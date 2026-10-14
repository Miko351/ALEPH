import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { ensureSchema } from '../src/schema.js';
import { getData, postData } from '../src/passkey-service.js';
import { HttpError } from '../src/security.js';

const origin = 'http://localhost:8000';
const rpID = 'localhost';
const b64 = (value) => Buffer.from(value).toString('base64url');
const sha = (value) => createHash('sha256').update(value).digest();

function cborHeader(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65536) return Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
  throw new Error('test CBOR length overflow');
}

function cbor(value) {
  if (typeof value === 'number') {
    return cborHeader(value >= 0 ? 0 : 1, value >= 0 ? value : -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);
    return Buffer.concat([cborHeader(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([cborHeader(2, value.length), Buffer.from(value)]);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([cborHeader(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(24);
  const cose = cbor(new Map([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
  return {
    id: b64(credentialId),
    register(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
      const counter = Buffer.alloc(4);
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha(rpID), Buffer.from([0x45]), counter, Buffer.alloc(16), idLength, credentialId, cose,
      ]);
      return {
        id: this.id, rawId: this.id, type: 'public-key',
        response: {
          clientDataJSON: b64(clientDataJSON),
          attestationObject: b64(cbor({ fmt: 'none', attStmt: {}, authData })),
          transports: ['internal'],
        },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      };
    },
    authenticate(challenge, invalid = false) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(1);
      const authData = Buffer.concat([sha(rpID), Buffer.from([0x05]), counter]);
      const signature = sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey);
      if (invalid) signature[0] ^= 0x01;
      return {
        id: this.id, rawId: this.id, type: 'public-key',
        response: {
          clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData),
          signature: b64(signature), userHandle: null,
        },
        clientExtensionResults: {}, authenticatorAttachment: 'platform',
      };
    },
  };
}

function request(cookie = '', query = '') {
  return new Request(`${origin}/api/passkey${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

async function post(db, action, data, cookie = '') {
  return postData(db, request(cookie), origin, rpID, { action, data });
}

async function register(db, username, device, cookie = '') {
  const mode = cookie ? 'add' : 'new';
  const start = (await post(db, 'registration-options', {
    mode, username, name: `${username} 기기`,
  }, cookie)).body;
  return post(db, 'registration-verify', {
    mode, challengeId: start.challengeId, response: device.register(start.options.challenge),
    ...(mode === 'new' ? { notes: [
      `${username}의 합성 프로젝트 메모`, `${username}의 합성 목록`, `${username}의 합성 회고`,
    ] } : {}),
  }, cookie);
}

test('공개 페이지와 비공개 응답은 분리된다', async () => {
  const page = await readFile('dist/index.html', 'utf8');
  const locked = await readFile('dist/private.html', 'utf8');
  assert.match(page, /패스키로 잠긴 자리/);
  assert.doesNotMatch(page + locked, /예시 기관 A와 예시 기관 B/);
  const db = createClient({ url: 'file::memory:' });
  try {
    await ensureSchema(db);
    await assert.rejects(getData(db, request('', '?action=private'), origin),
      (error) => error instanceof HttpError && error.status === 401);
  } finally { await db.close(); }
});

test('실제 서명·일회용 질문·계정 격리·두 패스키·삭제·로그아웃', async () => {
  const db = createClient({ url: 'file::memory:' });
  try {
    await ensureSchema(db);
    const aliceKey1 = authenticator();
    const aliceKey2 = authenticator();
    const bobKey = authenticator();
    const aliceRegistered = await register(db, 'alice-demo', aliceKey1);
    const aliceCookie = aliceRegistered.cookie.split(';')[0];
    assert.equal(aliceRegistered.body.registered, true);
    assert.equal((await getData(db, request(aliceCookie, '?action=private'), origin)).notes.length, 3);
    await register(db, 'alice-demo', aliceKey2, aliceCookie);
    const bobRegistered = await register(db, 'bob-demo', bobKey);
    const bobCookie = bobRegistered.cookie.split(';')[0];
    const aliceData = await getData(db, request(aliceCookie, '?action=private'), origin);
    const bobData = await getData(db, request(bobCookie, '?action=private'), origin);
    assert.notEqual(
      aliceData.notes.find((note) => note.title === '준비 중인 프로젝트').content,
      bobData.notes.find((note) => note.title === '준비 중인 프로젝트').content,
    );
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM passkeys')).rows[0].count, 3);
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM private_notes')).rows[0].count, 6);
    const publicKey = (await db.execute({
      sql: 'SELECT public_key FROM passkeys WHERE id = ?', args: [aliceKey1.id],
    })).rows[0].public_key;
    assert.ok(publicKey instanceof ArrayBuffer && publicKey.byteLength > 50);
    assert.deepEqual((await db.execute('PRAGMA table_info(users)')).rows.map((row) => row.name),
      ['id', 'username', 'created_at']);

    const bobId = (await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: ['bob-demo'] })).rows[0].id;
    const aliceId = (await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: ['alice-demo'] })).rows[0].id;
    assert.deepEqual(
      (await getData(db, request(aliceCookie, `?action=private&user_id=${bobId}`), origin)).notes,
      aliceData.notes,
    );
    assert.deepEqual(
      (await getData(db, request(bobCookie, `?action=private&user_id=${aliceId}`), origin)).notes,
      bobData.notes,
    );

    const bobNoteId = bobData.notes[0].id;
    assert.equal(
      (await getData(db, request(bobCookie, `?action=note&id=${bobNoteId}`), origin)).note.id,
      bobNoteId,
    );
    await assert.rejects(getData(db, request(aliceCookie, `?action=note&id=${bobNoteId}`), origin),
      (error) => error.status === 404);
    await assert.rejects(post(db, 'update-note', { id: bobNoteId, content: '침범' }, aliceCookie),
      (error) => error.status === 404);
    assert.equal((await getData(db, request(bobCookie, '?action=private'), origin)).notes[0].content,
      bobData.notes[0].content);
    await assert.rejects(post(db, 'delete-passkey', { id: bobKey.id }, aliceCookie),
      (error) => error.status === 404);

    const aliceNoteId = aliceData.notes[0].id;
    assert.equal(
      (await getData(db, request(aliceCookie, `?action=note&id=${aliceNoteId}`), origin)).note.id,
      aliceNoteId,
    );
    await assert.rejects(getData(db, request(bobCookie, `?action=note&id=${aliceNoteId}`), origin),
      (error) => error.status === 404);
    await assert.rejects(post(db, 'update-note', { id: aliceNoteId, content: '침범' }, bobCookie),
      (error) => error.status === 404);
    assert.equal((await getData(db, request(aliceCookie, '?action=private'), origin)).notes.length, 3);
    assert.equal((await getData(db, request(bobCookie, '?action=private'), origin)).notes.length, 3);

    const otherAccountStart = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    assert.equal(otherAccountStart.options.allowCredentials.some((item) => item.id === bobKey.id), false);
    await assert.rejects(post(db, 'authentication-verify', {
      challengeId: otherAccountStart.challengeId,
      response: bobKey.authenticate(otherAccountStart.options.challenge),
    }), (error) => error instanceof HttpError && error.status === 403 &&
      error.message === '이 계정의 패스키가 아닙니다.');

    const badStart = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    await assert.rejects(post(db, 'authentication-verify', {
      challengeId: badStart.challengeId,
      response: aliceKey1.authenticate(badStart.options.challenge, true),
    }), (error) => error.status === 401 && error.message === '패스키 서명 확인에 실패했습니다.');

    const loginStart = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    const distinctStart = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    assert.notEqual(loginStart.options.challenge, distinctStart.options.challenge);
    const signed = aliceKey1.authenticate(loginStart.options.challenge);
    const aliceLoggedIn = await post(db, 'authentication-verify', {
      challengeId: loginStart.challengeId, response: signed,
    });
    assert.equal(aliceLoggedIn.body.authenticated, true);
    await assert.rejects(post(db, 'authentication-verify', {
      challengeId: loginStart.challengeId, response: signed,
    }), (error) => error.status === 401 && error.message === '질문이 만료되었거나 이미 사용되었습니다.');

    const before = (await getData(db, request(aliceCookie, '?action=passkeys'), origin)).passkeys;
    assert.equal(before.length, 2);
    await post(db, 'delete-passkey', { id: aliceKey1.id }, aliceCookie);
    const remaining = (await getData(db, request(aliceCookie, '?action=passkeys'), origin)).passkeys;
    assert.deepEqual(remaining.map((row) => row.id), [aliceKey2.id]);
    await assert.rejects(post(db, 'delete-passkey', { id: aliceKey2.id }, aliceCookie),
      (error) => error.status === 409);

    const afterDelete = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    await assert.rejects(post(db, 'authentication-verify', {
      challengeId: afterDelete.challengeId,
      response: aliceKey1.authenticate(afterDelete.options.challenge),
    }), (error) => error.status === 403);
    const remainingStart = (await post(db, 'authentication-options', { username: 'alice-demo' })).body;
    const remainingLogin = await post(db, 'authentication-verify', {
      challengeId: remainingStart.challengeId,
      response: aliceKey2.authenticate(remainingStart.options.challenge),
    });
    assert.equal(remainingLogin.body.authenticated, true);

    await post(db, 'logout', {}, aliceCookie);
    await assert.rejects(getData(db, request(aliceCookie, '?action=private'), origin),
      (error) => error.status === 401);
    assert.equal((await getData(db, request(bobCookie, '?action=private'), origin)).notes.length, 3);
  } finally { await db.close(); }
});

test('등록 취소는 계정·패스키를 남기지 않고 등록 질문은 매번 바뀐다', async () => {
  const db = createClient({ url: 'file::memory:' });
  try {
    await ensureSchema(db);
    const first = (await post(db, 'registration-options', {
      mode: 'new', username: 'cancel-demo', name: '기기',
    })).body;
    const second = (await post(db, 'registration-options', {
      mode: 'new', username: 'cancel-demo', name: '기기',
    })).body;
    assert.notEqual(first.options.challenge, second.options.challenge);
    await post(db, 'cancel-challenge', { challengeId: first.challengeId });
    await post(db, 'cancel-challenge', { challengeId: second.challengeId });
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM users')).rows[0].count, 0);
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM passkeys')).rows[0].count, 0);
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM challenges')).rows[0].count, 0);
  } finally { await db.close(); }
});

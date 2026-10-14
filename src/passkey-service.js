import { randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  CHALLENGE_MS, HttpError, createSession, currentUser, logout, normalizeUsername,
  passkeyName, requireUser,
} from './security.js';

const nowIso = () => new Date().toISOString();
const one = (result) => result.rows[0] || null;

const noteTitles = ['준비 중인 프로젝트', '살펴볼 곳', '개인 회고'];

function checkedNewNotes(notes) {
  if (!Array.isArray(notes) || notes.length !== 3 || notes.some((value) =>
    typeof value !== 'string' || !value.trim() || value.length > 500)) {
    throw new HttpError('비공개 예시 메모 세 항목을 각각 1~500자로 입력해 주세요.');
  }
  return notes.map((value) => value.trim());
}

function newUserNotes(userId, contents) {
  const at = nowIso();
  return noteTitles.map((title, index) => ({
    id: randomUUID(), userId, title, content: contents[index], at,
  }));
}

async function listPasskeys(db, userId) {
  const result = await db.execute({
    sql: 'SELECT id, name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at, id',
    args: [userId],
  });
  return result.rows.map(({ id, name, created_at }) => ({ id, name, created_at }));
}

async function issueChallenge(db, data) {
  await db.execute({ sql: 'DELETE FROM challenges WHERE expires_at <= ?', args: [nowIso()] });
  const challengeId = randomUUID();
  await db.execute({
    sql: `INSERT INTO challenges
      (id, kind, user_id, pending_username, passkey_name, challenge, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [challengeId, data.kind, data.userId, data.username ?? null, data.name ?? null,
      data.challenge, new Date(Date.now() + CHALLENGE_MS).toISOString()],
  });
  return challengeId;
}

async function consumeChallenge(db, challengeId, kind) {
  if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/.test(challengeId)) {
    throw new HttpError('질문 값이 올바르지 않습니다.', 401);
  }
  const result = await db.execute({
    sql: 'DELETE FROM challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING *',
    args: [challengeId, kind, nowIso()],
  });
  const challenge = one(result);
  if (!challenge) throw new HttpError('질문이 만료되었거나 이미 사용되었습니다.', 401);
  return challenge;
}

export async function getData(db, request, origin) {
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'status') {
    const user = await currentUser(db, request, origin);
    return { authenticated: Boolean(user), username: user?.username ?? null };
  }
  const user = await requireUser(db, request, origin);
  if (action === 'private') {
    const result = await db.execute({
      sql: 'SELECT id, title, content, updated_at FROM private_notes WHERE user_id = ? ORDER BY title, id',
      args: [user.id],
    });
    return { username: user.username, notes: result.rows };
  }
  if (action === 'note') {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const note = one(await db.execute({
      sql: 'SELECT id, title, content, updated_at FROM private_notes WHERE id = ? AND user_id = ?',
      args: [id, user.id],
    }));
    if (!note) throw new HttpError('이 계정의 메모를 찾을 수 없습니다.', 404);
    return { note };
  }
  if (action === 'passkeys') return { passkeys: await listPasskeys(db, user.id) };
  throw new HttpError('지원하지 않는 조회입니다.', 404);
}

async function startRegistration(db, request, origin, rpID, data) {
  const mode = data.mode === 'add' ? 'add' : 'new';
  const name = passkeyName(data.name);
  let userId;
  let username;
  let excludeCredentials = [];
  if (mode === 'add') {
    const user = await requireUser(db, request, origin);
    userId = user.id;
    username = user.username;
    const current = await db.execute({
      sql: 'SELECT id, transports FROM passkeys WHERE user_id = ?', args: [userId],
    });
    excludeCredentials = current.rows.map((row) => ({
      id: row.id, transports: JSON.parse(row.transports),
    }));
  } else {
    if (await currentUser(db, request, origin)) throw new HttpError('새 계정은 로그아웃한 뒤 만드세요.', 409);
    username = normalizeUsername(data.username);
    const exists = await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] });
    if (exists.rows.length) throw new HttpError('이미 사용 중인 아이디입니다.', 409);
    userId = randomUUID();
  }
  const options = await generateRegistrationOptions({
    rpName: 'A Little Closer', rpID, userName: username, userDisplayName: username,
    userID: Uint8Array.from(Buffer.from(userId.replaceAll('-', ''), 'hex')),
    attestationType: 'none', excludeCredentials,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_MS,
  });
  const challengeId = await issueChallenge(db, {
    kind: mode === 'add' ? 'register-add' : 'register-new',
    userId, username: mode === 'new' ? username : null, name, challenge: options.challenge,
  });
  return { challengeId, options };
}

async function finishRegistration(db, request, origin, rpID, data) {
  const mode = data.mode === 'add' ? 'add' : 'new';
  const newNotes = mode === 'new' ? checkedNewNotes(data.notes) : null;
  if (mode === 'add') await requireUser(db, request, origin);
  const challenge = await consumeChallenge(db, data.challengeId,
    mode === 'add' ? 'register-add' : 'register-new');
  if (mode === 'add') {
    const user = await requireUser(db, request, origin);
    if (user.id !== challenge.user_id) throw new HttpError('다른 계정의 질문입니다.', 403);
  }
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: data.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
  } catch {
    throw new HttpError('패스키 등록 확인에 실패했습니다.', 401);
  }
  if (!verified.verified || !verified.registrationInfo) throw new HttpError('패스키 등록 확인에 실패했습니다.', 401);
  const credential = verified.registrationInfo.credential;
  const transports = credential.transports ?? data.response?.response?.transports ?? [];
  const at = nowIso();
  const tx = await db.transaction('write');
  try {
    if (mode === 'new') {
      const existing = await tx.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [challenge.pending_username] });
      if (existing.rows.length) throw new HttpError('이미 사용 중인 아이디입니다.', 409);
      await tx.execute({
        sql: 'INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)',
        args: [challenge.user_id, challenge.pending_username, at],
      });
    }
    await tx.execute({
      sql: `INSERT INTO passkeys (id, user_id, name, public_key, counter, transports, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [credential.id, challenge.user_id, challenge.passkey_name,
        credential.publicKey, credential.counter, JSON.stringify(transports), at],
    });
    if (mode === 'new') {
      for (const note of newUserNotes(challenge.user_id, newNotes)) {
        await tx.execute({
          sql: 'INSERT INTO private_notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)',
          args: [note.id, note.userId, note.title, note.content, note.at],
        });
      }
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    if (error instanceof HttpError) throw error;
    if (/unique|constraint/i.test(String(error.message))) throw new HttpError('이미 등록된 계정 또는 패스키입니다.', 409);
    throw error;
  }
  if (mode === 'add') return { body: { registered: true } };
  return {
    body: { registered: true, username: challenge.pending_username },
    cookie: await createSession(db, challenge.user_id, origin),
  };
}

async function startAuthentication(db, rpID, data) {
  const username = normalizeUsername(data.username);
  const user = one(await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] }));
  if (!user) throw new HttpError('등록된 패스키를 찾을 수 없습니다.', 401);
  const rows = (await db.execute({
    sql: 'SELECT id, transports FROM passkeys WHERE user_id = ?', args: [user.id],
  })).rows;
  if (!rows.length) throw new HttpError('등록된 패스키를 찾을 수 없습니다.', 401);
  const options = await generateAuthenticationOptions({
    rpID, allowCredentials: rows.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) })),
    userVerification: 'required', timeout: CHALLENGE_MS,
  });
  const challengeId = await issueChallenge(db, {
    kind: 'authenticate', userId: user.id, challenge: options.challenge,
  });
  return { challengeId, options };
}

async function finishAuthentication(db, origin, rpID, data) {
  const challenge = await consumeChallenge(db, data.challengeId, 'authenticate');
  const credential = one(await db.execute({
    sql: 'SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ? AND user_id = ?',
    args: [data.response?.id ?? '', challenge.user_id],
  }));
  if (!credential) throw new HttpError('이 계정의 패스키가 아닙니다.', 403);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: data.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: {
        id: credential.id, publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter), transports: JSON.parse(credential.transports),
      },
    });
  } catch {
    throw new HttpError('패스키 서명 확인에 실패했습니다.', 401);
  }
  if (!result.verified) throw new HttpError('패스키 서명 확인에 실패했습니다.', 401);
  await db.execute({
    sql: 'UPDATE passkeys SET counter = ? WHERE id = ? AND user_id = ?',
    args: [result.authenticationInfo.newCounter, credential.id, challenge.user_id],
  });
  return { body: { authenticated: true }, cookie: await createSession(db, challenge.user_id, origin) };
}

async function deletePasskey(db, request, origin, data) {
  const user = await requireUser(db, request, origin);
  const rows = await listPasskeys(db, user.id);
  if (!rows.some((row) => row.id === data.id)) throw new HttpError('이 계정의 패스키가 아닙니다.', 404);
  if (rows.length < 2) throw new HttpError('마지막 패스키는 삭제할 수 없습니다.', 409);
  const result = await db.execute({
    sql: `DELETE FROM passkeys WHERE id = ? AND user_id = ?
      AND (SELECT COUNT(*) FROM passkeys WHERE user_id = ?) > 1 RETURNING id`,
    args: [data.id, user.id, user.id],
  });
  if (!result.rows.length) throw new HttpError('마지막 패스키는 삭제할 수 없습니다.', 409);
  return { deleted: true, passkeys: await listPasskeys(db, user.id) };
}

async function updateNote(db, request, origin, data) {
  const user = await requireUser(db, request, origin);
  if (typeof data.content !== 'string' || data.content.length > 1000) {
    throw new HttpError('메모는 1000자 이내로 입력해 주세요.');
  }
  const result = await db.execute({
    sql: 'UPDATE private_notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING id',
    args: [data.content.trim(), nowIso(), data.id ?? '', user.id],
  });
  if (!result.rows.length) throw new HttpError('이 계정의 메모를 찾을 수 없습니다.', 404);
  return { saved: true };
}

export async function postData(db, request, origin, rpID, body) {
  const data = body?.data ?? {};
  switch (body?.action) {
    case 'registration-options': return { body: await startRegistration(db, request, origin, rpID, data) };
    case 'registration-verify': return finishRegistration(db, request, origin, rpID, data);
    case 'authentication-options': return { body: await startAuthentication(db, rpID, data) };
    case 'authentication-verify': return finishAuthentication(db, origin, rpID, data);
    case 'cancel-challenge': {
      if (typeof data.challengeId === 'string') {
        await db.execute({ sql: 'DELETE FROM challenges WHERE id = ?', args: [data.challengeId] });
      }
      return { body: { canceled: true } };
    }
    case 'delete-passkey': return { body: await deletePasskey(db, request, origin, data) };
    case 'update-note': return { body: await updateNote(db, request, origin, data) };
    case 'logout': return { body: { loggedOut: true }, cookie: await logout(db, request, origin) };
    default: throw new HttpError('지원하지 않는 작업입니다.', 404);
  }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GET, POST } from '../api/passkey.js';
import { getDb } from '../src/db.js';

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.TURSO_AUTH_TOKEN = 'local-test-only';

const url = 'http://localhost:8000/api/passkey';
const request = (action) => new Request(`${url}?action=${action}`);
const post = (action, data, origin = 'http://localhost:8000') => POST(new Request(url, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ action, data }),
}));

test('공개 HTML에 연락처가 남지 않는다', () => {
  for (const page of ['index.html', 'editorial-test.html', 'private.html']) {
    const html = readFileSync(new URL(`../dist/${page}`, import.meta.url), 'utf8');
    assert.equal(/mailto:|tel:|010[-. ]?\d{3,4}[-. ]?\d{4}/i.test(html), false,
      `${page}에 연락처가 남아 있습니다.`);
  }
});

test('페이지 이동 링크는 양쪽 상단 메뉴에 하나씩 있다', () => {
  for (const [page, destination] of [['index.html', 'private.html'], ['private.html', 'index.html']]) {
    const html = readFileSync(new URL(`../dist/${page}`, import.meta.url), 'utf8');
    const occurrences = [...html.matchAll(new RegExp(`href="${destination}"`, 'g'))];
    assert.equal(occurrences.length, 1, `${page}의 이동 링크가 중복됩니다.`);
    const navigation = html.match(/<nav class="masthead-links"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    assert.match(navigation, new RegExp(`href="${destination}"`));
  }
});

test('공개 소개의 중복 안내를 없애고 패스키 폼은 유지한다', () => {
  const publicHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const privateHtml = readFileSync(new URL('../dist/private.html', import.meta.url), 'utf8');
  assert.doesNotMatch(publicHtml, /class="private-entry"/);
  assert.match(privateHtml, /class="auth-access"/);
  assert.match(privateHtml, /id="login-form"/);
  assert.match(privateHtml, /id="register-form"/);
});

test('실제 API 응답: 공개 상태 200, 비로그인 비공개 자료 401, 타 출처 403', async () => {
  try {
    const status = await GET(request('status'));
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { authenticated: false, username: null });

    const privateResponse = await GET(request('private'));
    assert.equal(privateResponse.status, 401);
    assert.deepEqual(await privateResponse.json(), { error: '패스키 로그인이 필요합니다.' });
    assert.equal(privateResponse.headers.get('cache-control'), 'no-store');

    const otherOrigin = await post('registration-options', {
      mode: 'new', username: 'example-a', name: '기기',
    }, 'https://unrelated.example');
    assert.equal(otherOrigin.status, 403);

    const registration = await post('registration-options', {
      mode: 'new', username: 'example-a', name: '기기',
    });
    assert.equal(registration.status, 200);
    const { challengeId, options } = await registration.json();
    assert.ok(challengeId && options.challenge);
    const canceled = await post('cancel-challenge', { challengeId });
    assert.equal(canceled.status, 200);
    const db = getDb();
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM users')).rows[0].count, 0);
    assert.equal((await db.execute('SELECT COUNT(*) AS count FROM challenges')).rows[0].count, 0);
  } finally {
    await getDb().close();
  }
});

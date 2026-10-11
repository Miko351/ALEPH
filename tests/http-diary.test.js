import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('로그인한 계정만 첫날 기준·기록·내보내기를 볼 수 있다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-http-diary-'));
  process.env.PDS_LOCAL_DB_PATH = join(directory, 'records.db');
  const { POST: authPost } = await import('../api/auth.js');
  const { GET: dataGet, POST: dataPost } = await import('../api/data.js');
  const base = 'http://localhost:8000';
  const post = (path, handler, action, data, cookie = '') => handler(new Request(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pds-request': '1', origin: base, cookie },
    body: JSON.stringify({ action, data }),
  }));
  const get = (path, cookie = '') => dataGet(new Request(`${base}${path}`, { headers: { cookie } }));
  try {
    const password = randomUUID();
    const first = await post('/api/auth', authPost, 'register', { username: 'diaryalpha', password });
    const second = await post('/api/auth', authPost, 'register', { username: 'diarybeta', password });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstCookie = first.headers.get('set-cookie').split(';')[0];
    const secondCookie = second.headers.get('set-cookie').split(';')[0];
    const setup = {
      question: '오늘 실제 작업시간은?',
      metric_name: '실제 작업시간',
      unit: '분',
      plan_rule: '작업 전에 우선 작업 하나를 정한다.',
    };
    const configResponse = await post('/api/data', dataPost, 'diary.config', setup, firstCookie);
    assert.equal(configResponse.status, 200);
    const config = (await configResponse.json()).snapshot.diary.config;
    assert.equal(config.question, setup.question);
    assert.equal(config.metric_name, setup.metric_name);
    assert.equal(config.unit, setup.unit);
    assert.equal(config.plan_rule, setup.plan_rule);

    const repeatConfig = await post('/api/data', dataPost, 'diary.config', setup, firstCookie);
    assert.equal(repeatConfig.status, 409);
    const prematureChange = await post('/api/data', dataPost, 'diary.rule', {
      next_rule: '작업을 둘로 나눈다.', reason: '합성 검사',
    }, firstCookie);
    assert.equal(prematureChange.status, 409);

    const dayResponse = await post('/api/data', dataPost, 'diary.day', {
      value: 45, note: '합성 검사 값',
    }, firstCookie);
    assert.equal(dayResponse.status, 200);
    const diary = (await dayResponse.json()).snapshot.diary;
    assert.equal(diary.days.length, 1);
    assert.equal(diary.total, 45);
    assert.equal(diary.average, 45);
    const duplicate = await post('/api/data', dataPost, 'diary.day', { value: 60, note: '' }, firstCookie);
    assert.equal(duplicate.status, 409);
    assert.equal((await (await get('/api/data', firstCookie)).json()).diary.days.length, 1);

    const otherDiary = (await (await get('/api/data', secondCookie)).json()).diary;
    assert.equal(otherDiary.config, null);
    assert.equal(otherDiary.days.length, 0);
    const exportResponse = await get('/api/data?export=1', firstCookie);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition'), /attachment/);
    assert.equal((await exportResponse.json()).diary.days.length, 1);
    assert.equal((await get('/api/data')).status, 401);
  } finally {
    const { getDb } = await import('../src/db.js');
    await getDb().close();
    delete process.env.PDS_LOCAL_DB_PATH;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('HTTP 요청/응답에서 비로그인·양방향 침범·가장·로그아웃을 차단한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-http-'));
  process.env.PDS_LOCAL_DB_PATH = join(directory, 'records.db');
  const { GET: authGet, POST: authPost } = await import('../api/auth.js');
  const { GET: dataGet, POST: dataPost } = await import('../api/data.js');
  const base = 'http://localhost:8000';
  const post = (path, handler, action, data, cookie = '') => handler(new Request(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pds-request': '1', origin: base, cookie },
    body: JSON.stringify({ action, data }),
  }));
  const get = (path, handler, cookie = '', headers = {}) => handler(new Request(`${base}${path}`, {
    headers: { cookie, ...headers },
  }));
  const plan = (title) => ({ title, start_date: '2026-10-07', end_date: '', priority: 'medium',
    success_criteria: '테스트', estimate_minutes: 30, carried_note: '' });
  const task = (planId, title) => ({ plan_id: planId, title, deadline: '', priority: 'medium',
    tag: '', estimate_minutes: 30 });
  try {
    const testPassword = randomUUID();
    const anonymous = await get('/api/data', dataGet);
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: '로그인이 필요합니다.' });
    const aSign = await post('/api/auth', authPost, 'register', { username: 'httpalpha', password: testPassword });
    const bSign = await post('/api/auth', authPost, 'register', { username: 'httpbeta', password: testPassword });
    assert.equal(aSign.status, 200);
    assert.equal(bSign.status, 200);
    assert.ok(!JSON.stringify(await aSign.clone().json()).includes(testPassword));
    assert.ok(!JSON.stringify(await bSign.clone().json()).includes(testPassword));
    assert.match(aSign.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const bUserId = (await bSign.clone().json()).user.id;
    const aCookie = aSign.headers.get('set-cookie').split(';')[0];
    const bCookie = bSign.headers.get('set-cookie').split(';')[0];
    const oldImportRoute = await post('/api/auth', authPost, 'claim-legacy', {}, aCookie);
    assert.equal(oldImportRoute.status, 400);
    assert.deepEqual(await oldImportRoute.json(), { error: '지원하지 않는 작업입니다.' });
    const aPlan = await (await post('/api/data', dataPost, 'plan.create', plan('A 전용 계획'), aCookie)).json();
    const bPlan = await (await post('/api/data', dataPost, 'plan.create', plan('B 전용 계획'), bCookie)).json();
    const aTask = await (await post('/api/data', dataPost, 'task.create', task(aPlan.result, 'A 전용 할 일'), aCookie)).json();
    const bTask = await (await post('/api/data', dataPost, 'task.create', task(bPlan.result, 'B 전용 할 일'), bCookie)).json();
    for (const [attackerCookie, victimTask] of [[aCookie, bTask.result], [bCookie, aTask.result]]) {
      for (const response of [
        await get(`/api/data?task_id=${victimTask}`, dataGet, attackerCookie),
        await post('/api/data', dataPost, 'task.update', { ...task(aPlan.result, '침범'), id: victimTask }, attackerCookie),
        await post('/api/data', dataPost, 'task.delete', { id: victimTask }, attackerCookie),
      ]) {
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: '할 일을 찾을 수 없습니다.' });
      }
    }
    const foreignPlanCreate = await post('/api/data', dataPost, 'task.create',
      { ...task(bPlan.result, '소유자 위조'), owner_id: bUserId }, aCookie);
    assert.equal(foreignPlanCreate.status, 404);
    assert.deepEqual(await foreignPlanCreate.json(), { error: '계획을 찾을 수 없습니다.' });
    const aList = await (await get(`/api/data?owner_id=${bUserId}`, dataGet, aCookie, { 'x-owner-id': bUserId })).json();
    const bList = await (await get('/api/data', dataGet, bCookie)).json();
    assert.equal(aList.plans.length, 1);
    assert.equal(bList.plans.length, 1);
    assert.equal(aList.tasks.length, 1);
    assert.equal(bList.tasks.length, 1);
    assert.equal(aList.tasks[0].title, 'A 전용 할 일');
    assert.equal(bList.tasks[0].title, 'B 전용 할 일');
    assert.ok(!JSON.stringify(aList).includes('B 전용'));
    assert.ok(!JSON.stringify(bList).includes('A 전용'));
    assert.ok(!JSON.stringify(aList).includes(bUserId));
    assert.ok(!JSON.stringify(aList).includes(bPlan.result));
    assert.ok(!JSON.stringify(aList).includes(bTask.result));
    const spoofedBody = await post('/api/data', dataPost, 'task.update',
      { ...task(aPlan.result, 'A 본문 위조 검사'), id: aTask.result, owner_id: bUserId }, aCookie);
    assert.equal(spoofedBody.status, 200);
    const spoofedSnapshot = (await spoofedBody.json()).snapshot;
    assert.equal(spoofedSnapshot.tasks[0].title, 'A 본문 위조 검사');
    assert.equal(spoofedSnapshot.tasks[0].id, aTask.result);
    assert.ok(!JSON.stringify(spoofedSnapshot).includes('B 전용'));
    const bAfterSpoof = await (await get('/api/data', dataGet, bCookie)).json();
    assert.equal(bAfterSpoof.tasks.length, 1);
    assert.equal(bAfterSpoof.tasks[0].title, 'B 전용 할 일');
    const ownExport = await get('/api/data?export=1', dataGet, aCookie);
    assert.equal(ownExport.status, 200);
    assert.match(ownExport.headers.get('content-disposition'), /attachment; filename="plan-do-see-export\.json"/);
    const exported = await ownExport.json();
    assert.equal(exported.plans.length, 1);
    assert.equal(exported.tasks.length, 1);
    assert.ok(!JSON.stringify(exported).includes('B 전용'));
    assert.equal((await get(`/api/data?task_id=${aTask.result}`, dataGet, aCookie)).status, 200);
    assert.equal((await get(`/api/data?task_id=${bTask.result}`, dataGet, bCookie)).status, 200);
    const ownUpdate = await post('/api/data', dataPost, 'task.update',
      { ...task(aPlan.result, 'A 수정 완료'), id: aTask.result }, aCookie);
    assert.equal(ownUpdate.status, 200);
    assert.equal((await ownUpdate.json()).snapshot.tasks[0].title, 'A 수정 완료');
    const ownDelete = await post('/api/data', dataPost, 'task.delete', { id: aTask.result }, aCookie);
    assert.equal(ownDelete.status, 200);
    const deletedSnapshot = (await ownDelete.json()).snapshot;
    assert.ok(deletedSnapshot.tasks[0].deleted_at);
    assert.equal((await get(`/api/data?task_id=${aTask.result}`, dataGet, aCookie)).status, 404);
    assert.equal((await (await get('/api/data', dataGet, bCookie)).json()).tasks.length, 1);
    assert.equal((await post('/api/auth', authPost, 'logout', {}, aCookie)).status, 200);
    const afterLogout = await get('/api/data', dataGet, aCookie);
    assert.equal(afterLogout.status, 401);
    assert.deepEqual(await afterLogout.json(), { error: '로그인이 필요합니다.' });
    assert.deepEqual(await (await get('/api/auth', authGet, aCookie)).json(), {
      authenticated: false, user: null, expires_at: null,
    });
  } finally {
    const { getDb } = await import('../src/db.js');
    await getDb().close();
    delete process.env.PDS_LOCAL_DB_PATH;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { ensureSchema } from '../src/schema.js';
import { changePassword, deleteAccount, getSession, login, logout, register } from '../src/auth.js';
import { createPlan, createTask, deleteTask, loadSnapshot, readTask, updateTask } from '../src/model.js';

const request = (cookie = '') => new Request('http://localhost:8000/api/data', { headers: { cookie } });
const planInput = (title) => ({
  title, start_date: '2026-10-07', end_date: '', priority: 'medium',
  success_criteria: '본인 기록만 보기', estimate_minutes: 30, carried_note: '',
});
const taskInput = (planId, title) => ({
  plan_id: planId, title, deadline: '', priority: 'medium', tag: '', estimate_minutes: 30,
});

test('Argon2id, 세션 폐기, 양방향 자료 격리', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-auth-'));
  const db = createClient({ url: `file:${join(directory, 'records.db').replaceAll('\\', '/')}` });
  try {
    await ensureSchema(db);
    const password = randomUUID();
    const a = await register(db, { username: 'alpha_test', password }, request());
    const b = await register(db, { username: 'beta_test', password }, request());
    const sessionRow = (await db.execute({
      sql: 'SELECT created_at, expires_at FROM sessions WHERE user_id = ?', args: [a.user.id],
    })).rows[0];
    assert.equal(Date.parse(sessionRow.expires_at) - Date.parse(sessionRow.created_at), 12 * 60 * 60 * 1000);
    assert.equal(a.expiresAt, sessionRow.expires_at);
    assert.match(a.cookie, /HttpOnly; SameSite=Strict/);
    const hashes = (await db.execute('SELECT password_hash FROM users ORDER BY username')).rows;
    assert.notEqual(hashes[0].password_hash, hashes[1].password_hash);
    assert.ok(hashes.every((row) => row.password_hash.startsWith('$argon2id$')));
    assert.ok(await argon2.verify(hashes[0].password_hash, password));
    await assert.rejects(register(db, { username: 'alpha_test', password }, request()), (error) => error.status === 409);
    const wrongPassword = randomUUID();
    const wrong = await login(db, { username: 'alpha_test', password: wrongPassword }, request()).catch((error) => error);
    const unknown = await login(db, { username: 'absent_test', password: wrongPassword }, request()).catch((error) => error);
    assert.equal(wrong.message, unknown.message);

    const aPlan = await createPlan(db, planInput('A 전용 계획'), a.user.id);
    const bPlan = await createPlan(db, planInput('B 전용 계획'), b.user.id);
    const aTask = await createTask(db, taskInput(aPlan, 'A 전용 할 일'), a.user.id);
    const bTask = await createTask(db, taskInput(bPlan, 'B 전용 할 일'), b.user.id);
    for (const [attacker, victim, ownTitle, otherTitle] of [
      [a, bTask, 'A 전용 계획', 'B 전용 계획'],
      [b, aTask, 'B 전용 계획', 'A 전용 계획'],
    ]) {
      await assert.rejects(readTask(db, attacker.user.id, victim), (error) => error.status === 404);
      await assert.rejects(updateTask(db, { ...taskInput(aPlan, '침입 수정'), id: victim }, attacker.user.id), (error) => error.status === 404);
      await assert.rejects(deleteTask(db, { id: victim }, attacker.user.id), (error) => error.status === 404);
      const snapshot = await loadSnapshot(db, attacker.user.id);
      assert.equal(snapshot.plans.length, 1);
      assert.equal(snapshot.plans[0].title, ownTitle);
      assert.ok(!JSON.stringify(snapshot).includes(otherTitle));
    }
    assert.equal((await readTask(db, b.user.id, bTask)).title, 'B 전용 할 일');
    assert.equal((await readTask(db, a.user.id, aTask)).title, 'A 전용 할 일');

    const oldCookie = a.cookie;
    assert.ok(await getSession(db, request(oldCookie)));
    await logout(db, request(oldCookie));
    assert.equal(await getSession(db, request(oldCookie)), null);
    const expiryProbe = await login(db, { username: 'alpha_test', password }, request());
    assert.ok(await getSession(db, request(expiryProbe.cookie)));
    await db.execute({
      sql: 'UPDATE sessions SET expires_at = ? WHERE user_id = ?',
      args: ['2000-01-01T00:00:00.000Z', a.user.id],
    });
    assert.equal(await getSession(db, request(expiryProbe.cookie)), null);
    const relogin = await login(db, { username: 'alpha_test', password }, request());
    const replacementPassword = randomUUID();
    await changePassword(db, request(relogin.cookie), {
      current_password: password, new_password: replacementPassword,
    });
    assert.equal(await getSession(db, request(relogin.cookie)), null);
    await assert.rejects(login(db, { username: 'alpha_test', password }, request()), (error) => error.status === 401);
    const finalLogin = await login(db, { username: 'alpha_test', password: replacementPassword }, request());
    await deleteAccount(db, request(finalLogin.cookie), { password: replacementPassword });
    assert.equal(await getSession(db, request(finalLogin.cookie)), null);
    assert.equal((await loadSnapshot(db, a.user.id)).plans.length, 0);
    assert.equal((await loadSnapshot(db, b.user.id)).plans.length, 1);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

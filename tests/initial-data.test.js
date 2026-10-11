import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import seed from '../seed/initial-records.json' with { type: 'json' };
import { ensureSchema } from '../src/schema.js';
import { importInitialDataToOwner } from '../src/initial-data.js';
import { loadSnapshot, updateTask } from '../src/model.js';
import { register } from '../src/auth.js';

test('T06 초기 기록을 지정 계정에만 한 번 이전하고 이후 수정은 보존한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-seed-'));
  const url = `file:${join(directory, 'records.db').replaceAll('\\', '/')}`;
  let db = createClient({ url });
  try {
    await ensureSchema(db);
    const request = new Request('http://localhost:8000/api/auth');
    const account = await register(db, { username: 'legacytest', password: randomUUID() }, request);
    assert.equal((await importInitialDataToOwner(db, account.user.id)).movedPlans, seed.tables.plans.length);
    await assert.rejects(importInitialDataToOwner(db, account.user.id), { status: 409 });
    assert.equal(Number((await db.execute('SELECT COUNT(*) AS total FROM plans WHERE owner_id IS NULL')).rows[0].total), 0);
    const first = await loadSnapshot(db, account.user.id);
    for (const table of Object.keys(seed.tables)) {
      assert.equal(first[table].length, seed.tables[table].length, table);
      const storedById = new Map(first[table].map((row) => [row.id, row]));
      for (const source of seed.tables[table]) {
        const stored = storedById.get(source.id);
        assert.ok(stored, `${table}: ${source.id}`);
        for (const [field, value] of Object.entries(source)) {
          assert.equal(stored[field], value, `${table}.${field}`);
        }
      }
    }
    const changed = first.tasks[0];
    await updateTask(db, { ...changed, title: '배포 후 수정한 할 일' }, account.user.id);
    await db.close();

    db = createClient({ url });
    await ensureSchema(db);
    const second = await loadSnapshot(db, account.user.id);
    assert.equal(second.tasks.find((task) => task.id === changed.id).title, '배포 후 수정한 할 일');
    assert.equal(second.work_logs.length, first.work_logs.length);
  } finally {
    try { await db.close(); } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

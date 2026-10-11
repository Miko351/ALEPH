import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import seed from '../seed/initial-records.json' with { type: 'json' };
import { ensureSchema } from '../src/schema.js';
import { importInitialDataToOwner } from '../src/initial-data.js';
import { loadSnapshot } from '../src/model.js';
import { register } from '../src/auth.js';

test('새 인증 DB에서는 관리자 명령이 T06 자료를 한 계정에 한 번만 복원한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-import-'));
  const db = createClient({ url: `file:${join(directory, 'records.db').replaceAll('\\', '/')}` });
  try {
    await ensureSchema(db);
    const request = new Request('http://localhost:8000/api/auth');
    const owner = await register(db, { username: 'importowner', password: randomUUID() }, request);
    const other = await register(db, { username: 'otheruser', password: randomUUID() }, request);
    const result = await importInitialDataToOwner(db, owner.user.id);
    assert.equal(result.movedPlans, seed.tables.plans.length);
    const restored = await loadSnapshot(db, owner.user.id);
    assert.equal(restored.plans.length, seed.tables.plans.length);
    assert.equal(restored.tasks.length, seed.tables.tasks.length);
    assert.equal(restored.work_logs.length, seed.tables.work_logs.length);
    assert.equal((await loadSnapshot(db, other.user.id)).plans.length, 0);
    assert.equal((await db.execute("SELECT COUNT(*) AS total FROM bootstrap_runs WHERE name = 't07-legacy-claim-v1'")).rows[0].total, 1);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

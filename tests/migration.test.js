import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { register, login } from '../src/auth.js';
import { ensureSchema } from '../src/schema.js';
import { importInitialDataToOwner } from '../src/initial-data.js';
import { changeDiaryRule, saveDiaryDay, setDiaryConfig } from '../src/diary.js';
import { copyMigration, inspectMigration } from '../scripts/migrate-local-to-turso.mjs';

test('빈 대상에 계정·자료·5일 기록을 옮기고 기존 비밀번호로 로그인한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-migration-'));
  const source = createClient({ url: `file:${join(directory, 'source.db').replaceAll('\\', '/')}` });
  const target = createClient({ url: `file:${join(directory, 'target.db').replaceAll('\\', '/')}` });
  try {
    await ensureSchema(source);
    const password = randomUUID();
    const request = new Request('http://localhost:8000/api/auth');
    const account = await register(source, { username: 'migration_test', password }, request);
    await importInitialDataToOwner(source, account.user.id);
    await setDiaryConfig(source, {
      question: '오늘 실제 작업시간은?', metric_name: '실제 작업시간', unit: '분',
      plan_rule: '우선 작업을 정한다.',
    }, account.user.id, new Date('2026-10-07T03:00:00Z'));
    for (let day = 7; day <= 11; day++) {
      if (day === 9) {
        await changeDiaryRule(source, { next_rule: '우선 작업과 예상시간을 정한다.', reason: '비교하기 위해' },
          account.user.id, new Date('2026-10-09T02:00:00Z'));
      }
      await saveDiaryDay(source, { value: day, note: '' }, account.user.id,
        new Date(`2026-10-${String(day).padStart(2, '0')}T03:00:00Z`));
    }

    const preview = await inspectMigration(source, target, 'migration_test');
    assert.equal(preview.sourceCounts.users, 1);
    assert.equal(preview.sourceCounts.diary_days, 5);
    assert.equal(preview.targetCounts.users, 0);
    const result = await copyMigration(source, target, 'migration_test');
    assert.equal(result.users, 1);
    assert.equal(result.plans, 2);
    assert.equal(result.tasks, 6);
    assert.equal(result.work_logs, 16);
    assert.equal(result.diary_days, 5);
    assert.equal(result.diary_rule_changes, 1);
    assert.equal(result.sessions, 0);
    assert.equal((await login(target, { username: 'migration_test', password }, request)).user.id,
      account.user.id);
    await assert.rejects(copyMigration(source, target, 'migration_test'),
      /대상 DB에 이미 앱 데이터가 있습니다/);
  } finally {
    await source.close();
    await target.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

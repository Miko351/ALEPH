import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { ensureSchema } from '../src/schema.js';
import { changeDiaryRule, readDiary, saveDiaryDay, setDiaryConfig } from '../src/diary.js';

test('합성 시계로만 5일·중복·2일차 뒤 규칙 변경을 검증한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-diary-'));
  const db = createClient({ url: `file:${join(directory, 'records.db').replaceAll('\\', '/')}` });
  const ownerId = randomUUID();
  const at = (day) => new Date(`2026-10-${day}T03:00:00.000Z`);
  try {
    await ensureSchema(db);
    await db.execute({ sql: 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      args: [ownerId, 'diarytest', 'synthetic-test-hash', at('07').toISOString()] });
    await setDiaryConfig(db, {
      question: '계획한 시간을 지켰나?', metric_name: '실제 작업시간', unit: '분', plan_rule: '매일 30분 계획',
    }, ownerId, at('07'));
    await saveDiaryDay(db, { value: 20, note: '' }, ownerId, at('07'));
    await assert.rejects(saveDiaryDay(db, { value: 30, note: '' }, ownerId, at('07')), (error) => error.status === 409);
    await saveDiaryDay(db, { value: 40, note: '' }, ownerId, at('08'));
    await assert.rejects(saveDiaryDay(db, { value: 50, note: '' }, ownerId, at('09')), (error) => error.status === 409);
    const changed = await changeDiaryRule(db, { next_rule: '매일 20분 계획', reason: '첫 이틀이 길었다' }, ownerId, at('08'));
    assert.equal(changed.rule_change.day1_kst, '2026-10-07');
    assert.equal(changed.rule_change.day2_kst, '2026-10-08');
    await saveDiaryDay(db, { value: 10, note: '' }, ownerId, at('09'));
    await saveDiaryDay(db, { value: '', note: '값을 측정하지 못함' }, ownerId, at('10'));
    await saveDiaryDay(db, { value: 30, note: '' }, ownerId, at('11'));
    const diary = await readDiary(db, ownerId);
    assert.equal(diary.days.length, 5);
    assert.equal(diary.total, 100);
    assert.equal(diary.average, 25);
    assert.equal(diary.counted_days, 4);
    assert.equal(diary.days[3].value, null);
    await assert.rejects(saveDiaryDay(db, { value: 40, note: '' }, ownerId, at('12')), (error) => error.status === 409);
    await assert.rejects(changeDiaryRule(db, { next_rule: '또 변경', reason: '반복' }, ownerId, at('12')), (error) => error.status === 409);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

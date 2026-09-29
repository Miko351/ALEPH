import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIME_ZONE, SOURCE_URL, emptyState, kstDate, normalizeLive, applySuccess,
  applyError, runFixture, restoreState, mergeDailyStates
} from '../dist/core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = resolve(root, 'dist/fixtures');
const files = {
  'T04-NORMAL-D1-A': 'normal-d1-a.json',
  'T04-NORMAL-D1-B': 'normal-d1-b.json',
  'T04-NORMAL-D2': 'normal-d2.json',
  'T04-TIMEOUT': 'timeout.json',
  'T04-AUTH-401': 'auth-401.json',
  'T04-RATE-429': 'rate-429.json',
  'T04-OFFLINE': 'offline.json',
  'T04-SCHEMA-BREAK': 'schema-break.json',
  'T04-RECOVER-D2': 'recover-d2.json'
};
const fixtures = Object.fromEntries(Object.entries(files).map(([id, file]) => [
  id, JSON.parse(readFileSync(resolve(fixtureDir, file), 'utf8'))
]));
function play(state, id) {
  assert.equal(fixtures[id].fixture_id, id);
  return runFixture(state, fixtures[id]);
}
function baseline() {
  return play(play(emptyState(), 'T04-NORMAL-D1-A'), 'T04-NORMAL-D1-B');
}

let day1 = play(emptyState(), 'T04-NORMAL-D1-A');
assert.equal(day1.daily_readings.length, 1);
assert.equal(day1.current_reading.normalized_value, 100);
const firstId = day1.daily_readings[0].record_id;
day1 = play(day1, 'T04-NORMAL-D1-B');
assert.equal(day1.daily_readings.length, 1);
assert.equal(day1.daily_readings[0].record_id, firstId);
assert.equal(day1.current_reading.normalized_value, 105);
day1 = play(day1, 'T04-NORMAL-D1-B');
assert.equal(day1.daily_readings.length, 1);
assert.equal(day1.daily_readings[0].record_id, firstId);
const day2 = play(day1, 'T04-NORMAL-D2');
assert.equal(day2.daily_readings.length, 2);
assert.equal(day2.last_delta, 15);
assert.deepEqual(day2.status, { freshness: 'fresh', error_code: 'none' });
console.log('C20·C21: 같은 날짜 3회 성공 뒤 1행, 다음 날짜 2행 · +15 PASS');

const failures = {
  'T04-TIMEOUT': 'timeout',
  'T04-AUTH-401': 'auth',
  'T04-RATE-429': 'rate_limit',
  'T04-OFFLINE': 'offline',
  'T04-SCHEMA-BREAK': 'schema_error'
};
for (const [id, code] of Object.entries(failures)) {
  const failed = play(baseline(), id);
  assert.deepEqual(failed.status, { freshness: 'stale', error_code: code });
  assert.equal(failed.current_reading.normalized_value, 105);
  assert.equal(failed.daily_readings.length, 1);
  assert.equal(failed.daily_readings[0].record_id, firstId);
  console.log(`C12~C18: ${id} → stale/${code}, 마지막 정상값 105 보존 PASS`);
}
const failed = play(baseline(), 'T04-TIMEOUT');
const recovered = play(failed, 'T04-RECOVER-D2');
assert.deepEqual(recovered.status, { freshness: 'fresh', error_code: 'none' });
assert.equal(recovered.daily_readings.length, 2);
assert.equal(recovered.daily_readings.filter(row => row.record_date === '2026-08-25').length, 1);
assert.equal(recovered.current_reading.normalized_value, 120);
assert.equal(recovered.last_delta, 15);
console.log('C19: 다시 시도 → fresh/none, 다음 날짜 신규 1행 · 120 · +15 PASS');

const fetchedAt = '2026-09-29T02:20:00.000Z';
const raw = {
  timezone: 'Asia/Seoul',
  current_units: { temperature_2m: '°C' },
  current: { time: '2026-09-29T11:15', temperature_2m: 21.4 }
};
const reading = normalizeLive(raw, fetchedAt);
assert.equal(reading.signal_id, 'daejeon-temperature-2m');
assert.equal(reading.normalized_value, raw.current.temperature_2m);
assert.equal(reading.unit, raw.current_units.temperature_2m);
assert.equal(reading.source_time, '2026-09-29T02:15:00.000Z');
assert.equal(reading.fetched_at, fetchedAt);
assert.equal(reading.record_date, '2026-09-29');
assert.equal(reading.record_timezone, TIME_ZONE);
assert.equal(reading.source_url, SOURCE_URL);
assert.equal(kstDate('2026-09-29T14:59:59.000Z'), '2026-09-29');
assert.equal(kstDate('2026-09-29T15:00:00.000Z'), '2026-09-30');
const stored = applySuccess(emptyState(), reading, { raw_response: raw });
assert.deepEqual(stored.daily_readings[0].raw_response, raw);
assert.deepEqual(restoreState(stored).current_reading, reading);
assert.equal(mergeDailyStates(stored, stored).daily_readings.length, 1);
assert.throws(() => normalizeLive({ ...raw, current: { ...raw.current, temperature_2m: '21.4' } }, fetchedAt));
assert.throws(() => restoreState({ schema_version: 1, daily_readings: [{ bad: true }] }));
assert.equal(applyError(stored, 'offline').daily_readings[0].normalized_value, 21.4);
console.log('실제 원천 정규화 경로: 값·단위·출처 시각·KST 날짜·원자료 보존 및 손상값 거부 PASS (입력은 합성 시험값)');

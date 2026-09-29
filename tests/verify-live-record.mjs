import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLive, restoreState, SOURCE_URL } from '../dist/core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const document = JSON.parse(readFileSync(resolve(root, 'dist/data/published-live.json'), 'utf8'));
const state = restoreState(document);

assert.deepEqual(state.daily_readings.map(row => row.record_date), ['2026-09-28', '2026-09-29']);
for (const row of state.daily_readings) {
  assert.equal(row.reading.source_url, SOURCE_URL);
  assert.deepEqual(normalizeLive(row.raw_response, row.last_fetched_at), row.reading);
  assert.equal(row.raw_response.current.temperature_2m, row.normalized_value);
  assert.equal(row.raw_response.current_units.temperature_2m, row.unit);
  console.log(`${row.record_date}: ${row.normalized_value} ${row.unit} · 파일 내부 원자료/저장값 대조 PASS`);
}
assert.equal(state.current_reading.normalized_value, 21.4);
assert.equal(Math.round(state.last_delta * 10) / 10, 0.4);
console.log('두 저장 행의 변화값 +0.4 °C PASS (실제 조회 날짜의 독립 검증은 별개)');

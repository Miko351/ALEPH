import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLive, restoreState, SOURCE_URL } from '../dist/core.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const document = JSON.parse(readFileSync(resolve(root, 'dist/data/published-live.json'), 'utf8'));
const state = restoreState(document);

assert.equal(state.daily_readings.length, 1);
const row = state.daily_readings[0];
assert.equal(row.record_date, '2026-09-29');
assert.equal(row.reading.source_url, SOURCE_URL);
assert.deepEqual(normalizeLive(row.raw_response, row.last_fetched_at), row.reading);
assert.equal(row.raw_response.current.temperature_2m, row.normalized_value);
assert.equal(row.raw_response.current_units.temperature_2m, row.unit);
assert.equal(row.reading.normalized_value, state.current_reading.normalized_value);
assert.equal(row.reading.source_time, '2026-09-29T02:30:00.000Z');
assert.equal(row.last_fetched_at, '2026-09-29T02:35:02.504Z');

console.log(`첫날 공개 기록: ${row.record_date} · ${row.normalized_value} ${row.unit} · 원자료/저장값 대조 PASS`);

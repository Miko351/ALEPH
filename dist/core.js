export const TIME_ZONE = 'Asia/Seoul';
export const SIGNAL_ID = 'daejeon-temperature-2m';
export const SOURCE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=36.35&longitude=127.38&current=temperature_2m&timezone=Asia%2FSeoul';
export const PACKAGE_ID = 'aleph-t04-real-information-board-public-contract-v2';
export const ERROR_CODES = Object.freeze(['timeout', 'auth', 'rate_limit', 'offline', 'schema_error']);

const READING_KEYS = Object.freeze([
  'signal_id', 'normalized_value', 'unit', 'source_name', 'source_url',
  'source_time', 'fetched_at', 'record_timezone', 'record_date'
]);

export function kstDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) throw new TypeError('올바른 시각이 아닙니다.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateReading(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new TypeError('값 형식이 다릅니다.');
  const keys = Object.keys(reading).sort();
  const expected = [...READING_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('필수 값의 구성이 다릅니다.');
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) ||
      !Number.isFinite(reading.normalized_value) ||
      typeof reading.unit !== 'string' || !reading.unit.trim() ||
      typeof reading.source_name !== 'string' || !reading.source_name.trim()) {
    throw new TypeError('값 또는 단위 형식이 다릅니다.');
  }
  try {
    if (new URL(reading.source_url).protocol !== 'https:') throw new Error();
  } catch { throw new TypeError('출처 주소가 올바르지 않습니다.'); }
  if (reading.source_time !== null && Number.isNaN(new Date(reading.source_time).getTime())) {
    throw new TypeError('출처 시각이 올바르지 않습니다.');
  }
  if (Number.isNaN(new Date(reading.fetched_at).getTime()) ||
      reading.record_timezone !== TIME_ZONE ||
      reading.record_date !== kstDate(reading.fetched_at)) {
    throw new TypeError('조회 날짜 또는 시간대가 올바르지 않습니다.');
  }
  return reading;
}

export function normalizeLive(raw, fetchedAt = new Date().toISOString()) {
  const current = raw?.current;
  const units = raw?.current_units;
  const sourceTime = current?.time;
  const match = typeof sourceTime === 'string'
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(sourceTime)
    : null;
  if (raw?.timezone !== TIME_ZONE || !match ||
      !Number.isFinite(current?.temperature_2m) || units?.temperature_2m !== '°C') {
    throw new TypeError('원천 응답의 기온·단위·기준 시각 형식이 바뀌었습니다.');
  }
  const observed = new Date(`${match[1]}:${match[2] || '00'}+09:00`);
  if (Number.isNaN(observed.getTime())) throw new TypeError('원천 기준 시각을 해석할 수 없습니다.');
  return validateReading({
    signal_id: SIGNAL_ID,
    normalized_value: current.temperature_2m,
    unit: units.temperature_2m,
    source_name: 'Open-Meteo Forecast API · 모델 기반 현재 기온',
    source_url: SOURCE_URL,
    source_time: observed.toISOString(),
    fetched_at: new Date(fetchedAt).toISOString(),
    record_timezone: TIME_ZONE,
    record_date: kstDate(fetchedAt)
  });
}

export function emptyState() {
  return {
    schema_version: 1,
    daily_readings: [],
    current_reading: null,
    status: null,
    last_delta: null,
    last_run: null
  };
}

function compare(rows, current) {
  const previous = rows
    .filter(row => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
  return previous && previous.unit === current.unit
    ? current.normalized_value - previous.normalized_value
    : null;
}

export function applySuccess(inputState, reading, meta = {}) {
  validateReading(reading);
  const state = structuredClone(inputState);
  const key = `${reading.signal_id}:${reading.record_date}`;
  const index = state.daily_readings.findIndex(row => `${row.signal_id}:${row.record_date}` === key);
  const prior = index < 0 ? null : state.daily_readings[index];
  const row = {
    record_id: prior?.record_id || key,
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: prior?.first_fetched_at || reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading: structuredClone(reading),
    raw_response: meta.raw_response ?? prior?.raw_response ?? null
  };
  if (index < 0) state.daily_readings.push(row);
  else state.daily_readings[index] = row;
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  state.current_reading = structuredClone(reading);
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_delta = compare(state.daily_readings, row);
  state.last_run = {
    fixture_id: meta.fixture_id || null,
    outcome: 'success',
    error_code: 'none',
    at: meta.virtual_now || reading.fetched_at,
    retry_after_seconds: null
  };
  return state;
}

export function applyError(inputState, errorCode, meta = {}) {
  if (!ERROR_CODES.includes(errorCode)) throw new TypeError('알 수 없는 오류 종류입니다.');
  const state = structuredClone(inputState);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.last_run = {
    fixture_id: meta.fixture_id || null,
    outcome: 'error',
    error_code: errorCode,
    at: meta.virtual_now || new Date().toISOString(),
    retry_after_seconds: meta.retry_after_seconds ?? null
  };
  return state;
}

export function runFixture(state, fixture) {
  if (fixture?.contract_version !== '1.1.0' || !fixture.transport ||
      !/^T04-[A-Z0-9-]+$/.test(fixture.fixture_id)) {
    throw new TypeError('합성 자료의 형식이 다릅니다.');
  }
  const transport = fixture.transport;
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: transport.headers?.['retry-after']
      ? Number(transport.headers['retry-after']) : null
  };
  if (transport.mode === 'offline') return applyError(state, 'offline', meta);
  if (transport.mode === 'timeout' || transport.delay_ms > transport.deadline_ms) {
    return applyError(state, 'timeout', meta);
  }
  if (transport.status === 401 || transport.status === 403) return applyError(state, 'auth', meta);
  if (transport.status === 429) return applyError(state, 'rate_limit', meta);
  if (transport.status >= 200 && transport.status < 300) {
    try { return applySuccess(state, fixture.payload, meta); }
    catch { return applyError(state, 'schema_error', meta); }
  }
  return applyError(state, 'schema_error', meta);
}

export function restoreState(value) {
  if (!value || value.schema_version !== 1 || !Array.isArray(value.daily_readings) ||
      value.daily_readings.length > 366) throw new TypeError('저장 기록 형식이 다릅니다.');
  const state = emptyState();
  const keys = new Set();
  for (const row of value.daily_readings) {
    validateReading(row?.reading);
    const key = `${row.reading.signal_id}:${row.reading.record_date}`;
    if (keys.has(key) || row.record_date !== row.reading.record_date ||
        row.normalized_value !== row.reading.normalized_value ||
        row.unit !== row.reading.unit) throw new TypeError('일별 기록이 손상됐습니다.');
    keys.add(key);
    state.daily_readings.push(structuredClone(row));
  }
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  const last = state.daily_readings.at(-1);
  if (last) {
    state.current_reading = structuredClone(last.reading);
    state.last_delta = compare(state.daily_readings, last);
  }
  return state;
}

export function mergeDailyStates(published, local) {
  const rows = new Map();
  for (const state of [published, local]) {
    for (const row of state.daily_readings) {
      const key = `${row.signal_id}:${row.record_date}`;
      const prior = rows.get(key);
      if (!prior || row.last_fetched_at > prior.last_fetched_at) rows.set(key, row);
    }
  }
  return restoreState({ schema_version: 1, daily_readings: [...rows.values()] });
}

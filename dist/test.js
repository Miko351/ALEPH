import { emptyState, runFixture } from './core.js';

const $ = id => document.getElementById(id);
const FIXTURE_FILES = Object.freeze({
  'T04-NORMAL-D1-A': 'normal-d1-a.json',
  'T04-NORMAL-D1-B': 'normal-d1-b.json',
  'T04-NORMAL-D2': 'normal-d2.json',
  'T04-TIMEOUT': 'timeout.json',
  'T04-AUTH-401': 'auth-401.json',
  'T04-RATE-429': 'rate-429.json',
  'T04-OFFLINE': 'offline.json',
  'T04-SCHEMA-BREAK': 'schema-break.json',
  'T04-RECOVER-D2': 'recover-d2.json'
});
const ERROR_COPY = Object.freeze({
  timeout: ['응답이 너무 늦습니다.', '제한 시간 안에 값을 받지 못했습니다.', '잠시 뒤 다시 시도하세요.'],
  auth: ['외부 원천이 요청을 거절했습니다.', '외부 원천의 401/403 응답입니다. 이 사이트에 로그인하라는 뜻이 아닙니다.', '원천 상태를 확인한 뒤 다시 시도하세요.'],
  rate_limit: ['외부 원천의 호출 제한입니다.', '짧은 시간에 요청이 많아 429 응답을 받았습니다.', '요청 간격을 두고 다시 시도하세요.'],
  offline: ['연결이 끊겼습니다.', '네트워크에 연결하지 못했습니다.', '인터넷 연결을 확인한 뒤 다시 시도하세요.'],
  schema_error: ['응답 형식이 달라졌습니다.', '필요한 값·단위·시각을 신뢰할 수 없어 이번 응답을 저장하지 않았습니다.', '원천 응답을 확인한 뒤 다시 시도하세요.']
});

const fixtures = new Map();
let demoState = emptyState();
let fixtureReady = false;

function formatDelta(value, unit) {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} ${unit}`;
}

function describeError(code, retryAfter) {
  const [title, description, action] = ERROR_COPY[code] || ERROR_COPY.schema_error;
  return { title, description, action: code === 'rate_limit' && Number.isFinite(retryAfter)
    ? `${retryAfter}초 이상 기다린 뒤 다시 시도하세요.` : action };
}

function renderDemo() {
  const reading = demoState.current_reading;
  const status = demoState.status;
  const lastRun = demoState.last_run;
  const badge = $('demo-badge');
  const value = $('demo-value');
  value.replaceChildren(document.createTextNode(reading ? String(reading.normalized_value) : '—'));
  const unit = document.createElement('small');
  unit.textContent = reading?.unit || 'pt';
  value.append(' ', unit);
  $('demo-code').textContent = status?.error_code || 'none';
  $('demo-rows').textContent = String(demoState.daily_readings.length);
  $('demo-delta').textContent = formatDelta(demoState.last_delta, reading?.unit || 'pt');
  $('demo-fixture').textContent = lastRun?.fixture_id || '—';
  badge.className = 'badge';
  if (status?.freshness === 'stale') {
    const copy = describeError(status.error_code, lastRun?.retry_after_seconds);
    badge.classList.add('badge-stale');
    badge.textContent = '오래된 값 · stale';
    $('demo-title').textContent = copy.title;
    $('demo-description').textContent = `${copy.description} 마지막 정상값 ${reading?.normalized_value ?? '없음'} ${reading?.unit || ''}을 보존했습니다.`;
    $('demo-next').textContent = `다음 행동: ${copy.action} 아래 버튼으로 복구를 시험할 수 있습니다.`;
  } else if (status?.freshness === 'fresh') {
    badge.classList.add('badge-fresh');
    badge.textContent = '정상 · fresh';
    $('demo-title').textContent = lastRun?.fixture_id === 'T04-RECOVER-D2' ? '다시 시도 뒤 복구됐습니다.' : '정상값을 저장했습니다.';
    $('demo-description').textContent = `같은 날짜는 한 줄로 갱신하고 다음 날짜는 새 줄을 추가했습니다. 현재 ${demoState.daily_readings.length}일 기록입니다.`;
    $('demo-next').textContent = '다른 상황을 선택하면 처음부터 다시 재생됩니다.';
  } else {
    badge.classList.add('badge-neutral');
    badge.textContent = '재생 전';
    $('demo-title').textContent = '상황을 선택해 주세요.';
    $('demo-description').textContent = '각 상황에서 마지막 정상값과 상태가 어떻게 바뀌는지 볼 수 있습니다.';
    $('demo-next').textContent = '왼쪽에서 상황 하나를 선택하세요.';
  }
  const ledger = $('demo-ledger');
  ledger.replaceChildren();
  for (const row of demoState.daily_readings) {
    const item = document.createElement('li');
    item.textContent = `${row.record_date} · ${row.normalized_value} ${row.unit}`;
    ledger.append(item);
  }
  $('demo-announcement').textContent = `${badge.textContent}. ${$('demo-title').textContent} ${$('demo-description').textContent}`;
}

function play(id) {
  const fixture = fixtures.get(id);
  if (!fixtureReady || !fixture) throw new Error('합성 자료가 준비되지 않았습니다.');
  demoState = runFixture(demoState, fixture);
}

function prepareBaseline() {
  demoState = emptyState();
  play('T04-NORMAL-D1-A');
  play('T04-NORMAL-D1-B');
}

function onScenario(type) {
  try {
    prepareBaseline();
    if (type === 'next-day') play('T04-NORMAL-D2');
    $('demo-retry').disabled = true;
    document.querySelectorAll('[data-failure]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    renderDemo();
  } catch (error) { $('demo-announcement').textContent = error.message; }
}

function onFailure(id) {
  try {
    prepareBaseline();
    play(id);
    $('demo-retry').disabled = false;
    document.querySelectorAll('[data-failure]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.failure === id)));
    renderDemo();
  } catch (error) { $('demo-announcement').textContent = error.message; }
}

function onRetry() {
  try {
    if (demoState.status?.freshness !== 'stale') return;
    play('T04-RECOVER-D2');
    $('demo-retry').disabled = true;
    document.querySelectorAll('[data-failure]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    renderDemo();
  } catch (error) { $('demo-announcement').textContent = error.message; }
}

async function loadFixtures() {
  for (const [id, file] of Object.entries(FIXTURE_FILES)) {
    const response = await fetch(`./fixtures/${file}`);
    if (!response.ok) throw new Error(`${file} 파일을 열 수 없습니다.`);
    const fixture = await response.json();
    if (fixture.fixture_id !== id) throw new Error(`${file}의 ID가 다릅니다.`);
    fixtures.set(id, fixture);
  }
  fixtureReady = true;
}

$('demo-retry').addEventListener('click', onRetry);
document.querySelectorAll('[data-scenario]').forEach(button =>
  button.addEventListener('click', () => onScenario(button.dataset.scenario)));
document.querySelectorAll('[data-failure]').forEach(button =>
  button.addEventListener('click', () => onFailure(button.dataset.failure)));
renderDemo();
loadFixtures().catch(error => {
  $('demo-description').textContent = error.message;
  $('demo-announcement').textContent = error.message;
});

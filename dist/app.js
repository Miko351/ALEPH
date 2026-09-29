import {
  TIME_ZONE, SOURCE_URL, emptyState, restoreState, mergeDailyStates,
  normalizeLive, applySuccess, applyError
} from './core.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'aleph-daily-board-live-v1';
const ERROR_COPY = Object.freeze({
  timeout: ['응답이 너무 늦습니다.', '제한 시간 안에 새 값이 오지 않았습니다.', '잠시 뒤 다시 조회하세요.'],
  auth: ['외부 원천이 요청을 거절했습니다.', '원천의 401/403 응답입니다. 이 사이트의 로그인이 필요한 것은 아닙니다.', '원천 상태를 확인한 뒤 다시 조회하세요.'],
  rate_limit: ['외부 원천의 호출 제한입니다.', '짧은 시간에 요청이 많아 429 응답을 받았습니다.', '요청 간격을 두고 다시 조회하세요.'],
  offline: ['연결이 끊겼습니다.', '새 값을 받지 못했습니다.', '인터넷 연결을 확인한 뒤 다시 조회하세요.'],
  schema_error: ['응답 형식이 달라졌습니다.', '기온·단위·시각을 신뢰할 수 없어 이번 값은 저장하지 않았습니다.', '잠시 뒤 다시 조회하세요.']
});

let liveState = emptyState();
let publishedState = emptyState();
let fetching = false;
let storageWarning = '';

function formatTime(value) {
  if (!value) return '제공되지 않음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시각 확인 불가';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date) + ' KST';
}

function formatDelta(value, unit) {
  if (value === null || value === undefined) return '두 날짜가 모이면 표시';
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} ${unit}`;
}

function setMessage(message, error = false) {
  $('live-status').textContent = message;
  $('live-status').classList.toggle('is-error', error);
}

function saveLive() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(liveState)); }
  catch { storageWarning = '브라우저에 기록하지 못했습니다. 새로고침하면 새 기록이 사라질 수 있습니다.'; }
}

function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  const rows = [...liveState.daily_readings].reverse();
  $('row-count').textContent = `${rows.length}일`;
  if (!rows.length) {
    const item = document.createElement('li');
    item.className = 'history-empty';
    item.textContent = '아직 저장된 실제 날짜 기록이 없습니다.';
    list.append(item);
    return;
  }
  for (const row of rows) {
    const published = publishedState.daily_readings.find(entry =>
      entry.signal_id === row.signal_id && entry.record_date === row.record_date &&
      entry.last_fetched_at === row.last_fetched_at
    );
    const item = document.createElement('li');
    item.className = 'history-item';
    const heading = document.createElement('div');
    heading.className = 'history-item-top';
    const date = document.createElement('strong');
    date.textContent = row.record_date;
    const value = document.createElement('span');
    value.textContent = `${row.normalized_value} ${row.unit}`;
    heading.append(date, value);
    const updated = document.createElement('p');
    updated.className = 'history-updated';
    updated.append(document.createTextNode('마지막 조회 '));
    const updatedTime = document.createElement('time');
    updatedTime.dateTime = row.last_fetched_at;
    updatedTime.textContent = formatTime(row.last_fetched_at);
    updated.append(updatedTime);
    const sourceTime = document.createElement('p');
    sourceTime.className = 'history-source';
    sourceTime.textContent = `자료 기준 ${formatTime(row.reading.source_time)} · ${published ? '공개 기록' : '이 브라우저에 저장'}`;
    const sourceLink = document.createElement('a');
    sourceLink.className = 'history-source-link';
    sourceLink.href = row.reading.source_url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = '원천 주소 열기';
    item.append(heading, updated, sourceTime, sourceLink);
    list.append(item);
  }
}

function renderLive() {
  const reading = liveState.current_reading;
  const status = liveState.status;
  const badge = $('live-badge');
  $('live-value').textContent = reading ? String(reading.normalized_value) : '—';
  $('live-unit').textContent = reading?.unit || '°C';
  $('live-delta').textContent = formatDelta(liveState.last_delta, reading?.unit || '°C');
  $('source-time').textContent = reading ? formatTime(reading.source_time) : '—';
  $('fetched-time').textContent = reading ? formatTime(reading.fetched_at) : '—';
  $('record-date').textContent = reading?.record_date || '—';
  $('source-link').href = reading?.source_url || 'https://open-meteo.com/en/docs';
  badge.className = 'badge';
  if (status?.freshness === 'stale') {
    badge.classList.add('badge-stale');
    badge.textContent = '오래된 값';
    $('live-context').textContent = reading
      ? '새 조회가 실패했습니다. 마지막 정상값을 표시 중입니다.'
      : '새 조회가 실패했고 아직 보존된 정상값이 없습니다.';
  } else if (status?.freshness === 'fresh') {
    badge.classList.add('badge-fresh');
    badge.textContent = '정상 조회';
    $('live-context').textContent = '새 값을 확인했습니다. 자료 기준 시각과 조회 시각을 함께 확인하세요.';
  } else {
    badge.classList.add('badge-neutral');
    badge.textContent = reading ? '저장된 값' : '조회 전';
    $('live-context').textContent = reading
      ? '저장된 기록입니다. 현재 상태는 다시 조회해야 확인할 수 있습니다.'
      : '아직 정상 조회 기록이 없습니다.';
  }
  renderHistory();
}

function describeError(code, retryAfter) {
  const [title, description, action] = ERROR_COPY[code] || ERROR_COPY.schema_error;
  return { title, description, action: code === 'rate_limit' && Number.isFinite(retryAfter)
    ? `${retryAfter}초 이상 기다린 뒤 다시 조회하세요.` : action };
}

async function refreshLive() {
  if (fetching) return;
  fetching = true;
  $('live-refresh').disabled = true;
  setMessage('Open-Meteo에서 대전의 현재 기온을 조회 중입니다.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let phase = 'request';
  try {
    if (!navigator.onLine) throw Object.assign(new Error('offline'), { code: 'offline' });
    const response = await fetch(SOURCE_URL, { signal: controller.signal, cache: 'no-store' });
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('auth'), { code: 'auth' });
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error('rate_limit'), {
        code: 'rate_limit', retryAfter: Number.isFinite(seconds) ? seconds : null
      });
    }
    if (!response.ok) throw Object.assign(new Error('unexpected response'), { code: 'schema_error' });
    phase = 'parse';
    const raw = await response.json();
    const reading = normalizeLive(raw, new Date().toISOString());
    liveState = applySuccess(liveState, reading, { raw_response: raw });
    saveLive();
    renderLive();
    setMessage(`${reading.record_date} 기록을 저장했습니다. ${storageWarning}`.trim());
  } catch (error) {
    const code = error.code || (controller.signal.aborted ? 'timeout' : phase === 'parse' ? 'schema_error' : 'offline');
    liveState = applyError(liveState, code, { retry_after_seconds: error.retryAfter });
    saveLive();
    renderLive();
    const copy = describeError(code, error.retryAfter);
    setMessage(`${copy.title} ${copy.description} ${copy.action} 마지막 정상값은 보존했습니다.`, true);
  } finally {
    clearTimeout(timer);
    fetching = false;
    $('live-refresh').disabled = false;
  }
}

async function loadStored() {
  try {
    const response = await fetch('./data/published-live.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('공개 기록을 읽을 수 없습니다.');
    publishedState = restoreState(await response.json());
  } catch {
    publishedState = emptyState();
    storageWarning = '공개 기록 파일을 읽지 못했습니다.';
  }
  let local = emptyState();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) local = restoreState(JSON.parse(saved));
  } catch { storageWarning = '이 브라우저의 이전 저장값이 손상돼 사용하지 않았습니다.'; }
  liveState = mergeDailyStates(publishedState, local);
  renderLive();
}

$('live-refresh').addEventListener('click', refreshLive);
await loadStored();
refreshLive();

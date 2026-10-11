const $ = (selector) => document.querySelector(selector);
const state = {
  user: null,
  snapshot: null,
  selectedPlanId: null,
  tab: 'plan',
  editingPlan: false,
  editingTaskId: null,
  evidenceMetric: null,
};

const priorityText = { high: '높음', medium: '보통', low: '낮음' };
const priorityRank = { high: 0, medium: 1, low: 2 };
const metricLabels = {
  planned_count: ['계획한 할 일', '건'],
  completed_count: ['완료', '건'],
  overdue_count: ['지연', '건'],
  blocked_count: ['막힌 이력', '건'],
  estimated_minutes: ['예상 시간', '분'],
  actual_minutes: ['실제 시간', '분'],
  difference_minutes: ['실제 − 예상', '분'],
};

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function add(parent, ...children) {
  parent.append(...children.filter(Boolean));
  return parent;
}

function empty(message) {
  return element('p', 'empty-state', message);
}

function formatKst(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function planWithLatestWork(data) {
  const taskPlanById = new Map(data.tasks.filter((task) => !task.deleted_at)
    .map((task) => [task.id, task.plan_id]));
  const latestLog = [...data.work_logs]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .find((log) => taskPlanById.has(log.task_id));
  if (latestLog) return taskPlanById.get(latestLog.task_id);
  return data.plans.find((plan) => data.tasks.some((task) => task.plan_id === plan.id && !task.deleted_at))?.id
    ?? data.plans[0]?.id ?? null;
}

function planPeriod(plan) {
  return `${plan.start_date} ~ ${plan.end_date || '진행 중 (종료일 미정)'}`;
}

function notice(message, isError = false) {
  const box = $('#message');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
}

function authNotice(message, isError = false, target = '#auth-message') {
  const box = $(target);
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = !message;
}

function showAuth() {
  state.user = null;
  state.snapshot = null;
  state.selectedPlanId = null;
  $('#app-shell').hidden = true;
  $('#auth-screen').hidden = false;
  $('#signed-in-as').textContent = '';
  $('.skip-link').href = '#auth-heading';
  if ($('#account-dialog').open) $('#account-dialog').close();
}

async function authRequest(action, data = {}) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pds-request': '1' },
    body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '인증 요청을 처리하지 못했습니다.');
  return body;
}

async function showApp(user) {
  state.user = user;
  $('#signed-in-as').textContent = `${user.username} 님`;
  $('.skip-link').href = '#content';
  $('#auth-screen').hidden = true;
  $('#app-shell').hidden = false;
  await load();
}

async function restoreSession() {
  try {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '서버 연결을 확인해 주세요.');
    if (body.authenticated) await showApp(body.user);
    else showAuth();
  } catch (error) {
    showAuth();
    authNotice(error.message, true);
  }
}

async function load() {
  try {
    const response = await fetch('/api/data', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) return showAuth();
      throw new Error(data.error ?? '기록을 불러오지 못했습니다.');
    }
    state.snapshot = data;
    if (!data.plans.some((plan) => plan.id === state.selectedPlanId)) {
      state.selectedPlanId = planWithLatestWork(data);
    }
    render();
  } catch (error) {
    notice(error.message, true);
  }
}

async function mutate(action, data) {
  try {
    const response = await fetch('/api/data', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-pds-request': '1' },
      body: JSON.stringify({ action, data }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) showAuth();
      throw new Error(body.error ?? '저장하지 못했습니다.');
    }
    state.snapshot = body.snapshot;
    render();
    return body.result;
  } catch (error) {
    notice(error.message, true);
    return null;
  }
}

function selectedPlan() {
  return state.snapshot?.plans.find((plan) => plan.id === state.selectedPlanId) ?? null;
}

function activeTasks() {
  return (state.snapshot?.tasks ?? []).filter((task) => task.plan_id === state.selectedPlanId && !task.deleted_at);
}

function planFields(form) {
  return Object.fromEntries(['title', 'start_date', 'end_date', 'priority', 'success_criteria',
    'estimate_minutes', 'carried_note'].map((key) => [key, form.elements.namedItem(key).value]));
}

function fillPlanForm(plan) {
  const form = $('#plan-form');
  for (const key of ['title', 'start_date', 'end_date', 'priority', 'success_criteria',
    'estimate_minutes', 'carried_note']) {
    form.elements.namedItem(key).value = plan?.[key] ?? (key === 'priority' ? 'medium' : '');
  }
  state.editingPlan = Boolean(plan);
  $('#plan-form-heading').textContent = plan ? '계획 수정' : '새 계획';
  $('#plan-submit').textContent = plan ? '수정 내용 저장' : '계획 저장';
  $('#plan-cancel').hidden = !plan;
}

function fillTaskForm(task) {
  const form = $('#task-form');
  for (const key of ['title', 'deadline', 'priority', 'tag', 'estimate_minutes', 'estimate_basis']) {
    form.elements.namedItem(key).value = task?.[key] ?? (key === 'priority' ? 'medium' : key === 'estimate_basis' ? 'planned' : '');
  }
  state.editingTaskId = task?.id ?? null;
  $('#task-form-heading').textContent = task ? '할 일 수정' : '할 일 추가';
  $('#task-submit').textContent = task ? '수정 내용 저장' : '할 일 저장';
  $('#task-cancel').hidden = !task;
}

function renderSwitcher() {
  const select = $('#plan-select');
  const taskPlanById = new Map((state.snapshot?.tasks ?? []).filter((task) => !task.deleted_at)
    .map((task) => [task.id, task.plan_id]));
  const logCounts = new Map();
  for (const log of state.snapshot?.work_logs ?? []) {
    const planId = taskPlanById.get(log.task_id);
    if (planId) logCounts.set(planId, (logCounts.get(planId) ?? 0) + 1);
  }
  const options = (state.snapshot?.plans ?? []).map((plan) => {
    const option = element('option', '', `${plan.title} · 실행 ${logCounts.get(plan.id) ?? 0}건`);
    option.value = plan.id;
    return option;
  });
  if (!options.length) {
    const option = element('option', '', '계획을 먼저 만들어 주세요');
    option.value = '';
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = state.selectedPlanId ?? '';
  $('#today-label').textContent = `${state.snapshot?.today ?? ''} · Asia/Seoul`;
}

function meta(label, value) {
  const cell = element('div');
  add(cell, element('dt', '', label), element('dd', '', value));
  return cell;
}

function renderPlan() {
  const plan = selectedPlan();
  $('#edit-plan').hidden = !plan;
  const current = $('#current-plan');
  const history = $('#plan-history');
  if (!plan) {
    current.replaceChildren(empty('계획을 저장하면 이곳에 현재 내용이 나타납니다.'));
    history.replaceChildren(empty('아직 이력이 없습니다.'));
    $('#version-count').textContent = '0개 버전';
    return;
  }
  const metaList = element('dl', 'plan-meta');
  add(metaList,
    meta('기간', planPeriod(plan)),
    meta('우선순위', priorityText[plan.priority]),
    meta('예상 시간', `${plan.estimate_minutes}분`),
    meta('현재 버전', `${plan.revision}판`),
    meta('계획 ID', plan.id));
  const criteria = element('div', 'current-criteria');
  add(criteria, element('small', '', '성공 기준'), element('span', '', plan.success_criteria));
  current.replaceChildren(element('h4', 'current-title', plan.title), metaList, criteria);
  if (plan.carried_note) current.append(element('p', 'carried-note', `이전 돌아보기 · ${plan.carried_note}`));
  const versions = state.snapshot.plan_versions.filter((version) => version.plan_id === plan.id);
  $('#version-count').textContent = `${versions.length}개 버전`;
  history.replaceChildren(...versions.slice().reverse().map((version) => {
    const card = element('article', 'version');
    add(card,
      element('strong', '', `${version.revision}판 · ${version.title}`),
      element('small', '', `${formatKst(version.saved_at)} · ${planPeriod(version)} · 우선순위 ${priorityText[version.priority]} · 예상 ${version.estimate_minutes}분`),
      element('p', '', `성공 기준 · ${version.success_criteria}`),
      version.carried_note ? element('p', '', `이어받은 개선점 · ${version.carried_note}`) : null);
    return card;
  }));
}

function filteredTasks() {
  let tasks = activeTasks();
  const term = $('#task-search').value.trim().toLocaleLowerCase();
  if (term) tasks = tasks.filter((task) => `${task.title} ${task.tag}`.toLocaleLowerCase().includes(term));
  const filter = $('#task-filter').value;
  if (filter === 'open' || filter === 'completed') tasks = tasks.filter((task) => task.status === filter);
  if (filter === 'overdue') tasks = tasks.filter((task) => task.status === 'open' && task.deadline && task.deadline < state.snapshot.today);
  const sort = $('#task-sort').value;
  tasks.sort((a, b) => {
    const deadline = !a.deadline ? (!b.deadline ? 0 : 1) : !b.deadline ? -1 : a.deadline.localeCompare(b.deadline);
    const highFirst = priorityRank[a.priority] - priorityRank[b.priority];
    const created = a.created_at.localeCompare(b.created_at);
    if (sort === 'priority') return highFirst || deadline || created || a.id.localeCompare(b.id);
    if (sort === 'created') return created || deadline || highFirst || a.id.localeCompare(b.id);
    return deadline || highFirst || created || a.id.localeCompare(b.id);
  });
  return tasks;
}

function taskButton(label, action, id, danger = false) {
  const button = element('button', `mini-button${danger ? ' danger' : ''}`, label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderTasks() {
  const list = $('#task-list');
  const tasks = filteredTasks();
  const sortDescription = {
    deadline: '마감일 빠른 순(미정은 뒤) → 우선순위 높은 순 → 등록 시각 → ID',
    priority: '우선순위 높은 순 → 마감일 빠른 순(미정은 뒤) → 등록 시각 → ID',
    created: '등록 시각 빠른 순 → 마감일 빠른 순(미정은 뒤) → 우선순위 높은 순 → ID',
  }[$('#task-sort').value];
  $('.sort-note').textContent = `정렬 기준: ${sortDescription}. 값이 같아도 순서는 일정합니다.`;
  $('#task-count').textContent = String(activeTasks().length);
  if (!selectedPlan()) {
    list.replaceChildren(empty('Plan에서 계획을 먼저 만들어 주세요.'));
    return;
  }
  if (!tasks.length) {
    list.replaceChildren(empty(activeTasks().length ? '현재 검색·필터 조건에 맞는 할 일이 없습니다.' : '계획에 딸린 할 일을 추가해 주세요.'));
    return;
  }
  list.replaceChildren(...tasks.map((task) => {
    const card = element('article', `task-card${task.status === 'completed' ? ' is-done' : ''}`);
    const left = element('div');
    const taskMeta = element('div', 'task-meta');
    const workLogs = state.snapshot.work_logs.filter((log) => log.task_id === task.id);
    const actualMinutes = Math.round(workLogs.reduce((sum, log) => sum + Number(log.actual_seconds), 0) / 6) / 10;
    const latestWork = workLogs.reduce((latest, log) => !latest || log.started_at > latest.started_at ? log : latest, null);
    add(taskMeta,
      element('span', '', `마감 ${task.deadline || '미정'}`),
      element('span', '', `우선순위 ${priorityText[task.priority]}`),
      element('span', '', `예상 ${task.estimate_minutes}분${task.estimate_basis === 'retrospective' ? ' · 사후 추정' : ''}`),
      element('span', '', `실행 ${workLogs.length}건 · 실제 ${actualMinutes}분`),
      task.tag ? element('span', '', `#${task.tag}`) : null,
      element('span', '', task.status === 'completed' ? '완료' : '진행 중'));
    add(left, element('h4', '', task.title), taskMeta,
      latestWork ? element('p', 'task-latest-work', `최근 한 일 · ${formatKst(latestWork.started_at)} · ${latestWork.work_summary}`) : null);
    const actions = element('div', 'task-actions');
    add(actions,
      taskButton(task.status === 'completed' ? '되돌리기' : '완료', task.status === 'completed' ? 'reopen' : 'complete', task.id),
      taskButton('수정', 'edit', task.id),
      taskButton('삭제', 'delete', task.id, true));
    return add(card, left, actions);
  }));
}

function renderLogs() {
  const tasks = activeTasks();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const select = $('#log-task');
  const previous = select.value;
  const options = tasks.map((task) => {
    const option = element('option', '', task.title);
    option.value = task.id;
    return option;
  });
  const initial = element('option', '', tasks.length ? '할 일을 선택해 주세요' : '할 일을 먼저 추가해 주세요');
  initial.value = '';
  select.replaceChildren(initial, ...options);
  select.value = taskById.has(previous) ? previous : '';
  const logs = state.snapshot.work_logs.filter((log) => taskById.has(log.task_id))
    .sort((a, b) => b.started_at.localeCompare(a.started_at) || a.id.localeCompare(b.id));
  $('#log-count').textContent = `${logs.length}건`;
  const list = $('#log-list');
  if (!logs.length) {
    list.replaceChildren(empty('선택한 계획에는 실행 기록이 없습니다. 다른 계획의 기록은 상단에서 계획을 바꿔 확인할 수 있습니다.'));
    return;
  }
  list.replaceChildren(...logs.map((log) => {
    const card = element('article', 'log-card');
    add(card,
      element('h4', '', log.work_title || log.work_summary || '실행 기록'),
      element('div', 'log-meta', `${formatKst(log.started_at)} → ${formatKst(log.ended_at)} · 실제 ${Math.round(log.actual_seconds / 6) / 10}분`),
      element('p', 'log-task', `연결된 할 일 · ${taskById.get(log.task_id).title}`),
      log.work_summary ? element('p', 'log-summary', `한 일 · ${log.work_summary}`) : null,
      log.blocker_reason ? element('p', '', `막힌 이유 · ${log.blocker_reason}`) : null);
    return card;
  }));
}

function currentSee() {
  return state.snapshot.see.find((item) => item.plan_id === state.selectedPlanId) ?? null;
}

function renderEvidence() {
  const list = $('#evidence-list');
  const metric = state.evidenceMetric;
  $('#evidence-subtitle').textContent = metric ? metricLabels[metric][0] : '숫자를 선택해 주세요';
  if (!metric || !selectedPlan()) {
    list.replaceChildren(empty('집계 숫자를 누르면 연결된 기록이 보입니다.'));
    return;
  }
  const tasks = activeTasks();
  const ids = new Set(tasks.map((task) => task.id));
  const logs = state.snapshot.work_logs.filter((log) => ids.has(log.task_id));
  const blocked = new Set(logs.filter((log) => log.blocker_reason.trim()).map((log) => log.task_id));
  let sourceTasks = tasks;
  let sourceLogs = [];
  if (metric === 'completed_count') sourceTasks = tasks.filter((task) => task.status === 'completed');
  if (metric === 'overdue_count') sourceTasks = tasks.filter((task) => task.status === 'open' && task.deadline && task.deadline < state.snapshot.today);
  if (metric === 'blocked_count') {
    sourceTasks = tasks.filter((task) => blocked.has(task.id));
    sourceLogs = logs.filter((log) => log.blocker_reason.trim());
  }
  if (metric === 'actual_minutes') {
    sourceTasks = [];
    sourceLogs = logs;
  }
  if (metric === 'difference_minutes') sourceLogs = logs;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const records = [
    ...sourceTasks.map((task) => {
      const row = element('article', 'evidence-row');
      add(row, element('strong', '', task.title),
        element('p', '', `마감 ${task.deadline || '미정'} · ${task.status === 'completed' ? '완료' : '진행 중'} · 예상 ${task.estimate_minutes}분${task.estimate_basis === 'retrospective' ? ' (사후 추정)' : ''}`));
      return row;
    }),
    ...sourceLogs.map((log) => {
      const row = element('article', 'evidence-row');
      add(row, element('strong', '', `실행 · ${log.work_title || log.work_summary || '실행 기록'}`),
        element('p', '', `연결된 할 일 · ${taskById.get(log.task_id)?.title ?? '할 일'}`),
        element('p', '', `${formatKst(log.started_at)} → ${formatKst(log.ended_at)} · 실제 ${Math.round(log.actual_seconds / 6) / 10}분${log.blocker_reason ? ` · 막힌 이유: ${log.blocker_reason}` : ''}`),
        log.work_summary ? element('p', '', `한 일 · ${log.work_summary}`) : null);
      return row;
    }),
  ];
  list.replaceChildren(...(records.length ? records : [empty('이 숫자에 해당하는 기록이 없습니다.') ]));
}

function renderSee() {
  const see = currentSee();
  const note = $('#estimate-note');
  const hasRetrospective = activeTasks().some((task) => task.estimate_basis === 'retrospective');
  note.hidden = !hasRetrospective;
  note.textContent = hasRetrospective ? '예상 시간에 사후 추정치가 포함되어 있습니다. 실제 − 예상 차이는 작업 전에 세운 계획과의 오차가 아닙니다.' : '';
  const grid = $('#metric-grid');
  grid.replaceChildren(...Object.entries(metricLabels).map(([key, [label, unit]]) => {
    const button = element('button', `metric-card${state.evidenceMetric === key ? ' is-active' : ''}`);
    button.type = 'button';
    button.dataset.metric = key;
    add(button, element('span', '', label), element('strong', '', see?.[key] ?? 0), element('small', '', unit === '분' ? '기록으로 확인하기 · 분' : '기록으로 확인하기 · 건'));
    return button;
  }));
  renderEvidence();
  const sourceId = state.selectedPlanId;
  const reviews = state.snapshot.reviews.filter((review) => review.source_plan_id === sourceId);
  const list = $('#review-list');
  list.replaceChildren(...reviews.map((review) => {
    const next = state.snapshot.plans.find((plan) => plan.id === review.next_plan_id);
    const row = element('article', 'review-row');
    add(row, element('strong', '', review.improvement_line), element('small', '', `다음 계획: ${next?.title ?? '확인할 수 없음'} · ${formatKst(review.created_at)}`));
    return row;
  }));
}

function renderDiary() {
  const diary = state.snapshot.diary;
  if (!diary) return;
  const { config, days, rule_change: change } = diary;
  $('#diary-setup-section').hidden = Boolean(config);
  $('#diary-day-section').hidden = !config || days.length >= 5 ||
    days.some((day) => day.day_kst === state.snapshot.today) || (days.length === 2 && !change);
  $('#diary-rule-section').hidden = !config || days.length !== 2 || Boolean(change);
  $('#diary-comparison').hidden = !change;
  $('#diary-count').textContent = `${days.length}/5일`;
  if (!config) return;
  $('#diary-today').textContent = `오늘 ${state.snapshot.today} · Asia/Seoul`;
  $('#diary-value-label').firstChild.textContent = `${config.metric_name} (${config.unit})`;
  const summary = $('#diary-summary');
  const rules = element('dl', 'diary-rules');
  for (const [label, value] of [
    ['질문', config.question], ['지표', `${config.metric_name} · ${config.unit}`],
    ['계산', config.calculation_rule], ['빈 값', config.missing_rule],
    ['중복', config.duplicate_rule], ['튀는 값', config.outlier_rule],
    ['반올림', config.rounding_rule], ['주 시작', config.week_start],
    ['처음 계획 규칙', config.plan_rule],
  ]) add(rules, meta(label, value));
  const values = element('p', 'diary-total', `합계 ${diary.total.toFixed(2)} ${config.unit} · 평균 ${diary.average === null ? '—' : diary.average.toFixed(2)} ${config.unit} · 계산에 포함된 날 ${diary.counted_days}일`);
  summary.replaceChildren(rules, values);
  $('#diary-days').replaceChildren(...days.map((day, index) => {
    const row = element('article', 'diary-day');
    const rule = index < 2 ? '변경 전' : '변경 후';
    add(row, element('strong', '', `${index + 1}일차 · ${day.day_kst} · ${rule}`),
      element('span', '', day.value === null ? '값 없음' : `${Number(day.value).toFixed(2)} ${config.unit}`),
      day.note ? element('p', '', day.note) : null);
    return row;
  }));
  if (!change) return;
  $('#diary-change-details').replaceChildren(
    element('p', '', `바꾼 시각 · ${formatKst(change.changed_at)} (Asia/Seoul)`),
    element('p', '', `가리키는 기록 · 1일차 ${change.day1_kst} / 2일차 ${change.day2_kst}`),
    element('p', '', `이전 규칙 · ${change.previous_rule}`),
    element('p', '', `바꾼 규칙 · ${change.next_rule}`),
    element('p', '', `이유 · ${change.reason}`),
  );
  const before = days.slice(0, 2).map((day) => day.value).filter((value) => value !== null);
  const after = days.slice(2).map((day) => day.value).filter((value) => value !== null);
  const average = (values) => values.length
    ? `${(values.reduce((sum, value) => sum + Number(value), 0) / values.length).toFixed(2)} ${config.unit}`
    : '값 없음';
  $('#diary-before-after').replaceChildren(
    element('p', '', `변경 전 ${before.length}일 평균 · ${average(before)}`),
    element('p', '', `변경 후 ${after.length}일 평균 · ${average(after)}`),
    element('small', '', `같은 지표: ${config.metric_name} · 같은 단위: ${config.unit} · 같은 계산: ${config.calculation_rule}`),
  );
}

function render() {
  if (!state.snapshot) return;
  renderSwitcher();
  renderPlan();
  renderTasks();
  renderLogs();
  renderSee();
  renderDiary();
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  for (const name of ['plan', 'do', 'see', 'diary']) $(`#${name}-panel`).hidden = name !== state.tab;
}

for (const [selector, action, fields, success] of [
  ['#diary-setup-form', 'diary.config', ['question', 'metric_name', 'unit', 'plan_rule'], '첫날 기준을 고정했습니다.'],
  ['#diary-day-form', 'diary.day', ['value', 'note'], '오늘 기록을 저장했습니다.'],
  ['#diary-rule-form', 'diary.rule', ['next_rule', 'reason'], '규칙 변경을 기록했습니다.'],
]) {
  $(selector).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(fields.map((field) => [field, form.elements.namedItem(field).value]));
    const result = await mutate(action, data);
    if (!result) return;
    form.reset();
    notice(success);
  });
}

document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  state.tab = button.dataset.tab;
  render();
  $('#content').focus({ preventScroll: true });
}));

$('#plan-select').addEventListener('change', (event) => {
  state.selectedPlanId = event.target.value || null;
  state.evidenceMetric = null;
  fillPlanForm(null);
  fillTaskForm(null);
  render();
});

$('#plan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = planFields(event.currentTarget);
  const editing = state.editingPlan;
  if (editing) data.id = state.selectedPlanId;
  const result = await mutate(editing ? 'plan.update' : 'plan.create', data);
  if (!result) return;
  state.selectedPlanId = result;
  fillPlanForm(null);
  render();
  notice(editing ? '계획 수정 이력을 남겼습니다.' : '계획을 저장했습니다.');
});

$('#edit-plan').addEventListener('click', () => {
  fillPlanForm(selectedPlan());
  $('#plan-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#plan-form').elements.namedItem('title').focus({ preventScroll: true });
});
$('#plan-cancel').addEventListener('click', () => fillPlanForm(null));

$('#task-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedPlan()) return notice('계획을 먼저 만들어 주세요.', true);
  const form = event.currentTarget;
  const data = Object.fromEntries(['title', 'deadline', 'priority', 'tag', 'estimate_minutes', 'estimate_basis']
    .map((key) => [key, form.elements.namedItem(key).value]));
  const editing = Boolean(state.editingTaskId);
  data.id = state.editingTaskId;
  data.plan_id = state.selectedPlanId;
  const result = await mutate(editing ? 'task.update' : 'task.create', data);
  if (!result) return;
  fillTaskForm(null);
  render();
  notice(editing ? '할 일을 수정했습니다.' : '할 일을 저장했습니다.');
});
$('#task-cancel').addEventListener('click', () => fillTaskForm(null));

$('#task-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const task = state.snapshot.tasks.find((item) => item.id === button.dataset.id);
  if (!task) return;
  if (button.dataset.action === 'edit') {
    fillTaskForm(task);
    $('#task-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#task-form').elements.namedItem('title').focus({ preventScroll: true });
    return;
  }
  if (button.dataset.action === 'delete' && !confirm(`‘${task.title}’ 할 일을 삭제할까요?`)) return;
  const action = { complete: 'task.complete', reopen: 'task.reopen', delete: 'task.delete' }[button.dataset.action];
  const result = await mutate(action, {
    id: task.id,
    ...(action === 'task.complete' ? { request_key: crypto.randomUUID() } : {}),
  });
  if (result) notice(action === 'task.complete' ? '완료를 기록했습니다.' : action === 'task.reopen' ? '진행 중으로 되돌렸습니다.' : '할 일을 삭제했습니다.');
});

for (const selector of ['#task-search', '#task-filter', '#task-sort']) {
  $(selector).addEventListener(selector === '#task-search' ? 'input' : 'change', renderTasks);
}

$('#log-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const started = form.elements.namedItem('started_at').value;
  const ended = form.elements.namedItem('ended_at').value;
  if (!started || !ended) return notice('시작과 종료 시각을 입력해 주세요.', true);
  const result = await mutate('log.create', {
    task_id: form.elements.namedItem('task_id').value,
    started_at: new Date(started).toISOString(),
    ended_at: new Date(ended).toISOString(),
    work_title: form.elements.namedItem('work_title').value,
    work_summary: form.elements.namedItem('work_summary').value,
    blocker_reason: form.elements.namedItem('blocker_reason').value,
  });
  if (!result) return;
  form.reset();
  render();
  notice('실행 기록을 저장했습니다.');
});

$('#metric-grid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-metric]');
  if (!button) return;
  state.evidenceMetric = button.dataset.metric;
  renderSee();
  $('#evidence-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedPlan()) return notice('계획을 먼저 만들어 주세요.', true);
  const form = event.currentTarget;
  const value = (key) => form.elements.namedItem(key).value;
  const next = {
    title: value('title'), start_date: value('start_date'), end_date: value('end_date'),
    priority: value('priority'), estimate_minutes: value('estimate_minutes'),
    success_criteria: value('success_criteria'),
  };
  const result = await mutate('review.carry', {
    source_plan_id: state.selectedPlanId,
    improvement_line: value('improvement_line'),
    next_plan: next,
  });
  if (!result) return;
  state.selectedPlanId = result;
  state.tab = 'plan';
  state.evidenceMetric = null;
  fillPlanForm(null);
  form.reset();
  render();
  notice('개선점이 다음 계획에 이어졌습니다.');
});

document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => {
  const mode = button.dataset.authMode;
  document.querySelectorAll('[data-auth-mode]').forEach((item) => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  $('#auth-submit').textContent = mode === 'register' ? '가입하고 시작하기' : '로그인';
  $('#auth-form').elements.namedItem('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  authNotice('');
}));

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = document.querySelector('[data-auth-mode].is-active').dataset.authMode;
  const data = {
    username: form.elements.namedItem('username').value,
    password: form.elements.namedItem('password').value,
  };
  try {
    const result = await authRequest(mode, data);
    form.reset();
    authNotice('');
    await showApp(result.user);
  } catch (error) {
    authNotice(error.message, true);
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await authRequest('logout');
    showAuth();
    authNotice('로그아웃했습니다.');
  } catch (error) {
    notice(error.message, true);
  }
});

$('#account-settings').addEventListener('click', () => {
  authNotice('', false, '#account-message');
  $('#account-dialog').showModal();
});
$('#account-close').addEventListener('click', () => $('#account-dialog').close());

$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await authRequest('change-password', {
      current_password: form.elements.namedItem('current_password').value,
      new_password: form.elements.namedItem('new_password').value,
    });
    form.reset();
    showAuth();
    authNotice('비밀번호를 바꿨습니다. 새 비밀번호로 다시 로그인해 주세요.');
  } catch (error) {
    authNotice(error.message, true, '#account-message');
  }
});

$('#delete-account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!confirm('계정과 이 계정의 모든 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
  const form = event.currentTarget;
  try {
    await authRequest('delete-account', { password: form.elements.namedItem('password').value });
    form.reset();
    showAuth();
    authNotice('계정과 기록을 삭제했습니다.');
  } catch (error) {
    authNotice(error.message, true, '#account-message');
  }
});

restoreSession();

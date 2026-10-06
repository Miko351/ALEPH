import { randomUUID } from 'node:crypto';

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const one = (result) => result.rows[0] ?? null;
const rows = (result) => result.rows.map((row) => ({ ...row }));

function text(value, label, max = 500, required = true) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (required && !clean) throw new InputError(`${label}을(를) 입력해 주세요.`);
  if (clean.length > max) throw new InputError(`${label}은(는) ${max}자 이하로 입력해 주세요.`);
  return clean;
}

function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputError(`${label}의 날짜 형식을 확인해 주세요.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InputError(`${label}의 날짜를 확인해 주세요.`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new InputError(`${label}의 시각 형식을 확인해 주세요.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new InputError(`${label}의 시각을 확인해 주세요.`);
  return parsed.toISOString();
}

function minutes(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    throw new InputError(`${label}은(는) 0 이상의 정수 분으로 입력해 주세요.`);
  }
  return n;
}

function priority(value) {
  if (!['low', 'medium', 'high'].includes(value)) {
    throw new InputError('우선순위를 선택해 주세요.');
  }
  return value;
}

function id(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) {
    throw new InputError(`${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function planInput(data) {
  const endDate = data.end_date == null || data.end_date === '' ? '' : date(data.end_date, '종료일');
  const plan = {
    title: text(data.title, '계획 이름', 120),
    start_date: date(data.start_date, '시작일'),
    end_date: endDate,
    priority: priority(data.priority),
    success_criteria: text(data.success_criteria, '성공 기준', 1000),
    estimate_minutes: minutes(data.estimate_minutes, '예상 시간'),
    carried_note: text(data.carried_note, '이어받은 개선점', 500, false),
  };
  if (plan.end_date && plan.end_date < plan.start_date) throw new InputError('종료일은 시작일보다 빠를 수 없습니다.');
  return plan;
}

function taskInput(data) {
  const estimateBasis = data.estimate_basis ?? 'planned';
  if (!['planned', 'retrospective'].includes(estimateBasis)) {
    throw new InputError('예상 시간의 기준을 선택해 주세요.');
  }
  return {
    title: text(data.title, '할 일', 200),
    deadline: data.deadline == null || data.deadline === '' ? '' : date(data.deadline, '마감일'),
    priority: priority(data.priority),
    tag: text(data.tag, '태그', 60, false),
    estimate_minutes: minutes(data.estimate_minutes, '예상 시간'),
    estimate_basis: estimateBasis,
  };
}

async function withWrite(db, work) {
  const tx = await db.transaction('write');
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}

async function insertPlan(tx, data, timestampNow) {
  const planId = randomUUID();
  await tx.execute({
    sql: `INSERT INTO plans
      (id, title, start_date, end_date, priority, success_criteria, estimate_minutes, carried_note, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [planId, data.title, data.start_date, data.end_date, data.priority,
      data.success_criteria, data.estimate_minutes, data.carried_note, timestampNow, timestampNow],
  });
  await tx.execute({
    sql: `INSERT INTO plan_versions
      (id, plan_id, revision, title, start_date, end_date, priority, success_criteria, estimate_minutes, carried_note, saved_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), planId, data.title, data.start_date, data.end_date,
      data.priority, data.success_criteria, data.estimate_minutes, data.carried_note, timestampNow],
  });
  return planId;
}

export async function createPlan(db, input) {
  const data = planInput(input);
  return withWrite(db, (tx) => insertPlan(tx, data, now()));
}

export async function updatePlan(db, input) {
  const planId = id(input.id, '계획');
  const data = planInput(input);
  return withWrite(db, async (tx) => {
    const current = one(await tx.execute({ sql: 'SELECT revision FROM plans WHERE id = ?', args: [planId] }));
    if (!current) throw new InputError('계획을 찾을 수 없습니다.', 404);
    const nextRevision = Number(current.revision) + 1;
    const savedAt = now();
    await tx.execute({
      sql: `UPDATE plans SET title = ?, start_date = ?, end_date = ?, priority = ?,
        success_criteria = ?, estimate_minutes = ?, carried_note = ?, revision = ?, updated_at = ?
        WHERE id = ?`,
      args: [data.title, data.start_date, data.end_date, data.priority,
        data.success_criteria, data.estimate_minutes, data.carried_note, nextRevision, savedAt, planId],
    });
    await tx.execute({
      sql: `INSERT INTO plan_versions
        (id, plan_id, revision, title, start_date, end_date, priority, success_criteria, estimate_minutes, carried_note, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), planId, nextRevision, data.title, data.start_date, data.end_date,
        data.priority, data.success_criteria, data.estimate_minutes, data.carried_note, savedAt],
    });
    return planId;
  });
}

export async function createTask(db, input) {
  const planId = id(input.plan_id, '계획');
  const data = taskInput(input);
  const plan = one(await db.execute({ sql: 'SELECT id FROM plans WHERE id = ?', args: [planId] }));
  if (!plan) throw new InputError('계획을 찾을 수 없습니다.', 404);
  const taskId = randomUUID();
  const createdAt = now();
  await db.execute({
    sql: `INSERT INTO tasks
      (id, plan_id, title, deadline, priority, tag, estimate_minutes, estimate_basis, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [taskId, planId, data.title, data.deadline, data.priority, data.tag,
      data.estimate_minutes, data.estimate_basis, createdAt, createdAt],
  });
  return taskId;
}

export async function updateTask(db, input) {
  const taskId = id(input.id, '할 일');
  const data = taskInput(input);
  const result = await db.execute({
    sql: `UPDATE tasks SET title = ?, deadline = ?, priority = ?, tag = ?, estimate_minutes = ?, estimate_basis = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL RETURNING id`,
    args: [data.title, data.deadline, data.priority, data.tag, data.estimate_minutes, data.estimate_basis, now(), taskId],
  });
  if (!one(result)) throw new InputError('할 일을 찾을 수 없습니다.', 404);
  return taskId;
}

export async function deleteTask(db, input) {
  const taskId = id(input.id, '할 일');
  const result = await db.execute({
    sql: 'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING id',
    args: [now(), now(), taskId],
  });
  if (!one(result)) throw new InputError('할 일을 찾을 수 없습니다.', 404);
  return taskId;
}

export async function completeTask(db, input) {
  const taskId = id(input.id, '할 일');
  const requestKey = input.request_key ? id(input.request_key, '요청') : randomUUID();
  const completedAt = now();
  // One conditional DB update; the DB trigger writes one completion event only
  // for an actual open -> completed transition. UI button state is not the guard.
  const changed = one(await db.execute({
    sql: `UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ?,
      last_completion_request_key = ?
      WHERE id = ? AND status = 'open' AND deleted_at IS NULL RETURNING id`,
    args: [completedAt, completedAt, requestKey, taskId],
  }));
  if (!changed) {
    const current = one(await db.execute({
      sql: 'SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL', args: [taskId],
    }));
    if (!current) throw new InputError('할 일을 찾을 수 없습니다.', 404);
  }
  return { id: taskId, added: Boolean(changed) };
}

export async function reopenTask(db, input) {
  const taskId = id(input.id, '할 일');
  const result = await db.execute({
    sql: `UPDATE tasks SET status = 'open', completed_at = NULL,
      completion_cycle = completion_cycle + 1, last_completion_request_key = NULL, updated_at = ?
      WHERE id = ? AND status = 'completed' AND deleted_at IS NULL RETURNING id`,
    args: [now(), taskId],
  });
  if (!one(result)) throw new InputError('완료 상태인 할 일을 찾을 수 없습니다.', 404);
  return taskId;
}

export async function createWorkLog(db, input) {
  const taskId = id(input.task_id, '할 일');
  const task = one(await db.execute({
    sql: 'SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL', args: [taskId],
  }));
  if (!task) throw new InputError('할 일을 찾을 수 없습니다.', 404);
  const startedAt = timestamp(input.started_at, '시작');
  const endedAt = timestamp(input.ended_at, '종료');
  const actualSeconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (actualSeconds <= 0 || actualSeconds > 86400 * 7) {
    throw new InputError('종료 시각은 시작보다 늦어야 하며 한 기록은 7일을 넘길 수 없습니다.');
  }
  const blocker = text(input.blocker_reason, '막힌 이유', 500, false);
  const title = text(input.work_title, '실행 기록 제목', 160);
  const summary = text(input.work_summary, '실제로 한 일', 1000);
  const logId = randomUUID();
  await db.execute({
    sql: `INSERT INTO work_logs
      (id, task_id, started_at, ended_at, actual_seconds, work_title, work_summary, blocker_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [logId, taskId, startedAt, endedAt, actualSeconds, title, summary, blocker, now()],
  });
  return logId;
}

export async function carryReview(db, input) {
  const sourceId = id(input.source_plan_id, '이전 계획');
  const line = text(input.improvement_line, '다음에 고칠 점', 500);
  const nextPlan = planInput({ ...input.next_plan, carried_note: line });
  return withWrite(db, async (tx) => {
    const source = one(await tx.execute({ sql: 'SELECT id FROM plans WHERE id = ?', args: [sourceId] }));
    if (!source) throw new InputError('이전 계획을 찾을 수 없습니다.', 404);
    const createdAt = now();
    const nextId = await insertPlan(tx, nextPlan, createdAt);
    await tx.execute({
      sql: `INSERT INTO reviews (id, source_plan_id, next_plan_id, improvement_line, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [randomUUID(), sourceId, nextId, line, createdAt],
    });
    return nextId;
  });
}

export function todaySeoul(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const roundMinute = (seconds) => Math.round((seconds / 60) * 10) / 10;

export function calculateSee(planId, tasks, workLogs, at = new Date()) {
  const active = tasks.filter((task) => task.plan_id === planId && !task.deleted_at);
  const activeIds = new Set(active.map((task) => task.id));
  const relevantLogs = workLogs.filter((log) => activeIds.has(log.task_id));
  const blockedIds = new Set(relevantLogs.filter((log) => log.blocker_reason.trim()).map((log) => log.task_id));
  const estimated = active.reduce((sum, task) => sum + Number(task.estimate_minutes), 0);
  const actual = roundMinute(relevantLogs.reduce((sum, log) => sum + Number(log.actual_seconds), 0));
  return {
    plan_id: planId,
    planned_count: active.length,
    completed_count: active.filter((task) => task.status === 'completed').length,
    overdue_count: active.filter((task) => task.status !== 'completed' && task.deadline && task.deadline < todaySeoul(at)).length,
    blocked_count: blockedIds.size,
    estimated_minutes: estimated,
    actual_minutes: actual,
    difference_minutes: Math.round((actual - estimated) * 10) / 10,
  };
}

export async function loadSnapshot(db) {
  const [plans, versions, tasks, logs, events, reviews] = await Promise.all([
    db.execute('SELECT * FROM plans ORDER BY created_at DESC, id'),
    db.execute('SELECT * FROM plan_versions ORDER BY plan_id, revision'),
    db.execute('SELECT * FROM tasks ORDER BY created_at, id'),
    db.execute('SELECT * FROM work_logs ORDER BY started_at, id'),
    db.execute('SELECT * FROM completion_events ORDER BY completed_at, id'),
    db.execute('SELECT * FROM reviews ORDER BY created_at, id'),
  ]);
  const data = {
    plans: rows(plans), plan_versions: rows(versions), tasks: rows(tasks),
    work_logs: rows(logs), completion_events: rows(events), reviews: rows(reviews),
  };
  data.see = data.plans.map((plan) => calculateSee(plan.id, data.tasks, data.work_logs));
  data.timezone = 'Asia/Seoul';
  data.today = todaySeoul();
  return data;
}

export const actions = {
  'plan.create': createPlan,
  'plan.update': updatePlan,
  'task.create': createTask,
  'task.update': updateTask,
  'task.delete': deleteTask,
  'task.complete': completeTask,
  'task.reopen': reopenTask,
  'log.create': createWorkLog,
  'review.carry': carryReview,
};

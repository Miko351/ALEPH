import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { ensureSchema } from '../src/schema.js';
import {
  calculateSee, carryReview as carryReviewOwned, completeTask as completeTaskOwned,
  createPlan as createPlanOwned, createTask as createTaskOwned, createWorkLog as createWorkLogOwned,
  deleteTask as deleteTaskOwned, loadSnapshot as loadSnapshotOwned,
  reopenTask as reopenTaskOwned, todaySeoul, updatePlan as updatePlanOwned,
  updateTask as updateTaskOwned,
} from '../src/model.js';

test('계획·할 일·실행·돌아보기는 서버 DB 파일에 보존되고 근거 수치와 일치한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pds-db-'));
  const url = `file:${join(directory, 'records.db').replaceAll('\\', '/')}`;
  const db = createClient({ url });
  try {
    await ensureSchema(db);
    const ownerId = randomUUID();
    await db.execute({ sql: 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      args: [ownerId, 'modeltest', 'synthetic-test-hash', new Date().toISOString()] });
    const createPlan = (target, data) => createPlanOwned(target, data, ownerId);
    const updatePlan = (target, data) => updatePlanOwned(target, data, ownerId);
    const createTask = (target, data) => createTaskOwned(target, data, ownerId);
    const updateTask = (target, data) => updateTaskOwned(target, data, ownerId);
    const deleteTask = (target, data) => deleteTaskOwned(target, data, ownerId);
    const completeTask = (target, data) => completeTaskOwned(target, data, ownerId);
    const reopenTask = (target, data) => reopenTaskOwned(target, data, ownerId);
    const createWorkLog = (target, data) => createWorkLogOwned(target, data, ownerId);
    const carryReview = (target, data) => carryReviewOwned(target, data, ownerId);
    const loadSnapshot = (target) => loadSnapshotOwned(target, ownerId);
    const plan = {
      title: '검사 전용 계획', start_date: '2026-10-01', end_date: '2026-10-31',
      priority: 'high', success_criteria: '할 일 다섯 개 검증', estimate_minutes: 300,
      carried_note: '',
    };
    const planId = await createPlan(db, plan);
    await updatePlan(db, { ...plan, id: planId, success_criteria: '수정된 기준', estimate_minutes: 320 });
    const taskIds = [];
    for (let index = 0; index < 5; index += 1) {
      taskIds.push(await createTask(db, {
        plan_id: planId, title: `할 일 ${index + 1}`, deadline: index < 2 ? '2026-10-02' : '2026-10-20',
        priority: 'medium', tag: '검사', estimate_minutes: 30,
      }));
    }
    await updateTask(db, {
      id: taskIds[0], title: '<script>alert(1)</script>', deadline: '2026-10-02',
      priority: 'high', tag: '문자열', estimate_minutes: 40, estimate_basis: 'retrospective',
    });

    const [first, second] = await Promise.all([
      completeTask(db, { id: taskIds[0], request_key: 'cfd14752-7bd5-4406-921b-3c0f555c7480' }),
      completeTask(db, { id: taskIds[0], request_key: '1c630a79-435a-44f7-af2f-eef85f96098d' }),
    ]);
    assert.equal(Number(first.added) + Number(second.added), 1);

    for (let index = 0; index < 3; index += 1) {
      await createWorkLog(db, {
        task_id: taskIds[index],
        started_at: `2026-10-0${index + 1}T00:00:00.000Z`,
        ended_at: `2026-10-0${index + 1}T00:30:00.000Z`,
        work_title: `검사 ${index + 1}`,
        work_summary: `검사 작업 ${index + 1} 수행`,
        blocker_reason: index === 1 ? '연결이 끊김' : '',
      });
    }
    let snapshot = await loadSnapshot(db);
    assert.equal(snapshot.plan_versions.length, 2);
    assert.equal(snapshot.plan_versions[0].success_criteria, plan.success_criteria);
    assert.equal(snapshot.plans[0].success_criteria, '수정된 기준');
    assert.equal(snapshot.completion_events.length, 1);
    assert.equal(snapshot.work_logs.length, 3);
    assert.equal(snapshot.work_logs[0].work_title, '검사 1');
    assert.equal(snapshot.work_logs[0].work_summary, '검사 작업 1 수행');
    assert.equal(snapshot.tasks[0].title, '<script>alert(1)</script>');
    assert.equal(snapshot.tasks[0].estimate_basis, 'retrospective');
    await assert.rejects(createWorkLog(db, {
      task_id: taskIds[0], started_at: '2026-10-04T00:00:00.000Z',
      ended_at: '2026-10-04T00:01:00.000Z', work_title: '내용 없음', blocker_reason: '',
    }), /실제로 한 일/);
    assert.equal(snapshot.see[0].completed_count, 1);
    const see = calculateSee(planId, snapshot.tasks, snapshot.work_logs, new Date('2026-10-06T02:00:00.000Z'));
    assert.deepEqual({
      planned: see.planned_count, completed: see.completed_count, overdue: see.overdue_count,
      blocked: see.blocked_count, estimated: see.estimated_minutes,
      actual: see.actual_minutes, difference: see.difference_minutes,
    }, { planned: 5, completed: 1, overdue: 1, blocked: 1, estimated: 160, actual: 90, difference: -70 });

    await reopenTask(db, { id: taskIds[0] });
    await completeTask(db, { id: taskIds[0], request_key: 'a7eb14ba-1276-43b1-a35f-fc0396986d53' });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.completion_events.length, 2);
    assert.equal(snapshot.see[0].completed_count, 1);

    await deleteTask(db, { id: taskIds[4] });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.see[0].planned_count, 4);
    assert.equal(snapshot.see[0].estimated_minutes, 130);

    const nextId = await carryReview(db, {
      source_plan_id: planId,
      improvement_line: '예상 시간을 더 잘게 나눈다',
      next_plan: { ...plan, title: '다음 계획', start_date: '2026-11-01', end_date: '2026-11-30' },
    });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.plans.find((entry) => entry.id === nextId).carried_note, '예상 시간을 더 잘게 나눈다');
    assert.equal(snapshot.reviews.length, 1);
    assert.deepEqual(calculateSee(nextId, snapshot.tasks, snapshot.work_logs), {
      plan_id: nextId, planned_count: 0, completed_count: 0, overdue_count: 0,
      blocked_count: 0, estimated_minutes: 0, actual_minutes: 0, difference_minutes: 0,
    });

    const undated = {
      title: '마감일 미정 작업', deadline: '', priority: 'high', tag: '검사', estimate_minutes: 30,
    };
    const undatedId = await createTask(db, { ...undated, plan_id: nextId });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.tasks.find((entry) => entry.id === undatedId).deadline, '');
    assert.equal(calculateSee(nextId, snapshot.tasks, snapshot.work_logs, new Date('2026-11-06T02:00:00.000Z')).overdue_count, 0);
    await updateTask(db, { ...undated, id: undatedId, deadline: '2026-11-01' });
    snapshot = await loadSnapshot(db);
    assert.equal(calculateSee(nextId, snapshot.tasks, snapshot.work_logs, new Date('2026-11-06T02:00:00.000Z')).overdue_count, 1);
    await updateTask(db, { ...undated, id: undatedId });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.tasks.find((entry) => entry.id === undatedId).deadline, '');
    assert.equal(calculateSee(nextId, snapshot.tasks, snapshot.work_logs, new Date('2026-11-06T02:00:00.000Z')).overdue_count, 0);
    await assert.rejects(createTask(db, { ...undated, plan_id: nextId, deadline: '2026-02-30' }), /마감일의 날짜를 확인해 주세요/);

    const openPlan = {
      title: '관제 UI 계획', start_date: '2026-09-17', end_date: '',
      priority: 'high', success_criteria: '사건 처리 흐름을 확인한다',
      estimate_minutes: 60, carried_note: '',
    };
    const openPlanId = await createPlan(db, openPlan);
    await updatePlan(db, { ...openPlan, id: openPlanId, end_date: '2026-10-31' });
    const nextOpenId = await carryReview(db, {
      source_plan_id: openPlanId,
      improvement_line: '다음 계획에는 검증 시간을 나눈다',
      next_plan: { ...openPlan, title: '그다음 계획', start_date: '2026-11-01' },
    });
    snapshot = await loadSnapshot(db);
    assert.equal(snapshot.plan_versions.find((version) => version.plan_id === openPlanId && version.revision === 1).end_date, '');
    assert.equal(snapshot.plans.find((entry) => entry.id === openPlanId).end_date, '2026-10-31');
    assert.equal(snapshot.plans.find((entry) => entry.id === nextOpenId).end_date, '');
    await assert.rejects(
      createPlan(db, { ...openPlan, end_date: '2026-09-16' }),
      /종료일은 시작일보다 빠를 수 없습니다/,
    );
    await assert.rejects(
      createPlan(db, { ...openPlan, end_date: '2026-02-30' }),
      /종료일의 날짜를 확인해 주세요/,
    );

    await db.close();
    const reopened = createClient({ url });
    try {
      const restored = await loadSnapshot(reopened);
      assert.equal(restored.plans.length, 4);
      assert.equal(restored.work_logs.length, 3);
      assert.equal(restored.plans.find((entry) => entry.id === planId).estimate_minutes, 320);
    } finally {
      await reopened.close();
    }
  } finally {
    try { await db.close(); } catch { /* already closed */ }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('서울 날짜 키는 UTC 날짜와 달라도 서울 날짜를 따른다', () => {
  assert.equal(todaySeoul(new Date('2026-10-05T16:00:00.000Z')), '2026-10-06');
});

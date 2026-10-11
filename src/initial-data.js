import seed from '../seed/initial-records.json' with { type: 'json' };
import { InputError } from './model.js';

const columns = {
  plans: ['id', 'title', 'start_date', 'end_date', 'priority', 'success_criteria', 'estimate_minutes', 'carried_note', 'revision', 'created_at', 'updated_at'],
  plan_versions: ['id', 'plan_id', 'revision', 'title', 'start_date', 'end_date', 'priority', 'success_criteria', 'estimate_minutes', 'carried_note', 'saved_at'],
  tasks: ['id', 'plan_id', 'title', 'deadline', 'priority', 'tag', 'estimate_minutes', 'estimate_basis', 'status', 'completion_cycle', 'last_completion_request_key', 'completed_at', 'deleted_at', 'created_at', 'updated_at'],
  work_logs: ['id', 'task_id', 'started_at', 'ended_at', 'actual_seconds', 'work_title', 'work_summary', 'blocker_reason', 'created_at'],
  completion_events: ['id', 'task_id', 'completion_cycle', 'request_key', 'completed_at'],
  reviews: ['id', 'source_plan_id', 'next_plan_id', 'improvement_line', 'created_at'],
};

function verifySeed() {
  if (seed.version !== 1 || !seed.tables ||
      seed.tables.plans?.length < 1 || seed.tables.tasks?.length < 5 || seed.tables.work_logs?.length < 3) {
    throw new Error('초기 자료 형식 또는 건수가 올바르지 않습니다.');
  }
  for (const [table, fields] of Object.entries(columns)) {
    if (!Array.isArray(seed.tables[table])) throw new Error(`초기 자료에 ${table} 목록이 없습니다.`);
    for (const row of seed.tables[table]) {
      if (fields.some((field) => !Object.hasOwn(row, field))) {
        throw new Error(`초기 자료의 ${table} 항목이 누락되었습니다.`);
      }
    }
  }
}

export async function insertInitialDataForOwner(tx, ownerId) {
  verifySeed();
  for (const [table, fields] of Object.entries(columns)) {
    const names = table === 'plans' ? [...fields, 'owner_id'] : fields;
    const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
    for (const row of seed.tables[table]) {
      const args = fields.map((field) => row[field]);
      if (table === 'plans') args.push(ownerId);
      await tx.execute({ sql, args });
    }
  }
  return seed.tables.plans.length;
}

export async function importInitialDataToOwner(db, ownerId) {
  const tx = await db.transaction('write');
  try {
    const account = await tx.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [ownerId] });
    if (!account.rows.length) throw new InputError('대상 계정을 찾을 수 없습니다.', 404);
    const marker = await tx.execute({
      sql: 'INSERT OR IGNORE INTO bootstrap_runs (name, applied_at) VALUES (?, ?)',
      args: ['t07-legacy-claim-v1', new Date().toISOString()],
    });
    if (!Number(marker.rowsAffected)) throw new InputError('기존 기록은 이미 이전되었습니다.', 409);
    const existing = await tx.execute('SELECT COUNT(*) AS total FROM plans WHERE owner_id IS NULL');
    let movedPlans;
    if (Number(existing.rows[0].total)) {
      const result = await tx.execute({
        sql: 'UPDATE plans SET owner_id = ? WHERE owner_id IS NULL', args: [ownerId],
      });
      movedPlans = Number(result.rowsAffected);
    } else {
      movedPlans = await insertInitialDataForOwner(tx, ownerId);
    }
    await tx.commit();
    return { movedPlans };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}

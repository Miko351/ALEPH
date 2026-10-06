import seed from '../seed/initial-records.json' with { type: 'json' };

const columns = {
  plans: ['id', 'title', 'start_date', 'end_date', 'priority', 'success_criteria', 'estimate_minutes', 'carried_note', 'revision', 'created_at', 'updated_at'],
  plan_versions: ['id', 'plan_id', 'revision', 'title', 'start_date', 'end_date', 'priority', 'success_criteria', 'estimate_minutes', 'carried_note', 'saved_at'],
  tasks: ['id', 'plan_id', 'title', 'deadline', 'priority', 'tag', 'estimate_minutes', 'estimate_basis', 'status', 'completion_cycle', 'last_completion_request_key', 'completed_at', 'deleted_at', 'created_at', 'updated_at'],
  work_logs: ['id', 'task_id', 'started_at', 'ended_at', 'actual_seconds', 'work_title', 'work_summary', 'blocker_reason', 'created_at'],
  completion_events: ['id', 'task_id', 'completion_cycle', 'request_key', 'completed_at'],
  reviews: ['id', 'source_plan_id', 'next_plan_id', 'improvement_line', 'created_at'],
};

const initializing = new WeakMap();

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

async function initialize(db) {
  verifySeed();
  const tx = await db.transaction('write');
  try {
    const marker = await tx.execute({
      sql: 'INSERT OR IGNORE INTO bootstrap_runs (name, applied_at) VALUES (?, ?)',
      args: ['initial-records-v1', new Date().toISOString()],
    });
    if (Number(marker.rowsAffected) === 0) {
      await tx.commit();
      return false;
    }

    const existing = await tx.execute('SELECT COUNT(*) AS total FROM plans');
    if (Number(existing.rows[0].total) > 0) {
      await tx.commit();
      return false;
    }

    for (const [table, fields] of Object.entries(columns)) {
      const placeholders = fields.map(() => '?').join(', ');
      const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`;
      for (const row of seed.tables[table]) {
        await tx.execute({ sql, args: fields.map((field) => row[field]) });
      }
    }
    await tx.commit();
    return true;
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}

export function ensureInitialData(db) {
  if (!initializing.has(db)) {
    initializing.set(db, initialize(db).catch((error) => {
      initializing.delete(db);
      throw error;
    }));
  }
  return initializing.get(db);
}

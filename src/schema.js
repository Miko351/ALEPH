const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
    success_criteria TEXT NOT NULL,
    estimate_minutes INTEGER NOT NULL CHECK (estimate_minutes >= 0),
    carried_note TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plan_versions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    priority TEXT NOT NULL,
    success_criteria TEXT NOT NULL,
    estimate_minutes INTEGER NOT NULL,
    carried_note TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    UNIQUE(plan_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    title TEXT NOT NULL,
    deadline TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
    tag TEXT NOT NULL DEFAULT '',
    estimate_minutes INTEGER NOT NULL CHECK (estimate_minutes >= 0),
    estimate_basis TEXT NOT NULL DEFAULT 'planned' CHECK (estimate_basis IN ('planned','retrospective')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
    completion_cycle INTEGER NOT NULL DEFAULT 0,
    last_completion_request_key TEXT,
    completed_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    actual_seconds INTEGER NOT NULL CHECK (actual_seconds >= 0),
    work_title TEXT NOT NULL DEFAULT '',
    work_summary TEXT NOT NULL DEFAULT '',
    blocker_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS completion_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    completion_cycle INTEGER NOT NULL,
    request_key TEXT NOT NULL UNIQUE,
    completed_at TEXT NOT NULL,
    UNIQUE(task_id, completion_cycle)
  )`,
  `CREATE TRIGGER IF NOT EXISTS task_complete_event
    AFTER UPDATE OF status ON tasks
    WHEN OLD.status = 'open' AND NEW.status = 'completed'
    BEGIN
      INSERT INTO completion_events (id, task_id, completion_cycle, request_key, completed_at)
      VALUES (lower(hex(randomblob(16))), NEW.id, NEW.completion_cycle,
        NEW.last_completion_request_key, NEW.completed_at);
    END`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    source_plan_id TEXT NOT NULL REFERENCES plans(id),
    next_plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id),
    improvement_line TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bootstrap_runs (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS diary_config (
    owner_id TEXT PRIMARY KEY REFERENCES users(id),
    question TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    calculation_rule TEXT NOT NULL,
    missing_rule TEXT NOT NULL,
    duplicate_rule TEXT NOT NULL,
    outlier_rule TEXT NOT NULL,
    rounding_rule TEXT NOT NULL,
    week_start TEXT NOT NULL,
    plan_rule TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS diary_days (
    owner_id TEXT NOT NULL REFERENCES users(id),
    day_kst TEXT NOT NULL,
    value REAL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, day_kst)
  )`,
  `CREATE TABLE IF NOT EXISTS diary_rule_changes (
    owner_id TEXT PRIMARY KEY REFERENCES users(id),
    previous_rule TEXT NOT NULL,
    next_rule TEXT NOT NULL,
    reason TEXT NOT NULL,
    day1_kst TEXT NOT NULL,
    day2_kst TEXT NOT NULL,
    changed_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS tasks_plan_idx ON tasks(plan_id, deleted_at)',
  'CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, expires_at)',
  'CREATE INDEX IF NOT EXISTS logs_task_idx ON work_logs(task_id)',
  'CREATE INDEX IF NOT EXISTS versions_plan_idx ON plan_versions(plan_id, revision)',
];

const initializing = new WeakMap();

async function initialize(db) {
  await db.batch(statements, 'write');
  const planColumns = await db.execute('PRAGMA table_info(plans)');
  if (!planColumns.rows.some((column) => column.name === 'owner_id')) {
    await db.execute('ALTER TABLE plans ADD COLUMN owner_id TEXT REFERENCES users(id)');
  }
  await db.execute('CREATE INDEX IF NOT EXISTS plans_owner_idx ON plans(owner_id, created_at)');
  const taskColumns = await db.execute('PRAGMA table_info(tasks)');
  if (!taskColumns.rows.some((column) => column.name === 'estimate_basis')) {
    await db.execute("ALTER TABLE tasks ADD COLUMN estimate_basis TEXT NOT NULL DEFAULT 'planned'");
  }
  const logColumns = await db.execute('PRAGMA table_info(work_logs)');
  if (!logColumns.rows.some((column) => column.name === 'work_title')) {
    await db.execute("ALTER TABLE work_logs ADD COLUMN work_title TEXT NOT NULL DEFAULT ''");
  }
  if (!logColumns.rows.some((column) => column.name === 'work_summary')) {
    await db.execute("ALTER TABLE work_logs ADD COLUMN work_summary TEXT NOT NULL DEFAULT ''");
  }
}

export function ensureSchema(db) {
  if (!initializing.has(db)) {
    initializing.set(db, initialize(db).catch((error) => {
      initializing.delete(db);
      throw error;
    }));
  }
  return initializing.get(db);
}

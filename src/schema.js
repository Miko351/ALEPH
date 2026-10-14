const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id)',
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pending_username TEXT,
    passkey_name TEXT,
    challenge TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS challenges_expires_idx ON challenges(expires_at)',
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS private_notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS private_notes_user_idx ON private_notes(user_id)',
];

export async function ensureSchema(db) {
  for (const sql of statements) await db.execute(sql);
}

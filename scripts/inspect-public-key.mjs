import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { normalizeUsername } from '../src/security.js';

const username = normalizeUsername(process.argv[process.argv.indexOf('--username') + 1]);
const db = getDb();
try {
  await ensureSchema(db);
  const result = await db.execute({
    sql: `SELECT passkeys.name, passkeys.public_key, passkeys.created_at
      FROM passkeys JOIN users ON users.id = passkeys.user_id
      WHERE users.username = ? ORDER BY passkeys.created_at`,
    args: [username],
  });
  if (!result.rows.length) throw new Error('해당 계정에 등록된 패스키가 없습니다.');
  for (const row of result.rows) {
    process.stdout.write(JSON.stringify({
      name: row.name,
      created_at: row.created_at,
      public_key_base64url: Buffer.from(row.public_key).toString('base64url'),
    }) + '\n');
  }
} finally {
  await db.close();
}

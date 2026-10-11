import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { ensureSchema } from '../src/schema.js';

// Old sessions are intentionally excluded: users log in again on the deployed site.
const TABLES = [
  'users', 'plans', 'plan_versions', 'tasks', 'work_logs',
  'completion_events', 'reviews', 'bootstrap_runs',
  'diary_config', 'diary_days', 'diary_rule_changes',
];
const EMPTY_TARGET_TABLES = [...TABLES, 'sessions'];

async function tableNames(db) {
  const result = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(result.rows.map((row) => String(row.name)));
}

async function counts(db, names, tables) {
  const result = {};
  for (const table of tables) {
    result[table] = names.has(table)
      ? Number((await db.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count)
      : 0;
  }
  return result;
}

export async function inspectMigration(source, target, expectedUsername) {
  const sourceNames = await tableNames(source);
  const missing = TABLES.filter((table) => !sourceNames.has(table));
  if (missing.length) throw new Error(`로컬 DB 테이블이 없습니다: ${missing.join(', ')}`);
  const users = (await source.execute('SELECT id, username FROM users')).rows;
  if (users.length !== 1 || users[0].username !== expectedUsername) {
    throw new Error('로컬 DB의 계정이 지정한 아이디 1개와 일치하지 않습니다.');
  }
  const sourceCounts = await counts(source, sourceNames, TABLES);
  if (sourceCounts.diary_days !== 5) {
    throw new Error('로컬 DB의 일별 기록이 5건이 아닙니다. 이전 대상을 확인해 주세요.');
  }
  const targetNames = await tableNames(target);
  const targetCounts = await counts(target, targetNames, EMPTY_TARGET_TABLES);
  if (Object.values(targetCounts).some((count) => count !== 0)) {
    throw new Error('대상 DB에 이미 앱 데이터가 있습니다. 덮어쓰지 않습니다.');
  }
  return { sourceCounts, targetCounts, username: users[0].username };
}

export async function copyMigration(source, target, expectedUsername) {
  const before = await inspectMigration(source, target, expectedUsername);
  const data = new Map();
  for (const table of TABLES) data.set(table, (await source.execute(`SELECT * FROM ${table}`)).rows);

  await ensureSchema(target);
  for (const table of TABLES) {
    const sourceColumns = (await source.execute(`PRAGMA table_info(${table})`)).rows.map((row) => row.name);
    const targetColumns = (await target.execute(`PRAGMA table_info(${table})`)).rows.map((row) => row.name);
    if (JSON.stringify(sourceColumns) !== JSON.stringify(targetColumns)) {
      throw new Error(`${table}의 로컬·대상 DB 열 구성이 다릅니다. 이전하지 않았습니다.`);
    }
  }

  const tx = await target.transaction('write');
  try {
    const names = await tableNames(tx);
    const current = await counts(tx, names, EMPTY_TARGET_TABLES);
    if (Object.values(current).some((count) => count !== 0)) {
      throw new Error('이전 중 대상 DB에 데이터가 생겼습니다. 덮어쓰지 않습니다.');
    }
    for (const table of TABLES) {
      for (const row of data.get(table)) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(', ');
        await tx.execute({
          sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          args: columns.map((column) => row[column]),
        });
      }
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }

  const targetCounts = await counts(target, await tableNames(target), EMPTY_TARGET_TABLES);
  for (const table of TABLES) {
    if (targetCounts[table] !== before.sourceCounts[table]) {
      throw new Error(`${table}의 이전 전후 건수가 다릅니다. 대상 DB를 확인해 주세요.`);
    }
  }
  if (targetCounts.sessions !== 0) throw new Error('대상 DB에 이전 세션이 남았습니다.');
  return targetCounts;
}

async function main() {
  const args = process.argv.slice(2);
  const username = args[args.indexOf('--username') + 1]?.trim().toLowerCase();
  const apply = args.includes('--apply');
  const host = args[args.indexOf('--confirm-host') + 1];
  if (!username || !/^[a-z0-9_-]{3,40}$/.test(username)) {
    throw new Error('사용법: node scripts/migrate-local-to-turso.mjs --username <아이디> [--apply --confirm-host <대상 호스트>]');
  }
  const sourcePath = resolve('data/local.db');
  if (!existsSync(sourcePath)) throw new Error('로컬 data/local.db가 없습니다.');
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!remoteUrl || !authToken) throw new Error('TURSO_DATABASE_URL과 TURSO_AUTH_TOKEN이 필요합니다. 비밀값을 명령 인자로 넣지 마세요.');
  const targetUrl = new URL(remoteUrl);
  if (!['libsql:', 'https:'].includes(targetUrl.protocol) || !targetUrl.hostname) {
    throw new Error('대상 URL은 원격 Turso 주소여야 합니다.');
  }
  if (apply && host !== targetUrl.host) {
    throw new Error('대상 호스트 확인값이 일치하지 않습니다. 미리보기의 호스트를 확인해 주세요.');
  }

  const source = createClient({ url: `file:${sourcePath.replaceAll('\\', '/')}` });
  const target = createClient({ url: remoteUrl, authToken });
  try {
    const preview = await inspectMigration(source, target, username);
    process.stdout.write(`대상 호스트: ${targetUrl.host}\n계정: ${preview.username}\n로컬 건수: ${JSON.stringify(preview.sourceCounts)}\n대상 DB: 앱 데이터 0건\n`);
    if (!apply) {
      process.stdout.write('미리보기만 했습니다. 이전을 실행하려면 --apply --confirm-host <위 호스트>를 추가하세요.\n');
      return;
    }
    const result = await copyMigration(source, target, username);
    process.stdout.write(`이전 완료. 대상 건수: ${JSON.stringify(result)}\n이전 로그인 세션은 복사하지 않았습니다.\n`);
  } finally {
    await source.close();
    await target.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`이전 중단: ${error.message}\n`);
    process.exitCode = 1;
  });
}

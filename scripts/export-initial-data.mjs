import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { loadSnapshot } from '../src/model.js';

const source = resolve(process.env.PDS_LOCAL_DB_PATH ?? 'data/local.db');
const target = resolve('seed/initial-records.json');
if (!existsSync(source)) throw new Error(`로컬 DB를 찾을 수 없습니다: ${source}`);

const db = createClient({ url: `file:${source.replaceAll('\\', '/')}` });
let snapshot;
try {
  snapshot = await loadSnapshot(db);
} finally {
  await db.close();
}

const tables = Object.fromEntries(
  ['plans', 'plan_versions', 'tasks', 'work_logs', 'completion_events', 'reviews']
    .map((name) => [name, snapshot[name]]),
);
if (tables.plans.length < 1 || tables.tasks.length < 5 || tables.work_logs.length < 3) {
  throw new Error('초기 자료의 계획·할 일·실행 기록 건수를 확인해 주세요.');
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify({ version: 1, tables }, null, 2)}\n`, 'utf8');
process.stdout.write(`초기 자료 저장: ${target}\n`);

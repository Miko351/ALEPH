import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';

let client;

export function getDb() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    if (!process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN이 설정되지 않았습니다.');
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    return client;
  }
  if (process.env.VERCEL) throw new Error('배포 환경에 Turso DB가 연결되지 않았습니다.');
  const path = resolve(process.env.PASSKEY_LOCAL_DB_PATH ?? 'data/local.db');
  mkdirSync(dirname(path), { recursive: true });
  client = createClient({ url: `file:${path.replaceAll('\\', '/')}` });
  return client;
}

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';

let sharedClient;

export function getDb() {
  if (sharedClient) return sharedClient;

  const remoteUrl = process.env.TURSO_DATABASE_URL;
  if (remoteUrl) {
    if (!process.env.TURSO_AUTH_TOKEN) {
      throw new Error('서버 DB 인증값이 설정되지 않았습니다.');
    }
    sharedClient = createClient({
      url: remoteUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return sharedClient;
  }

  // A deployment must never silently write into an ephemeral local file.
  if (process.env.VERCEL) {
    throw new Error('서버 DB가 연결되지 않았습니다. TURSO_DATABASE_URL을 설정하세요.');
  }

  const localPath = resolve(process.env.PDS_LOCAL_DB_PATH ?? 'data/local.db');
  mkdirSync(dirname(localPath), { recursive: true });
  sharedClient = createClient({ url: `file:${localPath.replaceAll('\\', '/')}` });
  return sharedClient;
}

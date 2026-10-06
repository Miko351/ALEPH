import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { ensureInitialData } from '../src/initial-data.js';
import { actions, InputError, loadSnapshot } from '../src/model.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function errorResponse(error) {
  const known = error instanceof InputError;
  return Response.json(
    { error: known ? error.message : '서버 DB 작업에 실패했습니다. 연결 상태를 확인해 주세요.' },
    { status: known ? error.status : 500, headers: jsonHeaders },
  );
}

export async function GET(request) {
  try {
    const db = getDb();
    await ensureSchema(db);
    await ensureInitialData(db);
    const snapshot = await loadSnapshot(db);
    const isExport = new URL(request.url).searchParams.get('export') === '1';
    if (isExport) {
      return new Response(JSON.stringify({ exported_at: new Date().toISOString(), ...snapshot }, null, 2), {
        headers: {
          ...jsonHeaders,
          'content-disposition': 'attachment; filename="plan-do-see-export.json"',
        },
      });
    }
    return Response.json(snapshot, { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > 64000) throw new InputError('입력 내용이 너무 깁니다.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('요청 형식이 올바르지 않습니다.');
    }
    if (!body || typeof body !== 'object' || !Object.hasOwn(actions, body.action)) {
      throw new InputError('지원하지 않는 작업입니다.');
    }
    const db = getDb();
    await ensureSchema(db);
    await ensureInitialData(db);
    const result = await actions[body.action](db, body.data ?? {});
    return Response.json({ result, snapshot: await loadSnapshot(db) }, { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

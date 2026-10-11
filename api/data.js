import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { requireSession, validateSameOrigin } from '../src/auth.js';
import { actions, InputError, loadSnapshot, readTask } from '../src/model.js';
import { diaryActions, readDiary } from '../src/diary.js';

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
    const { user } = await requireSession(db, request);
    const url = new URL(request.url);
    const taskId = url.searchParams.get('task_id');
    if (taskId) return Response.json({ task: await readTask(db, user.id, taskId) }, { headers: jsonHeaders });
    const snapshot = { ...await loadSnapshot(db, user.id), diary: await readDiary(db, user.id) };
    const isExport = url.searchParams.get('export') === '1';
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
    validateSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 64000) throw new InputError('입력 내용이 너무 깁니다.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('요청 형식이 올바르지 않습니다.');
    }
    if (!body || typeof body !== 'object' || !Object.hasOwn({ ...actions, ...diaryActions }, body.action)) {
      throw new InputError('지원하지 않는 작업입니다.');
    }
    const db = getDb();
    await ensureSchema(db);
    const { user } = await requireSession(db, request);
    const result = await (actions[body.action] ?? diaryActions[body.action])(db, body.data ?? {}, user.id);
    return Response.json({ result, snapshot: { ...await loadSnapshot(db, user.id), diary: await readDiary(db, user.id) } }, { headers: jsonHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

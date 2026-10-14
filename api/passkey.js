import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { getData, postData } from '../src/passkey-service.js';
import { HttpError, relyingParty, verifyRequestOrigin } from '../src/security.js';

const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-type': 'application/json; charset=utf-8',
};

function failure(error) {
  const known = error instanceof HttpError;
  return Response.json({ error: known ? error.message : '요청을 처리하지 못했습니다.' }, {
    status: known ? error.status : 500, headers,
  });
}

export async function GET(request) {
  try {
    const { origin } = relyingParty(request);
    const db = getDb();
    await ensureSchema(db);
    return Response.json(await getData(db, request, origin), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  try {
    const { origin, rpID } = relyingParty(request);
    verifyRequestOrigin(request, origin);
    const raw = await request.text();
    if (raw.length > 65536) throw new HttpError('요청 내용이 너무 깁니다.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError('요청 형식이 올바르지 않습니다.');
    }
    const db = getDb();
    await ensureSchema(db);
    const result = await postData(db, request, origin, rpID, body);
    return Response.json(result.body, {
      headers: { ...headers, ...(result.cookie ? { 'set-cookie': result.cookie } : {}) },
    });
  } catch (error) {
    return failure(error);
  }
}

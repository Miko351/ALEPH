import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { InputError } from '../src/model.js';
import {
  changePassword, deleteAccount, getSession, login, logout, register,
  validateSameOrigin,
} from '../src/auth.js';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function failure(error) {
  const known = error instanceof InputError;
  return Response.json({ error: known ? error.message : '인증 요청을 처리하지 못했습니다.' }, {
    status: known ? error.status : 500, headers,
  });
}

export async function GET(request) {
  try {
    const db = getDb();
    await ensureSchema(db);
    const session = await getSession(db, request);
    return Response.json({ authenticated: Boolean(session), user: session?.user ?? null,
      expires_at: session?.expiresAt ?? null }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  try {
    validateSameOrigin(request);
    const raw = await request.text();
    if (raw.length > 8192) throw new InputError('입력 내용이 너무 깁니다.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('요청 형식이 올바르지 않습니다.');
    }
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
      throw new InputError('지원하지 않는 작업입니다.');
    }
    const db = getDb();
    await ensureSchema(db);
    let result;
    if (body.action === 'register') result = await register(db, body.data ?? {}, request);
    else if (body.action === 'login') result = await login(db, body.data ?? {}, request);
    else if (body.action === 'logout') result = await logout(db, request);
    else if (body.action === 'change-password') result = await changePassword(db, request, body.data ?? {});
    else if (body.action === 'delete-account') result = await deleteAccount(db, request, body.data ?? {});
    else throw new InputError('지원하지 않는 작업입니다.');

    const { cookie, ...publicResult } = result;
    return Response.json(publicResult, {
      headers: { ...headers, ...(cookie ? { 'set-cookie': cookie } : {}) },
    });
  } catch (error) {
    return failure(error);
  }
}

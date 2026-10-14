import { createHash, randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const CHALLENGE_MS = 5 * 60 * 1000;
export const SESSION_MS = 12 * 60 * 60 * 1000;

export function relyingParty(request) {
  const requestOrigin = new URL(request.url).origin;
  const expectedOrigin = process.env.PASSKEY_ORIGIN?.trim() ||
    (process.env.VERCEL ? '' : requestOrigin);
  if (!expectedOrigin) throw new Error('PASSKEY_ORIGIN이 설정되지 않았습니다.');
  const url = new URL(expectedOrigin);
  if (url.origin !== expectedOrigin || (url.protocol !== 'https:' && url.hostname !== 'localhost')) {
    throw new Error('PASSKEY_ORIGIN은 HTTPS 주소 또는 localhost여야 합니다.');
  }
  if (requestOrigin !== expectedOrigin) throw new HttpError('이 주소에서는 패스키를 사용할 수 없습니다.', 403);
  return { origin: expectedOrigin, rpID: url.hostname };
}

export function verifyRequestOrigin(request, origin) {
  if (request.headers.get('origin') !== origin) throw new HttpError('요청 출처가 일치하지 않습니다.', 403);
}

export function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
    throw new HttpError('아이디는 영문 소문자·숫자·_·-로 3~30자여야 합니다.');
  }
  return username;
}

export function passkeyName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 40) throw new HttpError('패스키 이름을 1~40자로 입력해 주세요.');
  return name;
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function cookieName(origin) {
  return origin.startsWith('https:') ? '__Host-personal_session' : 'personal_session';
}

export function cookieHeader(origin, token = '', maxAge = 0) {
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  return `${cookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

export function readSessionToken(request, origin) {
  const name = cookieName(origin);
  const match = (request.headers.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1) || '';
}

export async function currentUser(db, request, origin) {
  const token = readSessionToken(request, origin);
  if (!token) return null;
  const result = await db.execute({
    sql: `SELECT users.id, users.username FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    args: [tokenHash(token), new Date().toISOString()],
  });
  return result.rows[0] || null;
}

export async function requireUser(db, request, origin) {
  const user = await currentUser(db, request, origin);
  if (!user) throw new HttpError('패스키 로그인이 필요합니다.', 401);
  return user;
}

export async function createSession(db, userId, origin) {
  const token = newToken();
  const now = new Date();
  await db.execute({
    sql: 'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    args: [tokenHash(token), userId, new Date(now.getTime() + SESSION_MS).toISOString(), now.toISOString()],
  });
  return cookieHeader(origin, token, SESSION_MS / 1000);
}

export async function logout(db, request, origin) {
  const token = readSessionToken(request, origin);
  if (token) await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [tokenHash(token)] });
  return cookieHeader(origin);
}


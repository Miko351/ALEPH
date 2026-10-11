import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { InputError } from './model.js';

const SESSION_HOURS = 12;
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
const PASSWORD_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const first = (result) => result.rows[0] ?? null;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{3,40}$/.test(username)) {
    throw new InputError('아이디는 영문 소문자·숫자·_·-를 사용해 3~40자로 입력해 주세요.');
  }
  return username;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 1024) {
    throw new InputError('비밀번호는 12자 이상, 1024바이트 이하로 입력해 주세요.');
  }
  return value;
}

function sessionName(request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-pds_session' : 'pds_session';
}

function cookieValue(request, token, maxAge = SESSION_MS / 1000) {
  const name = sessionName(request);
  const secure = name.startsWith('__Host-') ? '; Secure' : '';
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`;
}

function readToken(request) {
  const name = sessionName(request);
  const cookie = request.headers.get('cookie') ?? '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  const token = entry?.slice(name.length + 1) ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function validateSameOrigin(request) {
  if (request.headers.get('x-pds-request') !== '1' ||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new InputError('요청 형식을 확인해 주세요.', 403);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new InputError('다른 사이트에서 보낸 요청은 처리할 수 없습니다.', 403);
  }
}

export async function createSession(db, userId, request) {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_MS);
  await db.execute({
    sql: 'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    args: [tokenHash(token), userId, expiresAt.toISOString(), createdAt.toISOString()],
  });
  return { cookie: cookieValue(request, token), expiresAt: expiresAt.toISOString() };
}

export async function getSession(db, request) {
  const token = readToken(request);
  if (!token) return null;
  const row = first(await db.execute({
    sql: `SELECT users.id, users.username, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    args: [tokenHash(token), new Date().toISOString()],
  }));
  return row ? { user: { id: row.id, username: row.username }, expiresAt: row.expires_at } : null;
}

export async function requireSession(db, request) {
  const session = await getSession(db, request);
  if (!session) throw new InputError('로그인이 필요합니다.', 401);
  return session;
}

export async function register(db, input, request) {
  const username = normalizeUsername(input.username);
  const password = validatePassword(input.password);
  const exists = first(await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] }));
  if (exists) throw new InputError('이미 사용 중인 아이디입니다.', 409);
  const hash = await argon2.hash(password, PASSWORD_OPTIONS);
  const userId = randomUUID();
  try {
    await db.execute({
      sql: 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      args: [userId, username, hash, new Date().toISOString()],
    });
  } catch (error) {
    if (/unique|constraint/i.test(String(error.message))) throw new InputError('이미 사용 중인 아이디입니다.', 409);
    throw error;
  }
  const session = await createSession(db, userId, request);
  return { user: { id: userId, username }, ...session };
}

export async function login(db, input, request) {
  const username = normalizeUsername(input.username);
  const password = typeof input.password === 'string' ? input.password : '';
  const user = first(await db.execute({
    sql: 'SELECT id, username, password_hash FROM users WHERE username = ?', args: [username],
  }));
  const valid = user && await argon2.verify(user.password_hash, password).catch(() => false);
  if (!valid) throw new InputError('아이디 또는 비밀번호가 올바르지 않습니다.', 401);
  const session = await createSession(db, user.id, request);
  return { user: { id: user.id, username: user.username }, ...session };
}

export async function logout(db, request) {
  const token = readToken(request);
  if (token) await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [tokenHash(token)] });
  return { cookie: cookieValue(request, '', 0) };
}

export async function changePassword(db, request, input) {
  const { user } = await requireSession(db, request);
  const current = typeof input.current_password === 'string' ? input.current_password : '';
  const next = validatePassword(input.new_password);
  const account = first(await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.id] }));
  if (!account || !await argon2.verify(account.password_hash, current)) {
    throw new InputError('현재 비밀번호가 올바르지 않습니다.', 403);
  }
  const hash = await argon2.hash(next, PASSWORD_OPTIONS);
  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, user.id] });
    await tx.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [user.id] });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  return { cookie: cookieValue(request, '', 0) };
}

export async function deleteAccount(db, request, input) {
  const { user } = await requireSession(db, request);
  const account = first(await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.id] }));
  const password = typeof input.password === 'string' ? input.password : '';
  if (!account || !await argon2.verify(account.password_hash, password)) {
    throw new InputError('비밀번호가 올바르지 않습니다.', 403);
  }
  const ownerPlans = 'SELECT id FROM plans WHERE owner_id = ?';
  const ownerTasks = `SELECT id FROM tasks WHERE plan_id IN (${ownerPlans})`;
  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM diary_rule_changes WHERE owner_id = ?', args: [user.id] });
    await tx.execute({ sql: 'DELETE FROM diary_days WHERE owner_id = ?', args: [user.id] });
    await tx.execute({ sql: 'DELETE FROM diary_config WHERE owner_id = ?', args: [user.id] });
    await tx.execute({ sql: `DELETE FROM reviews WHERE source_plan_id IN (${ownerPlans}) OR next_plan_id IN (${ownerPlans})`, args: [user.id, user.id] });
    await tx.execute({ sql: `DELETE FROM completion_events WHERE task_id IN (${ownerTasks})`, args: [user.id] });
    await tx.execute({ sql: `DELETE FROM work_logs WHERE task_id IN (${ownerTasks})`, args: [user.id] });
    await tx.execute({ sql: `DELETE FROM tasks WHERE plan_id IN (${ownerPlans})`, args: [user.id] });
    await tx.execute({ sql: `DELETE FROM plan_versions WHERE plan_id IN (${ownerPlans})`, args: [user.id] });
    await tx.execute({ sql: 'DELETE FROM plans WHERE owner_id = ?', args: [user.id] });
    await tx.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [user.id] });
    await tx.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  return { cookie: cookieValue(request, '', 0) };
}

export const authDetails = {
  passwordAlgorithm: 'Argon2id',
  sessionKind: 'opaque server session',
  sessionHours: SESSION_HOURS,
};

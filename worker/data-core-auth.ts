import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import { DATA_CORE_ROLES, isMasterRole, DataCoreAccessError, requireAuthenticatedAccess, requireSignedInAccess, type DataCoreAccessContext, type DataCoreRole } from "./data-core-access";
import { canonicalCampusId, HEARTBEAT_MINUTES } from './campus-directory';

export const AUTH_COOKIE_NAME = "data_core_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
// Cloudflare Workers currently rejects PBKDF2 requests above this limit.
const PASSWORD_ITERATIONS = 100_000;
const MAX_PASSWORD_ITERATIONS = 100_000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

type AccountRow = {
  id: string;
  user_id: string;
  login_id: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  status: string;
  must_change_password: number;
  failed_login_count: number;
  locked_until: string | null;
};

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeLoginId(value: unknown) {
  return text(value, 80).toLowerCase();
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function passwordHash(password: string, salt: string, iterations: number) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_ITERATIONS) {
    throw new DataCoreAccessError(409, "이 로그인 계정은 비밀번호 재설정이 필요합니다.");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const prefix = `${AUTH_COOKIE_NAME}=`;
  const entry = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function cookie(value: string, maxAge = SESSION_MAX_AGE_SECONDS) {
  return `${AUTH_COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

const authSchemaReady = new WeakMap<D1Database, Promise<void>>();
export async function ensureStandaloneAuthSchema(db: D1Database) {
  if (!authSchemaReady.has(db)) authSchemaReady.set(db, initializeStandaloneAuthSchema(db).catch(error => { authSchemaReady.delete(db); throw error; }));
  return authSchemaReady.get(db)!;
}
async function initializeStandaloneAuthSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL UNIQUE, login_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_login_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_active_idx ON auth_sessions(token_hash, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_accounts_login_idx ON auth_accounts(login_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_presence_idx ON auth_sessions(user_id, revoked_at, expires_at, last_seen_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS audit_auth_login_idx ON audit_logs(organization_id, resource_type, action, resource_id, created_at)"),
  ]);
}

export async function standaloneSessionIdentity(db: D1Database, request: Request) {
  const rawToken = sessionToken(request);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, a.must_change_password
     FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
     INNER JOIN auth_accounts a ON a.user_id = u.id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.status = 'active' AND u.status = 'active'`,
  ).bind(tokenHash, now).first<{ session_id: string; user_id: string; email: string | null; display_name: string; must_change_password: number }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    internalUserId: row.user_id,
    email: row.email || row.user_id,
    displayName: row.display_name,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function recordStandaloneActivity(db: D1Database, request: Request, context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new DataCoreAccessError(403, '허용되지 않은 요청 출처입니다.');
  const token = sessionToken(request);
  if (!token) return { ok: true };
  const now = new Date();
  await db.prepare(`UPDATE auth_sessions SET last_seen_at = ?
    WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at <= ?`)
    .bind(now.toISOString(), await sha256(token), context.user!.internalUserId, now.toISOString(),
      new Date(now.getTime() - HEARTBEAT_MINUTES * 60_000).toISOString()).run();
  return { ok: true };
}

async function audit(db: D1Database, userId: string | null, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  await db.prepare(
    `INSERT INTO audit_logs (id, organization_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'auth_account', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, userId, action, resourceId, JSON.stringify(metadata), new Date().toISOString()).run();
}

async function createSession(db: D1Database, userId: string) {
  const rawToken = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.prepare(
    `INSERT INTO auth_sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), await sha256(rawToken), userId, now.toISOString(), expiresAt, now.toISOString()).run();
  return { rawToken, expiresAt };
}

export async function loginStandalone(db: D1Database, request: Request, body: { loginId?: unknown; password?: unknown }) {
  assertSameOrigin(request);
  const loginId = normalizeLoginId(body.loginId);
  const password = String(body.password || "");
  if (!loginId || !password) throw new DataCoreAccessError(400, "로그인 ID와 비밀번호를 입력하세요.");
  const account = await db.prepare("SELECT a.* FROM auth_accounts a INNER JOIN users u ON u.id = a.user_id WHERE a.login_id = ? AND u.status = 'active'").bind(loginId).first<AccountRow>();
  const now = new Date();
  if (!account || account.status !== "active") {
    await audit(db, null, "login_failed", null, { loginId });
    throw new DataCoreAccessError(401, "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  }
  if (account.locked_until && new Date(account.locked_until).getTime() > now.getTime()) {
    throw new DataCoreAccessError(423, "로그인 시도가 잠시 잠겼습니다. 잠시 후 다시 시도하세요.");
  }
  const candidate = await passwordHash(password, account.password_salt, account.password_iterations);
  if (!timingSafeEqual(candidate, account.password_hash)) {
    const failures = account.failed_login_count + 1;
    const lockedUntil = failures >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
    await db.prepare("UPDATE auth_accounts SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(failures, lockedUntil, now.toISOString(), account.id).run();
    await audit(db, account.user_id, "login_failed", account.id, { failures });
    throw new DataCoreAccessError(401, "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  }
  await db.prepare("UPDATE auth_accounts SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now.toISOString(), now.toISOString(), account.id).run();
  const session = await createSession(db, account.user_id);
  await audit(db, account.user_id, "login", account.id);
  return { session, mustChangePassword: Boolean(account.must_change_password) };
}

export async function logoutStandalone(db: D1Database, request: Request) {
  assertSameOrigin(request);
  const rawToken = sessionToken(request);
  if (rawToken) await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), await sha256(rawToken)).run();
  return { headers: { "set-cookie": cookie("", 0) } };
}

export async function changeStandalonePassword(db: D1Database, request: Request, context: DataCoreAccessContext, body: { currentPassword?: unknown; nextPassword?: unknown }) {
  assertSameOrigin(request);
  requireSignedInAccess(context);
  const actor = context.user!;
  const currentPassword = String(body.currentPassword || "");
  const nextPassword = String(body.nextPassword || "");
  if (nextPassword.length < 12) throw new DataCoreAccessError(400, "새 비밀번호는 12자 이상이어야 합니다.");
  const account = await db.prepare("SELECT * FROM auth_accounts WHERE user_id = ?").bind(actor.internalUserId).first<AccountRow>();
  if (!account) throw new DataCoreAccessError(400, "standalone 로그인 계정이 없습니다.");
  const candidate = await passwordHash(currentPassword, account.password_salt, account.password_iterations);
  if (!timingSafeEqual(candidate, account.password_hash)) throw new DataCoreAccessError(401, "현재 비밀번호가 올바르지 않습니다.");
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(nextPassword, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await db.prepare("UPDATE auth_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(hash, salt, PASSWORD_ITERATIONS, now, account.id).run();
  await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now, account.user_id).run();
  const session = await createSession(db, account.user_id);
  await audit(db, account.user_id, "password_changed", account.id);
  return { ok: true, session };
}

export async function createStandaloneAccount(db: D1Database, request: Request, context: DataCoreAccessContext, input: { loginId?: unknown; displayName?: unknown; email?: unknown; campusId?: unknown; role?: unknown; temporaryPassword?: unknown }) {
  assertSameOrigin(request);
  requireAuthenticatedAccess(context);
  const actor = context.user!;
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "계정 관리는 마스터 관리자만 사용할 수 있습니다.");
  const loginId = normalizeLoginId(input.loginId);
  const temporaryPassword = String(input.temporaryPassword || "");
  const role = text(input.role, 40) as DataCoreRole;
  if (!loginId || temporaryPassword.length < 12 || !DATA_CORE_ROLES.includes(role)) throw new DataCoreAccessError(400, "계정 정보를 확인하세요.");
  const userId = `local:${crypto.randomUUID()}`;
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(temporaryPassword, salt, PASSWORD_ITERATIONS);
  const campusId = isMasterRole(role) ? null : canonicalCampusId(input.campusId);
  if (!isMasterRole(role) && !campusId) throw new DataCoreAccessError(400, "캠퍼스 계정에는 캠퍼스 지정이 필요합니다.");
  if (campusId && !await db.prepare("SELECT id FROM campuses WHERE id = ? AND organization_id = ? AND status = 'active'").bind(campusId, DEFAULT_ORGANIZATION_ID).first()) throw new DataCoreAccessError(400, '활성 캠퍼스를 선택하세요.');
  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .bind(userId, text(input.email, 240) || null, text(input.displayName, 160) || loginId, now, now),
    db.prepare("INSERT INTO auth_accounts (id, user_id, login_id, password_hash, password_salt, password_iterations, status, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 0, ?, ?)")
      .bind(accountId, userId, loginId, hash, salt, PASSWORD_ITERATIONS, now, now),
    db.prepare("INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, campusId, userId, role, now, now),
  ]);
  await audit(db, actor.internalUserId, "account_created", accountId, { loginId, campusId, role });
  return { id: accountId, loginId, userId, campusId, role, mustChangePassword: true };
}

export async function listStandaloneAccounts(db: D1Database, context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "계정 관리는 마스터 관리자만 사용할 수 있습니다.");
  const result = await db.prepare(
    `SELECT a.id, a.login_id, a.status, a.must_change_password, a.failed_login_count, a.locked_until,
            a.last_login_at, u.display_name, u.email, m.campus_id, c.name AS campus_name, m.role
       FROM auth_accounts a
       INNER JOIN users u ON u.id = a.user_id
       LEFT JOIN memberships m ON m.user_id = a.user_id AND m.organization_id = ?
       LEFT JOIN campuses c ON c.id = m.campus_id
       ORDER BY a.created_at DESC`,
  ).bind(DEFAULT_ORGANIZATION_ID).all();
  return result.results || [];
}

export async function updateStandaloneAccount(
  db: D1Database,
  request: Request,
  context: DataCoreAccessContext,
  accountId: string,
  input: { status?: unknown; temporaryPassword?: unknown; revokeSessions?: unknown },
) {
  assertSameOrigin(request);
  requireAuthenticatedAccess(context);
  const actor = context.user!;
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "계정 관리는 마스터 관리자만 사용할 수 있습니다.");
  const account = await db.prepare("SELECT * FROM auth_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
  if (!account) throw new DataCoreAccessError(404, "계정을 찾을 수 없습니다.");
  const now = new Date().toISOString();
  const status = text(input.status, 20);
  const temporaryPassword = String(input.temporaryPassword || "");
  const revokeSessions = input.revokeSessions === true;
  if (status && !["active", "disabled"].includes(status)) throw new DataCoreAccessError(400, "계정 상태가 올바르지 않습니다.");
  if (temporaryPassword && temporaryPassword.length < 12) throw new DataCoreAccessError(400, "임시 비밀번호는 12자 이상이어야 합니다.");
  const targetIsSuperAdmin = Boolean(await db.prepare(
    "SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND role IN ('SUPER_ADMIN', 'MASTER') LIMIT 1",
  ).bind(account.user_id, DEFAULT_ORGANIZATION_ID).first());
  if (account.user_id === actor.internalUserId && (status === "disabled" || revokeSessions || temporaryPassword)) {
    throw new DataCoreAccessError(400, "본인 계정의 비활성화, 세션 해제, 임시 비밀번호 재설정은 다른 마스터 관리자가 처리해야 합니다.");
  }
  if (status === "disabled" && account.status === "active" && targetIsSuperAdmin) {
    const activeSuperAdmins = await db.prepare(
      `SELECT count(DISTINCT a.id) AS count
         FROM auth_accounts a
         INNER JOIN memberships m ON m.user_id = a.user_id
         WHERE a.status = 'active' AND m.organization_id = ? AND m.role IN ('SUPER_ADMIN', 'MASTER')`,
    ).bind(DEFAULT_ORGANIZATION_ID).first<{ count: number }>();
    if (Number(activeSuperAdmins?.count || 0) <= 1) {
      throw new DataCoreAccessError(409, "마지막 활성 마스터 계정은 비활성화할 수 없습니다.");
    }
  }
  const statements: D1PreparedStatement[] = [];
  if (temporaryPassword) {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    statements.push(db.prepare(
      "UPDATE auth_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
    ).bind(await passwordHash(temporaryPassword, salt, PASSWORD_ITERATIONS), salt, PASSWORD_ITERATIONS, now, accountId));
  }
  if (status) statements.push(db.prepare("UPDATE auth_accounts SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, accountId));
  if (status === "disabled" || revokeSessions || temporaryPassword) {
    statements.push(db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, account.user_id));
  }
  if (statements.length) await db.batch(statements);
  await audit(db, actor.internalUserId, "account_updated", accountId, { status: status || undefined, passwordReset: Boolean(temporaryPassword), sessionsRevoked: Boolean(status === "disabled" || revokeSessions || temporaryPassword) });
  return { id: accountId, status: status || account.status, passwordReset: Boolean(temporaryPassword) };
}

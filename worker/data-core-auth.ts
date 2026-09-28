import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import { DATA_CORE_ROLES, isMasterRole, DataCoreAccessError, requireAuthenticatedAccess, requireSignedInAccess, type DataCoreAccessContext, type DataCoreRole } from "./data-core-access";
import { canonicalCampusId, HEARTBEAT_MINUTES, campusDisplayName, isSelectableCampus, presentCampuses } from './campus-directory';

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
    // 직원인증: a person applies with their own login ID/password (kept only as a PBKDF2 hash); the
    // account exists only after a MASTER approves the request.
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_signup_requests (
      id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, campus_id TEXT NOT NULL, position TEXT NOT NULL,
      login_id TEXT NOT NULL, phone TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requester_hash TEXT,
      account_id TEXT, role TEXT, decided_by_user_id TEXT, decided_at TEXT, reject_reason TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_signup_status_idx ON auth_signup_requests(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_signup_login_idx ON auth_signup_requests(login_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_signup_requester_idx ON auth_signup_requests(requester_hash, created_at)"),
  ]);
}

export async function standaloneSessionIdentity(db: D1Database, request: Request) {
  const rawToken = sessionToken(request);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, a.login_id, a.must_change_password
     FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
     INNER JOIN auth_accounts a ON a.user_id = u.id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.status = 'active' AND u.status = 'active'`,
  ).bind(tokenHash, now).first<{ session_id: string; user_id: string; email: string | null; display_name: string; login_id: string; must_change_password: number }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    internalUserId: row.user_id,
    email: row.email || row.user_id,
    displayName: row.display_name,
    loginId: row.login_id,
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

function auditStatement(db: D1Database, userId: string | null, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  return db.prepare(
    `INSERT INTO audit_logs (id, organization_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'auth_account', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, userId, action, resourceId, JSON.stringify(metadata), new Date().toISOString());
}
async function audit(db: D1Database, userId: string | null, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  await auditStatement(db, userId, action, resourceId, metadata).run();
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
  if (!account) {
    // Someone who applied (직원인증) but is not approved yet gets told so — only with the right password,
    // so the message never reveals which IDs have applied.
    const pending = await db.prepare(
      "SELECT status, password_hash, password_salt, password_iterations FROM auth_signup_requests WHERE login_id = ? AND status IN ('pending','rejected') ORDER BY created_at DESC LIMIT 1",
    ).bind(loginId).first<{ status: string; password_hash: string; password_salt: string; password_iterations: number }>();
    if (pending && timingSafeEqual(await passwordHash(password, pending.password_salt, pending.password_iterations), pending.password_hash)) {
      await audit(db, null, "login_failed", null, { loginId, signup: pending.status });
      throw new DataCoreAccessError(403, pending.status === "pending"
        ? "직원인증 신청이 아직 수락되지 않았습니다. 마스터 관리자가 수락하면 로그인할 수 있습니다."
        : "직원인증 신청이 거절되었습니다. 마스터 관리자에게 문의하세요.");
    }
  }
  if (!account || account.status !== "active") {
    await audit(db, null, "login_failed", null, { loginId });
    throw new DataCoreAccessError(401, "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  }
  if (account.locked_until && new Date(account.locked_until).getTime() > now.getTime()) {
    throw new DataCoreAccessError(423, "로그인 시도가 잠시 잠겼습니다. 잠시 후 다시 시도하세요.");
  }
  const candidate = await passwordHash(password, account.password_salt, account.password_iterations);
  if (!timingSafeEqual(candidate, account.password_hash)) {
    const failures = (account.locked_until ? 0 : account.failed_login_count) + 1;
    const lockedUntil = failures >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
    await db.prepare("UPDATE auth_accounts SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(failures, lockedUntil, now.toISOString(), account.id).run();
    await audit(db, account.user_id, "login_failed", account.id, { failures });
    throw new DataCoreAccessError(401, lockedUntil ? "로그인 시도가 잠시 잠겼습니다. 15분 후 다시 시도하거나 마스터에게 비밀번호 변경을 요청하세요." : "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
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
  const rawToken = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const session = { rawToken, expiresAt: new Date(Date.parse(now) + SESSION_MAX_AGE_SECONDS * 1000).toISOString() };
  // A failed session/audit write must not leave a changed password behind.
  await db.batch([
    db.prepare("UPDATE auth_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
      .bind(hash, salt, PASSWORD_ITERATIONS, now, account.id),
    db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, account.user_id),
    db.prepare("INSERT INTO auth_sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), await sha256(rawToken), account.user_id, now, session.expiresAt, now),
    db.prepare("INSERT INTO audit_logs (id, organization_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, 'password_changed', 'auth_account', ?, '{}', ?)")
      .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, account.user_id, account.id, now),
  ]);
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
            a.last_login_at, u.display_name, u.email, m.campus_id, c.name AS campus_name, m.role,
            r.position, r.phone
       FROM auth_accounts a
       INNER JOIN users u ON u.id = a.user_id
       LEFT JOIN memberships m ON m.user_id = a.user_id AND m.organization_id = ?
       LEFT JOIN campuses c ON c.id = m.campus_id
       LEFT JOIN auth_signup_requests r ON r.account_id = a.id AND r.status = 'approved'
       ORDER BY a.created_at DESC`,
  ).bind(DEFAULT_ORGANIZATION_ID).all();
  return (result.results || []).map(row => ({ ...row,
    campus_name: campusDisplayName(row.campus_id, row.campus_name),
    retiredCampus: !isSelectableCampus(row.campus_id),
  }));
}

export async function updateStandaloneAccount(
  db: D1Database,
  request: Request,
  context: DataCoreAccessContext,
  accountId: string,
  input: { status?: unknown; temporaryPassword?: unknown; newPassword?: unknown; mustChangePassword?: unknown; revokeSessions?: unknown },
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
  const directChange = input.newPassword !== undefined;
  const replacementPassword = directChange ? String(input.newPassword || "") : temporaryPassword;
  if (directChange && request.headers.get('origin') !== new URL(request.url).origin) throw new DataCoreAccessError(403, '동일 출처 요청만 허용됩니다.');
  if (directChange && (temporaryPassword || replacementPassword.length < 12 || (input.mustChangePassword !== undefined && typeof input.mustChangePassword !== 'boolean'))) throw new DataCoreAccessError(400, '새 비밀번호는 12자 이상이어야 하며 변경 방식을 확인해야 합니다.');
  const mustChange = directChange ? input.mustChangePassword !== false : true;
  const revokeSessions = input.revokeSessions === true;
  if (status && !["active", "disabled"].includes(status)) throw new DataCoreAccessError(400, "계정 상태가 올바르지 않습니다.");
  if (temporaryPassword && temporaryPassword.length < 12) throw new DataCoreAccessError(400, "임시 비밀번호는 12자 이상이어야 합니다.");
  const targetIsSuperAdmin = Boolean(await db.prepare(
    "SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND role IN ('SUPER_ADMIN', 'MASTER') LIMIT 1",
  ).bind(account.user_id, DEFAULT_ORGANIZATION_ID).first());
  if (directChange && (targetIsSuperAdmin || !await db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND campus_id IS NOT NULL LIMIT 1").bind(account.user_id, DEFAULT_ORGANIZATION_ID).first())) throw new DataCoreAccessError(403, '직접 비밀번호 변경은 캠퍼스 계정에만 사용할 수 있습니다.');
  if (account.user_id === actor.internalUserId && (status === "disabled" || revokeSessions || replacementPassword)) {
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
  if (replacementPassword) {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    statements.push(db.prepare(
      "UPDATE auth_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
    ).bind(await passwordHash(replacementPassword, salt, PASSWORD_ITERATIONS), salt, PASSWORD_ITERATIONS, mustChange ? 1 : 0, now, accountId));
  }
  if (status) statements.push(db.prepare("UPDATE auth_accounts SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, accountId));
  if (status === "disabled" || revokeSessions || replacementPassword) {
    statements.push(db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, account.user_id));
  }
  statements.push(auditStatement(db, actor.internalUserId, "account_updated", accountId, { status: status || undefined, passwordReset: Boolean(replacementPassword), passwordSetByMaster: directChange, mustChangePassword: replacementPassword ? mustChange : undefined, sessionsRevoked: Boolean(status === "disabled" || revokeSessions || replacementPassword) }));
  await db.batch(statements);
  return { id: accountId, status: status || account.status, passwordReset: Boolean(replacementPassword) };
}

/**
 * 회원삭제: the account can never sign in again and its login ID becomes free. Files, records and audit
 * history the person created stay (the users row is kept as 'deleted' so authorship still resolves);
 * only the login, sessions and campus memberships are removed.
 */
export async function deleteStandaloneAccount(db: D1Database, request: Request, context: DataCoreAccessContext, accountId: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  requireAuthenticatedAccess(context);
  const actor = context.user!;
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "계정 관리는 마스터 관리자만 사용할 수 있습니다.");
  const account = await db.prepare("SELECT * FROM auth_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
  if (!account) throw new DataCoreAccessError(404, "계정을 찾을 수 없습니다.");
  if (account.user_id === actor.internalUserId) throw new DataCoreAccessError(400, "본인 계정은 삭제할 수 없습니다. 다른 마스터 관리자가 처리해야 합니다.");
  const targetIsMaster = Boolean(await db.prepare(
    "SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND role IN ('SUPER_ADMIN', 'MASTER') LIMIT 1",
  ).bind(account.user_id, DEFAULT_ORGANIZATION_ID).first());
  if (targetIsMaster && account.status === "active") {
    const masters = await db.prepare(
      `SELECT count(DISTINCT a.id) AS count FROM auth_accounts a INNER JOIN memberships m ON m.user_id = a.user_id
        WHERE a.status = 'active' AND m.organization_id = ? AND m.role IN ('SUPER_ADMIN', 'MASTER')`,
    ).bind(DEFAULT_ORGANIZATION_ID).first<{ count: number }>();
    if (Number(masters?.count || 0) <= 1) throw new DataCoreAccessError(409, "마지막 마스터 계정은 삭제할 수 없습니다.");
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(account.user_id),
    db.prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?").bind(account.user_id, DEFAULT_ORGANIZATION_ID),
    db.prepare("DELETE FROM auth_accounts WHERE id = ?").bind(accountId),
    db.prepare("UPDATE users SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now, account.user_id),
    db.prepare("UPDATE auth_signup_requests SET status = 'withdrawn', updated_at = ? WHERE account_id = ?").bind(now, accountId),
    auditStatement(db, actor.internalUserId, "account_deleted", accountId, { loginId: account.login_id }),
  ]);
  return { id: accountId, deleted: true };
}

// ---------- 직원인증 (staff sign-up → MASTER approval) ----------
const SIGNUP_PASSWORD_MIN = 12;
const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{3,29}$/;
const SIGNUPS_PER_REQUESTER_HOUR = 5;
const MAX_PENDING_SIGNUPS = 100;

type SignupRow = {
  id: string; display_name: string; campus_id: string; position: string; login_id: string; phone: string;
  password_hash: string; password_salt: string; password_iterations: number; status: string; created_at: string;
};

function requireStrictSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
}

async function activeCampus(db: D1Database, value: unknown) {
  const id = canonicalCampusId(value);
  if (!id || !isSelectableCampus(id)) return null;
  return db.prepare("SELECT id FROM campuses WHERE id = ? AND organization_id = ? AND status = 'active'").bind(id, DEFAULT_ORGANIZATION_ID).first<{ id: string }>();
}

/** What the public 직원인증 form needs: the campuses to choose from and the password rule. */
export async function signupOptions(db: D1Database) {
  const rows = (await db.prepare("SELECT id, code, name FROM campuses WHERE organization_id = ? AND status = 'active'")
    .bind(DEFAULT_ORGANIZATION_ID).all<Record<string, unknown>>()).results || [];
  return { campuses: presentCampuses(rows).map(row => ({ id: row.id, name: row.name })), passwordMinLength: SIGNUP_PASSWORD_MIN };
}

/** Public: files a 직원인증 request. Nothing can sign in with it until a MASTER approves it. */
export async function submitSignupRequest(db: D1Database, request: Request, input: Record<string, unknown>) {
  requireStrictSameOrigin(request);
  const displayName = text(input.displayName, 40);
  const position = text(input.position, 40);
  const loginId = normalizeLoginId(input.loginId);
  const password = String(input.password ?? "");
  const phone = text(input.phone, 20);
  const digits = phone.replace(/\D/g, "");
  if (!displayName) throw new DataCoreAccessError(400, "이름을 입력하세요.");
  const campus = await activeCampus(db, input.campusId);
  if (!campus) throw new DataCoreAccessError(400, "캠퍼스를 선택하세요.");
  if (!position) throw new DataCoreAccessError(400, "직책을 입력하세요.");
  if (!LOGIN_ID_PATTERN.test(loginId)) throw new DataCoreAccessError(400, "아이디는 영문 소문자·숫자로 시작하는 4~30자(영문·숫자·. _ -)로 입력하세요.");
  if (password.length < SIGNUP_PASSWORD_MIN || password.length > 128) throw new DataCoreAccessError(400, `비밀번호는 ${SIGNUP_PASSWORD_MIN}자 이상으로 입력하세요.`);
  if (!/^[0-9+()\-\s]+$/.test(phone) || digits.length < 9 || digits.length > 12) throw new DataCoreAccessError(400, "연락처를 숫자로 입력하세요. 예: 010-1234-5678");
  const taken = await db.prepare(
    "SELECT 1 FROM auth_accounts WHERE login_id = ? UNION ALL SELECT 1 FROM auth_signup_requests WHERE login_id = ? AND status = 'pending' LIMIT 1",
  ).bind(loginId, loginId).first();
  if (taken) throw new DataCoreAccessError(409, "이미 사용 중이거나 신청 중인 아이디입니다. 다른 아이디를 입력하세요.");
  const now = new Date();
  const requesterHash = await sha256(`signup:${request.headers.get("cf-connecting-ip") || "unknown"}`);
  const recent = await db.prepare("SELECT count(*) AS count FROM auth_signup_requests WHERE requester_hash = ? AND created_at > ?")
    .bind(requesterHash, new Date(now.getTime() - 3600_000).toISOString()).first<{ count: number }>();
  if (Number(recent?.count || 0) >= SIGNUPS_PER_REQUESTER_HOUR) throw new DataCoreAccessError(429, "신청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  const pending = await db.prepare("SELECT count(*) AS count FROM auth_signup_requests WHERE status = 'pending'").first<{ count: number }>();
  if (Number(pending?.count || 0) >= MAX_PENDING_SIGNUPS) throw new DataCoreAccessError(429, "대기 중인 신청이 많습니다. 마스터 관리자에게 문의하세요.");
  const id = crypto.randomUUID();
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(password, salt, PASSWORD_ITERATIONS);
  const stamp = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO auth_signup_requests (id, display_name, campus_id, position, login_id, phone, password_hash, password_salt,
        password_iterations, status, requester_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .bind(id, displayName, campus.id, position, loginId, phone, hash, salt, PASSWORD_ITERATIONS, requesterHash, stamp, stamp),
    auditStatement(db, null, "signup_requested", id, { loginId, campusId: campus.id }),
  ]);
  return { id, status: "pending" };
}

/** MASTER: 직원인증 requests (pending by default). Password hashes never leave the server. */
export async function listSignupRequests(db: D1Database, context: DataCoreAccessContext, status = "pending") {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "직원인증 관리는 마스터 관리자만 사용할 수 있습니다.");
  const all = status === "all";
  const rows = (await db.prepare(
    `SELECT id, display_name, campus_id, position, login_id, phone, status, role, account_id, reject_reason, decided_at, created_at
       FROM auth_signup_requests ${all ? "" : "WHERE status = 'pending'"} ORDER BY created_at DESC LIMIT 200`,
  ).all<Record<string, unknown>>()).results || [];
  return rows.map(row => ({ ...row, campus_name: campusDisplayName(row.campus_id, row.campus_id) }));
}

/** MASTER: accept (creates the account with the applicant's own password) or reject a request. */
export async function decideSignupRequest(
  db: D1Database, request: Request, context: DataCoreAccessContext, id: string, action: "approve" | "reject",
  input: { role?: unknown; campusId?: unknown; reason?: unknown },
) {
  requireStrictSameOrigin(request);
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "직원인증 관리는 마스터 관리자만 사용할 수 있습니다.");
  const actor = context.user!;
  const row = await db.prepare("SELECT * FROM auth_signup_requests WHERE id = ?").bind(id).first<SignupRow>();
  if (!row) throw new DataCoreAccessError(404, "신청을 찾을 수 없습니다.");
  if (row.status !== "pending") throw new DataCoreAccessError(409, "이미 처리된 신청입니다.");
  const now = new Date().toISOString();
  if (action === "reject") {
    const reason = text(input.reason, 200) || null;
    await db.batch([
      db.prepare("UPDATE auth_signup_requests SET status = 'rejected', reject_reason = ?, decided_by_user_id = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(reason, actor.internalUserId, now, now, id),
      auditStatement(db, actor.internalUserId, "signup_rejected", id, { loginId: row.login_id }),
    ]);
    return { id, status: "rejected" };
  }
  const role = (text(input.role, 40) || "CAMPUS_ADMIN") as DataCoreRole;
  if (!DATA_CORE_ROLES.includes(role)) throw new DataCoreAccessError(400, "권한을 선택하세요.");
  let campusId: string | null = null;
  if (!isMasterRole(role)) {
    const campus = await activeCampus(db, input.campusId ?? row.campus_id);
    if (!campus) throw new DataCoreAccessError(400, "활성 캠퍼스를 선택하세요.");
    campusId = campus.id;
  }
  if (await db.prepare("SELECT 1 FROM auth_accounts WHERE login_id = ?").bind(row.login_id).first()) {
    throw new DataCoreAccessError(409, "같은 아이디의 계정이 이미 있습니다. 신청을 거절하고 다른 아이디로 다시 신청하도록 안내하세요.");
  }
  const userId = `local:${crypto.randomUUID()}`, accountId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare("INSERT INTO users (id, email, display_name, status, created_at, updated_at) VALUES (?, NULL, ?, 'active', ?, ?)")
        .bind(userId, row.display_name, now, now),
      // The applicant chose this password, so no forced change on first login.
      db.prepare("INSERT INTO auth_accounts (id, user_id, login_id, password_hash, password_salt, password_iterations, status, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)")
        .bind(accountId, userId, row.login_id, row.password_hash, row.password_salt, row.password_iterations, now, now),
      db.prepare("INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, campusId, userId, role, now, now),
      db.prepare("UPDATE auth_signup_requests SET status = 'approved', account_id = ?, role = ?, campus_id = COALESCE(?, campus_id), decided_by_user_id = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .bind(accountId, role, campusId, actor.internalUserId, now, now, id),
      auditStatement(db, actor.internalUserId, "signup_approved", id, { loginId: row.login_id, accountId, role, campusId }),
    ]);
  } catch (error) {
    if (/UNIQUE/i.test(String((error as Error)?.message))) throw new DataCoreAccessError(409, "같은 아이디의 계정이 이미 있습니다.");
    throw error;
  }
  return { id, status: "approved", account: { id: accountId, loginId: row.login_id, role, campusId } };
}

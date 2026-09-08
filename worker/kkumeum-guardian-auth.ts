import { DataCoreAccessError } from "./data-core-access";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";
import { assertInternalGuardianBeta } from "./kkumeum-pilot";

export const KKUMEUM_GUARDIAN_COOKIE_NAME = "kkumeum_family_session";
const GUARDIAN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 100_000;
const MAX_PASSWORD_ITERATIONS = 100_000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

type GuardianRow = {
  id: string;
  login_id: string | null;
  display_name: string;
  status: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  must_change_password: number;
  failed_login_count: number;
  locked_until: string | null;
};

export type KkumeumGuardianIdentity = {
  guardianId: string;
  loginId: string;
  displayName: string;
  mustChangePassword: boolean;
};

function text(value: unknown, max = 240): string {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeLoginId(value: unknown): string {
  return text(value, 120).toLowerCase();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64(new Uint8Array(digest));
}

async function passwordHash(password: string, salt: string, iterations: number): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_ITERATIONS) {
    throw new DataCoreAccessError(409, "이 보호자 계정은 비밀번호 재설정이 필요합니다.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function guardianSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const prefix = `${KKUMEUM_GUARDIAN_COOKIE_NAME}=`;
  const entry = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

export function kkumeumGuardianCookie(value: string, maxAge = GUARDIAN_SESSION_MAX_AGE_SECONDS): string {
  return `${KKUMEUM_GUARDIAN_COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

export async function ensureKkumeumGuardianAuthSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumPhase1Schema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_guardians (
      id TEXT PRIMARY KEY NOT NULL,
      login_id TEXT UNIQUE,
      phone TEXT,
      email TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      password_hash TEXT,
      password_salt TEXT,
      password_iterations INTEGER,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS guardian_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      guardian_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE
    )`),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS student_guardians (
      id TEXT PRIMARY KEY NOT NULL,
      student_id TEXT NOT NULL,
      guardian_id TEXT NOT NULL,
      relationship_label TEXT,
      can_view_reports INTEGER NOT NULL DEFAULT 1,
      can_view_photos INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE,
      UNIQUE(student_id, guardian_id)
    )`),
    familyDb.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS family_guardians_phone_unique ON family_guardians(phone) WHERE phone IS NOT NULL",
    ),
    familyDb.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS family_guardians_email_unique ON family_guardians(email) WHERE email IS NOT NULL",
    ),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS guardian_sessions_guardian_idx ON guardian_sessions(guardian_id, expires_at)",
    ),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS guardian_sessions_active_idx ON guardian_sessions(token_hash, expires_at)",
    ),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS student_guardians_guardian_idx ON student_guardians(guardian_id, student_id)",
    ),
  ]);
}

async function auditGuardianAuth(
  familyDb: D1Database,
  guardianId: string | null,
  action: string,
): Promise<void> {
  await familyDb.prepare(
    `INSERT INTO family_audit_logs (
       id, campus_id, actor_type, actor_id, action,
       resource_type, resource_id, metadata_json, created_at
     ) VALUES (?, NULL, 'guardian', ?, ?, 'guardian_auth', ?, '{}', ?)`,
  ).bind(
    crypto.randomUUID(),
    guardianId,
    action,
    guardianId,
    new Date().toISOString(),
  ).run();
}

export async function createKkumeumGuardianPasswordRecord(password: string): Promise<{
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
}> {
  if (password.length < 12) {
    throw new DataCoreAccessError(400, "보호자 비밀번호는 12자 이상이어야 합니다.");
  }
  const passwordSalt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  return {
    passwordHash: await passwordHash(password, passwordSalt, PASSWORD_ITERATIONS),
    passwordSalt,
    passwordIterations: PASSWORD_ITERATIONS,
  };
}

async function createGuardianSession(familyDb: D1Database, guardianId: string) {
  const rawToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GUARDIAN_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await familyDb.prepare(
    `INSERT INTO guardian_sessions (
       id, guardian_id, token_hash, created_at, expires_at, revoked_at, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).bind(
    crypto.randomUUID(),
    guardianId,
    await sha256(rawToken),
    now.toISOString(),
    expiresAt,
    now.toISOString(),
  ).run();
  return { rawToken, expiresAt };
}

export async function kkumeumGuardianSessionIdentity(
  familyDb: D1Database,
  request: Request,
): Promise<KkumeumGuardianIdentity | null> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const rawToken = guardianSessionToken(request);
  if (!rawToken) return null;
  const now = new Date().toISOString();
  const row = await familyDb.prepare(
    `SELECT s.id AS session_id, g.id AS guardian_id, g.login_id, g.display_name, g.must_change_password
     FROM guardian_sessions s
     INNER JOIN family_guardians g ON g.id = s.guardian_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND g.status = 'active'
     LIMIT 1`,
  ).bind(await sha256(rawToken), now).first<{
    session_id: string;
    guardian_id: string;
    login_id: string | null;
    display_name: string;
    must_change_password: number;
  }>();
  if (!row) return null;
  await familyDb.prepare("UPDATE guardian_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(now, row.session_id)
    .run();
  return {
    guardianId: row.guardian_id,
    loginId: row.login_id || row.guardian_id,
    displayName: row.display_name,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function loginKkumeumGuardian(
  familyDb: D1Database,
  request: Request,
  input: { loginId?: unknown; password?: unknown },
) {
  assertSameOrigin(request);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const loginId = normalizeLoginId(input.loginId);
  const password = String(input.password || "");
  if (!loginId || !password) {
    throw new DataCoreAccessError(400, "로그인 ID와 비밀번호를 입력하세요.");
  }

  const guardian = await familyDb.prepare(
    `SELECT id, login_id, display_name, status, password_hash, password_salt,
            password_iterations, must_change_password, failed_login_count, locked_until
     FROM family_guardians WHERE login_id = ? LIMIT 1`,
  ).bind(loginId).first<GuardianRow>();
  const now = new Date();
  if (!guardian || guardian.status !== "active" || !guardian.password_hash || !guardian.password_salt) {
    await auditGuardianAuth(familyDb, guardian?.id || null, "login_failed");
    throw new DataCoreAccessError(401, "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  }
  if (guardian.locked_until && new Date(guardian.locked_until).getTime() > now.getTime()) {
    throw new DataCoreAccessError(423, "로그인 시도가 잠시 잠겼습니다. 잠시 후 다시 시도하세요.");
  }

  let candidate: string;
  try {
    candidate = await passwordHash(password, guardian.password_salt, Number(guardian.password_iterations));
  } catch (error) {
    if (error instanceof DataCoreAccessError && error.status === 409) {
      await auditGuardianAuth(familyDb, guardian.id, "password_reset_required");
    }
    throw error;
  }
  if (!timingSafeEqual(candidate, guardian.password_hash)) {
    const failures = Number(guardian.failed_login_count || 0) + 1;
    const lockedUntil = failures >= MAX_FAILED_LOGINS
      ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()
      : null;
    await familyDb.prepare(
      `UPDATE family_guardians
       SET failed_login_count = ?, locked_until = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(failures, lockedUntil, now.toISOString(), guardian.id).run();
    await auditGuardianAuth(familyDb, guardian.id, "login_failed");
    throw new DataCoreAccessError(401, "로그인 ID 또는 비밀번호가 올바르지 않습니다.");
  }

  // When closed beta is explicitly enabled, reject before a session is issued.
  await assertInternalGuardianBeta(familyDb, guardian.id);

  await familyDb.prepare(
    `UPDATE family_guardians
     SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(now.toISOString(), now.toISOString(), guardian.id).run();
  const session = await createGuardianSession(familyDb, guardian.id);
  await auditGuardianAuth(familyDb, guardian.id, "login");
  return {
    guardian: {
      guardianId: guardian.id,
      loginId: guardian.login_id || guardian.id,
      displayName: guardian.display_name,
      mustChangePassword: Boolean(guardian.must_change_password),
    } satisfies KkumeumGuardianIdentity,
    expiresAt: session.expiresAt,
    setCookie: kkumeumGuardianCookie(session.rawToken),
  };
}

export async function changeKkumeumGuardianPassword(
  familyDb: D1Database,
  request: Request,
  input: { currentPassword?: unknown; newPassword?: unknown },
): Promise<{ ok: true; authenticated: true; mustChangePassword: false; expiresAt: string; setCookie: string }> {
  assertSameOrigin(request);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const rawToken = guardianSessionToken(request);
  if (!rawToken) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");

  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  if (!currentPassword || !newPassword) {
    throw new DataCoreAccessError(400, "현재 비밀번호와 새 비밀번호를 입력하세요.");
  }
  if (currentPassword === newPassword) {
    throw new DataCoreAccessError(400, "새 비밀번호는 현재 비밀번호와 다르게 설정하세요.");
  }

  const now = new Date();
  const sessionHash = await sha256(rawToken);
  const guardian = await familyDb.prepare(
    `SELECT g.id, g.login_id, g.display_name, g.status, g.password_hash, g.password_salt,
            g.password_iterations, g.must_change_password, g.failed_login_count, g.locked_until
     FROM guardian_sessions s
     INNER JOIN family_guardians g ON g.id = s.guardian_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
     LIMIT 1`,
  ).bind(sessionHash, now.toISOString()).first<GuardianRow>();
  if (!guardian || guardian.status !== "active" || !guardian.password_hash || !guardian.password_salt) {
    throw new DataCoreAccessError(401, "유효한 보호자 로그인이 필요합니다.");
  }
  if (guardian.locked_until && new Date(guardian.locked_until).getTime() > now.getTime()) {
    throw new DataCoreAccessError(423, "로그인 시도가 잠시 잠겼습니다. 잠시 후 다시 시도하세요.");
  }

  const candidate = await passwordHash(
    currentPassword,
    guardian.password_salt,
    Number(guardian.password_iterations),
  );
  if (!timingSafeEqual(candidate, guardian.password_hash)) {
    throw new DataCoreAccessError(401, "현재 비밀번호가 올바르지 않습니다.");
  }

  const passwordRecord = await createKkumeumGuardianPasswordRecord(newPassword);
  const replacementRawToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const replacementTokenHash = await sha256(replacementRawToken);
  const expiresAt = new Date(now.getTime() + GUARDIAN_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const timestamp = now.toISOString();

  await familyDb.batch([
    familyDb.prepare(
      `UPDATE family_guardians
       SET password_hash = ?, password_salt = ?, password_iterations = ?,
           must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
    ).bind(
      passwordRecord.passwordHash,
      passwordRecord.passwordSalt,
      passwordRecord.passwordIterations,
      timestamp,
      guardian.id,
    ),
    familyDb.prepare(
      `UPDATE guardian_sessions
       SET revoked_at = ?
       WHERE guardian_id = ? AND revoked_at IS NULL`,
    ).bind(timestamp, guardian.id),
    familyDb.prepare(
      `INSERT INTO guardian_sessions (
         id, guardian_id, token_hash, created_at, expires_at, revoked_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(
      crypto.randomUUID(),
      guardian.id,
      replacementTokenHash,
      timestamp,
      expiresAt,
      timestamp,
    ),
  ]);
  await auditGuardianAuth(familyDb, guardian.id, "password_change");

  return {
    ok: true,
    authenticated: true,
    mustChangePassword: false,
    expiresAt,
    setCookie: kkumeumGuardianCookie(replacementRawToken),
  };
}

export async function logoutKkumeumGuardian(
  familyDb: D1Database,
  request: Request,
): Promise<{ ok: true; setCookie: string }> {
  assertSameOrigin(request);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const rawToken = guardianSessionToken(request);
  if (rawToken) {
    const tokenHash = await sha256(rawToken);
    const session = await familyDb.prepare(
      "SELECT guardian_id FROM guardian_sessions WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
    ).bind(tokenHash).first<{ guardian_id: string }>();
    await familyDb.prepare(
      "UPDATE guardian_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    ).bind(new Date().toISOString(), tokenHash).run();
    if (session?.guardian_id) await auditGuardianAuth(familyDb, session.guardian_id, "logout");
  }
  return { ok: true, setCookie: kkumeumGuardianCookie("", 0) };
}

import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import {
  ensureKkumeumGuardianAuthSchema,
  kkumeumGuardianSessionIdentity,
  startKkumeumGuardianCodeSession,
} from "./kkumeum-guardian-auth";
import { getKkumeumPilotSettings } from "./kkumeum-pilot";

// 인증키: one code per student. A parent types it once in the app (or opens the shared link) and the phone is
// connected to that child; family members can each use it, and an already signed-in parent uses it to add a
// second child. Staff can issue a new code at any time, which retires the old one (connected phones stay).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const RELATIONSHIPS = new Set(["어머니", "아버지", "할머니", "할아버지", "보호자"]);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
export function normalizeInviteCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const displayInviteCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export async function ensureKkumeumInviteSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_invite_codes (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      created_by TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      redeemed_count INTEGER NOT NULL DEFAULT 0,
      last_redeemed_at TEXT,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_invite_codes_student_idx ON family_invite_codes(student_id, revoked_at)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_invite_attempts (
      key_hash TEXT PRIMARY KEY NOT NULL,
      window_started_at TEXT NOT NULL,
      failures INTEGER NOT NULL DEFAULT 0
    )`),
  ]);
}

function requireManager(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  if (context.memberships.some((m) => m.campusId === campusId && ["CAMPUS_DIRECTOR", "CAMPUS_ADMIN"].includes(m.role))) return;
  throw new DataCoreAccessError(403, "인증키는 최고관리자 또는 해당 캠퍼스 원장만 발급할 수 있습니다.");
}
async function requireStudent(familyDb: D1Database, campusId: string, studentId: string) {
  const student = await familyDb.prepare("SELECT id, name, display_name, status FROM family_students WHERE id = ? AND campus_id = ?")
    .bind(studentId, campusId).first<{ id: string; name: string; display_name: string | null; status: string }>();
  if (!student) throw new DataCoreAccessError(403, "이 학생의 인증키를 관리할 권한이 없습니다.");
  return student;
}
async function audit(familyDb: D1Database, campusId: string | null, actorType: string, actorId: string | null, action: string, studentId: string) {
  await familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'student', ?, '{}', ?)`).bind(crypto.randomUUID(), campusId, actorType, actorId, action, studentId, new Date().toISOString()).run();
}

export async function kkumeumInviteStatus(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, studentId: string) {
  requireManager(context, campusId);
  await ensureKkumeumInviteSchema(familyDb);
  await requireStudent(familyDb, campusId, studentId);
  const active = await familyDb.prepare("SELECT created_at, redeemed_count, last_redeemed_at FROM family_invite_codes WHERE student_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .bind(studentId).first<{ created_at: string; redeemed_count: number; last_redeemed_at: string | null }>();
  const linked = await familyDb.prepare("SELECT COUNT(*) AS n FROM student_guardians WHERE student_id = ?").bind(studentId).first<{ n: number }>();
  return { active: Boolean(active), createdAt: active?.created_at || null, redeemedCount: Number(active?.redeemed_count || 0),
    lastRedeemedAt: active?.last_redeemed_at || null, connectedGuardians: Number(linked?.n || 0) };
}

// The code is shown only in this response; only its hash is stored.
export async function issueKkumeumInviteCode(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, studentId: string) {
  requireManager(context, campusId);
  await ensureKkumeumInviteSchema(familyDb);
  const student = await requireStudent(familyDb, campusId, studentId);
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await familyDb.batch([
        familyDb.prepare("UPDATE family_invite_codes SET revoked_at = ? WHERE student_id = ? AND revoked_at IS NULL").bind(now, studentId),
        familyDb.prepare("INSERT INTO family_invite_codes (id, campus_id, student_id, code_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), campusId, studentId, await sha256(code), context.user?.internalUserId || null, now),
      ]);
      await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "invite_code_issue", studentId);
      return { code: displayInviteCode(code), studentName: student.display_name || student.name, createdAt: now };
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
    }
  }
  throw new DataCoreAccessError(503, "인증키를 만들지 못했습니다. 다시 시도해 주세요.");
}

export async function revokeKkumeumInviteCode(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, studentId: string) {
  requireManager(context, campusId);
  await ensureKkumeumInviteSchema(familyDb);
  await requireStudent(familyDb, campusId, studentId);
  await familyDb.prepare("UPDATE family_invite_codes SET revoked_at = ? WHERE student_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), studentId).run();
  await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "invite_code_revoke", studentId);
  return { ok: true };
}

async function attemptKey(request: Request): Promise<string> {
  return sha256(`invite:${request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local"}`);
}
async function assertNotThrottled(familyDb: D1Database, key: string): Promise<void> {
  const row = await familyDb.prepare("SELECT window_started_at, failures FROM family_invite_attempts WHERE key_hash = ?").bind(key).first<{ window_started_at: string; failures: number }>();
  if (row && Date.now() - Date.parse(row.window_started_at) < FAILURE_WINDOW_MS && row.failures >= MAX_FAILURES) {
    throw new DataCoreAccessError(429, "인증키 입력을 여러 번 틀렸습니다. 15분 뒤에 다시 시도해 주세요.");
  }
}
async function recordFailure(familyDb: D1Database, key: string): Promise<void> {
  const now = new Date().toISOString();
  const row = await familyDb.prepare("SELECT window_started_at FROM family_invite_attempts WHERE key_hash = ?").bind(key).first<{ window_started_at: string }>();
  if (!row || Date.now() - Date.parse(row.window_started_at) >= FAILURE_WINDOW_MS) {
    await familyDb.prepare("INSERT INTO family_invite_attempts (key_hash, window_started_at, failures) VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET window_started_at = excluded.window_started_at, failures = 1").bind(key, now).run();
  } else {
    await familyDb.prepare("UPDATE family_invite_attempts SET failures = failures + 1 WHERE key_hash = ?").bind(key).run();
  }
}

// Parent side. Signed in already → the child is added to this account (자녀추가). Otherwise a guardian account
// without password is created for this phone and signed in for 180 days.
export async function redeemKkumeumInviteCode(familyDb: D1Database, request: Request, input: Record<string, unknown>) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  await ensureKkumeumInviteSchema(familyDb);
  const key = await attemptKey(request);
  await assertNotThrottled(familyDb, key);
  const code = normalizeInviteCode(input.code);
  const invite = code.length === CODE_LENGTH ? await familyDb.prepare(`SELECT i.id, i.campus_id, i.student_id, s.name, s.display_name
      FROM family_invite_codes i JOIN family_students s ON s.id = i.student_id
      WHERE i.code_hash = ? AND i.revoked_at IS NULL AND s.status = 'active' LIMIT 1`)
    .bind(await sha256(code)).first<{ id: string; campus_id: string; student_id: string; name: string; display_name: string | null }>() : null;
  if (!invite) {
    await recordFailure(familyDb, key);
    throw new DataCoreAccessError(401, "인증키를 다시 확인해 주세요. 학원에서 받은 8자리 인증키입니다.");
  }
  const relationship = RELATIONSHIPS.has(String(input.relationship)) ? String(input.relationship) : "보호자";
  const now = new Date().toISOString();
  const childName = invite.display_name || invite.name;
  const signedIn = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (signedIn && !signedIn.mustChangePassword) {
    await familyDb.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
      VALUES (?, ?, ?, ?, 1, 1, ?) ON CONFLICT(student_id, guardian_id) DO NOTHING`).bind(crypto.randomUUID(), invite.student_id, signedIn.guardianId, relationship, now).run();
    await familyDb.prepare("UPDATE family_invite_codes SET redeemed_count = redeemed_count + 1, last_redeemed_at = ? WHERE id = ?").bind(now, invite.id).run();
    await audit(familyDb, invite.campus_id, "guardian", signedIn.guardianId, "invite_code_add_child", invite.student_id);
    return { added: true, studentId: invite.student_id, childName, setCookie: null as string | null };
  }
  const settings = await getKkumeumPilotSettings(familyDb);
  if (settings.internalGuardianBetaEnabled) throw new DataCoreAccessError(403, "지금은 시범 운영 중이라 인증키로 새로 시작할 수 없습니다. 학원에 문의해 주세요.");
  const guardianId = crypto.randomUUID();
  await familyDb.batch([
    familyDb.prepare(`INSERT INTO family_guardians (id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at)
      VALUES (?, NULL, ?, 'active', 0, 0, ?, ?)`).bind(guardianId, `${childName} ${relationship}`.slice(0, 100), now, now),
    familyDb.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
      VALUES (?, ?, ?, ?, 1, 1, ?)`).bind(crypto.randomUUID(), invite.student_id, guardianId, relationship, now),
    familyDb.prepare("UPDATE family_invite_codes SET redeemed_count = redeemed_count + 1, last_redeemed_at = ? WHERE id = ?").bind(now, invite.id),
  ]);
  await audit(familyDb, invite.campus_id, "guardian", guardianId, "invite_code_start", invite.student_id);
  const session = await startKkumeumGuardianCodeSession(familyDb, guardianId);
  return { added: false, studentId: invite.student_id, childName, setCookie: session.setCookie, displayName: `${childName} ${relationship}` };
}

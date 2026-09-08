import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKkumeumGuardianAuthSchema } from "./kkumeum-guardian-auth";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

type ConsentRow = {
  id: string;
  student_id: string;
  guardian_id: string;
  consent_type: string;
  version: string;
  source: string;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown, maximum = 120): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function identifier(value: unknown, field: string): string {
  const normalized = text(value, 80);
  if (!normalized || !IDENTIFIER_PATTERN.test(normalized)) {
    throw new DataCoreAccessError(400, `${field} 형식이 올바르지 않습니다.`);
  }
  return normalized;
}

function version(value: unknown): string {
  const normalized = text(value, 40);
  if (!normalized || !VERSION_PATTERN.test(normalized)) {
    throw new DataCoreAccessError(400, "동의 문서 버전 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function requireManager(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  if (context.memberships.some((membership) => (
    membership.campusId === campusId && membership.role === "CAMPUS_DIRECTOR"
  ))) return;
  throw new DataCoreAccessError(403, "동의 기록은 최고관리자 또는 해당 캠퍼스 원장만 관리할 수 있습니다.");
}

export async function ensureKkumeumConsentSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS consents (
      id TEXT PRIMARY KEY NOT NULL,
      student_id TEXT NOT NULL,
      guardian_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE
    )`),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS consents_student_idx ON consents(student_id, consent_type, granted_at)",
    ),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS consents_guardian_idx ON consents(guardian_id, consent_type, granted_at)",
    ),
    familyDb.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS consents_active_unique
       ON consents(student_id, guardian_id, consent_type, version)
       WHERE revoked_at IS NULL`,
    ),
  ]);
}

async function requireLinkedGuardian(
  familyDb: D1Database,
  campusId: string,
  studentId: string,
  guardianId: string,
): Promise<void> {
  const row = await familyDb.prepare(
    `SELECT sg.guardian_id
     FROM student_guardians sg
     JOIN family_students s ON s.id = sg.student_id
     WHERE sg.student_id = ? AND sg.guardian_id = ? AND s.campus_id = ?
     LIMIT 1`,
  ).bind(studentId, guardianId, campusId).first<{ guardian_id: string }>();
  if (!row) throw new DataCoreAccessError(404, "해당 캠퍼스 학생의 보호자 연결을 찾을 수 없습니다.");
}

function response(row: ConsentRow) {
  return {
    id: row.id,
    studentId: row.student_id,
    guardianId: row.guardian_id,
    consentType: row.consent_type,
    version: row.version,
    source: row.source,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    active: !row.revoked_at,
  };
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  action: "consent.grant" | "consent.revoke",
  consentId: string,
  metadata: { studentId: string; guardianId: string; consentType: string; version: string; source: string },
): Promise<void> {
  await familyDb.prepare(
    `INSERT INTO family_audit_logs (
       id, campus_id, actor_type, actor_id, action,
       resource_type, resource_id, metadata_json, created_at
     ) VALUES (?, ?, 'staff', ?, ?, 'consent', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    campusId,
    context.user?.internalUserId || null,
    action,
    consentId,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ).run();
}

export async function listKkumeumConsents(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
  guardianId: string,
) {
  requireManager(context, campusId);
  await ensureKkumeumConsentSchema(familyDb);
  await requireLinkedGuardian(familyDb, campusId, studentId, guardianId);
  const result = await familyDb.prepare(
    `SELECT id, student_id, guardian_id, consent_type, version, source,
            granted_at, revoked_at, created_at, updated_at
     FROM consents
     WHERE student_id = ? AND guardian_id = ?
     ORDER BY granted_at DESC, created_at DESC
     LIMIT 100`,
  ).bind(studentId, guardianId).all<ConsentRow>();
  return (result.results || []).map(response);
}

export async function grantKkumeumConsent(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  const guardianId = text(input.guardianId, 120);
  const consentType = identifier(input.consentType, "consentType");
  const consentVersion = version(input.version);
  const source = identifier(input.source, "source");
  if (!campusId || !studentId || !guardianId) {
    throw new DataCoreAccessError(400, "campusId, studentId, guardianId가 필요합니다.");
  }
  requireManager(context, campusId);
  await ensureKkumeumConsentSchema(familyDb);
  await requireLinkedGuardian(familyDb, campusId, studentId, guardianId);

  const existing = await familyDb.prepare(
    `SELECT id, student_id, guardian_id, consent_type, version, source,
            granted_at, revoked_at, created_at, updated_at
     FROM consents
     WHERE student_id = ? AND guardian_id = ? AND consent_type = ? AND version = ?
       AND revoked_at IS NULL
     LIMIT 1`,
  ).bind(studentId, guardianId, consentType, consentVersion).first<ConsentRow>();
  if (existing) return { consent: response(existing), created: false };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await familyDb.prepare(
    `INSERT INTO consents (
       id, student_id, guardian_id, consent_type, version, source,
       granted_at, revoked_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).bind(id, studentId, guardianId, consentType, consentVersion, source, now, now, now).run();
  await audit(familyDb, context, campusId, "consent.grant", id, {
    studentId,
    guardianId,
    consentType,
    version: consentVersion,
    source,
  });
  return {
    consent: {
      id,
      studentId,
      guardianId,
      consentType,
      version: consentVersion,
      source,
      grantedAt: now,
      revokedAt: null,
      active: true,
    },
    created: true,
  };
}

export async function revokeKkumeumConsent(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  consentId: string,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  const guardianId = text(input.guardianId, 120);
  if (!campusId || !studentId || !guardianId) {
    throw new DataCoreAccessError(400, "campusId, studentId, guardianId가 필요합니다.");
  }
  requireManager(context, campusId);
  await ensureKkumeumConsentSchema(familyDb);
  await requireLinkedGuardian(familyDb, campusId, studentId, guardianId);
  const current = await familyDb.prepare(
    `SELECT id, student_id, guardian_id, consent_type, version, source,
            granted_at, revoked_at, created_at, updated_at
     FROM consents
     WHERE id = ? AND student_id = ? AND guardian_id = ?
     LIMIT 1`,
  ).bind(consentId, studentId, guardianId).first<ConsentRow>();
  if (!current) throw new DataCoreAccessError(404, "동의 기록을 찾을 수 없습니다.");
  if (current.revoked_at) return { consent: response(current), changed: false };

  const now = new Date().toISOString();
  await familyDb.prepare(
    "UPDATE consents SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).bind(now, now, consentId).run();
  await audit(familyDb, context, campusId, "consent.revoke", consentId, {
    studentId,
    guardianId,
    consentType: current.consent_type,
    version: current.version,
    source: current.source,
  });
  return {
    consent: { ...response(current), revokedAt: now, active: false },
    changed: true,
  };
}

export async function hasActiveKkumeumConsent(
  familyDb: D1Database,
  studentId: string,
  guardianId: string,
  consentType: string,
  consentVersion: string,
): Promise<boolean> {
  await ensureKkumeumConsentSchema(familyDb);
  const row = await familyDb.prepare(
    `SELECT id FROM consents
     WHERE student_id = ? AND guardian_id = ? AND consent_type = ? AND version = ?
       AND revoked_at IS NULL
     LIMIT 1`,
  ).bind(studentId, guardianId, consentType, consentVersion).first<{ id: string }>();
  return Boolean(row);
}

export async function requireActiveKkumeumConsent(
  familyDb: D1Database,
  studentId: string,
  guardianId: string,
  consentType: string,
  consentVersion: string,
): Promise<void> {
  if (await hasActiveKkumeumConsent(familyDb, studentId, guardianId, consentType, consentVersion)) return;
  throw new DataCoreAccessError(403, "필요한 동의 상태가 확인되지 않았습니다.");
}

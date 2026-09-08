import { DataCoreAccessError } from "./data-core-access";
import { ensureKkumeumConsentSchema, type KkumeumConsentPolicy } from "./kkumeum-consents";
import {
  ensureKkumeumGuardianAuthSchema,
  kkumeumGuardianSessionIdentity,
  type KkumeumGuardianIdentity,
} from "./kkumeum-guardian-auth";

export type GuardianNotice = {
  announcementId: string;
  announcementType: string;
  title: string;
  body: string;
  publishedAt: string;
  unread: boolean;
};

export async function ensureKkumeumAnnouncementSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT,
      author_user_id TEXT NOT NULL,
      announcement_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS announcements_campus_idx ON announcements(campus_id, status, published_at)",
    ),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS announcement_targets (
      id TEXT PRIMARY KEY NOT NULL,
      announcement_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
    )`),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS announcement_targets_lookup_idx ON announcement_targets(target_type, target_id, announcement_id)",
    ),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS read_receipts (
      id TEXT PRIMARY KEY NOT NULL,
      guardian_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE,
      UNIQUE(guardian_id, resource_type, resource_id)
    )`),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS read_receipts_guardian_idx ON read_receipts(guardian_id, resource_type, read_at)",
    ),
  ]);
}

async function requireGuardian(
  familyDb: D1Database,
  request: Request,
): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumAnnouncementSchema(familyDb);
  const identity = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!identity) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (identity.mustChangePassword) {
    throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  }
  return identity;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

const VISIBLE_TARGET_SQL = `(
  t.target_type = 'organization'
  OR (t.target_type = 'guardian' AND t.target_id = ?)
  OR (t.target_type = 'student' AND EXISTS (
    SELECT 1 FROM student_guardians sg
    WHERE sg.guardian_id = ? AND sg.student_id = t.target_id
  ))
  OR (t.target_type = 'campus' AND EXISTS (
    SELECT 1
    FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id
    WHERE sg.guardian_id = ? AND s.campus_id = t.target_id
  ))
  OR (t.target_type = 'class' AND EXISTS (
    SELECT 1
    FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id
    WHERE sg.guardian_id = ? AND s.current_class_id = t.target_id
  ))
)`;

function guardianBindings(guardianId: string): string[] {
  return [guardianId, guardianId, guardianId, guardianId];
}

type TargetVisibility = { sql: string; bindings: string[] };

async function consentPolicy(familyDb: D1Database): Promise<KkumeumConsentPolicy> {
  await ensureKkumeumConsentSchema(familyDb);
  const row = await familyDb.prepare(
    `SELECT consent_type, required_version, enforcement_enabled, updated_at
     FROM family_consent_policy WHERE id = 1`,
  ).first<{
    consent_type: string | null;
    required_version: string | null;
    enforcement_enabled: number;
    updated_at: string | null;
  }>();
  const policy: KkumeumConsentPolicy = {
    consentType: row?.consent_type || null,
    requiredVersion: row?.required_version || null,
    enforcementEnabled: Boolean(row?.enforcement_enabled),
    updatedAt: row?.updated_at || null,
  };
  if (policy.enforcementEnabled && (!policy.consentType || !policy.requiredVersion)) {
    throw new DataCoreAccessError(503, "보호자 동의 정책 설정을 확인할 수 없습니다.");
  }
  return policy;
}

function targetVisibility(guardianId: string, policy: KkumeumConsentPolicy): TargetVisibility {
  if (!policy.enforcementEnabled || !policy.consentType || !policy.requiredVersion) {
    return { sql: VISIBLE_TARGET_SQL, bindings: guardianBindings(guardianId) };
  }
  const type = policy.consentType;
  const version = policy.requiredVersion;
  return {
    sql: `(
      t.target_type = 'organization'
      OR (t.target_type = 'guardian' AND t.target_id = ? AND EXISTS (
        SELECT 1
        FROM student_guardians sg
        INNER JOIN consents c
          ON c.student_id = sg.student_id
         AND c.guardian_id = sg.guardian_id
         AND c.consent_type = ?
         AND c.version = ?
         AND c.revoked_at IS NULL
        WHERE sg.guardian_id = ?
      ))
      OR (t.target_type = 'student' AND EXISTS (
        SELECT 1
        FROM student_guardians sg
        INNER JOIN consents c
          ON c.student_id = sg.student_id
         AND c.guardian_id = sg.guardian_id
         AND c.consent_type = ?
         AND c.version = ?
         AND c.revoked_at IS NULL
        WHERE sg.guardian_id = ? AND sg.student_id = t.target_id
      ))
      OR (t.target_type = 'campus' AND EXISTS (
        SELECT 1
        FROM student_guardians sg
        INNER JOIN family_students s ON s.id = sg.student_id
        INNER JOIN consents c
          ON c.student_id = sg.student_id
         AND c.guardian_id = sg.guardian_id
         AND c.consent_type = ?
         AND c.version = ?
         AND c.revoked_at IS NULL
        WHERE sg.guardian_id = ? AND s.campus_id = t.target_id
      ))
      OR (t.target_type = 'class' AND EXISTS (
        SELECT 1
        FROM student_guardians sg
        INNER JOIN family_students s ON s.id = sg.student_id
        INNER JOIN consents c
          ON c.student_id = sg.student_id
         AND c.guardian_id = sg.guardian_id
         AND c.consent_type = ?
         AND c.version = ?
         AND c.revoked_at IS NULL
        WHERE sg.guardian_id = ? AND s.current_class_id = t.target_id
      ))
    )`,
    bindings: [
      guardianId, type, version, guardianId,
      type, version, guardianId,
      type, version, guardianId,
      type, version, guardianId,
    ],
  };
}

export async function listGuardianNotices(
  familyDb: D1Database,
  request: Request,
): Promise<{ notices: GuardianNotice[]; unreadCount: number }> {
  const guardian = await requireGuardian(familyDb, request);
  const visibility = targetVisibility(guardian.guardianId, await consentPolicy(familyDb));
  const result = await familyDb.prepare(
    `SELECT DISTINCT
       a.id,
       a.announcement_type,
       a.title,
       a.body,
       a.published_at,
       CASE WHEN rr.id IS NULL THEN 1 ELSE 0 END AS unread
     FROM announcements a
     INNER JOIN announcement_targets t ON t.announcement_id = a.id
     LEFT JOIN read_receipts rr
       ON rr.guardian_id = ?
      AND rr.resource_type = 'announcement'
      AND rr.resource_id = a.id
     WHERE a.status = 'published'
       AND a.published_at IS NOT NULL
       AND ${visibility.sql}
     ORDER BY a.published_at DESC, a.id DESC
     LIMIT 100`,
  ).bind(
    guardian.guardianId,
    ...visibility.bindings,
  ).all<{
    id: string;
    announcement_type: string;
    title: string;
    body: string;
    published_at: string;
    unread: number;
  }>();

  const notices = (result.results || []).map((row) => ({
    announcementId: row.id,
    announcementType: row.announcement_type,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at,
    unread: Boolean(row.unread),
  }));
  return {
    notices,
    unreadCount: notices.reduce((count, notice) => count + (notice.unread ? 1 : 0), 0),
  };
}

export async function markGuardianNoticeRead(
  familyDb: D1Database,
  request: Request,
  announcementId: string,
): Promise<{ ok: true; announcementId: string; readAt: string }> {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const visibility = targetVisibility(guardian.guardianId, await consentPolicy(familyDb));
  const visible = await familyDb.prepare(
    `SELECT a.id
     FROM announcements a
     INNER JOIN announcement_targets t ON t.announcement_id = a.id
     WHERE a.id = ?
       AND a.status = 'published'
       AND a.published_at IS NOT NULL
       AND ${visibility.sql}
     LIMIT 1`,
  ).bind(
    announcementId,
    ...visibility.bindings,
  ).first<{ id: string }>();
  if (!visible) {
    throw new DataCoreAccessError(403, "이 소식을 볼 권한이 없습니다.");
  }

  const readAt = new Date().toISOString();
  await familyDb.prepare(
    `INSERT INTO read_receipts (
       id, guardian_id, resource_type, resource_id, read_at
     ) VALUES (?, ?, 'announcement', ?, ?)
     ON CONFLICT(guardian_id, resource_type, resource_id)
     DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    guardian.guardianId,
    announcementId,
    readAt,
  ).run();

  const receipt = await familyDb.prepare(
    `SELECT read_at FROM read_receipts
     WHERE guardian_id = ? AND resource_type = 'announcement' AND resource_id = ?
     LIMIT 1`,
  ).bind(guardian.guardianId, announcementId).first<{ read_at: string }>();

  return { ok: true, announcementId, readAt: receipt?.read_at || readAt };
}

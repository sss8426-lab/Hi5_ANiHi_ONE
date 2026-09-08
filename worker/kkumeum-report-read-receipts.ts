import { DataCoreAccessError } from "./data-core-access";
import { ensureKkumeumAnnouncementSchema } from "./kkumeum-announcements";
import {
  ensureKkumeumGuardianAuthSchema,
  kkumeumGuardianSessionIdentity,
  type KkumeumGuardianIdentity,
} from "./kkumeum-guardian-auth";
import { requireKkumeumGuardianConsentPolicy } from "./kkumeum-consents";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

async function requireGuardian(
  familyDb: D1Database,
  request: Request,
): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const identity = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!identity) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (identity.mustChangePassword) {
    throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  }
  return identity;
}

async function requireReportViewAccess(
  familyDb: D1Database,
  guardianId: string,
  studentId: string,
): Promise<void> {
  const link = await familyDb.prepare(
    `SELECT can_view_reports
     FROM student_guardians
     WHERE guardian_id = ? AND student_id = ?
     LIMIT 1`,
  ).bind(guardianId, studentId).first<{ can_view_reports: number }>();
  if (!link) throw new DataCoreAccessError(403, "이 학생 정보를 볼 권한이 없습니다.");
  if (!link.can_view_reports) {
    throw new DataCoreAccessError(403, "이 학생의 성장평가를 볼 권한이 없습니다.");
  }
  await requireKkumeumGuardianConsentPolicy(familyDb, studentId, guardianId);
}

async function prepare(
  familyDb: D1Database,
  request: Request,
  studentId: string,
): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumPhase2Schema(familyDb);
  await ensureKkumeumAnnouncementSchema(familyDb);
  const guardian = await requireGuardian(familyDb, request);
  await requireReportViewAccess(familyDb, guardian.guardianId, studentId);
  return guardian;
}

export async function guardianMonthlyReportReadMap(
  familyDb: D1Database,
  request: Request,
  studentId: string,
): Promise<Map<string, string>> {
  const guardian = await prepare(familyDb, request, studentId);
  const result = await familyDb.prepare(
    `SELECT rr.resource_id, rr.read_at
     FROM read_receipts rr
     INNER JOIN monthly_reports mr
       ON mr.id = rr.resource_id
      AND mr.student_id = ?
      AND mr.status = 'sent'
     WHERE rr.guardian_id = ?
       AND rr.resource_type = 'monthly_report'`,
  ).bind(studentId, guardian.guardianId).all<{ resource_id: string; read_at: string }>();
  return new Map((result.results || []).map((row) => [row.resource_id, row.read_at]));
}

export async function markGuardianMonthlyReportRead(
  familyDb: D1Database,
  request: Request,
  studentId: string,
  reportId: string,
): Promise<{ ok: true; reportId: string; readAt: string }> {
  assertSameOrigin(request);
  const guardian = await prepare(familyDb, request, studentId);
  const visible = await familyDb.prepare(
    `SELECT id
     FROM monthly_reports
     WHERE id = ? AND student_id = ? AND status = 'sent'
     LIMIT 1`,
  ).bind(reportId, studentId).first<{ id: string }>();
  if (!visible) {
    throw new DataCoreAccessError(403, "확인할 수 있는 월간평가가 아닙니다.");
  }

  const readAt = new Date().toISOString();
  await familyDb.prepare(
    `INSERT INTO read_receipts (
       id, guardian_id, resource_type, resource_id, read_at
     ) VALUES (?, ?, 'monthly_report', ?, ?)
     ON CONFLICT(guardian_id, resource_type, resource_id)
     DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    guardian.guardianId,
    reportId,
    readAt,
  ).run();

  const receipt = await familyDb.prepare(
    `SELECT read_at
     FROM read_receipts
     WHERE guardian_id = ?
       AND resource_type = 'monthly_report'
       AND resource_id = ?
     LIMIT 1`,
  ).bind(guardian.guardianId, reportId).first<{ read_at: string }>();

  return { ok: true, reportId, readAt: receipt?.read_at || readAt };
}

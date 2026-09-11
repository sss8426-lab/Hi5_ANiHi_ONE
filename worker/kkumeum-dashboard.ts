import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { ensureKkumeumGuardianAuthSchema } from "./kkumeum-guardian-auth";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";

function month(value: string | null): string {
  const candidate = String(value || "").trim();
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(candidate)
    ? candidate
    : new Date().toISOString().slice(0, 7);
}

export async function getKkumeumDashboard(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  yearMonth: string | null,
) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.memberships.some(
    (membership) => membership.campusId === campusId && ['CAMPUS_DIRECTOR', 'CAMPUS_ADMIN'].includes(membership.role),
  )) {
    throw new DataCoreAccessError(403, "꿈이음 전체 현황은 최고관리자 또는 해당 캠퍼스 원장만 볼 수 있습니다.");
  }
  await ensureKkumeumPhase2Schema(familyDb);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const selectedMonth = month(yearMonth);
  const [counts, reportCounts, artworkCounts, guardianCounts] = await familyDb.batch([
    familyDb.prepare(
      `SELECT
         (SELECT COUNT(*) FROM family_students WHERE campus_id = ? AND status = 'active') AS student_count,
         (SELECT COUNT(*) FROM family_classes WHERE campus_id = ? AND active = 1) AS class_count`,
    ).bind(campusId, campusId),
    familyDb.prepare(
      `SELECT status, COUNT(*) AS count
       FROM monthly_reports
       WHERE campus_id = ? AND year_month = ?
       GROUP BY status`,
    ).bind(campusId, selectedMonth),
    familyDb.prepare(
      `SELECT COUNT(*) AS count
       FROM student_artworks
       WHERE campus_id = ?
         AND deleted_at IS NULL
         AND substr(COALESCE(lesson_date, created_at), 1, 7) = ?`,
    ).bind(campusId, selectedMonth),
    familyDb.prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN g.status = 'active' THEN sg.student_id END) AS linked_count
       FROM family_students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id
       LEFT JOIN family_guardians g ON g.id = sg.guardian_id
       WHERE s.campus_id = ? AND s.status = 'active'`,
    ).bind(campusId),
  ]);
  const summary = (counts.results?.[0] || {}) as Record<string, unknown>;
  const reports = Object.fromEntries(
    (reportCounts.results || []).map((row) => [String((row as Record<string, unknown>).status), Number((row as Record<string, unknown>).count || 0)]),
  );
  const activeStudents = Number(summary.student_count || 0);
  const linkedStudents = Number((guardianCounts.results?.[0] as Record<string, unknown> | undefined)?.linked_count || 0);
  return {
    campusId,
    yearMonth: selectedMonth,
    students: activeStudents,
    classes: Number(summary.class_count || 0),
    reports: {
      missing: Math.max(0, activeStudents - Number(reports.draft || 0) - Number(reports.ready || 0) - Number(reports.sent || 0)),
      draft: Number(reports.draft || 0),
      ready: Number(reports.ready || 0),
      sent: Number(reports.sent || 0),
    },
    artworks: Number((artworkCounts.results?.[0] as Record<string, unknown> | undefined)?.count || 0),
    guardians: { linked: linkedStudents, unlinked: Math.max(0, activeStudents - linkedStudents) },
  };
}

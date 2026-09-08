import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { DEFAULT_ORGANIZATION_ID, ensureDataCoreDatabase } from "./data-core";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";

export const KKUMEUM_ANALYTICS_SCHEMA_VERSION = "kkumeum-growth-aggregate-v1";
export const KKUMEUM_ANALYTICS_MIN_COHORT_SIZE = 5;

export type KkumeumAnalyticsPreview = {
  schemaVersion: string;
  campusId: string;
  yearMonth: string;
  generatedAt: string;
  minimumCohortSize: number;
  activeStudentCount: number;
  reports: {
    missing: number;
    draft: number;
    ready: number;
    sent: number;
    completionRate: number;
  };
  artworks: {
    count: number;
    averagePerActiveStudent: number;
  };
  stageBreakdown: {
    suppressed: boolean;
    reason: "minimum_cohort" | null;
    buckets: Array<{ stage: string; studentCount: number }>;
  };
};

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "").trim().slice(0, maximum);
}

export function normalizeAnalyticsYearMonth(value: unknown): string {
  const yearMonth = cleanText(value, 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new DataCoreAccessError(400, "yearMonth는 YYYY-MM 형식이어야 합니다.");
  }
  return yearMonth;
}

function requireCampusId(value: unknown): string {
  const campusId = cleanText(value, 120);
  if (!campusId) throw new DataCoreAccessError(400, "campusId가 필요합니다.");
  return campusId;
}

function isOwnCampusDirector(context: DataCoreAccessContext, campusId: string): boolean {
  return context.memberships.some(
    (membership) => membership.campusId === campusId && membership.role === "CAMPUS_DIRECTOR",
  );
}

export function requireAnalyticsPreviewAccess(
  context: DataCoreAccessContext,
  campusIdValue: unknown,
): string {
  requireAuthenticatedAccess(context);
  const campusId = requireCampusId(campusIdValue);
  if (context.isSuperAdmin || isOwnCampusDirector(context, campusId)) return campusId;
  throw new DataCoreAccessError(403, "성장 통계는 마스터 관리자 또는 해당 캠퍼스 원장만 확인할 수 있습니다.");
}

export function requireAnalyticsSyncAccess(context: DataCoreAccessContext): void {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "DATA CORE 성장 통계 저장은 마스터 관리자만 사용할 수 있습니다.");
  }
}

export function analyticsSyncEnabled(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function numeric(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function computeKkumeumAnalyticsPreview(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusIdValue: unknown,
  yearMonthValue: unknown,
): Promise<KkumeumAnalyticsPreview> {
  const campusId = requireAnalyticsPreviewAccess(context, campusIdValue);
  const yearMonth = normalizeAnalyticsYearMonth(yearMonthValue);
  await ensureKkumeumPhase2Schema(familyDb);

  const active = await familyDb
    .prepare("SELECT COUNT(*) AS count FROM family_students WHERE campus_id = ? AND status = 'active'")
    .bind(campusId)
    .first<{ count: number }>();
  const activeStudentCount = numeric(active?.count);

  const reportRows = await familyDb
    .prepare(
      `SELECT r.status, COUNT(*) AS count
       FROM monthly_reports r
       INNER JOIN family_students s ON s.id = r.student_id
       WHERE r.campus_id = ? AND r.year_month = ?
         AND s.campus_id = ? AND s.status = 'active'
       GROUP BY r.status`,
    )
    .bind(campusId, yearMonth, campusId)
    .all<{ status: string; count: number }>();
  const reportCounts = { draft: 0, ready: 0, sent: 0 };
  for (const row of reportRows.results || []) {
    if (row.status === "draft" || row.status === "ready" || row.status === "sent") {
      reportCounts[row.status] = numeric(row.count);
    }
  }
  const reportTotal = reportCounts.draft + reportCounts.ready + reportCounts.sent;
  const missing = Math.max(0, activeStudentCount - reportTotal);

  const artworks = await familyDb
    .prepare(
      `SELECT COUNT(*) AS count
       FROM student_artworks a
       INNER JOIN family_students s ON s.id = a.student_id
       INNER JOIN family_files f ON f.id = a.family_file_id
       WHERE a.campus_id = ? AND s.campus_id = ? AND s.status = 'active'
         AND f.deleted_at IS NULL
         AND substr(COALESCE(NULLIF(a.lesson_date, ''), a.created_at), 1, 7) = ?`,
    )
    .bind(campusId, campusId, yearMonth)
    .first<{ count: number }>();
  const artworkCount = numeric(artworks?.count);

  const stageRows = await familyDb
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(c.stage), ''), '미지정') AS stage, COUNT(*) AS count
       FROM family_students s
       LEFT JOIN family_classes c
         ON c.id = s.current_class_id AND c.campus_id = s.campus_id
       WHERE s.campus_id = ? AND s.status = 'active'
       GROUP BY COALESCE(NULLIF(TRIM(c.stage), ''), '미지정')
       ORDER BY stage`,
    )
    .bind(campusId)
    .all<{ stage: string; count: number }>();
  const rawStageBuckets = (stageRows.results || []).map((row) => ({
    stage: cleanText(row.stage, 120) || "미지정",
    studentCount: numeric(row.count),
  }));
  const suppressStages = rawStageBuckets.some(
    (bucket) => bucket.studentCount > 0 && bucket.studentCount < KKUMEUM_ANALYTICS_MIN_COHORT_SIZE,
  );

  return {
    schemaVersion: KKUMEUM_ANALYTICS_SCHEMA_VERSION,
    campusId,
    yearMonth,
    generatedAt: new Date().toISOString(),
    minimumCohortSize: KKUMEUM_ANALYTICS_MIN_COHORT_SIZE,
    activeStudentCount,
    reports: {
      missing,
      draft: reportCounts.draft,
      ready: reportCounts.ready,
      sent: reportCounts.sent,
      completionRate: activeStudentCount ? oneDecimal((reportTotal / activeStudentCount) * 100) : 0,
    },
    artworks: {
      count: artworkCount,
      averagePerActiveStudent: activeStudentCount ? oneDecimal(artworkCount / activeStudentCount) : 0,
    },
    stageBreakdown: {
      suppressed: suppressStages,
      reason: suppressStages ? "minimum_cohort" : null,
      buckets: suppressStages ? [] : rawStageBuckets,
    },
  };
}

function aggregateRecordId(campusId: string, yearMonth: string): string {
  return `kkumeum-growth-aggregate:${campusId}:${yearMonth}:v1`;
}

async function auditSync(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  preview: KkumeumAnalyticsPreview,
  recordId: string,
): Promise<void> {
  await familyDb
    .prepare(
      `INSERT INTO family_audit_logs (
         id, campus_id, actor_type, actor_id, action,
         resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, 'staff', ?, 'analytics.sync', 'analytics_aggregate', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      preview.campusId,
      context.user?.internalUserId || null,
      recordId,
      JSON.stringify({
        campusId: preview.campusId,
        yearMonth: preview.yearMonth,
        schemaVersion: preview.schemaVersion,
        stageBreakdownSuppressed: preview.stageBreakdown.suppressed,
        stageBucketCount: preview.stageBreakdown.buckets.length,
      }),
      new Date().toISOString(),
    )
    .run();
}

export async function syncKkumeumAnalyticsToDataCore(
  db: D1Database,
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusIdValue: unknown,
  yearMonthValue: unknown,
  syncEnabledValue: unknown,
) {
  requireAnalyticsSyncAccess(context);
  if (!analyticsSyncEnabled(syncEnabledValue)) {
    throw new DataCoreAccessError(503, "analytics_sync_disabled");
  }
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");

  const preview = await computeKkumeumAnalyticsPreview(
    familyDb,
    context,
    campusIdValue,
    yearMonthValue,
  );
  await ensureDataCoreDatabase(db);

  const campus = await db
    .prepare("SELECT id FROM campuses WHERE id = ? AND organization_id = ? AND status = 'active'")
    .bind(preview.campusId, DEFAULT_ORGANIZATION_ID)
    .first<{ id: string }>();
  if (!campus) throw new DataCoreAccessError(400, "DATA CORE에 등록된 캠퍼스만 성장 통계를 저장할 수 있습니다.");

  const recordId = aggregateRecordId(preview.campusId, preview.yearMonth);
  const now = new Date().toISOString();
  const metadata = JSON.stringify(preview);
  await db
    .prepare(
      `INSERT INTO data_records (
         id, organization_id, campus_id, created_by_user_id,
         record_type, source_app, title, summary, visibility,
         status, metadata_json, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, 'kkumeum-growth-aggregate', 'kkumeum-analytics', ?, NULL, 'campus', 'active', ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         campus_id = excluded.campus_id,
         created_by_user_id = excluded.created_by_user_id,
         record_type = excluded.record_type,
         source_app = excluded.source_app,
         title = excluded.title,
         summary = NULL,
         visibility = 'campus',
         status = 'active',
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    )
    .bind(
      recordId,
      DEFAULT_ORGANIZATION_ID,
      preview.campusId,
      context.user.internalUserId,
      `꿈이음 성장 통계 · ${preview.yearMonth}`,
      metadata,
      now,
      now,
    )
    .run();

  await auditSync(familyDb, context, preview, recordId);
  return { ok: true, recordId, preview };
}

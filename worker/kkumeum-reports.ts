import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { requireKkumeumStudentAccess } from "./kkumeum-core";
import {
  isKkumeumGrowthSkillCode,
  KKUMEUM_GROWTH_SKILL_REGISTRY,
  KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION,
  normalizeKkumeumGrowthSkillCodes,
} from "./kkumeum-growth-skills";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";
import { ensureKkumeumAnnouncementSchema } from "./kkumeum-announcements";

export type MonthlyReportInput = {
  campusId?: unknown;
  studentId?: unknown;
  yearMonth?: unknown;
  title?: unknown;
  summary?: unknown;
  evaluationText?: unknown;
  teacherNote?: unknown;
  growthPoints?: unknown;
  growthSkillCodes?: unknown;
  nextMonthFocus?: unknown;
};

export type MonthlyReportDraftOutput = {
  title: string;
  summary: string;
  evaluationText: string;
  growthPoints: Record<string, unknown>;
  nextMonthFocus: string;
};

export type MonthlyReportDraftProvider = {
  generate(input: {
    studentRef: string;
    yearMonth: string;
    teacherObservations: string;
    artworkNotes: string[];
    rules: readonly string[];
  }): Promise<MonthlyReportDraftOutput>;
};

const REPORT_RULES = Object.freeze([
  "확인된 작품·수업 메모를 근거로 작성한다.",
  "과장된 성장 표현이나 확인되지 않은 입시 수치를 만들지 않는다.",
  "잘된 점, 성장한 부분, 보완할 부분, 다음 달 목표가 구분되도록 작성한다.",
  "AI 초안은 교사가 검토·수정하기 전에는 보호자에게 전달할 수 없다.",
]);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requiredText(value: unknown, field: string, maxLength = 120): string {
  const text = cleanText(value, maxLength);
  if (!text) throw new DataCoreAccessError(400, `${field}가 필요합니다.`);
  return text;
}

function normalizeYearMonth(value: unknown): string {
  const yearMonth = requiredText(value, "yearMonth", 7);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    throw new DataCoreAccessError(400, "yearMonth는 YYYY-MM 형식이어야 합니다.");
  }
  return yearMonth;
}

function normalizeGrowthPoints(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    const normalizedKey = cleanText(key, 80);
    if (!normalizedKey) continue;
    if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      safe[normalizedKey] = typeof child === "string" ? cleanText(child, 500) : child;
    }
  }
  return safe;
}

function parseGrowthPoints(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStoredGrowthSkillCodes(value: unknown, taxonomyVersion: unknown): string[] {
  if (taxonomyVersion !== KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION) return [];
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    const unique = new Set<string>();
    for (const code of parsed) {
      if (isKkumeumGrowthSkillCode(code)) unique.add(code);
    }
    return [...unique].slice(0, 5);
  } catch {
    return [];
  }
}

function validReadAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function reportResponse(row: Record<string, unknown>) {
  const growthSkillTaxonomyVersion = typeof row.growth_skill_taxonomy_version === "string"
    ? row.growth_skill_taxonomy_version
    : null;
  const growthSkillCodes = parseStoredGrowthSkillCodes(
    row.growth_skill_codes_json,
    growthSkillTaxonomyVersion,
  );
  const sent = row.status === "sent";
  const guardianFirstReadAt = sent ? validReadAt(row.guardian_first_read_at) : null;
  return {
    id: row.id,
    studentId: row.student_id,
    campusId: row.campus_id,
    yearMonth: row.year_month,
    teacherUserId: row.teacher_user_id,
    title: row.title || "",
    summary: row.summary || "",
    evaluationText: row.evaluation_text || "",
    teacherNote: row.teacher_note || "",
    growthPoints: parseGrowthPoints(row.growth_points_json),
    growthSkillTaxonomyVersion,
    growthSkillCodes,
    growthSkills: growthSkillCodes
      .map((code) => KKUMEUM_GROWTH_SKILL_REGISTRY.find((skill) => skill.code === code))
      .filter(Boolean),
    nextMonthFocus: row.next_month_focus || "",
    status: row.status,
    sentAt: row.sent_at || null,
    guardianConfirmed: Boolean(sent && guardianFirstReadAt && Number(row.guardian_confirmed) === 1),
    guardianFirstReadAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const guardianConfirmationColumns = `
  CASE WHEN mr.status = 'sent' AND EXISTS (
    SELECT 1 FROM read_receipts rr
    INNER JOIN student_guardians sg
      ON sg.guardian_id = rr.guardian_id
     AND sg.student_id = mr.student_id
    WHERE rr.resource_type = 'monthly_report'
      AND rr.resource_id = mr.id
      AND julianday(rr.read_at) IS NOT NULL
  ) THEN 1 ELSE 0 END AS guardian_confirmed,
  CASE WHEN mr.status = 'sent' THEN (
    SELECT MIN(rr.read_at) FROM read_receipts rr
    INNER JOIN student_guardians sg
      ON sg.guardian_id = rr.guardian_id
     AND sg.student_id = mr.student_id
    WHERE rr.resource_type = 'monthly_report'
      AND rr.resource_id = mr.id
      AND julianday(rr.read_at) IS NOT NULL
  ) ELSE NULL END AS guardian_first_read_at`;

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  action: string,
  resourceId: string,
  metadata: unknown = {},
) {
  await familyDb
    .prepare(
      `INSERT INTO family_audit_logs (
         id, campus_id, actor_type, actor_id, action,
         resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, 'staff', ?, ?, 'monthly_report', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      campusId,
      context.user?.internalUserId || null,
      action,
      resourceId,
      JSON.stringify(metadata || {}),
      new Date().toISOString(),
    )
    .run();
}

async function requireStudentRow(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
) {
  const row = await familyDb
    .prepare("SELECT id, campus_id FROM family_students WHERE id = ? AND campus_id = ?")
    .bind(studentId, campusId)
    .first<{ id: string; campus_id: string }>();
  if (!row) throw new DataCoreAccessError(404, "꿈이음 학생을 찾을 수 없습니다.");
  await requireKkumeumStudentAccess(familyDb, context, campusId, studentId);
  return row;
}

async function reportRowById(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
) {
  await ensureKkumeumPhase2Schema(familyDb);
  await ensureKkumeumAnnouncementSchema(familyDb);
  const row = await familyDb
    .prepare(`SELECT mr.*, ${guardianConfirmationColumns} FROM monthly_reports mr WHERE mr.id = ?`)
    .bind(reportId)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "월간 평가를 찾을 수 없습니다.");
  await requireKkumeumStudentAccess(
    familyDb,
    context,
    String(row.campus_id),
    String(row.student_id),
  );
  return row;
}

function reportValues(input: MonthlyReportInput) {
  const growthSkillCodes = normalizeKkumeumGrowthSkillCodes(input.growthSkillCodes);
  return {
    title: cleanText(input.title, 240),
    summary: cleanText(input.summary, 2000),
    evaluationText: cleanText(input.evaluationText, 8000),
    teacherNote: cleanText(input.teacherNote, 8000),
    growthPoints: normalizeGrowthPoints(input.growthPoints),
    growthSkillCodes,
    growthSkillTaxonomyVersion: growthSkillCodes.length ? KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION : null,
    nextMonthFocus: cleanText(input.nextMonthFocus, 3000),
  };
}

export async function createMonthlyReport(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: MonthlyReportInput,
) {
  requireAuthenticatedAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureKkumeumPhase2Schema(familyDb);
  await ensureKkumeumAnnouncementSchema(familyDb);
  const campusId = requiredText(input.campusId, "campusId");
  const studentId = requiredText(input.studentId, "studentId");
  const yearMonth = normalizeYearMonth(input.yearMonth);
  await requireStudentRow(familyDb, context, campusId, studentId);
  const existing = await familyDb
    .prepare("SELECT id FROM monthly_reports WHERE student_id = ? AND year_month = ?")
    .bind(studentId, yearMonth)
    .first<{ id: string }>();
  if (existing) throw new DataCoreAccessError(409, "해당 학생의 월간 평가가 이미 존재합니다.");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const values = reportValues(input);
  await familyDb
    .prepare(
      `INSERT INTO monthly_reports (
         id, student_id, campus_id, year_month, teacher_user_id,
         title, summary, evaluation_text, teacher_note, growth_points_json,
         growth_skill_taxonomy_version, growth_skill_codes_json,
         next_month_focus, status, sent_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`,
    )
    .bind(
      id,
      studentId,
      campusId,
      yearMonth,
      context.user.internalUserId,
      values.title,
      values.summary,
      values.evaluationText,
      values.teacherNote,
      JSON.stringify(values.growthPoints),
      values.growthSkillTaxonomyVersion,
      JSON.stringify(values.growthSkillCodes),
      values.nextMonthFocus,
      now,
      now,
    )
    .run();
  await audit(familyDb, context, campusId, "create", id, { studentId, yearMonth });
  return getMonthlyReport(familyDb, context, id);
}

export async function getMonthlyReport(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
) {
  return reportResponse(await reportRowById(familyDb, context, reportId));
}

export async function listMonthlyReports(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
) {
  await ensureKkumeumPhase2Schema(familyDb);
  await requireStudentRow(familyDb, context, campusId, studentId);
  const result = await familyDb
    .prepare(
      `SELECT mr.*, ${guardianConfirmationColumns} FROM monthly_reports mr
       WHERE mr.campus_id = ? AND mr.student_id = ?
       ORDER BY mr.year_month DESC, mr.created_at DESC
       LIMIT 48`,
    )
    .bind(campusId, studentId)
    .all<Record<string, unknown>>();
  return (result.results || []).map(reportResponse);
}

export async function updateMonthlyReport(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
  input: MonthlyReportInput,
) {
  const current = await reportRowById(familyDb, context, reportId);
  if (current.status === "sent") {
    throw new DataCoreAccessError(409, "전달 완료된 평가는 직접 덮어쓸 수 없습니다. 명시적 수정 이력을 사용하세요.");
  }
  const values = reportValues(input);
  const now = new Date().toISOString();
  await familyDb
    .prepare(
      `UPDATE monthly_reports
       SET title = ?, summary = ?, evaluation_text = ?, teacher_note = ?,
           growth_points_json = ?, growth_skill_taxonomy_version = ?, growth_skill_codes_json = ?,
           next_month_focus = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      values.title,
      values.summary,
      values.evaluationText,
      values.teacherNote,
      JSON.stringify(values.growthPoints),
      values.growthSkillTaxonomyVersion,
      JSON.stringify(values.growthSkillCodes),
      values.nextMonthFocus,
      now,
      reportId,
    )
    .run();
  await audit(familyDb, context, String(current.campus_id), "update", reportId);
  return getMonthlyReport(familyDb, context, reportId);
}

export async function transitionMonthlyReport(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
  target: "draft" | "ready" | "sent",
) {
  const current = await reportRowById(familyDb, context, reportId);
  const from = String(current.status);
  const allowed =
    (from === "draft" && target === "ready") ||
    (from === "ready" && (target === "draft" || target === "sent"));
  if (!allowed) {
    throw new DataCoreAccessError(409, `${from} 상태에서는 ${target} 상태로 변경할 수 없습니다.`);
  }
  if (target === "sent" && !cleanText(current.evaluation_text, 8000)) {
    throw new DataCoreAccessError(400, "보호자에게 전달할 종합평가를 먼저 작성하세요.");
  }
  const now = new Date().toISOString();
  await familyDb
    .prepare(
      `UPDATE monthly_reports
       SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
       WHERE id = ?`,
    )
    .bind(target, target, now, now, reportId)
    .run();
  await audit(familyDb, context, String(current.campus_id), `status:${from}->${target}`, reportId);
  return getMonthlyReport(familyDb, context, reportId);
}

export async function reviseSentMonthlyReport(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
  input: MonthlyReportInput,
) {
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  const current = await reportRowById(familyDb, context, reportId);
  if (current.status !== "sent") {
    throw new DataCoreAccessError(409, "전달 완료된 평가만 명시적 수정 이력을 만들 수 있습니다.");
  }
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await familyDb
    .prepare(
      `INSERT INTO monthly_report_revisions (
         id, report_id, editor_user_id, snapshot_json, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      revisionId,
      reportId,
      context.user.internalUserId,
      JSON.stringify(reportResponse(current)),
      now,
    )
    .run();
  const values = reportValues(input);
  await familyDb
    .prepare(
      `UPDATE monthly_reports
       SET title = ?, summary = ?, evaluation_text = ?, teacher_note = ?,
           growth_points_json = ?, growth_skill_taxonomy_version = ?, growth_skill_codes_json = ?,
           next_month_focus = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      values.title,
      values.summary,
      values.evaluationText,
      values.teacherNote,
      JSON.stringify(values.growthPoints),
      values.growthSkillTaxonomyVersion,
      JSON.stringify(values.growthSkillCodes),
      values.nextMonthFocus,
      now,
      reportId,
    )
    .run();
  await audit(familyDb, context, String(current.campus_id), "revise-sent", reportId, { revisionId });
  return { report: await getMonthlyReport(familyDb, context, reportId), revisionId };
}

export async function listMonthlyReportRevisions(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  reportId: string,
) {
  await reportRowById(familyDb, context, reportId);
  const result = await familyDb
    .prepare(
      `SELECT id, report_id, editor_user_id, snapshot_json, created_at
       FROM monthly_report_revisions
       WHERE report_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(reportId)
    .all<Record<string, unknown>>();
  return (result.results || []).map((row) => ({
    id: row.id,
    reportId: row.report_id,
    editorUserId: row.editor_user_id,
    snapshot: (() => {
      try { return JSON.parse(String(row.snapshot_json || "{}")); } catch { return {}; }
    })(),
    createdAt: row.created_at,
  }));
}

export async function generateMonthlyReportDraft(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: {
    campusId?: unknown;
    studentId?: unknown;
    yearMonth?: unknown;
    teacherObservations?: unknown;
    artworkNotes?: unknown;
  },
  provider?: MonthlyReportDraftProvider,
) {
  await ensureKkumeumPhase2Schema(familyDb);
  const campusId = requiredText(input.campusId, "campusId");
  const studentId = requiredText(input.studentId, "studentId");
  const yearMonth = normalizeYearMonth(input.yearMonth);
  await requireStudentRow(familyDb, context, campusId, studentId);

  if (!provider) {
    return {
      available: false as const,
      code: "provider_not_configured" as const,
      message: "꿈이음 월간평가 AI 초안 연결 준비 중입니다. 교사가 직접 작성한 평가는 계속 저장할 수 있습니다.",
    };
  }

  const artworkNotes = Array.isArray(input.artworkNotes)
    ? input.artworkNotes.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 30)
    : [];
  return {
    available: true as const,
    generated: await provider.generate({
      studentRef: studentId,
      yearMonth,
      teacherObservations: cleanText(input.teacherObservations, 6000),
      artworkNotes,
      rules: REPORT_RULES,
    }),
    requiresTeacherReview: true,
    autoSend: false,
  };
}

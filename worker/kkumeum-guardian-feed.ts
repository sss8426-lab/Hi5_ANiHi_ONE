import { DataCoreAccessError } from "./data-core-access";
import { privateImageResponse } from './private-image-response';
import {
  ensureKkumeumGuardianAuthSchema,
  kkumeumGuardianSessionIdentity,
  type KkumeumGuardianIdentity,
} from "./kkumeum-guardian-auth";
import { requireKkumeumGuardianConsentPolicy } from "./kkumeum-consents";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";
import {
  KKUMEUM_GROWTH_SKILL_REGISTRY,
  KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION,
  isKkumeumGrowthSkillCode,
} from "./kkumeum-growth-skills";

type GuardianChildLink = {
  student_id: string;
  display_name: string;
  grade: string | null;
  status: string;
  class_name: string | null;
  can_view_reports: number;
  can_view_photos: number;
};

export type GuardianChildSummary = {
  studentId: string;
  displayName: string;
  grade: string | null;
  status: string;
  className: string | null;
};

const GROWTH_SKILL_LABEL_BY_CODE = new Map(
  KKUMEUM_GROWTH_SKILL_REGISTRY.map((skill) => [skill.code, skill.labelKo]),
);

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function guardianGrowthSkillLabels(version: unknown, codesJson: unknown): string[] {
  if (version !== KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION || !codesJson) return [];
  try {
    const parsed = JSON.parse(String(codesJson));
    if (!Array.isArray(parsed)) return [];
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const raw of parsed) {
      if (!isKkumeumGrowthSkillCode(raw) || seen.has(raw)) continue;
      seen.add(raw);
      const label = GROWTH_SKILL_LABEL_BY_CODE.get(raw);
      if (label) labels.push(label);
    }
    return labels;
  } catch {
    return [];
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

async function guardianChildLink(
  familyDb: D1Database,
  guardianId: string,
  studentId: string,
): Promise<GuardianChildLink> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  const row = await familyDb.prepare(
    `SELECT
       s.id AS student_id,
       COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
       s.grade,
       s.status,
       c.name AS class_name,
       sg.can_view_reports,
       sg.can_view_photos
     FROM student_guardians sg
     INNER JOIN family_students s ON s.id = sg.student_id
     LEFT JOIN family_classes c ON c.id = s.current_class_id
     WHERE sg.guardian_id = ? AND sg.student_id = ?
     LIMIT 1`,
  ).bind(guardianId, studentId).first<GuardianChildLink>();
  if (!row) {
    throw new DataCoreAccessError(403, "이 학생 정보를 볼 권한이 없습니다.");
  }
  return row;
}

function childResponse(row: GuardianChildLink): GuardianChildSummary {
  return {
    studentId: row.student_id,
    displayName: row.display_name,
    grade: row.grade || null,
    status: row.status,
    className: row.class_name || null,
  };
}

export async function listGuardianChildren(
  familyDb: D1Database,
  request: Request,
): Promise<GuardianChildSummary[]> {
  const guardian = await requireGuardian(familyDb, request);
  const result = await familyDb.prepare(
    `SELECT
       s.id AS student_id,
       COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
       s.grade,
       s.status,
       c.name AS class_name,
       sg.can_view_reports,
       sg.can_view_photos
     FROM student_guardians sg
     INNER JOIN family_students s ON s.id = sg.student_id
     LEFT JOIN family_classes c ON c.id = s.current_class_id
     WHERE sg.guardian_id = ?
     ORDER BY display_name, s.id`,
  ).bind(guardian.guardianId).all<GuardianChildLink>();
  return (result.results || []).map(childResponse);
}

export async function getGuardianChild(
  familyDb: D1Database,
  request: Request,
  studentId: string,
): Promise<GuardianChildSummary> {
  const guardian = await requireGuardian(familyDb, request);
  return childResponse(await guardianChildLink(familyDb, guardian.guardianId, studentId));
}

export async function listGuardianChildReports(
  familyDb: D1Database,
  request: Request,
  studentId: string,
) {
  const guardian = await requireGuardian(familyDb, request);
  await ensureKkumeumPhase2Schema(familyDb);
  const link = await guardianChildLink(familyDb, guardian.guardianId, studentId);
  if (!link.can_view_reports) {
    throw new DataCoreAccessError(403, "이 학생의 성장평가를 볼 권한이 없습니다.");
  }
  await requireKkumeumGuardianConsentPolicy(familyDb, studentId, guardian.guardianId);
  const result = await familyDb.prepare(
    `SELECT id, year_month, title, summary, evaluation_text,
            growth_points_json, growth_skill_taxonomy_version, growth_skill_codes_json,
            next_month_focus, sent_at
     FROM monthly_reports
     WHERE student_id = ? AND status = 'sent'
     ORDER BY year_month DESC, sent_at DESC`,
  ).bind(studentId).all<{
    id: string;
    year_month: string;
    title: string | null;
    summary: string | null;
    evaluation_text: string | null;
    growth_points_json: string;
    growth_skill_taxonomy_version: string | null;
    growth_skill_codes_json: string | null;
    next_month_focus: string | null;
    sent_at: string | null;
  }>();
  return (result.results || []).map((row) => ({
    reportId: row.id,
    yearMonth: row.year_month,
    title: row.title || "",
    summary: row.summary || "",
    evaluationText: row.evaluation_text || "",
    growthPoints: parseJsonObject(row.growth_points_json),
    growthSkillLabels: guardianGrowthSkillLabels(
      row.growth_skill_taxonomy_version,
      row.growth_skill_codes_json,
    ),
    nextMonthFocus: row.next_month_focus || "",
    sentAt: row.sent_at || null,
  }));
}

export async function listGuardianChildArtworks(
  familyDb: D1Database,
  request: Request,
  studentId: string,
) {
  const guardian = await requireGuardian(familyDb, request);
  await ensureKkumeumPhase2Schema(familyDb);
  const link = await guardianChildLink(familyDb, guardian.guardianId, studentId);
  if (!link.can_view_photos) {
    throw new DataCoreAccessError(403, "이 학생의 작품사진을 볼 권한이 없습니다.");
  }
  await requireKkumeumGuardianConsentPolicy(familyDb, studentId, guardian.guardianId);
  const result = await familyDb.prepare(
    `SELECT a.id, a.title, a.lesson_date, a.sort_order,
            f.id AS file_id, f.mime_type
     FROM student_artworks a
     INNER JOIN family_files f ON f.id = a.family_file_id
     WHERE a.student_id = ?
       AND f.student_id = ?
       AND f.deleted_at IS NULL
     ORDER BY COALESCE(a.lesson_date, '') DESC, a.sort_order, a.created_at DESC`,
  ).bind(studentId, studentId).all<{
    id: string;
    title: string | null;
    lesson_date: string | null;
    sort_order: number;
    file_id: string;
    mime_type: string;
  }>();
  return (result.results || []).map((row) => ({
    artworkId: row.id,
    title: row.title || "",
    lessonDate: row.lesson_date || null,
    sortOrder: Number(row.sort_order) || 0,
    mimeType: row.mime_type,
    fileUrl: `/api/family/files/${encodeURIComponent(row.file_id)}`,
  }));
}

export async function readGuardianFamilyFile(
  familyDb: D1Database,
  familyFiles: R2Bucket,
  request: Request,
  fileId: string,
): Promise<Response> {
  const guardian = await requireGuardian(familyDb, request);
  await ensureKkumeumPhase2Schema(familyDb);
  const row = await familyDb.prepare(
    `SELECT f.r2_key, f.file_name, f.mime_type, f.student_id
     FROM family_files f
     INNER JOIN student_guardians sg
       ON sg.student_id = f.student_id
      AND sg.guardian_id = ?
      AND sg.can_view_photos = 1
     WHERE f.id = ?
       AND f.student_id IS NOT NULL
       AND f.deleted_at IS NULL
     LIMIT 1`,
  ).bind(guardian.guardianId, fileId).first<{
    r2_key: string;
    file_name: string;
    mime_type: string;
    student_id: string;
  }>();
  if (!row) {
    throw new DataCoreAccessError(403, "이 파일을 볼 권한이 없습니다.");
  }
  await requireKkumeumGuardianConsentPolicy(familyDb, row.student_id, guardian.guardianId);
  const object = await familyFiles.get(row.r2_key);
  if (!object) throw new DataCoreAccessError(404, "꿈이음 원본 파일을 찾을 수 없습니다.");
  const headers = new Headers({
    "content-type": row.mime_type || "application/octet-stream",
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || "file")}`,
    "x-content-type-options": "nosniff",
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return privateImageResponse(request,object,headers,row.mime_type);
}

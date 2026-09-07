import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { requireKkumeumStudentAccess } from "./kkumeum-core";
import { requireKkumeumArtworkManageAccess } from "./kkumeum-artwork-access";
import { ensureKkumeumPhase2Schema } from "./kkumeum-phase2-schema";

const MAX_ARTWORK_SIZE_BYTES = 30 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "vbs", "js", "mjs", "jar",
]);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requiredText(value: unknown, field: string, maxLength = 120): string {
  const text = cleanText(value, maxLength);
  if (!text) throw new DataCoreAccessError(400, `${field}가 필요합니다.`);
  return text;
}

function fileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  action: string,
  resourceType: "artwork" | "family_file",
  resourceId: string,
  metadata: unknown = {},
) {
  await familyDb
    .prepare(
      `INSERT INTO family_audit_logs (
         id, campus_id, actor_type, actor_id, action,
         resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      campusId,
      context.user?.internalUserId || null,
      action,
      resourceType,
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
  await ensureKkumeumPhase2Schema(familyDb);
  const row = await familyDb
    .prepare("SELECT id, campus_id, current_class_id FROM family_students WHERE id = ? AND campus_id = ?")
    .bind(studentId, campusId)
    .first<{ id: string; campus_id: string; current_class_id: string | null }>();
  if (!row) throw new DataCoreAccessError(404, "꿈이음 학생을 찾을 수 없습니다.");
  await requireKkumeumStudentAccess(familyDb, context, campusId, studentId);
  return row;
}

async function validateClassLink(
  familyDb: D1Database,
  campusId: string,
  student: { current_class_id: string | null },
  classId: string | null,
) {
  if (!classId) return;
  const row = await familyDb
    .prepare("SELECT id FROM family_classes WHERE id = ? AND campus_id = ? AND active = 1")
    .bind(classId, campusId)
    .first<{ id: string }>();
  if (!row || student.current_class_id !== classId) {
    throw new DataCoreAccessError(400, "학생의 현재 반과 작품 반 정보가 일치하지 않습니다.");
  }
}

async function validateReportLink(
  familyDb: D1Database,
  campusId: string,
  studentId: string,
  reportId: string | null,
) {
  if (!reportId) return;
  const row = await familyDb
    .prepare("SELECT id FROM monthly_reports WHERE id = ? AND campus_id = ? AND student_id = ?")
    .bind(reportId, campusId, studentId)
    .first<{ id: string }>();
  if (!row) throw new DataCoreAccessError(400, "같은 학생·캠퍼스의 월간평가에만 작품을 연결할 수 있습니다.");
}

function artworkResponse(row: Record<string, unknown>) {
  const fileId = String(row.family_file_id || row.file_id || "");
  return {
    id: row.id,
    studentId: row.student_id,
    campusId: row.campus_id,
    classId: row.class_id || null,
    reportId: row.report_id || null,
    fileId,
    fileName: row.file_name || "",
    mimeType: row.mime_type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes || 0),
    title: row.title || "",
    lessonDate: row.lesson_date || null,
    teacherNote: row.teacher_note || "",
    sortOrder: Number(row.sort_order || 0),
    fileUrl: `/api/kkumeum/files/${encodeURIComponent(fileId)}`,
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

async function artworkRowById(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  artworkId: string,
  includeDeleted = false,
) {
  await ensureKkumeumPhase2Schema(familyDb);
  const row = await familyDb
    .prepare(
      `SELECT a.*, f.file_name, f.mime_type, f.size_bytes, f.deleted_at
       FROM student_artworks a
       JOIN family_files f ON f.id = a.family_file_id
       WHERE a.id = ? ${includeDeleted ? "" : "AND f.deleted_at IS NULL"}
       LIMIT 1`,
    )
    .bind(artworkId)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "학생작품을 찾을 수 없습니다.");
  await requireKkumeumStudentAccess(
    familyDb,
    context,
    String(row.campus_id),
    String(row.student_id),
  );
  return row;
}

export async function uploadKkumeumArtwork(
  request: Request,
  familyDb: D1Database,
  familyFiles: R2Bucket,
  context: DataCoreAccessContext,
) {
  requireAuthenticatedAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureKkumeumPhase2Schema(familyDb);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new DataCoreAccessError(400, "업로드할 작품 이미지가 필요합니다.");
  if (file.size <= 0) throw new DataCoreAccessError(400, "빈 파일은 업로드할 수 없습니다.");
  if (file.size > MAX_ARTWORK_SIZE_BYTES) {
    throw new DataCoreAccessError(413, "작품 이미지 한 파일의 최대 크기는 30MB입니다.");
  }
  if (!String(file.type || "").toLowerCase().startsWith("image/")) {
    throw new DataCoreAccessError(415, "꿈이음 작품은 이미지 파일만 업로드할 수 있습니다.");
  }
  if (BLOCKED_EXTENSIONS.has(fileExtension(file.name))) {
    throw new DataCoreAccessError(415, "실행 파일 또는 스크립트 파일은 업로드할 수 없습니다.");
  }

  const campusId = requiredText(form.get("campusId"), "campusId");
  const studentId = requiredText(form.get("studentId"), "studentId");
  const student = await requireStudentRow(familyDb, context, campusId, studentId);
  await requireKkumeumArtworkManageAccess(familyDb, context, campusId, studentId);

  const classId = cleanText(form.get("classId"), 120) || null;
  const reportId = cleanText(form.get("reportId"), 120) || null;
  await validateClassLink(familyDb, campusId, student, classId);
  await validateReportLink(familyDb, campusId, studentId, reportId);

  const fileId = crypto.randomUUID();
  const artworkId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  // Deliberately exclude names, phones, schools and original file names from the private R2 key.
  const r2Key = ["kkumeum", "private", campusId, studentId, fileId].join("/");
  // File size is capped at 30MB. Buffering gives R2/Miniflare a known content length and avoids
  // ambiguous streaming semantics while keeping a strict, bounded memory ceiling.
  const fileBytes = await file.arrayBuffer();

  await familyFiles.put(r2Key, fileBytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { familyFileId: fileId, campusId, studentId, purpose: "artwork" },
  });

  try {
    await familyDb.batch([
      familyDb
        .prepare(
          `INSERT INTO family_files (
             id, campus_id, student_id, owner_user_id, purpose, r2_key,
             file_name, mime_type, size_bytes, created_at, deleted_at
           ) VALUES (?, ?, ?, ?, 'artwork', ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          fileId,
          campusId,
          studentId,
          context.user.internalUserId,
          r2Key,
          cleanText(file.name, 200) || "artwork",
          file.type || "application/octet-stream",
          file.size,
          createdAt,
        ),
      familyDb
        .prepare(
          `INSERT INTO student_artworks (
             id, student_id, campus_id, class_id, report_id, family_file_id,
             title, lesson_date, teacher_note, sort_order, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          artworkId,
          studentId,
          campusId,
          classId,
          reportId,
          fileId,
          cleanText(form.get("title"), 240),
          cleanText(form.get("lessonDate"), 20) || null,
          cleanText(form.get("teacherNote"), 4000),
          numberValue(form.get("sortOrder")),
          createdAt,
        ),
    ]);
  } catch (error) {
    await familyFiles.delete(r2Key).catch(() => undefined);
    throw error;
  }

  await audit(familyDb, context, campusId, "upload", "artwork", artworkId, {
    studentId,
    fileId,
    sizeBytes: file.size,
  });
  return getKkumeumArtwork(familyDb, context, artworkId);
}

export async function listKkumeumArtworks(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
) {
  await requireStudentRow(familyDb, context, campusId, studentId);
  const result = await familyDb
    .prepare(
      `SELECT a.*, f.file_name, f.mime_type, f.size_bytes, f.deleted_at
       FROM student_artworks a
       JOIN family_files f ON f.id = a.family_file_id
       WHERE a.campus_id = ? AND a.student_id = ? AND f.deleted_at IS NULL
       ORDER BY COALESCE(a.lesson_date, a.created_at) DESC, a.sort_order ASC, a.created_at DESC
       LIMIT 500`,
    )
    .bind(campusId, studentId)
    .all<Record<string, unknown>>();
  return (result.results || []).map(artworkResponse);
}

export async function getKkumeumArtwork(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  artworkId: string,
) {
  return artworkResponse(await artworkRowById(familyDb, context, artworkId));
}

export async function updateKkumeumArtwork(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  artworkId: string,
  input: Record<string, unknown>,
) {
  const current = await artworkRowById(familyDb, context, artworkId);
  const campusId = String(current.campus_id);
  const studentId = String(current.student_id);
  await requireKkumeumArtworkManageAccess(familyDb, context, campusId, studentId);

  const reportId = input.reportId === undefined
    ? (current.report_id ? String(current.report_id) : null)
    : (cleanText(input.reportId, 120) || null);
  await validateReportLink(familyDb, campusId, studentId, reportId);

  const title = input.title === undefined ? String(current.title || "") : cleanText(input.title, 240);
  const teacherNote = input.teacherNote === undefined
    ? String(current.teacher_note || "")
    : cleanText(input.teacherNote, 4000);
  const lessonDate = input.lessonDate === undefined
    ? (current.lesson_date ? String(current.lesson_date) : null)
    : (cleanText(input.lessonDate, 20) || null);
  const sortOrder = input.sortOrder === undefined
    ? Number(current.sort_order || 0)
    : numberValue(input.sortOrder);

  await familyDb
    .prepare(
      `UPDATE student_artworks
       SET report_id = ?, title = ?, lesson_date = ?, teacher_note = ?, sort_order = ?
       WHERE id = ?`,
    )
    .bind(reportId, title, lessonDate, teacherNote, sortOrder, artworkId)
    .run();
  await audit(familyDb, context, campusId, "update", "artwork", artworkId, { studentId, reportId });
  return getKkumeumArtwork(familyDb, context, artworkId);
}

export async function trashKkumeumArtwork(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  artworkId: string,
) {
  const current = await artworkRowById(familyDb, context, artworkId);
  const campusId = String(current.campus_id);
  const studentId = String(current.student_id);
  await requireKkumeumArtworkManageAccess(familyDb, context, campusId, studentId);
  const deletedAt = new Date().toISOString();
  await familyDb
    .prepare("UPDATE family_files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(deletedAt, String(current.family_file_id))
    .run();
  await audit(familyDb, context, campusId, "trash", "artwork", artworkId, { studentId });
  return { ok: true, id: artworkId, deletedAt, recoverable: true };
}

export async function restoreKkumeumArtwork(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  artworkId: string,
) {
  const current = await artworkRowById(familyDb, context, artworkId, true);
  const campusId = String(current.campus_id);
  const studentId = String(current.student_id);
  await requireKkumeumArtworkManageAccess(familyDb, context, campusId, studentId);
  if (!current.deleted_at) return { artwork: artworkResponse(current), restored: false };
  await familyDb
    .prepare("UPDATE family_files SET deleted_at = NULL WHERE id = ?")
    .bind(String(current.family_file_id))
    .run();
  await audit(familyDb, context, campusId, "restore", "artwork", artworkId, { studentId });
  return { artwork: await getKkumeumArtwork(familyDb, context, artworkId), restored: true };
}

export async function readKkumeumFamilyFile(
  familyDb: D1Database,
  familyFiles: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
): Promise<Response> {
  requireAuthenticatedAccess(context);
  await ensureKkumeumPhase2Schema(familyDb);
  const row = await familyDb
    .prepare(
      `SELECT id, campus_id, student_id, r2_key, file_name, mime_type, deleted_at
       FROM family_files WHERE id = ? LIMIT 1`,
    )
    .bind(fileId)
    .first<Record<string, unknown>>();
  if (!row || row.deleted_at) throw new DataCoreAccessError(404, "꿈이음 파일을 찾을 수 없습니다.");
  const campusId = String(row.campus_id || "");
  const studentId = String(row.student_id || "");
  if (!campusId || !studentId) throw new DataCoreAccessError(403, "학생 연결이 없는 파일은 이 경로에서 열 수 없습니다.");
  await requireKkumeumStudentAccess(familyDb, context, campusId, studentId);

  const object = await familyFiles.get(String(row.r2_key));
  if (!object) throw new DataCoreAccessError(404, "꿈이음 원본 파일을 찾을 수 없습니다.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", String(row.mime_type || headers.get("content-type") || "application/octet-stream"));
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(String(row.file_name || "artwork"))}`,
  );
  return new Response(object.body, { headers });
}

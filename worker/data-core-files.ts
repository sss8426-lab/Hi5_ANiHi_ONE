import {
  DEFAULT_ORGANIZATION_ID,
  DataCoreFileArea,
  ensureDataCoreDatabase,
  recordFileObject,
  visibilityForArea,
} from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const FILE_AREAS: DataCoreFileArea[] = [
  "student-private",
  "documents-private",
  "academy-public",
  "exports-temporary",
];
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "ps1",
  "vbs",
  "js",
  "mjs",
  "jar",
]);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeFileName(value: string) {
  return cleanText(value, 160)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_") || "file";
}

function fileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function normalizeArea(value: unknown): DataCoreFileArea {
  const area = cleanText(value, 40) as DataCoreFileArea;
  return FILE_AREAS.includes(area) ? area : "documents-private";
}

function canReadFileRow(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (!context.user || !context.memberships.length) return false;
  if (row.visibility === "organization" || row.visibility === "public") return true;
  if (row.visibility === "campus") {
    return typeof row.campus_id === "string" && context.campusIds.includes(row.campus_id);
  }
  return context.user.internalUserId === row.owner_user_id;
}

function canMutateFileRow(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  return context.user?.internalUserId === row.owner_user_id;
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  resourceId: string,
  campusId: string | null,
  metadata: unknown,
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, 'file_object', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEFAULT_ORGANIZATION_ID,
      campusId,
      context.user.internalUserId,
      action,
      resourceId,
      JSON.stringify(metadata ?? {}),
      new Date().toISOString(),
    )
    .run();
}

async function assertRecordLinkAllowed(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string | null,
  campusId: string | null,
) {
  if (!recordId) return;
  const record = await db
    .prepare(
      `SELECT id, campus_id, created_by_user_id
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<{ id: string; campus_id: string | null; created_by_user_id: string | null }>();
  if (!record) throw new DataCoreAccessError(400, "연결할 DATA CORE 레코드를 찾을 수 없습니다.");
  if (context.isSuperAdmin) return;
  if (record.created_by_user_id !== context.user?.internalUserId) {
    throw new DataCoreAccessError(403, "본인이 등록한 데이터에만 파일을 연결할 수 있습니다.");
  }
  if (record.campus_id !== campusId) {
    throw new DataCoreAccessError(400, "파일과 연결 데이터의 캠퍼스가 다릅니다.");
  }
}

function fileRowToResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    campusId: row.campus_id,
    campusName: row.campus_name,
    recordId: row.data_record_id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    area: row.area,
    category: row.category,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    visibility: row.visibility,
    downloadUrl: `/api/data-core/files/${encodeURIComponent(String(row.id))}`,
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

export async function uploadDataCoreFile(
  request: Request,
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  await ensureDataCoreDatabase(db);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new DataCoreAccessError(400, "업로드할 파일이 필요합니다.");
  if (file.size <= 0) throw new DataCoreAccessError(400, "빈 파일은 업로드할 수 없습니다.");
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new DataCoreAccessError(413, "한 파일의 최대 업로드 크기는 100MB입니다.");
  }
  if (BLOCKED_EXTENSIONS.has(fileExtension(file.name))) {
    throw new DataCoreAccessError(415, "실행 파일 또는 스크립트 파일은 업로드할 수 없습니다.");
  }

  const campusId = cleanText(form.get("campusId"), 120) || null;
  if (!context.isSuperAdmin && !campusId) {
    throw new DataCoreAccessError(400, "캠퍼스 사용자는 campusId가 필요합니다.");
  }
  if (campusId) requireCampusAccess(context, campusId);

  const area = normalizeArea(form.get("area"));
  const category = cleanText(form.get("category") || form.get("purpose") || "general", 80) || "general";
  const sourceApp = cleanText(form.get("sourceApp") || "data-core", 80) || "data-core";
  const recordId = cleanText(form.get("recordId"), 120) || null;
  const year = cleanText(form.get("year"), 8).replace(/[^0-9]/g, "");
  const ownerRef = cleanText(form.get("ownerId"), 120) || "shared";
  await assertRecordLinkAllowed(db, context, recordId, campusId);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const pathCampus = campusId || "organization";
  const pathYear = year || createdAt.slice(0, 4);
  const key = [
    "data-core",
    area,
    DEFAULT_ORGANIZATION_ID,
    pathCampus,
    category,
    ownerRef,
    pathYear,
    `${Date.now()}-${id}-${safeFileName(file.name)}`,
  ].join("/");

  await files.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
    customMetadata: {
      dataCoreFileId: id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      campusId: campusId || "",
      sourceApp,
      category,
    },
  });

  const visibility = visibilityForArea(area);
  await recordFileObject(db, {
    id,
    campusId,
    dataRecordId: recordId,
    ownerUserId: context.user.internalUserId,
    area,
    category,
    r2Key: key,
    originalFileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    visibility,
    createdAt,
  });
  await audit(db, context, "upload", id, campusId, {
    area,
    category,
    sourceApp,
    recordId,
    sizeBytes: file.size,
  });

  return {
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    campusId,
    recordId,
    area,
    category,
    sourceApp,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    visibility,
    downloadUrl: `/api/data-core/files/${encodeURIComponent(id)}`,
    createdAt,
  };
}

export async function listDataCoreFiles(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const category = cleanText(url.searchParams.get("category"), 80);
  const recordId = cleanText(url.searchParams.get("recordId"), 120);
  const q = cleanText(url.searchParams.get("q"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  const conditions = ["fo.organization_id = ?", "fo.deleted_at IS NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];
  if (campusId) {
    conditions.push("fo.campus_id = ?");
    bindings.push(campusId);
  }
  if (category) {
    conditions.push("fo.category = ?");
    bindings.push(category);
  }
  if (recordId) {
    conditions.push("fo.data_record_id = ?");
    bindings.push(recordId);
  }
  if (q) {
    conditions.push("(fo.original_file_name LIKE ? OR fo.category LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    bindings.push(like, like);
  }

  const result = await db
    .prepare(
      `SELECT fo.*, c.name AS campus_name, u.display_name AS owner_name
       FROM file_objects fo
       LEFT JOIN campuses c ON c.id = fo.campus_id
       LEFT JOIN users u ON u.id = fo.owner_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY fo.created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  return (result.results || [])
    .filter((row) => canReadFileRow(context, row))
    .map(fileRowToResponse);
}

export async function listDeletedDataCoreFiles(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  const q = cleanText(url.searchParams.get("q"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
  const conditions = ["fo.organization_id = ?", "fo.deleted_at IS NOT NULL"];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID];

  if (!context.isSuperAdmin) {
    if (!context.user) return [];
    conditions.push("fo.owner_user_id = ?");
    bindings.push(context.user.internalUserId);
  }
  if (campusId) {
    conditions.push("fo.campus_id = ?");
    bindings.push(campusId);
  }
  if (q) {
    conditions.push("(fo.original_file_name LIKE ? OR fo.category LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    bindings.push(like, like);
  }

  const result = await db
    .prepare(
      `SELECT fo.*, c.name AS campus_name, u.display_name AS owner_name
       FROM file_objects fo
       LEFT JOIN campuses c ON c.id = fo.campus_id
       LEFT JOIN users u ON u.id = fo.owner_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY fo.deleted_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<Record<string, unknown>>();

  return (result.results || []).map(fileRowToResponse);
}

export async function readDataCoreFile(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
) {
  requireAuthenticatedAccess(context);
  const row = await db
    .prepare(
      `SELECT * FROM file_objects
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "파일을 찾을 수 없습니다.");
  if (!canReadFileRow(context, row)) {
    throw new DataCoreAccessError(403, "이 파일을 볼 권한이 없습니다.");
  }

  const object = await files.get(String(row.r2_key));
  if (!object) throw new DataCoreAccessError(404, "R2 원본 파일을 찾을 수 없습니다.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(String(row.original_file_name || "file"))}`,
  );
  return new Response(object.body, { headers });
}

/**
 * Normal delete is intentionally recoverable. The R2 object remains intact and
 * the metadata is moved to trash by setting deleted_at.
 */
export async function deleteDataCoreFile(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
) {
  requireWriteAccess(context);
  void files;
  const row = await db
    .prepare(
      `SELECT * FROM file_objects
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "파일을 찾을 수 없습니다.");
  if (!canMutateFileRow(context, row)) {
    throw new DataCoreAccessError(403, "본인이 업로드한 파일만 삭제할 수 있습니다.");
  }

  const deletedAt = new Date().toISOString();
  await db
    .prepare("UPDATE file_objects SET deleted_at = ? WHERE id = ?")
    .bind(deletedAt, fileId)
    .run();
  await audit(
    db,
    context,
    "trash",
    fileId,
    (row.campus_id as string | null) || null,
    { r2Key: row.r2_key, fileName: row.original_file_name, recoverable: true },
  );
  return { ok: true, id: fileId, deletedAt, recoverable: true };
}

export async function restoreDataCoreFile(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
) {
  requireWriteAccess(context);
  const row = await db
    .prepare(
      `SELECT * FROM file_objects
       WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "휴지통에서 파일을 찾을 수 없습니다.");
  if (!canMutateFileRow(context, row)) {
    throw new DataCoreAccessError(403, "본인이 삭제한 파일만 복원할 수 있습니다.");
  }

  const object = await files.get(String(row.r2_key));
  if (!object) {
    throw new DataCoreAccessError(409, "R2 원본이 이미 없어 복원할 수 없습니다.");
  }

  await db.prepare("UPDATE file_objects SET deleted_at = NULL WHERE id = ?").bind(fileId).run();
  await audit(
    db,
    context,
    "restore",
    fileId,
    (row.campus_id as string | null) || null,
    { r2Key: row.r2_key, fileName: row.original_file_name },
  );
  return { ok: true, id: fileId, restoredAt: new Date().toISOString() };
}

export async function purgeDataCoreFile(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
) {
  requireWriteAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "영구 삭제는 마스터 관리자만 할 수 있습니다.");
  }

  const row = await db
    .prepare(
      `SELECT * FROM file_objects
       WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "휴지통에서 파일을 찾을 수 없습니다.");

  await files.delete(String(row.r2_key));
  await audit(
    db,
    context,
    "purge",
    fileId,
    (row.campus_id as string | null) || null,
    { r2Key: row.r2_key, fileName: row.original_file_name, permanent: true },
  );
  await db.prepare("DELETE FROM file_objects WHERE id = ?").bind(fileId).run();
  return { ok: true, id: fileId, permanent: true, purgedAt: new Date().toISOString() };
}

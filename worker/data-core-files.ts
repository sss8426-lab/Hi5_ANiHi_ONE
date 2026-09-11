import {
  DEFAULT_ORGANIZATION_ID,
  DataCoreFileArea,
  ensureDataCoreDatabase,
  fileAreaForPurpose,
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
import { canReadRegisteredFile, derivativeMetadata, DERIVATIVE_CATEGORY, DERIVATIVE_RECORD_TYPE } from './data-core-derivative-policy';
import { libraryUploadTarget, libraryCanDelete, LIBRARY_FOLDER, LIBRARY_SOURCE } from './data-core-library-policy';
import { privateImageResponse } from './private-image-response';
import { THUMBNAIL_CATEGORY, THUMBNAIL_RECORD_TYPE, thumbnailSource } from './data-core-derivative-policy';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const FILE_AREAS: DataCoreFileArea[] = [
  "student-private",
  "documents-private",
  "academy-public",
  "exports-temporary",
];
const LIBRARY_FILE_CATEGORIES = new Set([
  "class-photo",
  "student-artwork",
  "academy-photo",
  "competition-material",
  "admission-material",
  "counseling-material",
  "blog-source",
  "instagram-source",
  "promotion-material",
  "hq-workspace",
]);
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

function libraryFileProfile(category: string, campusId: string | null) {
  if (!LIBRARY_FILE_CATEGORIES.has(category)) {
    throw new DataCoreAccessError(400, "자료보관함 분류가 올바르지 않습니다.");
  }
  if (category === "hq-workspace") {
    return {
      area: "documents-private" as const,
      visibility: "organization" as const,
      sourceApp: "hq-library",
    };
  }
  if (category === "student-artwork") {
    return { area: "student-private" as const, visibility: "private" as const, sourceApp: "data-core" };
  }
  if (category === "promotion-material") {
    return { area: "academy-public" as const, visibility: "public" as const, sourceApp: "data-core" };
  }
  return {
    area: "documents-private" as const,
    visibility: campusId ? ("campus" as const) : ("organization" as const),
    sourceApp: category === "blog-source" ? "blog" : category === "instagram-source" ? "instagram" : "data-core",
  };
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
      `SELECT id, campus_id, created_by_user_id, record_type, source_app, title
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<{ id: string; campus_id: string | null; created_by_user_id: string | null; record_type: string; source_app: string; title: string }>();
  if (!record) throw new DataCoreAccessError(400, "연결할 DATA CORE 레코드를 찾을 수 없습니다.");
  if ([DERIVATIVE_RECORD_TYPE,THUMBNAIL_RECORD_TYPE].includes(record.record_type)) throw new DataCoreAccessError(403, '파생 이미지 원본 관계는 직접 연결할 수 없습니다.');
  if (record.record_type === 'competition-award-folder' && record.campus_id) requireCampusAccess(context, record.campus_id);
  if (record.record_type === 'competition-award-folder' && record.campus_id !== campusId) {
    throw new DataCoreAccessError(400, '파일과 수상작 폴더의 캠퍼스가 다릅니다.');
  }
  if (context.isSuperAdmin) return record;
  if (record.created_by_user_id !== context.user?.internalUserId) {
    throw new DataCoreAccessError(403, "본인이 등록한 데이터에만 파일을 연결할 수 있습니다.");
  }
  if (record.campus_id !== campusId) {
    throw new DataCoreAccessError(400, "파일과 연결 데이터의 캠퍼스가 다릅니다.");
  }
  return record;
}

async function assertHqWorkspaceUpload(
  db: D1Database,
  context: DataCoreAccessContext,
  category: string,
  campusId: string | null,
  recordId: string | null,
) {
  if (category !== "hq-workspace") return;
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "본원 작업물 업로드는 마스터 관리자만 할 수 있습니다.");
  }
  if (campusId) {
    throw new DataCoreAccessError(400, "본원 작업물은 조직 공통으로만 업로드할 수 있습니다.");
  }
  if (!recordId) {
    throw new DataCoreAccessError(400, "본원 작업물 폴더를 먼저 선택하세요.");
  }
  const folder = await db
    .prepare(
      `SELECT id, campus_id, record_type, source_app, visibility
       FROM data_records
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
    )
    .bind(recordId, DEFAULT_ORGANIZATION_ID)
    .first<{
      id: string;
      campus_id: string | null;
      record_type: string;
      source_app: string;
      visibility: string;
    }>();
  if (
    !folder ||
    folder.campus_id !== null ||
    folder.record_type !== "hq-library-folder" ||
    folder.source_app !== "data-core-library" ||
    folder.visibility !== "organization"
  ) {
    throw new DataCoreAccessError(400, "유효한 본원 작업물 폴더가 아닙니다.");
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
    sourceApp: row.source_app,
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
  const category = cleanText(form.get("category") || form.get("purpose") || "general", 80) || "general";
  if ([DERIVATIVE_CATEGORY,THUMBNAIL_CATEGORY].includes(category)) throw new DataCoreAccessError(400, '파생 이미지 저장 기능을 사용하세요.');
  const recordId = cleanText(form.get("recordId"), 120) || null;
  const libraryFolder = await libraryUploadTarget(db, context, recordId);
  if (libraryFolder && (libraryFolder.campusId !== campusId || libraryFolder.category !== category)) {
    throw new DataCoreAccessError(400, '파일과 자료보관함 폴더의 위치가 다릅니다.');
  }
  if (libraryFolder?.row?.record_type === LIBRARY_FOLDER && request.headers.get('origin') !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, '동일 출처 요청만 허용됩니다.');
  }
  if (!libraryFolder) await assertHqWorkspaceUpload(db, context, category, campusId, recordId);
  if (category !== "hq-workspace") {
    if (!context.isSuperAdmin && !campusId) {
      throw new DataCoreAccessError(400, "캠퍼스 사용자는 campusId가 필요합니다.");
    }
    if (campusId) requireCampusAccess(context, campusId);
  }

  const isLibraryUpload = new URL(request.url).pathname === "/api/data-core/files";
  const profile = libraryFolder ? {
    area: (category === 'student-artwork' ? 'student-private' : 'documents-private') as DataCoreFileArea,
    visibility: (category === 'student-artwork' || libraryFolder.shareMode === 'restricted' ? 'private' : campusId ? 'campus' : 'organization') as 'private' | 'campus' | 'organization',
    sourceApp: libraryFolder.row?.record_type === LIBRARY_FOLDER ? LIBRARY_SOURCE : 'hq-library',
  } : isLibraryUpload
    ? libraryFileProfile(category, campusId)
    : {
      area: fileAreaForPurpose(category),
      visibility: visibilityForArea(fileAreaForPurpose(category)),
      sourceApp: cleanText(form.get("sourceApp") || "data-core", 80) || "data-core",
    };
  const { area, visibility, sourceApp } = profile;
  const year = cleanText(form.get("year"), 8).replace(/[^0-9]/g, "");
  const ownerRef = cleanText(form.get("ownerId"), 120) || "shared";
  if (!libraryFolder) await assertRecordLinkAllowed(db, context, recordId, campusId);
  const fileName = file.name;

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
    `${Date.now()}-${id}-${safeFileName(fileName)}`,
  ].join("/");

  await files.put(key, file, {
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

  try {
  await recordFileObject(db, {
    id,
    campusId,
    dataRecordId: recordId,
    ownerUserId: context.user.internalUserId,
    sourceApp,
    area,
    category,
    r2Key: key,
    originalFileName: fileName,
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
  } catch (error) {
    // Compensate only this request's new object and row.
    await files.delete(key);
    await db.prepare('DELETE FROM file_objects WHERE id = ?').bind(id).run();
    throw error;
  }

  return {
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    campusId,
    recordId,
    area,
    category,
    sourceApp,
    fileName,
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
  if (campusId) requireCampusAccess(context, campusId);
  const category = cleanText(url.searchParams.get("category"), 80);
  const recordId = cleanText(url.searchParams.get("recordId"), 120);
  const sourceApp = cleanText(url.searchParams.get("sourceApp"), 80);
  const q = cleanText(url.searchParams.get("q"), 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);

  const conditions = ["fo.organization_id = ?", "fo.deleted_at IS NULL", "fo.category <> 'image-thumbnail'"];
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
  if (sourceApp) {
    conditions.push("fo.source_app = ?");
    bindings.push(sourceApp);
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

  const visible = [];
  for (const row of result.results || []) {
    if (await canReadRegisteredFile(db, context, row)) visible.push({ ...fileRowToResponse(row), metadata:await derivativeMetadata(db, row) });
  }
  return visible;
}

export async function listDeletedDataCoreFiles(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  requireAuthenticatedAccess(context);
  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  if (campusId) requireCampusAccess(context, campusId);
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

  const visible = [];
  for (const row of result.results || []) {
    if (![DERIVATIVE_CATEGORY,THUMBNAIL_CATEGORY].includes(String(row.category)) || await canReadRegisteredFile(db, context, row)) {
      visible.push({...fileRowToResponse(row), metadata:await derivativeMetadata(db, row)});
    }
  }
  return visible;
}

export async function readDataCoreFile(
  db: D1Database,
  files: R2Bucket,
  context: DataCoreAccessContext,
  fileId: string,
  request?: Request,
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
  if (!await canReadRegisteredFile(db, context, row)) {
    throw new DataCoreAccessError(403, "이 파일을 볼 권한이 없습니다.");
  }

  if (row.category === THUMBNAIL_CATEGORY) {
    const source = await thumbnailSource(db,row);
    if (!source || !await files.head(String(source.r2_key))) throw new DataCoreAccessError(404,"원본 파일을 찾을 수 없습니다.");
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
  return privateImageResponse(request, object, headers, String(row.mime_type));
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
  awardFolderId?: string,
  libraryScope = false,
) {
  if (awardFolderId !== undefined) return purgeDataCoreFile(db, files, context, fileId, awardFolderId);
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
  const folder = await libraryUploadTarget(db, context, row.data_record_id as string | null);
  if (libraryScope && row.campus_id) requireCampusAccess(context, String(row.campus_id));
  const director = libraryScope && context.memberships.some(m => m.campusId === row.campus_id && m.role === 'CAMPUS_DIRECTOR');
  if ((!canMutateFileRow(context, row) && !director) || (folder && !libraryCanDelete(context, folder, row.owner_user_id))) {
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
  if (String(row.deleted_at || '').startsWith('purging:')) throw new DataCoreAccessError(409, '파일 삭제 처리 중입니다.');
  if (row.source_app === LIBRARY_SOURCE || row.category === 'hq-workspace') {
    const folder = await libraryUploadTarget(db, context, row.data_record_id as string | null);
    if (!folder) throw new DataCoreAccessError(403, '원본 폴더를 확인할 수 없습니다.');
  }
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
  awardFolderId?: string,
) {
  requireWriteAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "영구 삭제는 마스터 관리자만 할 수 있습니다.");
  }

  const row = await db
    .prepare(
      `SELECT * FROM file_objects
       WHERE id = ? AND organization_id = ?`,
    )
    .bind(fileId, DEFAULT_ORGANIZATION_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, "휴지통에서 파일을 찾을 수 없습니다.");
  if (String(row.deleted_at || '').startsWith('purging:')) throw new DataCoreAccessError(409, '파일 삭제 처리 중입니다.');
  if (awardFolderId !== undefined) {
    if (!awardFolderId || row.data_record_id !== awardFolderId || row.category !== 'competition-material') {
      throw new DataCoreAccessError(403, '선택한 수상작 폴더의 파일만 삭제할 수 있습니다.');
    }
    const campusId = (row.campus_id as string | null) || null;
    if (campusId) requireCampusAccess(context, campusId);
    const folder = await assertRecordLinkAllowed(db, context, awardFolderId, campusId);
    if (folder?.record_type !== 'competition-award-folder' || folder.source_app !== 'competition') {
      throw new DataCoreAccessError(403, '유효한 수상작 폴더가 아닙니다.');
    }
  } else if (!row.deleted_at) {
    throw new DataCoreAccessError(404, '휴지통에서 파일을 찾을 수 없습니다.');
  }

  // A tombstone prevents new normal links/reads while R2 and D1 are reconciled.
  // Include trashed content: restoring a draft must not resurrect a broken reference.
  const assertUnreferenced = async () => {
    const reference = await db.prepare(`SELECT id FROM data_records
      WHERE instr(COALESCE(metadata_json,''), ?) > 0 OR instr(COALESCE(content_text,''), ?) > 0
      UNION ALL SELECT id FROM file_objects WHERE r2_key = ? AND id <> ? LIMIT 1`)
      .bind(fileId, fileId, row.r2_key, fileId).first();
    if (reference) throw new DataCoreAccessError(409, '이 파일은 다른 DATA CORE 자료에서도 사용 중이라 삭제할 수 없습니다.');
    for (const table of ['knowledge_nodes', 'knowledge_edges']) {
      const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
      if (exists && await db.prepare(`SELECT id FROM ${table} WHERE instr(metadata_json, ?) > 0 LIMIT 1`).bind(fileId).first()) {
        throw new DataCoreAccessError(409, '이 파일은 다른 DATA CORE 자료에서도 사용 중이라 삭제할 수 없습니다.');
      }
    }
    const appState = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").first();
    if (appState && await db.prepare('SELECT id FROM app_state WHERE instr(json, ?) > 0 OR instr(json, ?) > 0 LIMIT 1').bind(fileId, row.r2_key).first()) {
      throw new DataCoreAccessError(409, '이 파일은 다른 DATA CORE 자료에서도 사용 중이라 삭제할 수 없습니다.');
    }
    // The legacy admissions bridge can retain file IDs/URLs outside data_records.
    // Stream only the active state object; never deserialize or log admissions records.
    const state = await files.get('state/admissions-data.json');
    if (state) {
      const reader = state.body.getReader(), decoder = new TextDecoder();
      const needles = [fileId, String(row.r2_key), encodeURIComponent(String(row.r2_key))];
      const overlap = Math.max(...needles.map(value => value.length));
      let tail = '';
      try {
        while (true) {
          const chunk = await reader.read();
          const text = tail + decoder.decode(chunk.value, {stream:!chunk.done});
          if (needles.some(value => text.includes(value))) throw new DataCoreAccessError(409, '이 파일은 다른 DATA CORE 자료에서도 사용 중이라 삭제할 수 없습니다.');
          if (chunk.done) break;
          tail = text.slice(-overlap);
        }
      } finally { await reader.cancel(); }
    }
  };
  await assertUnreferenced();
  const key = String(row.r2_key);
  const original = await files.get(key);
  await audit(db, context, 'purge-start', fileId, (row.campus_id as string | null) || null,
    { permanent: true, awardFolderId: awardFolderId || null });
  const marker = `purging:${crypto.randomUUID()}`;
  const claim = await db.prepare('UPDATE file_objects SET deleted_at = ? WHERE id = ? AND deleted_at IS ?').bind(marker, fileId, row.deleted_at || null).run();
  if (Number(claim.meta?.changes) !== 1) throw new DataCoreAccessError(409, '파일 상태가 변경되었습니다. 다시 확인하세요.');
  let objectDeleted = false;
  try {
    await assertUnreferenced();
    await files.delete(key);
    objectDeleted = true;
    await assertUnreferenced();
    await db.batch([
      db.prepare(`INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at)
        VALUES (?,?,?,?,'purge','file_object',?,?,?)`).bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID,
        row.campus_id || null, context.user!.internalUserId, fileId, JSON.stringify({permanent:true}), new Date().toISOString()),
      db.prepare('DELETE FROM file_objects WHERE id = ?').bind(fileId),
    ]);
  } catch (error) {
    // Stream the retained original back on DB failure; never load a 100MB image into memory.
    if (objectDeleted && original) {
      const metadata = original as typeof original & R2PutOptions;
      await files.put(key, original.body, {httpMetadata:metadata.httpMetadata, customMetadata:metadata.customMetadata});
    }
    await db.prepare('UPDATE file_objects SET deleted_at = ? WHERE id = ?').bind(row.deleted_at || null, fileId).run();
    throw error;
  } finally {
    await original?.body.cancel().catch(() => {});
  }
  return { ok: true, id: fileId, permanent: true, purgedAt: new Date().toISOString() };
}

import { DEFAULT_ORGANIZATION_ID as ORG, recordFileObject, type DataCoreFileArea } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { LibraryFolder, LibraryTree, LIBRARY_FOLDER, LIBRARY_SOURCE, requireLibraryWrite } from './data-core-library-policy';

export const SIMPLE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const LIBRARY_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
export const MULTIPART_CHUNK_BYTES = 16 * 1024 * 1024;
export const MULTIPART_CONCURRENCY = 3;
export const LIBRARY_UPLOAD_SESSION = 'library-upload-session';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BLOCKED_EXTENSIONS = new Set(['exe','dll','bat','cmd','com','msi','scr','ps1','vbs','js','mjs','jar']);

type UploadStatus = 'pending' | 'uploading' | 'completed' | 'aborted' | 'failed';
type UploadedPart = { partNumber: number; etag: string };

type SessionMetadata = {
  schemaVersion: 1;
  folderId: string;
  fileId: string;
  r2Key: string;
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  chunkSize: number;
  partCount: number;
  campusId: string | null;
  ownerUserId: string;
  sourceApp: string;
  category: string;
  area: DataCoreFileArea;
  visibility: 'private' | 'campus' | 'organization';
  createdAt: string;
  expiresAt: string;
  status: UploadStatus;
};

type SessionRow = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  created_by_user_id: string | null;
  status: string;
  metadata_json: string;
  deleted_at: string | null;
};

const error = (status: number, message: string): never => { throw new DataCoreAccessError(status, message); };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function extension(name: string) {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf('.');
  return index >= 0 ? normalized.slice(index + 1) : '';
}

function safeFileName(name: string) {
  return name.normalize('NFC').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 140) || 'file';
}

function normalizeMime(value: unknown) {
  const mime = text(value).slice(0, 160);
  return mime && /^[A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+$/.test(mime) ? mime : 'application/octet-stream';
}

function validateFile(fileName: string, sizeBytes: number) {
  if (!fileName || [...fileName].length > 240 || /[\u0000-\u001f]/.test(fileName)) {
    error(400, '파일 이름을 확인해 주세요.');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) error(400, '파일 크기를 확인해 주세요.');
  if (sizeBytes > LIBRARY_MAX_FILE_SIZE_BYTES) error(413, '이 파일은 2GB를 초과해 업로드할 수 없습니다.');
  if (sizeBytes <= SIMPLE_UPLOAD_MAX_BYTES) error(400, '50MiB 이하 파일은 일반 업로드를 사용해 주세요.');
  if (BLOCKED_EXTENSIONS.has(extension(fileName))) error(415, '실행 파일 또는 스크립트 파일은 업로드할 수 없습니다.');
}

function profile(folder: LibraryFolder) {
  if (!folder.category) error(400, '파일을 저장할 폴더를 먼저 선택하세요.');
  const area = (folder.category === 'student-artwork' ? 'student-private' : 'documents-private') as DataCoreFileArea;
  const visibility = (folder.category === 'student-artwork' || folder.shareMode === 'restricted'
    ? 'private' : folder.campusId ? 'campus' : 'organization') as 'private' | 'campus' | 'organization';
  const sourceApp = folder.row?.record_type === LIBRARY_FOLDER ? LIBRARY_SOURCE : 'hq-library';
  return { area, visibility, sourceApp, category: folder.category };
}

function metadata(row: SessionRow): SessionMetadata {
  let value: unknown;
  try { value = JSON.parse(row.metadata_json); } catch { error(409, '업로드 세션 정보를 확인할 수 없습니다.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) error(409, '업로드 세션 정보를 확인할 수 없습니다.');
  return value as SessionMetadata;
}

async function saveStatus(db: D1Database, sessionId: string, current: SessionMetadata, status: UploadStatus) {
  const next = { ...current, status };
  const result = await db.prepare(`UPDATE data_records SET status = ?, metadata_json = ?, updated_at = ?
    WHERE id = ? AND organization_id = ? AND record_type = ? AND source_app = ? AND deleted_at IS NULL`)
    .bind(status, JSON.stringify(next), new Date().toISOString(), sessionId, ORG, LIBRARY_UPLOAD_SESSION, LIBRARY_SOURCE).run();
  if (Number(result.meta?.changes) !== 1) error(409, '업로드 세션 상태가 변경되었습니다.');
  return next;
}

async function loadSession(db: D1Database, tree: LibraryTree, context: DataCoreAccessContext, sessionId: string, allowExpired = false) {
  if (!context.user) error(401, '로그인이 필요합니다.');
  const row = await db.prepare(`SELECT id, organization_id, campus_id, created_by_user_id, status, metadata_json, deleted_at
    FROM data_records WHERE id = ? AND organization_id = ? AND record_type = ? AND source_app = ? AND deleted_at IS NULL`)
    .bind(sessionId, ORG, LIBRARY_UPLOAD_SESSION, LIBRARY_SOURCE).first<SessionRow>();
  if (!row) error(404, '업로드 세션을 찾을 수 없습니다.');
  const current = metadata(row);
  if (current.ownerUserId !== context.user.internalUserId || row.created_by_user_id !== context.user.internalUserId) {
    error(404, '업로드 세션을 찾을 수 없습니다.');
  }
  const folder = await tree.resolve(current.folderId);
  requireLibraryWrite(context, folder);
  if (folder.campusId !== current.campusId || row.campus_id !== current.campusId) error(409, '업로드 폴더 상태가 변경되었습니다.');
  if (!allowExpired && Date.parse(current.expiresAt) <= Date.now() && !['completed','aborted'].includes(current.status)) {
    error(410, '업로드 세션이 만료되었습니다. 파일을 다시 선택해 주세요.');
  }
  return { row, current, folder };
}

async function audit(db: D1Database, context: DataCoreAccessContext, action: string, fileId: string, campusId: string | null, details: Record<string, unknown>) {
  await db.prepare(`INSERT INTO audit_logs
    (id, organization_id, campus_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'file_object', ?, ?, ?)`)
    .bind(crypto.randomUUID(), ORG, campusId, context.user?.internalUserId || null, action, fileId,
      JSON.stringify(details), new Date().toISOString()).run();
}

export async function startLibraryMultipartUpload(
  db: D1Database,
  bucket: R2Bucket,
  context: DataCoreAccessContext,
  folder: LibraryFolder,
  input: Record<string, unknown>,
) {
  if (!context.user) error(401, '로그인이 필요합니다.');
  requireLibraryWrite(context, folder);
  const fileName = typeof input.fileName === 'string' ? input.fileName : '';
  const sizeBytes = Number(input.sizeBytes);
  validateFile(fileName, sizeBytes);
  const mimeType = normalizeMime(input.mimeType);
  const { area, visibility, sourceApp, category } = profile(folder);
  const fileId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const pathCampus = folder.campusId || 'organization';
  const r2Key = ['data-core', area, ORG, pathCampus, category, 'shared', createdAt.slice(0,4),
    `${Date.now()}-${fileId}-${safeFileName(fileName)}`].join('/');
  const upload = await bucket.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      dataCoreFileId: fileId,
      organizationId: ORG,
      campusId: folder.campusId || '',
      sourceApp,
      category,
    },
  });
  const partCount = Math.ceil(sizeBytes / MULTIPART_CHUNK_BYTES);
  const current: SessionMetadata = {
    schemaVersion: 1, folderId: folder.id, fileId, r2Key, uploadId: upload.uploadId, fileName, mimeType, sizeBytes,
    chunkSize: MULTIPART_CHUNK_BYTES, partCount, campusId: folder.campusId, ownerUserId: context.user.internalUserId,
    sourceApp, category, area, visibility, createdAt, expiresAt, status: 'pending',
  };
  try {
    await db.prepare(`INSERT INTO data_records
      (id, organization_id, campus_id, created_by_user_id, record_type, source_app, title, visibility, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'private', 'pending', ?, ?, ?)`)
      .bind(sessionId, ORG, folder.campusId, context.user.internalUserId, LIBRARY_UPLOAD_SESSION, LIBRARY_SOURCE,
        fileName, JSON.stringify(current), createdAt, createdAt).run();
  } catch (cause) {
    try { await upload.abort(); } catch {}
    throw cause;
  }
  return {
    sessionId, fileId, fileName, sizeBytes, mimeType, chunkSize: MULTIPART_CHUNK_BYTES, partCount,
    maxFileSizeBytes: LIBRARY_MAX_FILE_SIZE_BYTES, expiresAt,
  };
}

export async function uploadLibraryMultipartPart(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  tree: LibraryTree,
  context: DataCoreAccessContext,
  sessionId: string,
  partNumber: number,
) {
  const { current } = await loadSession(db, tree, context, sessionId);
  if (current.status === 'completed') error(409, '이미 완료된 업로드입니다.');
  if (current.status === 'aborted') error(409, '취소된 업로드입니다.');
  if (current.status === 'failed') error(409, '실패한 업로드 세션입니다. 파일 업로드를 다시 시작해 주세요.');
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > current.partCount) error(400, '업로드 조각 번호를 확인해 주세요.');
  const expected = partNumber === current.partCount
    ? current.sizeBytes - current.chunkSize * (current.partCount - 1)
    : current.chunkSize;
  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) !== expected) error(400, '업로드 조각 크기가 올바르지 않습니다.');
  let bytes: ArrayBuffer;
  try { bytes = await request.arrayBuffer(); }
  catch { error(400, '업로드 조각 데이터를 읽을 수 없습니다.'); }
  if (bytes.byteLength !== expected) error(400, '업로드 조각 크기가 올바르지 않습니다.');
  if (current.status === 'pending') await saveStatus(db, sessionId, current, 'uploading');
  try {
    const upload = bucket.resumeMultipartUpload(current.r2Key, current.uploadId);
    const part = await upload.uploadPart(partNumber, bytes);
    return { partNumber: part.partNumber, etag: part.etag, sizeBytes: expected };
  } catch (cause) {
    if (cause instanceof DataCoreAccessError) throw cause;
    throw new DataCoreAccessError(502, `업로드 조각 ${partNumber} 저장에 실패했습니다.`);
  }
}

export async function completeLibraryMultipartUpload(
  db: D1Database,
  bucket: R2Bucket,
  tree: LibraryTree,
  context: DataCoreAccessContext,
  sessionId: string,
  parts: UploadedPart[],
) {
  const { current, folder } = await loadSession(db, tree, context, sessionId);
  if (current.status === 'completed') error(409, '이미 완료된 업로드입니다.');
  if (current.status === 'aborted') error(409, '취소된 업로드입니다.');
  if (current.status === 'failed') error(409, '실패한 업로드 세션입니다. 파일 업로드를 다시 시작해 주세요.');
  if (!Array.isArray(parts) || parts.length !== current.partCount) error(400, '업로드 조각 목록을 확인해 주세요.');
  const normalized = parts.map(part => ({ partNumber: Number(part?.partNumber), etag: text(part?.etag) }))
    .sort((a,b) => a.partNumber - b.partNumber);
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].partNumber !== i + 1 || !normalized[i].etag) error(400, '업로드 조각 목록이 연속적이지 않습니다.');
  }

  let completed = false;
  try {
    const upload = bucket.resumeMultipartUpload(current.r2Key, current.uploadId);
    await upload.complete(normalized);
    completed = true;
    const object = await bucket.head(current.r2Key);
    if (!object || object.size !== current.sizeBytes) {
      await bucket.delete(current.r2Key);
      await saveStatus(db, sessionId, current, 'failed');
      error(502, 'R2 파일 크기 검증에 실패했습니다. 다시 업로드해 주세요.');
    }
    await recordFileObject(db, {
      id: current.fileId,
      organizationId: ORG,
      campusId: current.campusId,
      dataRecordId: folder.id,
      ownerUserId: context.user!.internalUserId,
      sourceApp: current.sourceApp,
      area: current.area,
      category: current.category,
      r2Key: current.r2Key,
      originalFileName: current.fileName,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      visibility: current.visibility,
      createdAt: current.createdAt,
    });
    await audit(db, context, 'upload', current.fileId, current.campusId, {
      area: current.area, category: current.category, sourceApp: current.sourceApp, recordId: folder.id,
      sizeBytes: current.sizeBytes, multipart: true, partCount: current.partCount, chunkSize: current.chunkSize,
    });
    await saveStatus(db, sessionId, current, 'completed');
  } catch (cause) {
    if (completed) {
      await bucket.delete(current.r2Key);
      await db.prepare('DELETE FROM file_objects WHERE id = ? AND organization_id = ?').bind(current.fileId, ORG).run();
    } else {
      try { await bucket.resumeMultipartUpload(current.r2Key, current.uploadId).abort(); } catch {}
    }
    try { await saveStatus(db, sessionId, current, 'failed'); } catch {}
    if (cause instanceof DataCoreAccessError) throw cause;
    throw new DataCoreAccessError(502, 'R2 업로드 완료 처리에 실패했습니다.');
  }
  return {
    file: {
      id: current.fileId,
      campusId: current.campusId,
      recordId: folder.id,
      area: current.area,
      category: current.category,
      sourceApp: current.sourceApp,
      fileName: current.fileName,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      visibility: current.visibility,
      previewUrl: `/api/data-core/library/files/${encodeURIComponent(current.fileId)}`,
      downloadUrl: `/api/data-core/library/files/${encodeURIComponent(current.fileId)}/download`,
      createdAt: current.createdAt,
    },
  };
}

export async function abortLibraryMultipartUpload(
  db: D1Database,
  bucket: R2Bucket,
  tree: LibraryTree,
  context: DataCoreAccessContext,
  sessionId: string,
) {
  const { current } = await loadSession(db, tree, context, sessionId, true);
  if (current.status === 'completed') error(409, '완료된 파일은 업로드 취소할 수 없습니다.');
  if (current.status === 'aborted') return { ok: true, sessionId };
  try {
    await bucket.resumeMultipartUpload(current.r2Key, current.uploadId).abort();
  } catch {
    // R2 may already have discarded the multipart session. The business file was never registered.
  }
  await saveStatus(db, sessionId, current, 'aborted');
  return { ok: true, sessionId };
}

export function parseUploadedParts(value: unknown): UploadedPart[] {
  if (!Array.isArray(value)) error(400, '업로드 조각 목록을 확인해 주세요.');
  return value as UploadedPart[];
}

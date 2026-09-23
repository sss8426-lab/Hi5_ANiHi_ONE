import { DEFAULT_ORGANIZATION_ID as ORG, recordFileObject } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireCampusAccess } from './data-core-access';
import { canonicalCampusId } from './campus-directory';
import { canReadRegisteredFile } from './data-core-derivative-policy';

export const CUSTOM_LOGO_CATEGORY = 'instagram-custom-logo';
export const CUSTOM_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const PAGE_SIZE = 30;

function scopedCampusId(context: DataCoreAccessContext, campusId: unknown) {
  const id = canonicalCampusId(campusId);
  if (!id) throw new DataCoreAccessError(400, '캠퍼스를 선택하세요.');
  requireCampusAccess(context, id);
  return id;
}

// Names are what people search by; LIKE wildcards typed by the user are matched literally.
const nameFilter = (q: unknown) => {
  const text = typeof q === 'string' ? q.trim().slice(0, 60) : '';
  return text ? '%' + text.replace(/[\\%_]/g, c => '\\' + c) + '%' : null;
};
// Names are shown as plain text; control characters (tabs, newlines…) are dropped.
const cleanName = (name: unknown) => Array.from(String(name ?? '')).filter(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join('').trim().slice(0, 120);

export async function listCustomLogos(db: D1Database, context: DataCoreAccessContext, campusId: unknown, cursor: unknown, q: unknown = '') {
  const id = scopedCampusId(context, campusId);
  const before = typeof cursor === 'string' && cursor ? cursor : null;
  const like = nameFilter(q);
  const row = before ? await db.prepare('SELECT created_at, id FROM file_objects WHERE id=? AND organization_id=? AND campus_id=? AND category=?')
    .bind(before, ORG, id, CUSTOM_LOGO_CATEGORY).first<{ created_at: string; id: string }>() : null;
  const where = `organization_id=? AND campus_id=? AND category=? AND deleted_at IS NULL${like ? " AND original_file_name LIKE ? ESCAPE '\\'" : ''}`;
  const args: unknown[] = [ORG, id, CUSTOM_LOGO_CATEGORY, ...(like ? [like] : [])];
  const statement = before && row
    ? db.prepare(`SELECT id, original_file_name, mime_type, size_bytes, created_at FROM file_objects
        WHERE ${where} AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(...args, row.created_at, row.created_at, row.id, PAGE_SIZE + 1)
    : db.prepare(`SELECT id, original_file_name, mime_type, size_bytes, created_at FROM file_objects
        WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(...args, PAGE_SIZE + 1);
  const rows = await statement.all<{ id: string; original_file_name: string; mime_type: string; size_bytes: number; created_at: string }>();
  const list = rows.results || [];
  const hasMore = list.length > PAGE_SIZE;
  const page = hasMore ? list.slice(0, PAGE_SIZE) : list;
  return {
    logos: page.map(r => ({ id: r.id, name: r.original_file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function uploadCustomLogo(db: D1Database, files: R2Bucket, context: DataCoreAccessContext, campusId: unknown, name: unknown, mime: unknown, bytes: Uint8Array) {
  const id = scopedCampusId(context, campusId);
  const extension = ALLOWED_MIME[String(mime)];
  if (!extension) throw new DataCoreAccessError(415, 'PNG, JPG, WEBP 이미지만 로고로 올릴 수 있습니다.');
  if (!bytes.length || bytes.length > CUSTOM_LOGO_MAX_BYTES) throw new DataCoreAccessError(413, '로고 이미지는 5MB 이하로 올려주세요.');
  const fileName = cleanName(name) || '이미지';
  const fileId = crypto.randomUUID(), now = new Date().toISOString();
  const key = `data-core/academy-public/${ORG}/${CUSTOM_LOGO_CATEGORY}/${fileId}.${extension}`;
  await files.put(key, bytes, { httpMetadata: { contentType: String(mime) } });
  try {
    await recordFileObject(db, {
      id: fileId, organizationId: ORG, campusId: id, ownerUserId: context.user!.internalUserId,
      sourceApp: 'instagram', area: 'academy-public', category: CUSTOM_LOGO_CATEGORY,
      r2Key: key, originalFileName: fileName, mimeType: String(mime), sizeBytes: bytes.length,
      visibility: 'campus', createdAt: now,
    });
  } catch (error) {
    await files.delete(key).catch(() => {});
    throw error;
  }
  return { id: fileId, name: fileName, mimeType: String(mime), sizeBytes: bytes.length, createdAt: now };
}

export async function deleteCustomLogo(db: D1Database, context: DataCoreAccessContext, id: unknown) {
  if (typeof id !== 'string' || !id) throw new DataCoreAccessError(400, '삭제할 로고를 확인하세요.');
  const row = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND category=? AND deleted_at IS NULL')
    .bind(id, ORG, CUSTOM_LOGO_CATEGORY).first<Record<string, unknown>>();
  if (!row) throw new DataCoreAccessError(404, '로고를 찾을 수 없습니다.');
  requireCampusAccess(context, String(row.campus_id || ''));
  // Deletion only ever hides this one row — it must never cascade to a completed image that already
  // composited this logo (that render is a separate, independent file_objects row).
  await db.prepare('UPDATE file_objects SET deleted_at=? WHERE id=?').bind(new Date().toISOString(), id).run();
}

export async function renameCustomLogo(db: D1Database, context: DataCoreAccessContext, id: unknown, name: unknown) {
  const fileName = cleanName(name);
  if (typeof id !== 'string' || !id) throw new DataCoreAccessError(400, '이름을 바꿀 이미지를 확인하세요.');
  if (!fileName) throw new DataCoreAccessError(400, '이미지 이름을 입력하세요.');
  const row = await db.prepare('SELECT campus_id FROM file_objects WHERE id=? AND organization_id=? AND category=? AND deleted_at IS NULL')
    .bind(id, ORG, CUSTOM_LOGO_CATEGORY).first<{ campus_id: string | null }>();
  if (!row) throw new DataCoreAccessError(404, '이미지를 찾을 수 없습니다.');
  requireCampusAccess(context, String(row.campus_id || ''));
  // Only the label changes; the stored pixels (and every composite already made from them) stay as they are.
  await db.prepare('UPDATE file_objects SET original_file_name=? WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(fileName, id, ORG).run();
  return { id, name: fileName };
}

/** Verify a referenced user image is still readable by this user before it is drawn or saved into a
 * render, without assuming the campusId on the request matches (callers compare campus themselves). */
export async function resolveCustomLogo(db: D1Database, context: DataCoreAccessContext, id: string) {
  const row = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND category=? AND deleted_at IS NULL')
    .bind(id, ORG, CUSTOM_LOGO_CATEGORY).first<Record<string, unknown>>();
  if (!row || !await canReadRegisteredFile(db, context, row)) return null;
  return row;
}

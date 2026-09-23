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

export async function listCustomLogos(db: D1Database, context: DataCoreAccessContext, campusId: unknown, cursor: unknown) {
  const id = scopedCampusId(context, campusId);
  const before = typeof cursor === 'string' && cursor ? cursor : null;
  const row = before ? await db.prepare('SELECT created_at, id FROM file_objects WHERE id=? AND organization_id=? AND campus_id=? AND category=? AND deleted_at IS NULL')
    .bind(before, ORG, id, CUSTOM_LOGO_CATEGORY).first<{ created_at: string; id: string }>() : null;
  const statement = before && row
    ? db.prepare(`SELECT id, original_file_name, mime_type, size_bytes, created_at FROM file_objects
        WHERE organization_id=? AND campus_id=? AND category=? AND deleted_at IS NULL
        AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(ORG, id, CUSTOM_LOGO_CATEGORY, row.created_at, row.created_at, row.id, PAGE_SIZE + 1)
    : db.prepare(`SELECT id, original_file_name, mime_type, size_bytes, created_at FROM file_objects
        WHERE organization_id=? AND campus_id=? AND category=? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(ORG, id, CUSTOM_LOGO_CATEGORY, PAGE_SIZE + 1);
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
  const fileName = String(name || '로고').trim().slice(0, 120) || '로고';
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

/** For instagram-layout.js's compositor: verify the referenced custom logo is still readable by this
 * user before drawing it, without assuming the campusId on the request matches (campus admins may
 * reuse a logo saved under their own campus only). */
export async function resolveCustomLogo(db: D1Database, context: DataCoreAccessContext, id: string) {
  const row = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND category=? AND deleted_at IS NULL')
    .bind(id, ORG, CUSTOM_LOGO_CATEGORY).first<Record<string, unknown>>();
  if (!row || !await canReadRegisteredFile(db, context, row)) return null;
  return row;
}

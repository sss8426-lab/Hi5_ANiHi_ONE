import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, isCampusAdmin, managesCampus } from './data-core-access';
import { PRIVATE_IMAGE_MIMES } from './private-image-response';
import { curriculumFile, curriculumFileReadable } from './data-core-curriculum';

export const DERIVATIVE_RECORD_TYPE = 'instagram-derived-file';
export const DERIVATIVE_CATEGORY = 'instagram-derived';
export const THUMBNAIL_RECORD_TYPE = 'image-thumbnail';
export const THUMBNAIL_CATEGORY = 'image-thumbnail';
export function assertMutableRecordType(type: unknown) {
  if ([DERIVATIVE_RECORD_TYPE, THUMBNAIL_RECORD_TYPE,'admissions-legacy-thumbnail'].includes(String(type).trim())) throw new DataCoreAccessError(403, '파생 이미지 원본 관계는 변경할 수 없습니다.');
}

export function validThumbnail(row: Record<string, any>, metadata: any, source: Record<string, any>) {
  return row.category === THUMBNAIL_CATEGORY && row.source_app === 'data-core-thumbnail' && row.mime_type === 'image/webp' &&
    row.area === 'documents-private' && metadata?.schemaVersion === 1 && metadata.derivativeType === 'thumbnail' &&
    metadata.derivativeFileId === row.id && metadata.derivedFromFileId === source.id && metadata.createdBy === 'library-upload' &&
    metadata.format === 'webp' && Number.isInteger(metadata.width) && Number.isInteger(metadata.height) &&
    metadata.width > 0 && metadata.height > 0 && Math.max(metadata.width,metadata.height) <= 480 &&
    source.organization_id === DEFAULT_ORGANIZATION_ID && source.organization_id === row.organization_id &&
    source.campus_id === row.campus_id && source.owner_user_id === row.owner_user_id && source.visibility === row.visibility &&
    !source.deleted_at && PRIVATE_IMAGE_MIMES.has(source.mime_type) && ![DERIVATIVE_CATEGORY,THUMBNAIL_CATEGORY].includes(source.category);
}

export async function thumbnailSource(db: D1Database, row: Record<string, unknown>) {
  if (typeof row.data_record_id !== 'string') return null;
  const record = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL')
    .bind(row.data_record_id,DEFAULT_ORGANIZATION_ID,THUMBNAIL_RECORD_TYPE).first<{metadata_json:string}>();
  let m;try { m=JSON.parse(record?.metadata_json || 'null'); } catch { return null; }
  if (!m || typeof m.derivedFromFileId !== 'string') return null;
  const source=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL')
    .bind(m.derivedFromFileId,DEFAULT_ORGANIZATION_ID).first<Record<string,any>>();
  return source && validThumbnail(row,m,source) ? source : null;
}

export function canReadBaseFile(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (!context.user || !context.memberships.length) return false;
  if (isCampusAdmin(context) && row.campus_id) return managesCampus(context, row.campus_id);
  if (row.visibility === 'organization' || row.visibility === 'public') return true;
  if (row.visibility === 'campus') return typeof row.campus_id === 'string' && context.campusIds.includes(row.campus_id);
  return context.user.internalUserId === row.owner_user_id;
}

export async function derivativeMetadata(db: D1Database, row: Record<string, unknown>) {
  if (row.category !== DERIVATIVE_CATEGORY || typeof row.data_record_id !== 'string') return null;
  const record = await db.prepare(`SELECT metadata_json FROM data_records WHERE id = ? AND organization_id = ?
    AND record_type = ? AND deleted_at IS NULL`).bind(row.data_record_id, DEFAULT_ORGANIZATION_ID, DERIVATIVE_RECORD_TYPE)
    .first<{ metadata_json: string }>();
  try {
    const value = JSON.parse(record?.metadata_json || 'null');
    if (value?.schemaVersion !== 1 || value.derivativeFileId !== row.id || typeof value.derivedFromFileId !== 'string'
      || value.derivativeType !== 'instagram-4x5' || value.width !== 2160 || value.height !== 2700
      || value.aspectRatio !== '4:5' || value.createdBy !== 'instagram-editor') return null;
    return value as {schemaVersion:number; derivativeFileId:string; derivedFromFileId:string; derivativeType:string;
      width:number; height:number; aspectRatio:string; createdBy:string};
  } catch { return null; }
}

export async function canReadRegisteredFile(db: D1Database, context: DataCoreAccessContext, row: Record<string, unknown>): Promise<boolean> {
  if (curriculumFile(row)) return curriculumFileReadable(db, context, row);
  // This derivative is served only after resolving the live legacy student/slot.
  if(row.category==='admissions-legacy-thumbnail')return false;
  if (!canReadBaseFile(context, row)) return false;
  if (row.category === THUMBNAIL_CATEGORY) {
    const source=await thumbnailSource(db,row);
    return Boolean(source && await canReadRegisteredFile(db,context,source));
  }
  if (row.source_app === 'data-core-library' || row.category === 'hq-workspace') {
    if (!row.data_record_id) return false;
    const { LibraryTree, LIBRARY_FOLDER, HQ_FOLDER, libraryFileReadable } = await import('./data-core-library-policy');
    const tree = await new LibraryTree(db, context).init();
    const record = await tree.row(String(row.data_record_id));
    if (!record || ![LIBRARY_FOLDER, HQ_FOLDER].includes(record.record_type)) return false;
    if (record && [LIBRARY_FOLDER, HQ_FOLDER].includes(record.record_type)) {
      try { if (!libraryFileReadable(context, await tree.resolve(record.id), row)) return false; }
      catch (e) { if (e instanceof DataCoreAccessError) return false; throw e; }
    }
  }
  if (row.category !== DERIVATIVE_CATEGORY) return true;
  const metadata = await derivativeMetadata(db, row);
  if (!metadata) return false;
  const source = await db.prepare(`SELECT * FROM file_objects WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`)
    .bind(metadata.derivedFromFileId, DEFAULT_ORGANIZATION_ID).first<Record<string, unknown>>();
  // One-hop immutable provenance: no chains, cycles, stale campus grants, or deleted-source bypass.
  return Boolean(source && ![DERIVATIVE_CATEGORY,THUMBNAIL_CATEGORY].includes(String(source.category)) && source.campus_id === row.campus_id
    && await canReadRegisteredFile(db, context, source) && (context.isSuperAdmin || !source.campus_id || context.campusIds.includes(String(source.campus_id))));
}

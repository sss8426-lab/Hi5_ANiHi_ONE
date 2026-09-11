import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';

export const DERIVATIVE_RECORD_TYPE = 'instagram-derived-file';
export const DERIVATIVE_CATEGORY = 'instagram-derived';
export function assertMutableRecordType(type: unknown) {
  if (type === DERIVATIVE_RECORD_TYPE) throw new DataCoreAccessError(403, '파생 이미지 원본 관계는 변경할 수 없습니다.');
}

export function canReadBaseFile(context: DataCoreAccessContext, row: Record<string, unknown>) {
  if (context.isSuperAdmin) return true;
  if (!context.user || !context.memberships.length) return false;
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
  if (!canReadBaseFile(context, row)) return false;
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
  return Boolean(source && source.category !== DERIVATIVE_CATEGORY && source.campus_id === row.campus_id
    && await canReadRegisteredFile(db, context, source) && (context.isSuperAdmin || !source.campus_id || context.campusIds.includes(String(source.campus_id))));
}

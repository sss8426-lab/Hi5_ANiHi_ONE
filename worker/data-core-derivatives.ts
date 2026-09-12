import { decode, hasPngSignature } from 'fast-png';
import { inflateSync } from 'node:zlib';
import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { ensureDataCoreMigrations } from './data-core-migrations';
import { DataCoreAccessContext, DataCoreAccessError, requireCampusAccess, requireWriteAccess } from './data-core-access';
import { canReadRegisteredFile, DERIVATIVE_CATEGORY, DERIVATIVE_RECORD_TYPE } from './data-core-derivative-policy';

const MAX_BYTES = 8 * 1024 * 1024;
export async function boundedDerivativeForm(request: Request, maxBytes = MAX_BYTES) {
  const limit = maxBytes + 65536;
  const message = maxBytes === MAX_BYTES ? '파생 이미지는 8MB 이하여야 합니다.' : '썸네일은 256KB 이하여야 합니다.';
  if (Number(request.headers.get('content-length')) > limit) throw new DataCoreAccessError(413, message);
  if (!request.body) throw new DataCoreAccessError(400, '파생 이미지 파일이 필요합니다.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new DataCoreAccessError(413, message); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData(); }
  catch { throw new DataCoreAccessError(400, '파생 이미지 요청 형식이 올바르지 않습니다.'); }
}
function validateOutput(bytes: Uint8Array) {
  try {
    if (!hasPngSignature(bytes) || bytes.length < 45) throw new Error();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== 2160
      || view.getUint32(20) !== 2700 || bytes[24] !== 8 || ![2, 6].includes(bytes[25])
      || bytes[26] || bytes[27] || bytes[28]) throw new Error();
    const chunks: Uint8Array[] = [];
    let offset = 8, count = 0, ended = false;
    while (offset < bytes.length) {
      if (++count > 1024 || offset + 12 > bytes.length) throw new Error();
      const size = view.getUint32(offset), type = view.getUint32(offset + 4);
      if (offset + size + 12 > bytes.length) throw new Error();
      if (type === 0x49444154) chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
      else if (type === 0x49484452) { if (offset !== 8) throw new Error(); }
      else if (type === 0x49454e44) { if (size || offset + 12 !== bytes.length) throw new Error(); ended = true; }
      else if (![0x73524742, 0x70485973, 0x67414d41, 0x6348524d].includes(type)) throw new Error();
      offset += size + 12;
    }
    if (!ended || !chunks.length) throw new Error();
    const channels = bytes[25] === 6 ? 4 : 3;
    const expected = (2160 * channels + 1) * 2700;
    // Bound decompression before the established decoder allocates its pixel buffer.
    if (inflateSync(Buffer.concat(chunks), { maxOutputLength: expected }).length !== expected) throw new Error();
    const image = decode(bytes, { checkCrc: true });
    if (image.width !== 2160 || image.height !== 2700) throw new Error();
  } catch { throw new DataCoreAccessError(400, '2160 x 2700 크기의 올바른 PNG 이미지만 저장할 수 있습니다.'); }
}

export async function createInstagramDerivative(request: Request, db: D1Database, files: R2Bucket, context: DataCoreAccessContext) {
  requireWriteAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, '로그인이 필요합니다.');
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new DataCoreAccessError(403, '같은 사이트에서만 파생 이미지를 저장할 수 있습니다.');
  }
  await ensureDataCoreMigrations(db);
  const form = await boundedDerivativeForm(request);
  const sourceId = String(form.get('derivedFromFileId') || '');
  if (!sourceId || sourceId.length > 120) throw new DataCoreAccessError(400, '원본 파일을 선택하세요.');
  const source = await db.prepare(`SELECT * FROM file_objects WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`)
    .bind(sourceId, DEFAULT_ORGANIZATION_ID).first<Record<string, unknown>>();
  if (!source) throw new DataCoreAccessError(404, '원본 파일을 찾을 수 없습니다.');
  if (source.campus_id) requireCampusAccess(context, String(source.campus_id));
  if (!await canReadRegisteredFile(db, context, source)) throw new DataCoreAccessError(403, '원본 이미지를 사용할 권한이 없습니다.');
  if (source.category === DERIVATIVE_CATEGORY || !['image/jpeg', 'image/png', 'image/webp'].includes(String(source.mime_type))) {
    throw new DataCoreAccessError(415, 'JPEG, PNG, WebP 원본 이미지를 선택하세요.');
  }
  const sourceObject = await files.head(String(source.r2_key));
  if (!sourceObject) throw new DataCoreAccessError(404, '원본 이미지가 없습니다.');
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'image/png' || !file.size || file.size > MAX_BYTES) {
    throw new DataCoreAccessError(400, '8MB 이하의 PNG 파생 이미지가 필요합니다.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateOutput(bytes);
  return persistImageDerivative(db, files, context, source, bytes, {
    category: DERIVATIVE_CATEGORY, recordType: DERIVATIVE_RECORD_TYPE, sourceApp: 'instagram', mime: 'image/png', extension: 'png',
    metadata: { derivativeType:'instagram-4x5', width:2160, height:2700, aspectRatio:'4:5', createdBy:'instagram-editor' },
  }, current => canReadRegisteredFile(db, context, current));
}

export async function persistImageDerivative(db: D1Database, files: R2Bucket, context: DataCoreAccessContext,
  source: Record<string, any>, bytes: Uint8Array,
  output: { category:string; recordType:string; sourceApp:string; mime:string; extension:string; metadata:Record<string,unknown>; recordId?:string },
  canStillRead: (current:Record<string,any>) => Promise<boolean>) {
  const sourceId = source.id;
  const id = crypto.randomUUID(), recordId = output.recordId || `file-derivative:${id}`, now = new Date().toISOString();
  const metadata = { ...output.metadata, schemaVersion:1, derivedFromFileId:sourceId, derivativeFileId:id };
  const key = `data-core/documents-private/${DEFAULT_ORGANIZATION_ID}/${output.category}/${id}.${output.extension}`;
  const name = `${output.sourceApp}-${id}.${output.extension}`;
  // The object key is new; only these new rows may be compensated on a failed write.
  await files.put(key, bytes, { httpMetadata:{contentType:output.mime} });
  try {
    const current = await db.prepare(`SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL`)
      .bind(sourceId, DEFAULT_ORGANIZATION_ID).first<Record<string, unknown>>();
    if (!current || current.campus_id !== source.campus_id || current.owner_user_id !== source.owner_user_id
      || current.visibility !== source.visibility || current.data_record_id !== source.data_record_id
      || current.category !== source.category || current.r2_key !== source.r2_key || !await canStillRead(current)) {
      throw new DataCoreAccessError(409, '원본 권한이 변경되었습니다. 원본을 다시 선택하세요.');
    }
    await db.batch([
      db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'private','active',?,?,?)`).bind(recordId,DEFAULT_ORGANIZATION_ID,source.campus_id,
          context.user!.internalUserId,output.recordType,output.sourceApp,name,JSON.stringify(metadata),now,now),
      db.prepare(`INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
        VALUES (?,?,?,?,?,'documents-private',?,?,?,?,?,?,?,?)`).bind(id,DEFAULT_ORGANIZATION_ID,source.campus_id,
          recordId,source.owner_user_id,output.category,output.sourceApp,key,name,output.mime,bytes.length,source.visibility,now),
      db.prepare(`INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at)
        VALUES (?,?,?,?,'derive','file_object',?,?,?)`).bind(crypto.randomUUID(),DEFAULT_ORGANIZATION_ID,source.campus_id,
          context.user!.internalUserId,id,JSON.stringify({derivedFromFileId:sourceId}),now),
    ]);
  } catch (error) {
    // A transport failure may follow a committed batch. Never remove a committed object's bytes.
    const committed = await db.prepare('SELECT id FROM file_objects WHERE id = ?').bind(id).first();
    if (!committed) await files.delete(key);
    throw error;
  }
  return {id,campusId:source.campus_id,sourceApp:output.sourceApp,category:output.category,fileName:name,mimeType:output.mime,
    sizeBytes:bytes.length,visibility:source.visibility,metadata,downloadUrl:`/api/data-core/files/${id}`,createdAt:now};
}

import { WEBP } from 'image-size/types/webp';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { boundedDerivativeForm, persistImageDerivative } from './data-core-derivatives';
import { DERIVATIVE_CATEGORY, THUMBNAIL_CATEGORY, THUMBNAIL_RECORD_TYPE, validThumbnail } from './data-core-derivative-policy';
import { PRIVATE_IMAGE_MIMES } from './private-image-response';

const MAX_BYTES = 256 * 1024;

// Sources have already passed the caller's current authorization. Returned files still recheck it on GET.
export async function thumbnailUrls(db:D1Database, sources:Record<string,any>[], prefix='/api/data-core/files/') {
  const urls=new Map<string,string>(), byId=new Map(sources.filter(s=>PRIVATE_IMAGE_MIMES.has(s.mime_type)).map(s=>[s.id,s]));
  const values=[...byId.values()];
  for(let offset=0;offset<values.length;offset+=50){
    const batch=values.slice(offset,offset+50), org=batch[0].organization_id;
    const rows=(await db.prepare(`SELECT fo.*, dr.metadata_json FROM file_objects fo JOIN data_records dr ON dr.id=fo.data_record_id
      WHERE fo.organization_id=? AND dr.organization_id=? AND fo.category=? AND dr.record_type=?
      AND fo.deleted_at IS NULL AND dr.deleted_at IS NULL
      AND CASE WHEN json_valid(dr.metadata_json) THEN json_extract(dr.metadata_json,'$.derivedFromFileId') END
      IN (${batch.map(()=>'?').join(',')}) ORDER BY fo.created_at DESC, fo.id`)
      .bind(org,org,THUMBNAIL_CATEGORY,THUMBNAIL_RECORD_TYPE,...batch.map(s=>s.id)).all<Record<string,any>>()).results||[];
    for(const row of rows){
      let metadata;try{metadata=JSON.parse(row.metadata_json);}catch{continue;}
      const source=byId.get(metadata?.derivedFromFileId);
      if(source&&!urls.has(source.id)&&validThumbnail(row,metadata,source))urls.set(source.id,`${prefix}${encodeURIComponent(row.id)}`);
    }
  }
  return urls;
}

export function thumbnailDimensions(bytes: Uint8Array) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 30 || !WEBP.validate(bytes) || view.getUint32(4,true) + 8 !== bytes.length) throw new Error();
    // A bounded, single-frame WebP container. Dimensions use the existing image-size parser,
    // not client metadata. This is header validation, not a pixel decoder.
    let offset = 12, frames = 0, frameDimensions;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error();
      const type = String.fromCharCode(...bytes.subarray(offset,offset+4)), size = view.getUint32(offset+4,true);
      if (!['VP8X','ICCP','ALPH','VP8 ','VP8L'].includes(type) || !size || offset+8+size > bytes.length) throw new Error();
      if (type === 'ICCP' && size > 16384) throw new Error();
      if (type === 'VP8X' && (offset !== 12 || size !== 10 || bytes[offset+8] & 0x02)) throw new Error();
      if (type === 'VP8 ' || type === 'VP8L') {
        frames++;
        const frame=new Uint8Array(12+8+size+(size%2));frame.set(bytes.subarray(0,12));frame.set(bytes.subarray(offset,offset+8+size+(size%2)),12);
        frameDimensions=WEBP.calculate(frame);
      }
      offset += 8 + size + (size % 2);
    }
    const dimensions = WEBP.calculate(bytes);
    if (offset !== bytes.length || frames !== 1 || !dimensions || !dimensions.width || !dimensions.height ||
      Math.max(dimensions.width,dimensions.height) > 480 || dimensions.width !== frameDimensions?.width || dimensions.height !== frameDimensions?.height) throw new Error();
    return dimensions;
  } catch { throw new DataCoreAccessError(400,'긴 변 480px 이하의 올바른 WebP 썸네일이 필요합니다.'); }
}

export async function thumbnailInput(request:Request) {
  const form=await boundedDerivativeForm(request,MAX_BYTES), file=form.get('file');
  if (!(file instanceof File) || file.type!=='image/webp' || !file.size || file.size>MAX_BYTES) {
    throw new DataCoreAccessError(400,'256KB 이하의 WebP 썸네일이 필요합니다.');
  }
  const bytes=new Uint8Array(await file.arrayBuffer());
  return {bytes,...thumbnailDimensions(bytes)};
}

export async function existingThumbnail(db:D1Database, source:Record<string,unknown>) {
  const {validThumbnail}=await import('./data-core-derivative-policy');
  const rows=(await db.prepare(`SELECT fo.*, dr.metadata_json FROM file_objects fo JOIN data_records dr ON dr.id=fo.data_record_id
    WHERE fo.organization_id=? AND dr.organization_id=? AND fo.category=? AND dr.record_type=?
    AND fo.deleted_at IS NULL AND dr.deleted_at IS NULL
    AND CASE WHEN json_valid(dr.metadata_json) THEN json_extract(dr.metadata_json,'$.derivedFromFileId') END=?
    ORDER BY fo.created_at,fo.id`).bind(source.organization_id,source.organization_id,THUMBNAIL_CATEGORY,THUMBNAIL_RECORD_TYPE,source.id).all<Record<string,unknown>>()).results||[];
  for(const row of rows) {
    let metadata;try{metadata=JSON.parse(String(row.metadata_json));}catch{continue;}
    if(validThumbnail(row,metadata,source))return {row,metadata};
  }
  return null;
}

export async function createLibraryThumbnail(request:Request, db:D1Database, bucket:R2Bucket, context:DataCoreAccessContext,
  source:Record<string,any>, canStillRead:(row:Record<string,any>)=>Promise<boolean>) {
  if (!PRIVATE_IMAGE_MIMES.has(source.mime_type) || [DERIVATIVE_CATEGORY,THUMBNAIL_CATEGORY].includes(source.category)) {
    throw new DataCoreAccessError(415,'원본 이미지에만 썸네일을 만들 수 있습니다.');
  }
  if (!await bucket.head(source.r2_key)) throw new DataCoreAccessError(404,'원본 파일을 찾을 수 없습니다.');
  const {bytes,width,height}=await thumbnailInput(request);
  const reuse=async()=>{
    const found=await existingThumbnail(db,source);
    if(!found || !await canStillRead(source) || !await bucket.head(String(found.row.r2_key)))return null;
    return {id:found.row.id,metadata:found.metadata,downloadUrl:`/api/data-core/files/${found.row.id}`,reused:true};
  };
  const existing=await reuse();if(existing)return existing;
  const previous=await db.prepare(`SELECT fo.id FROM file_objects fo JOIN data_records dr ON dr.id=fo.data_record_id
    WHERE fo.organization_id=? AND dr.record_type=? AND (fo.deleted_at IS NOT NULL OR dr.deleted_at IS NOT NULL)
    AND CASE WHEN json_valid(dr.metadata_json) THEN json_extract(dr.metadata_json,'$.derivedFromFileId') END=?
    ORDER BY fo.created_at DESC,fo.id DESC LIMIT 1`).bind(source.organization_id,THUMBNAIL_RECORD_TYPE,source.id).first<{id:string}>();
  try {return await persistImageDerivative(db,bucket,context,source,bytes,{
    category:THUMBNAIL_CATEGORY, recordType:THUMBNAIL_RECORD_TYPE, sourceApp:'data-core-thumbnail', mime:'image/webp',extension:'webp',
    recordId:`thumbnail-source:${source.id}:${previous?.id||'first'}`,
    metadata:{derivativeType:'thumbnail',width,height,format:'webp',createdBy:'library-upload',generatedAt:new Date().toISOString()},
  },canStillRead);}catch(error){const concurrent=await reuse();if(concurrent)return concurrent;throw error;}
}

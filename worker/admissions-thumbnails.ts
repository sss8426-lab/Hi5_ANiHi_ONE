import {DataCoreAccessError,requireWriteAccess,requireCampusAccess,type DataCoreAccessContext} from './data-core-access';
import {DEFAULT_ORGANIZATION_ID as ORG} from './data-core';
import {canReadRegisteredFile} from './data-core-derivative-policy';
import {createLibraryThumbnail,existingThumbnail,thumbnailInput} from './data-core-thumbnails';
import {readDataCoreFile} from './data-core-files';
import {privateImageResponse} from './private-image-response';

export const LEGACY_THUMBNAIL='admissions-legacy-thumbnail';
export function thumbnailMutation(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site') {
    throw new DataCoreAccessError(403,'동일 출처 요청만 허용됩니다.');
  }
}
export async function registeredArtworkThumbnail(request:Request,db:D1Database,files:R2Bucket,context:DataCoreAccessContext,id:string) {
  const source=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,unknown>>();
  if(!source || source.source_app!=='admissions' || source.category!=='student-artwork')throw new DataCoreAccessError(404,'학생 원본 그림을 찾을 수 없습니다.');
  const allowed=async(row:Record<string,unknown>)=>{
    if(row.campus_id)requireCampusAccess(context,String(row.campus_id));
    return canReadRegisteredFile(db,context,row);
  };
  if(!await allowed(source))throw new DataCoreAccessError(403,'원본 권한이 필요합니다.');
  if(request.method==='POST') {
    thumbnailMutation(request);requireWriteAccess(context);
    return Response.json({file:await createLibraryThumbnail(request,db,files,context,source,allowed)},{status:201,headers:{'cache-control':'private, no-store'}});
  }
  const thumbnail=await existingThumbnail(db,source);
  if(thumbnail && await files.head(String(thumbnail.row.r2_key)))return readDataCoreFile(db,files,context,String(thumbnail.row.id),request);
  return readDataCoreFile(db,files,context,id,request);
}

// Legacy originals have no registry ID. A versioned opaque identity refers to the
// existing stored student slot/key/ETag; never create an alias that could purge the original.
export async function legacyThumbnailIdentity(studentId:string,slot:string,campusId:unknown,key:string,etag:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([studentId,slot,campusId??null,key,etag])));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function legacyArtworkThumbnail(request:Request,db:D1Database,files:R2Bucket,context:DataCoreAccessContext,
  identity:string,campusId:string|null,original:R2ObjectBody,revalidate:()=>Promise<boolean>) {
  const recordId=`legacy-thumbnail:${identity}`;
  const find=async()=>{
    const row=await db.prepare(`SELECT fo.*,dr.metadata_json FROM file_objects fo JOIN data_records dr ON dr.id=fo.data_record_id
    WHERE dr.id=? AND dr.record_type=? AND dr.organization_id=? AND dr.deleted_at IS NULL
    AND fo.category=? AND fo.organization_id=? AND fo.deleted_at IS NULL AND fo.campus_id IS ?`).bind(recordId,LEGACY_THUMBNAIL,ORG,LEGACY_THUMBNAIL,ORG,campusId).first<Record<string,unknown>>();
    let m;try{m=JSON.parse(String(row?.metadata_json));}catch{return null;}
    return row && row.mime_type==='image/webp' && row.visibility==='private' && m.schemaVersion===1 && m.derivativeType==='thumbnail'
      && m.derivativeFileId===row.id && m.derivedFromFileId===`legacy-artwork:${identity}` && Number.isInteger(m.width) && Number.isInteger(m.height)
      && m.width>0 && m.height>0 && Math.max(m.width,m.height)<=480 ? row : null;
  };
  const serve=async(row:Record<string,unknown>)=>{
    const object=await files.get(String(row.r2_key));if(!object)return null;
    const headers=new Headers({'cache-control':'private, no-cache','etag':object.httpEtag,'content-type':'image/webp','cross-origin-resource-policy':'same-origin'});
    return privateImageResponse(request,object,headers,'image/webp');
  };
  if(request.method!=='POST') {
    const row=await find();if(row){const response=await serve(row);if(response){await original.body.cancel();return response;}}
    return null;
  }
  thumbnailMutation(request);
  if(!context.isSuperAdmin)throw new DataCoreAccessError(403,'기존 그림 썸네일 생성은 마스터 전용입니다.');
  const {bytes,width,height}=await thumbnailInput(request);
  const existing=await find();
  if(existing && await files.head(String(existing.r2_key))){await original.body.cancel();return Response.json({ready:true,reused:true},{headers:{'cache-control':'no-store'}});}
  const id=crypto.randomUUID(),key=`data-core/documents-private/${ORG}/${LEGACY_THUMBNAIL}/${id}.webp`,now=new Date().toISOString();
  const metadata={schemaVersion:1,derivativeType:'thumbnail',derivedFromFileId:`legacy-artwork:${identity}`,derivativeFileId:id,width,height,mimeType:'image/webp',generatedAt:now};
  await files.put(key,bytes,{httpMetadata:{contentType:'image/webp'}});
  try {
    if(!await revalidate())throw new DataCoreAccessError(409,'원본 연결이 변경되었습니다.');
    await db.batch([
      db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'admissions','Student thumbnail','private','active',?,?,?)`).bind(recordId,ORG,campusId,context.user!.internalUserId,LEGACY_THUMBNAIL,JSON.stringify(metadata),now,now),
      db.prepare(`INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
        VALUES (?,?,?,?,?,'documents-private',?,'admissions',?,'thumbnail.webp','image/webp',?,'private',?)`).bind(id,ORG,campusId,recordId,context.user!.internalUserId,LEGACY_THUMBNAIL,key,bytes.length,now),
    ]);
  }catch(error){
    const committed=await db.prepare('SELECT id FROM file_objects WHERE id=?').bind(id).first();
    if(!committed)await files.delete(key);
    const concurrent=await find();if(!concurrent || !await revalidate() || !await files.head(String(concurrent.r2_key)))throw error;
  }finally{await original.body.cancel();}
  return Response.json({ready:true},{status:201,headers:{'cache-control':'private, no-store'}});
}

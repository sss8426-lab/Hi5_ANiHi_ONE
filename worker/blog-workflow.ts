import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess, requireWriteAccess, requireCampusAccess, isCampusAdmin, managesCampus } from './data-core-access';
import { canReadRegisteredFile, derivativeMetadata, thumbnailSource,blogDerivativeSource } from './data-core-derivative-policy';
import {boundedDerivativeForm,persistImageDerivative} from './data-core-derivatives';
import {decode} from 'fast-png';
import {inflateSync} from 'node:zlib';
import { getContentDraft } from './data-core-content';
import {ensureDataCoreMigrations} from './data-core-migrations';
import {PHOTO_SAFETY_LIMIT} from './content-ai-images';
import {instagramPreserveReason} from '../public/data-core/instagram-source-policy.js';
import {inspectPost} from '../public/data-core/blog-post-model.js';

const fail = (message:string, status=400):never => { throw new DataCoreAccessError(status,message); };
const object = (v:any) => v && typeof v==='object' && !Array.isArray(v);
async function fileRow(db:D1Database,context:DataCoreAccessContext,id:string,campusId:string|null) {
  const row=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,any>>();
  if(!row)fail('파일이 삭제되었거나 존재하지 않습니다.',404);
  if(!await canReadRegisteredFile(db,context,row!))fail('파일 접근 권한이 없습니다.',403);
  if(campusId && row!.campus_id && row!.campus_id!==campusId)fail('다른 캠퍼스의 파일입니다.',403);
  return row!;
}

// Resolve provenance on the server, never by filename or client-supplied source IDs.
export async function resolveBlogFiles(db:D1Database,bucket:R2Bucket,context:DataCoreAccessContext,input:any) {
  requireAuthenticatedAccess(context);
  const campusId=typeof input.campusId==='string'&&input.campusId?input.campusId:null;
  if(!context.isSuperAdmin||campusId)requireCampusAccess(context,campusId);
  if(!Array.isArray(input.fileIds)||input.fileIds.length>PHOTO_SAFETY_LIMIT||input.fileIds.some((id:any)=>typeof id!=='string'||id.length>120))fail('파일 목록을 확인하세요.');
  const items:any[]=new Array(input.fileIds.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,input.fileIds.length)},async()=>{
  for(let index=next++;index<input.fileIds.length;index=next++){
    const id=input.fileIds[index];
    try {
      let row=await fileRow(db,context,id,campusId);
      if(row.category==='blog-derived'){
        const source=await blogDerivativeSource(db,row);
        if(!source||!await bucket.head(String(source.r2_key)))fail('편집 이미지의 원본이 없습니다.',404);
      }
      if(input.originals!==false){
        if(row.category==='instagram-derived'){
          const m=await derivativeMetadata(db,row);if(!m)fail('검증된 원본 연결이 없습니다.',409);
          row=await fileRow(db,context,m!.derivedFromFileId,campusId);
        } else if(row.category==='image-thumbnail'){
          const source=await thumbnailSource(db,row);if(!source)fail('검증된 원본 연결이 없습니다.',409);
          row=await fileRow(db,context,String(source!.id),campusId);
        } else if(row.category==='blog-derived'){
          const source=await blogDerivativeSource(db,row);if(!source)fail('검증된 원본 연결이 없습니다.',409);row=await fileRow(db,context,source!.id,campusId);
        } else if(/derived|thumbnail/.test(row.category||''))fail('원본 연결을 확인할 수 없습니다.',409);
      }
      if(!String(row.mime_type).startsWith('image/'))fail('이미지 파일이 아닙니다.');
      const head=await bucket.head(row.r2_key);if(!head)fail('저장소에서 파일을 찾을 수 없습니다.',404);
      items[index]={selectedId:id,id:row.id,fileName:row.original_file_name,mimeType:row.mime_type,size:head!.size,version:`"${head!.etag}"`,preserveReason:instagramPreserveReason(row),
        url:row.source_app==='data-core-library'?`/api/data-core/library/files/${encodeURIComponent(row.id)}/download`:`/api/data-core/files/${encodeURIComponent(row.id)}`};
    }catch(error){if(!(error instanceof DataCoreAccessError))throw error;items[index]={selectedId:id,error:error.message,status:error.status};}
  }
  }));
  return {items};
}

export async function saveBlogImage(request:Request,db:D1Database,bucket:R2Bucket,context:DataCoreAccessContext){
  requireWriteAccess(context);
  const form=await boundedDerivativeForm(request),id=String(form.get('sourceFileId')||''),campusId=String(form.get('campusId')||'')||null;
  if(!context.isSuperAdmin||campusId)requireCampusAccess(context,campusId);
  const source=await fileRow(db,context,id,campusId);
  if(/derived|thumbnail/.test(source.category)||!String(source.mime_type).startsWith('image/'))fail('원본 이미지를 선택하세요.');
  const head=await bucket.head(source.r2_key);if(!head)fail('원본 이미지가 없습니다.',404);
  if(String(form.get('sourceVersion'))!==`"${head!.etag}"`)fail('원본이 변경되었습니다. 미리보기를 다시 만드세요.',409);
  const file=form.get('file');if(!(file instanceof File)||file.type!=='image/png'||file.size>8*1024*1024)fail('8MB 이하 PNG가 필요합니다.');
  const bytes=new Uint8Array(await (file as File).arrayBuffer());
  try{
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
    if(v.getUint32(0)!==0x89504e47||v.getUint32(16)!==1200||v.getUint32(20)!==900||bytes[24]!==8||![2,6].includes(bytes[25])||bytes[28])throw Error();
    const compressed=[];for(let offset=8;offset<bytes.length;){const size=v.getUint32(offset);if(offset+size+12>bytes.length)throw Error();if(v.getUint32(offset+4)===0x49444154)compressed.push(bytes.subarray(offset+8,offset+8+size));offset+=size+12;}
    inflateSync(Buffer.concat(compressed),{maxOutputLength:(1200*(bytes[25]===6?4:3)+1)*900});decode(bytes,{checkCrc:true});
  }catch{fail('1200 × 900 PNG 미리보기를 다시 만드세요.');}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const recordId=`blog-image:${context.user!.internalUserId}:${id}:${hash}`;
  const cached=await db.prepare('SELECT id FROM file_objects WHERE data_record_id=? AND organization_id=? AND deleted_at IS NULL').bind(recordId,ORG).first<{id:string}>();
  if(cached){await fileRow(db,context,cached.id,campusId);return {id:cached.id,sourceFileId:id};}
  try{return await persistImageDerivative(db,bucket,context,source,bytes,{category:'blog-derived',recordType:'blog-derived-file',sourceApp:'blog',mime:'image/png',extension:'png',recordId,metadata:{width:1200,height:900,createdBy:'blog-editor',sourceVersion:`"${head!.etag}"`,hash}},row=>canReadRegisteredFile(db,context,row));}
  catch(error){const retry=await db.prepare('SELECT id FROM file_objects WHERE data_record_id=? AND organization_id=? AND deleted_at IS NULL').bind(recordId,ORG).first<{id:string}>();if(retry){await fileRow(db,context,retry.id,campusId);return {id:retry.id,sourceFileId:id};}throw error;}
}

export async function saveBlogPost(db:D1Database,bucket:R2Bucket,context:DataCoreAccessContext,input:any) {
  requireWriteAccess(context);
  await ensureDataCoreMigrations(db);
  if(!object(input)||!object(input.post)||!/^[-a-f0-9]{36}$/i.test(input.requestId||''))fail('저장 요청을 확인하세요.');
  const p=input.post,campusId=typeof input.campusId==='string'&&input.campusId?input.campusId:null;
  if(!context.isSuperAdmin||campusId)requireCampusAccess(context,campusId);
  if(p.schemaVersion!==1||!Array.isArray(p.photos)||p.photos.length>PHOTO_SAFETY_LIMIT||!Array.isArray(p.blocks)||p.blocks.length>PHOTO_SAFETY_LIMIT*6||!Number.isInteger(p.revision)||p.revision<0)fail('게시물 구조 또는 버전을 확인하세요.');
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>240||JSON.stringify(p).length>800000)fail('제목 또는 게시물 길이를 확인하세요.');
  if(p.photos.some((v:any)=>!object(v)||typeof v.fileId!=='string'||v.fileId.length>120)||new Set(p.photos.map((v:any)=>v.fileId)).size!==p.photos.length)fail('사진 참조를 확인하세요.');
  if(p.brief&&(!object(p.brief)||Object.values(p.brief).some(v=>typeof v!=='string')))fail('작성 조건을 확인하세요.');
  if(p.photos.some((v:any)=>['description','facts','exclude'].some(key=>v[key]!==undefined&&(typeof v[key]!=='string'||v[key].length>2000))))fail('사진 설명을 확인하세요.');
  if(p.publication){
    if(!object(p.publication))fail('게시 기록을 확인하세요.');
    const measured=['views','homefeedViews'].some(key=>p.publication[key]!=null);
    if(['views','homefeedViews'].some(key=>p.publication[key]!=null&&(!Number.isSafeInteger(p.publication[key])||p.publication[key]<0)))fail('통계 수치는 0 이상의 정수로 입력하세요.');
    if(measured&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.publication.asOf||'')||typeof p.publication.source!=='string'||!p.publication.source.trim()))fail('통계 기준일과 출처를 입력하세요.');
  }
  const types=['greeting','lead','heading','paragraph','caption','related','closing','contact','hashtags','image'];
  if(p.blocks.some((b:any)=>!object(b)||typeof b.id!=='string'||b.id.length>80||!types.includes(b.type)||(b.type==='image'?typeof b.fileId!=='string':typeof b.text!=='string'))||new Set(p.blocks.map((b:any)=>b.id)).size!==p.blocks.length)fail('본문 블록을 확인하세요.');
  const id=input.id||`blog:${context.user!.internalUserId}:${input.requestId}`;
  if(typeof id!=='string'||id.length>180)fail('게시물 ID를 확인하세요.');
  const existing=await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<Record<string,any>>();
  if(existing){
    await getContentDraft(db,context,id);
    if(existing.record_type!=='blog-draft'||existing.campus_id!==campusId||existing.deleted_at)fail('게시물 범위가 다릅니다.',409);
    if(!context.isSuperAdmin && !(isCampusAdmin(context)?managesCampus(context,existing.campus_id):existing.created_by_user_id===context.user!.internalUserId))fail('수정 권한이 없습니다.',403);
  }
  const old=existing?JSON.parse(existing.metadata_json||'{}'):{};
  const status=['draft','review','ready','published','archived'].includes(input.publishStatus)?input.publishStatus:'draft';
  const provisional=['draft','review','archived'].includes(status);
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(old.blogSaveRequest===input.requestId){if(old.blogSaveHash!==fingerprint)fail('동일 요청의 내용이 바뀌었습니다.',409);return getContentDraft(db,context,id);}
  if((old.blogPost?.revision||0)!==p.revision)fail('다른 곳에서 먼저 수정했습니다. 저장된 버전을 다시 열어 비교하세요.',409);
  const selected=await resolveBlogFiles(db,bucket,context,{campusId,fileIds:p.photos.map((v:any)=>v.fileId)});
  p.fileIssues=[];
  for(let i=0;i<p.photos.length;i++){
    const photo=p.photos[i],source=selected.items[i];
    if(source.error){
      const prior=old.blogPost?.photos?.find((v:any)=>v.fileId===photo.fileId);
      if(!provisional||!prior)fail(`원본 확인 실패: ${source.selectedId} · ${source.error}`,source.status);
      photo.sourceFileId=prior.sourceFileId;photo.version=prior.version;photo.fileName=prior.fileName;photo.order=i;p.fileIssues.push({fileId:photo.fileId,message:source.error});continue;
    }
    if(photo.version&&photo.version!==source.version)fail('원본 버전이 변경되었습니다. 사진을 다시 확인하세요.',409);
    photo.sourceFileId=source.id;photo.version=source.version;photo.fileName=source.fileName;photo.order=i;
  }
  const images=p.blocks.filter((b:any)=>b.type==='image');
  const resolved=await resolveBlogFiles(db,bucket,context,{campusId,fileIds:images.map((b:any)=>b.fileId),originals:false});
  const origins=await resolveBlogFiles(db,bucket,context,{campusId,fileIds:images.map((b:any)=>b.fileId)});
  for(let i=0;i<images.length;i++){
    const error=resolved.items[i].error||origins.items[i].error;
    if(error){const prior=old.blogPost?.blocks?.find((b:any)=>b.type==='image'&&b.fileId===images[i].fileId);if(!provisional||!prior)fail(`본문 이미지 확인 실패: ${error}`);images[i].sourceFileId=prior.sourceFileId;images[i].version=prior.version;p.fileIssues.push({fileId:images[i].fileId,message:error});}
    else{images[i].sourceFileId=origins.items[i].id;images[i].version=resolved.items[i].version;}
  }
  for(const photo of p.photos){photo.bodyOrder=images.map((b:any,i:number)=>b.role==='body'&&b.sourceFileId===photo.sourceFileId?i:-1).filter((i:number)=>i>=0);photo.bodyUsed=photo.bodyOrder.length>0;}
  if(['ready','published'].includes(status)&&p.privacyConfirmed!==true)fail('홍보 사용 권한과 개인정보를 확인하세요.');
  if(['ready','published'].includes(status)&&inspectPost(p).some((i:any)=>i.status==='needs_changes'))fail('게시 전 수정 필요 항목을 확인하세요.');
  if(status==='published'&&(!/^https:\/\/([a-z0-9-]+\.)?(blog.naver.com|m.blog.naver.com)\//i.test(p.publication?.url||'')||!/^\d{4}-\d{2}-\d{2}$/.test(p.publication?.date||'')))fail('실제 게시 URL과 게시일을 입력하세요.');
  p.revision++;p.campusId=campusId;p.id=id;
  const tags=Array.isArray(input.tags)?input.tags:[];
  const metadata={...old,blogPost:p,blogSaveRequest:input.requestId,blogSaveHash:fingerprint,relatedFileIds:p.photos.map((v:any)=>v.fileId),derivedFileIds:[],publishStatus:status,footer:input.footer||'',contactBlock:input.contactBlock||'',strategyMode:p.strategyMode||'balanced',blogTags:tags,strategy:p.generation?.strategy||old.strategy,titles:p.generation?.titles||old.titles,nextTopics:p.generation?.nextTopics||old.nextTopics,selectedTitleKind:p.generation?.selectedTitleKind||old.selectedTitleKind};
  const now=new Date().toISOString(),body=p.blocks.filter((b:any)=>b.type!=='image').map((b:any)=>b.text).join('\n\n');
  let result;
  if(existing){
    result=await db.prepare(`UPDATE data_records SET title=?,content_text=?,metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND deleted_at IS NULL AND metadata_json=?`)
      .bind(p.title,body,JSON.stringify(metadata),now,id,ORG,existing.metadata_json).run();
  }else{
    result=await db.prepare(`INSERT INTO data_records(id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,content_text,visibility,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,'blog-draft','blog',?,?,'private','active',?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(id,ORG,campusId,context.user!.internalUserId,p.title,body,JSON.stringify(metadata),now,now).run();
  }
  if(Number(result.meta?.changes)!==1){
    const retry=await getContentDraft(db,context,id);
    if(retry.metadata?.blogSaveRequest===input.requestId&&retry.metadata?.blogSaveHash===fingerprint)return retry;
    fail('동시에 수정된 게시물입니다. 다시 열어 비교하세요.',409);
  }
  return getContentDraft(db,context,id);
}

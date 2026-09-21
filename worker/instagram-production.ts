import { encode, decode } from 'fast-png';
import pica from 'pica';
import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess, requireCampusAccess, isCampusAdmin, managesCampus } from './data-core-access';
import { getContentDraft } from './data-core-content';
import { canReadRegisteredFile, derivativeMetadata, DERIVATIVE_CATEGORY, DERIVATIVE_RECORD_TYPE } from './data-core-derivative-policy';
import { boundedDerivativeForm, persistImageDerivative, validateOutput } from './data-core-derivatives';
import { campusDisplayName } from './campus-directory';
import { BRAND_VERSION, LOGOS, TEMPLATES, HUMAN_CHECKS, getInstagramCampusLogoLabel, normalizeDesign, designChecks } from '../public/data-core/instagram-brand-policy.js';

export const INSTAGRAM_RENDER = 'instagram-reviewed-render';
export const INSTAGRAM_SET = 'instagram-carousel-set';
type Approval = { fingerprint:string; approvedBy:string; approvedAt:string; checks:string[]; mode?:string };
type RenderMetadata = { draftId:string; fingerprint:string; masterFileId:string; backgroundFileId:string; exportFileId?:string; approval?:Approval };
const fail = (status:number, text:string):never => { throw new DataCoreAccessError(status,text); };
const parse = (text:unknown) => { try { return JSON.parse(String(text || '{}')); } catch { return {}; } };
const hash = async (value:unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');

export async function instagramPolicy(db:D1Database, context:DataCoreAccessContext, campusId:string) {
  requireWriteAccess(context);
  if (!campusId) fail(400,'제작할 캠퍼스를 선택하세요.');
  requireCampusAccess(context,campusId);
  const campus = await db.prepare('SELECT name FROM campuses WHERE id=? AND organization_id=?').bind(campusId,ORG).first<{name:string}>();
  if (!campus) fail(404,'캠퍼스를 찾을 수 없습니다.');
  const campusName = campusDisplayName(campusId,campus!.name)!;
  return { campusId, campusName, campusLogoLabel:getInstagramCampusLogoLabel(campusName), brandVersion:BRAND_VERSION, logos:LOGOS, templates:TEMPLATES };
}

async function productionDraft(db:D1Database, context:DataCoreAccessContext, id:string) {
  requireWriteAccess(context);
  const draft = await getContentDraft(db,context,id) as Awaited<ReturnType<typeof getContentDraft>> & { tags?:unknown };
  if (draft.sourceApp !== 'instagram') fail(400,'인스타 초안을 선택하세요.');
  const row = await db.prepare('SELECT created_by_user_id,campus_id FROM data_records WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,unknown>>();
  if (!row || (!context.isSuperAdmin && !(isCampusAdmin(context) && managesCampus(context,row.campus_id)) && context.user?.internalUserId !== row.created_by_user_id)) fail(403,'이 초안을 관리할 권한이 없습니다.');
  const policy = await instagramPolicy(db,context,String(draft.campusId || ''));
  const metadata = draft.metadata as Record<string,unknown>;
  const design = normalizeDesign(metadata.instagramDesign);
  const ids = Array.isArray(metadata.relatedFileIds) ? metadata.relatedFileIds : [];
  if (ids.length !== 1 || typeof ids[0] !== 'string') fail(400,'대표 원본 이미지 1장을 선택하세요.');
  const source = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(ids[0],ORG).first<Record<string,unknown>>();
  if (!source || !await canReadRegisteredFile(db,context,source) || (source.campus_id && source.campus_id !== draft.campusId)) fail(403,'원본 자료를 사용할 권한이 없습니다.');
  if (source!.category === DERIVATIVE_CATEGORY || !['image/png','image/jpeg','image/webp'].includes(String(source!.mime_type))) fail(400,'원본 이미지를 선택하세요.');
  // Include all editable metadata and the live campus projection: generic record edits also invalidate approval.
  // New logo choices must not invalidate previously approved single-image renders.
  const fingerprintPolicy=design.workflow==='carousel-v2'?policy:{...policy,logos:{anihi:LOGOS.anihi,hi5:LOGOS.hi5,combined:LOGOS.combined}};
  const fingerprint = await hash({id:draft.id,campusId:draft.campusId,title:draft.title,summary:draft.summary,content:draft.content,tags:draft.tags,metadata,policy:fingerprintPolicy});
  return { draft, design, policy, source:source!, fingerprint };
}

async function renderRow(db:D1Database, draftId:string, renderId:string) {
  const row = await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(renderId,ORG,INSTAGRAM_RENDER).first<{id:string;campus_id:string;metadata_json:string}>();
  const meta = parse(row?.metadata_json) as RenderMetadata;
  if (!row || meta.draftId !== draftId) fail(404,'저장된 제작 버전을 찾을 수 없습니다.');
  return { row:row!, meta };
}
async function audit(db:D1Database,context:DataCoreAccessContext,campusId:string,action:string,id:string) {
  return db.prepare(`INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,?,'instagram-production',?,'{}',?)`)
    .bind(crypto.randomUUID(),ORG,campusId,context.user!.internalUserId,action,id,new Date().toISOString());
}

type SetItem = {draftId:string;renderId:string;fingerprint:string};
async function ownedSet(db:D1Database,context:DataCoreAccessContext,id:string) {
  requireWriteAccess(context);
  const row=await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(id,ORG,INSTAGRAM_SET).first<Record<string,unknown>>();
  if(!row)fail(404,'저장된 이미지 세트를 찾을 수 없습니다.');
  requireCampusAccess(context,String(row!.campus_id));
  if(!context.isSuperAdmin&&!(isCampusAdmin(context)&&managesCampus(context,row!.campus_id))&&context.user!.internalUserId!==row!.created_by_user_id)fail(403,'이 작업을 열 권한이 없습니다.');
  return {row:row!,meta:parse(row!.metadata_json)};
}
export async function getInstagramSet(db:D1Database,context:DataCoreAccessContext,id:string) {
  const {row,meta}=await ownedSet(db,context,id),items=[];
  for(const item of meta.items as SetItem[]){
    const report=await reviewInstagram(db,context,item.draftId,item.renderId);
    if(!report.approved||report.fingerprint!==item.fingerprint)fail(409,'원본 권한 또는 제작 버전이 변경되었습니다.');
    items.push({...item,masterFileId:report.masterFileId});
  }
  return {id:row.id,campusId:row.campus_id,title:row.title,createdAt:row.created_at,items,caption:String(row.content_text||'')};
}
export async function listInstagramSets(db:D1Database,context:DataCoreAccessContext,campusId:string) {
  await instagramPolicy(db,context,campusId);
  const owner=context.isSuperAdmin||managesCampus(context,campusId)?'':' AND created_by_user_id=?';
  const bindings=[ORG,INSTAGRAM_SET,campusId,...(owner?[context.user!.internalUserId]:[])];
  const result=await db.prepare(`SELECT id,title,created_at AS createdAt FROM data_records WHERE organization_id=? AND record_type=? AND campus_id=? AND deleted_at IS NULL${owner} ORDER BY created_at DESC,id DESC LIMIT 30`).bind(...bindings).all();
  return {sets:result.results||[]};
}
export async function completeInstagramSet(db:D1Database,context:DataCoreAccessContext,input:Record<string,unknown>) {
  requireWriteAccess(context);
  const items=input.items as SetItem[],requestId=String(input.requestId||'');
  if(!/^[0-9a-f-]{36}$/i.test(requestId)||!Array.isArray(items)||items.length<1||items.length>10||new Set(items.map(i=>i?.renderId)).size!==items.length)fail(400,'1~10장의 완성 이미지를 선택하세요.');
  const id=`instagram-set:${context.user!.internalUserId}:${requestId}`;
  const existing=await db.prepare('SELECT id,metadata_json FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<{id:string;metadata_json:string}>();
  if(existing){if(JSON.stringify(parse(existing.metadata_json).items)!==JSON.stringify(items))fail(409,'다른 저장 요청입니다.');return getInstagramSet(db,context,id);}
  let campusId='',logo='';const sources=new Set(),statements:D1PreparedStatement[]=[];const now=new Date().toISOString();
  for(const item of items){
    if(!item||typeof item.draftId!=='string'||typeof item.renderId!=='string')fail(400,'제작 버전을 확인하세요.');
    const report=await reviewInstagram(db,context,item.draftId,item.renderId);
    if(report.design.workflow!=='carousel-v2'||!report.canApprove||report.fingerprint!==item.fingerprint)fail(409,'현재 미리보기와 저장 버전이 일치하지 않습니다.');
    if(campusId&&campusId!==report.campusId||logo&&logo!==report.design.logoType)fail(400,'같은 캠퍼스와 로고의 이미지 세트만 저장할 수 있습니다.');
    campusId=report.campusId;logo=report.design.logoType;
    const {row,meta}=await renderRow(db,item.draftId,item.renderId),source=await productionDraft(db,context,item.draftId);
    if(sources.has(source.source.id))fail(400,'중복 원본을 확인하세요.');sources.add(source.source.id);
    meta.approval={fingerprint:report.fingerprint,approvedBy:context.user!.internalUserId,approvedAt:now,checks:[],mode:'user-finalized-set'};
    statements.push(db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND metadata_json=?').bind(JSON.stringify(meta),now,row.id,ORG,row.metadata_json));
  }
  statements.push(db.prepare(`INSERT INTO data_records(id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,'instagram',?,'private','active',?,?,?)`).bind(id,ORG,campusId,context.user!.internalUserId,INSTAGRAM_SET,`인스타 이미지 ${items.length}장`,JSON.stringify({schemaVersion:1,items,completedAt:now}),now,now));
  statements.push(await audit(db,context,campusId,'instagram.complete-set',id));
  try{await db.batch(statements);}catch(error){
    // Concurrent duplicate clicks reuse the committed set, never manufacture a second one.
    const committed=await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<{metadata_json:string}>();
    if(committed){if(JSON.stringify(parse(committed.metadata_json).items)!==JSON.stringify(items))fail(409,'다른 저장 요청입니다.');return getInstagramSet(db,context,id);}
    throw error;
  }
  return getInstagramSet(db,context,id);
}
export async function saveInstagramSetCaption(db:D1Database,context:DataCoreAccessContext,id:string,input:Record<string,unknown>){
  await getInstagramSet(db,context,id);
  if(typeof input.caption!=='string'||input.caption.length>12000)fail(400,'홍보 문구를 확인하세요.');
  await db.prepare('UPDATE data_records SET content_text=?,updated_at=? WHERE id=? AND organization_id=? AND record_type=?').bind(input.caption,new Date().toISOString(),id,ORG,INSTAGRAM_SET).run();
  return {saved:true};
}

export async function saveInstagramRender(request:Request,db:D1Database,files:R2Bucket,context:DataCoreAccessContext,id:string) {
  const current = await productionDraft(db,context,id), form = await boundedDerivativeForm(request);
  if (form.get('fingerprint') !== current.fingerprint) fail(409,'초안이 변경되었습니다. 다시 저장하고 미리보기를 만드세요.');
  const backgroundId = String(form.get('backgroundFileId') || current.source.id);
  if (backgroundId !== current.source.id) {
    const row = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(backgroundId,ORG).first<Record<string,unknown>>();
    const provenance = row && await derivativeMetadata(db,row);
    const editable=current.design.materialKind==='ai-support'||(current.design.workflow==='carousel-v2'&&current.design.materialKind==='real-photo'&&current.design.externalAiConsent);
    if (!editable || !row || !provenance || provenance.derivedFromFileId !== current.source.id || !await canReadRegisteredFile(db,context,row)) fail(403,'학생 작품과 보호 자료는 원본 그대로 배치해야 합니다.');
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'image/png') fail(400,'PNG 미리보기가 필요합니다.');
  const bytes = new Uint8Array(await (file as File).arrayBuffer()); validateOutput(bytes);
  if (!await files.head(String(current.source.r2_key))) fail(404,'원본 이미지가 없습니다.');
  const output = await persistImageDerivative(db,files,context,current.source,bytes,{
    category:DERIVATIVE_CATEGORY,recordType:DERIVATIVE_RECORD_TYPE,sourceApp:'instagram',mime:'image/png',extension:'png',
    metadata:{derivativeType:'instagram-layout',width:2160,height:2700,aspectRatio:'4:5',createdBy:'instagram-editor',
      templateId:current.design.templateId,logoType:current.design.logoType,campusLogoLabel:current.policy.campusLogoLabel,campusOriginalName:current.policy.campusName,
      materialKind:current.design.materialKind,brandVersion:BRAND_VERSION,backgroundFileId:backgroundId,draftId:id,fingerprint:current.fingerprint,aiEdited:backgroundId !== current.source.id},
  }, source=>canReadRegisteredFile(db,context,source));
  const renderId=crypto.randomUUID(),now=new Date().toISOString();
  const metadata={draftId:id,fingerprint:current.fingerprint,masterFileId:output.id,sourceFileId:current.source.id,backgroundFileId:backgroundId,
    design:current.design,policy:current.policy,approval:null,renderedBy:context.user!.internalUserId,renderedAt:now};
  await db.batch([
    db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,'instagram','인스타 제작 검수','private','active',?,?,?)`)
      .bind(renderId,ORG,current.draft.campusId,context.user!.internalUserId,INSTAGRAM_RENDER,JSON.stringify(metadata),now,now),
    await audit(db,context,String(current.draft.campusId),'instagram.render',renderId),
  ]);
  return { renderId, file:output, fingerprint:current.fingerprint };
}

export async function reviewInstagram(db:D1Database,context:DataCoreAccessContext,id:string,renderId?:string) {
  const current = await productionDraft(db,context,id);
  if(!renderId) {
    const latest=await db.prepare('SELECT id FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL AND json_extract(metadata_json,\'$.draftId\')=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(ORG,INSTAGRAM_RENDER,id).first<{id:string}>();
    renderId=latest?.id;
  }
  const checks = designChecks(current.design,current.policy.campusLogoLabel);
  checks.push({code:'text-facts',status:'human_required',message:'이미지와 캡션의 날짜·숫자 대조 및 로고 픽셀·작품 훼손 검사는 담당자 확인이 필요합니다.'});
  if(/전국\s*1위|100\s*%\s*합격|합격\s*보장/.test(String(current.draft.content))) checks.push({code:'caption-claims',status:'needs_changes',message:'캡션의 근거 없는 순위·합격 보장 표현을 제거하세요.'});
  let approved=false, render:RenderMetadata|null=null;
  if (renderId) {
    const {meta}=await renderRow(db,id,renderId);render=meta;
    const output=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(meta.masterFileId,ORG).first<Record<string,unknown>>();
    const valid=!!output && await canReadRegisteredFile(db,context,output);
    checks.push({code:'version',status:meta.fingerprint===current.fingerprint && valid?'pass':'needs_changes',message:'현재 초안과 렌더링 버전 일치 / 원본 접근 권한'});
    checks.push({code:'format',status:valid?'pass':'needs_changes',message:'2160 × 2700 PNG · 4:5'});
    approved=valid && meta.fingerprint===current.fingerprint && meta.approval?.fingerprint===current.fingerprint;
  } else checks.push({code:'render',status:'not_run',message:'현재 초안을 먼저 렌더링하세요.'});
  const blocking=checks.some(item=>['needs_changes','not_run'].includes(item.status));
  return { ...current.policy,design:current.design,fingerprint:current.fingerprint,checks,renderId:renderId || null,
    approved:approved && !blocking,canApprove:!!renderId && !blocking,status:blocking?'needs_changes':approved?'pass':'human_required',
    approval:approved?render?.approval:null,masterFileId:render?.masterFileId || null };
}

export async function approveInstagram(db:D1Database,context:DataCoreAccessContext,id:string,input:Record<string,unknown>) {
  const report=await reviewInstagram(db,context,id,String(input.renderId || ''));
  if (!report.canApprove || input.fingerprint !== report.fingerprint) fail(409,'검수 항목을 수정한 뒤 현재 버전으로 다시 검수하세요.');
  const checks=input.checks as Record<string,unknown>|undefined;
  if (!HUMAN_CHECKS.every(key=>checks?.[key] === true)) fail(400,'작품·로고·디자인·AI·개인정보·가독성·사실 확인을 모두 완료하세요.');
  const {row,meta}=await renderRow(db,id,String(input.renderId));
  const now=new Date().toISOString();
  meta.approval={fingerprint:report.fingerprint,approvedBy:context.user!.internalUserId,approvedAt:now,checks:HUMAN_CHECKS};
  // Approval is recorded on this immutable render, never accepted from client draft metadata.
  await db.batch([db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND metadata_json=?')
    .bind(JSON.stringify(meta),now,row.id,ORG,row.metadata_json),await audit(db,context,String(row.campus_id),'instagram.approve',row.id)]);
  return reviewInstagram(db,context,id,row.id);
}

export async function exportInstagram(db:D1Database,files:R2Bucket,context:DataCoreAccessContext,id:string,input:Record<string,unknown>) {
  const report=await reviewInstagram(db,context,id,String(input.renderId || ''));
  if (!report.approved || input.fingerprint !== report.fingerprint) fail(409,'현재 버전의 승인이 필요합니다.');
  const row=await db.prepare('SELECT r2_key FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(report.masterFileId,ORG).first<{r2_key:string}>();
  const object=row && await files.get(row.r2_key);
  if (!object) fail(404,'승인된 이미지가 없습니다.');
  const bytes=new Uint8Array(await object!.arrayBuffer());validateOutput(bytes);
  const image=decode(bytes,{checkCrc:true}),rgba=new Uint8Array(2160*2700*4);
  for(let i=0;i<2160*2700;i++){rgba[i*4]=image.data[i*image.channels];rgba[i*4+1]=image.data[i*image.channels+1];rgba[i*4+2]=image.data[i*image.channels+2];rgba[i*4+3]=image.channels===4?image.data[i*4+3]:255;}
  const data=await pica({features:['js']}).resizeBuffer({src:rgba,width:2160,height:2700,toWidth:1080,toHeight:1350,filter:'lanczos3'});
  // Recheck after expensive rendering so concurrent edits cannot reuse old approval.
  if (!(await reviewInstagram(db,context,id,String(input.renderId))).approved) fail(409,'초안이 변경되었습니다. 재승인이 필요합니다.');
  const finalBytes=new Uint8Array(encode({width:1080,height:1350,channels:4,depth:8,data}));
  const current=await productionDraft(db,context,id);
  const {row:render,meta}=await renderRow(db,id,String(input.renderId));
  if(!meta.exportFileId || !await db.prepare('SELECT id FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(meta.exportFileId,ORG).first()) {
    const output=await persistImageDerivative(db,files,context,current.source,finalBytes,{
      category:DERIVATIVE_CATEGORY,recordType:DERIVATIVE_RECORD_TYPE,sourceApp:'instagram',mime:'image/png',extension:'png',
      metadata:{derivativeType:'instagram-publish',width:1080,height:1350,aspectRatio:'4:5',createdBy:'instagram-editor',renderId:render.id,draftId:id,fingerprint:report.fingerprint,
        masterFileId:report.masterFileId,logoType:current.design.logoType,campusLogoLabel:report.campusLogoLabel,approvedBy:meta.approval!.approvedBy,approvedAt:meta.approval!.approvedAt},
    },source=>canReadRegisteredFile(db,context,source));
    meta.exportFileId=output.id;
    await db.prepare('UPDATE data_records SET metadata_json=? WHERE id=? AND organization_id=? AND metadata_json=?').bind(JSON.stringify(meta),render.id,ORG,render.metadata_json).run();
  }
  if (!(await reviewInstagram(db,context,id,String(input.renderId))).approved) fail(409,'초안이 변경되었습니다. 재승인이 필요합니다.');
  await (await audit(db,context,String((await getContentDraft(db,context,id)).campusId),'instagram.export',String(input.renderId))).run();
  return new Response(finalBytes,{headers:{'content-type':'image/png','cache-control':'private, no-store','content-disposition':'attachment; filename="instagram-1080x1350.png"'}});
}

export async function assertInstagramAiUse(db:D1Database,context:DataCoreAccessContext,ids:string[],input:Record<string,unknown>,edit=false) {
  const design=normalizeDesign(input.material);
  const textOnly=!edit&&design.workflow==='carousel-v2'&&input.textOnly===true;
  const max=textOnly?10:design.workflow==='carousel-v2'&&!edit?6:1;
  if(!Array.isArray(ids)||ids.length<1||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>120))fail(400,'선택한 원본 이미지 수를 확인하세요.');
  if(textOnly){
    if(design.usePermission!=='allowed')fail(403,'홍보 사용 권한을 확인하세요.');
    for(const id of ids){
      const row=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,unknown>>();
      if(!row||!await canReadRegisteredFile(db,context,row)||(row.campus_id&&row.campus_id!==input.campusId))fail(403,'이 자료를 사용할 권한이 없습니다.');
    }
    return;
  }
  const editable=design.materialKind==='ai-support'||(design.workflow==='carousel-v2'&&design.materialKind==='real-photo');
  if (design.usePermission !== 'allowed' || !design.externalAiConsent || (edit && !editable) || ['student-artwork','brand-asset','fact-document'].includes(design.materialKind)) fail(403,'자료 유형과 별도의 외부 AI 처리 동의를 확인하세요. 학생 작품·로고·사실 자료는 AI에 전송하지 않습니다.');
  for(const id of ids){
    const row=await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id,ORG).first<Record<string,unknown>>();
    if(!row || !await canReadRegisteredFile(db,context,row) || /student|artwork|award|admission|document|logo/.test(String(row.category)) || row.area==='student-private') fail(403,'이 자료는 외부 AI 처리에 사용할 수 없습니다.');
  }
}

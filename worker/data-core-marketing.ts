import { decode as decodePng } from 'fast-png';
import { DEFAULT_ORGANIZATION_ID as ORG, ensureDataCoreDatabase } from './data-core';
import { CAMPUS_DIRECTORY, campusDisplayName } from './campus-directory';
import { DataCoreAccessError as AccessError, resolveDataCoreAccess, requireAuthenticatedAccess, listAccessibleCampuses, type DataCoreAccessContext } from './data-core-access';

export const MARKETING_KEYWORDS = ['부천웹툰학원','부천만화학원','부천애니학원','부평웹툰학원','부평만화학원','부평애니학원','부천미술학원','부천입시미술학원','부천디자인학원','부평미술학원','부평입시미술학원','부천예고입시','부평예고입시'];
export const MARKETING_SOURCE = 'marketing-monitoring';
export const MARKETING_REPORT = 'marketing-report';
export const MARKETING_PROFILE = 'marketing-channel-profile';
export type MarketingEnv = { DB?: D1Database; FILES?: R2Bucket; MARKETING_INGEST_TOKEN?: string; DATA_CORE_SUPER_ADMIN_EMAILS?: string };
type Row = Record<string, any>;
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
function fail(status:number,message:string):never {throw new AccessError(status,message);}
const object = (v:any) => v && typeof v==='object' && !Array.isArray(v);
function serialize(value:unknown) { const text=JSON.stringify(value); if(new TextEncoder().encode(text).length>200_000) fail(413,'메타데이터 최대 200KB입니다.'); return text; }
function validDate(date:any) { if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) fail(400,'reportDate가 올바르지 않습니다.'); }
const metrics = ['adRank','adCount','organicRank','officialDocuments','inspectedResults','gapDays','posts7','posts30','visitors7','visitors30','followers','profileVisits7','profileVisits30'];
const averages = ['dailyProfileVisits7','dailyProfileVisits30','dailyVisitors7','dailyVisitors30'];
export function validateMarketingPayload(p:any, now=Date.now()) {
  if(!object(p)||p.version!==1||typeof p.runId!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(p.runId)||!['sample','daily'].includes(p.runKind)) fail(400,'version, runId, runKind를 확인하세요.');
  if(!CAMPUS_DIRECTORY.some(c=>c.id===p.campusId)) fail(400,'정규 캠퍼스 ID가 필요합니다.');
  validDate(p.reportDate);
  if(typeof p.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.capturedAt)) fail(400,'capturedAt ISO 시각이 필요합니다.');
  validDate(p.capturedAt.slice(0,10));
  const captured=Date.parse(p.capturedAt);
  if(!Number.isFinite(captured)||captured<Date.UTC(2020,0,1)||captured>now+600000||new Date(captured+32400000).toISOString().slice(0,10)!==p.reportDate) fail(400,'수집 시각과 한국 날짜가 일치해야 합니다.');
  p.capturedAt = new Date(captured).toISOString(); // Stable UTC storage prevents mixed-offset history ordering errors.
  if(!object(p.environment)||p.environment.device!=='desktop') fail(400,'desktop 수집 환경이 필요합니다.');
  if(!object(p.platforms)||!object(p.platforms.naver)) fail(400,'네이버 관측 데이터가 필요합니다.');
  for(const name of Object.keys(p.platforms)) {
    if(!['naver','google'].includes(name)) fail(400,'지원하지 않는 검색 플랫폼입니다.');
    const platform=p.platforms[name];
    if(!object(platform)||typeof platform.status!=='string'||platform.status.length>1000||!Array.isArray(platform.keywords)||platform.keywords.length>13) fail(400,'플랫폼 형식이 올바르지 않습니다.');
    const seen=new Set();
    for(const item of platform.keywords) {
      if(!object(item)||!MARKETING_KEYWORDS.includes(item.keyword)||seen.has(item.keyword)||!['observed','not_exposed','not_observed','unavailable'].includes(item.adStatus)) fail(400,'키워드 또는 광고 상태가 올바르지 않습니다.');
      seen.add(item.keyword);
      for (const rank of ['adRank','organicRank']) if (item[rank] != null && (!Number.isInteger(item[rank]) || item[rank] < 1 || item[rank] > 1000000)) fail(400,'순위는 1 이상 정수 또는 null이어야 합니다.');
      if (item.adRank != null && (item.adStatus !== 'observed' || (item.adCount != null && item.adRank > item.adCount))) fail(400,'광고 순위와 관측 상태/개수가 일치하지 않습니다.');
      if (item.inspectedResults != null && ((item.officialDocuments != null && item.officialDocuments > item.inspectedResults) || (item.organicRank != null && item.organicRank > item.inspectedResults))) fail(400,'공식문서와 자연순위가 조사 결과 수를 초과할 수 없습니다.');
      if (item.officialDocuments === 0 && item.organicRank != null) fail(400,'공식문서 미노출과 자연순위가 일치하지 않습니다.');
      for(const key of metrics.slice(0,5)) if(item[key]===undefined) item[key]=null;
      item.sourceUrls ??= [];
      if(!Array.isArray(item.sourceUrls)||item.sourceUrls.length>50) fail(400,'출처 URL 형식 오류입니다.');
      item.sourceUrls.forEach(publicUrl);
    }
  }
  p.channels ??= {};
  if(!object(p.channels)) fail(400,'channels 형식 오류입니다.');
  for(const [name,c] of Object.entries(p.channels) as [string,any][]) {
    if(!['blog','instagram','website'].includes(name)||!object(c)) fail(400,'채널 형식 오류입니다.');
    if (c.status !== undefined && (typeof c.status !== 'string' || c.status.length > 1000)) fail(400,'채널 상태 형식 오류입니다.');
    for(const key of [...metrics.slice(5),...averages,'latestPublishedAt','latestPostUrl','periodCaution']) if(c[key]===undefined) c[key]=null;
    if (c.latestPublishedAt !== null) {
      if (typeof c.latestPublishedAt !== 'string') fail(400,'최근 게시 시각 오류입니다.');
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(c.latestPublishedAt);
      if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.latestPublishedAt)) fail(400,'게시 시각은 시간대 포함 ISO 또는 실제 날짜여야 합니다.');
      validDate(c.latestPublishedAt.slice(0,10));
      const posted = Date.parse(dateOnly ? c.latestPublishedAt+'T00:00:00+09:00' : c.latestPublishedAt);
      if (!Number.isFinite(posted) || posted>now+600000) fail(400,'최근 게시 시각 오류입니다.');
    }
    for(const key of ['url','latestPostUrl']) if(c[key]) publicUrl(c[key]);
  }
  if (p.comparison !== undefined) {
    const c = p.comparison;
    const fields = ['status','baselineRunKind','baselineDate','baselineReportId','scopeComparable','summary','limitations'];
    if (!object(c) || Object.keys(c).some(key => !fields.includes(key)) || !['observed','not_available','not_comparable'].includes(c.status)) fail(400,'comparison 형식 또는 상태가 올바르지 않습니다.');
    if (c.baselineRunKind !== undefined && c.baselineRunKind !== 'daily') fail(400,'비교 기준은 daily만 허용됩니다.');
    if (c.baselineDate !== undefined) validDate(c.baselineDate);
    if (c.baselineReportId !== undefined && (typeof c.baselineReportId !== 'string' || !/^marketing:[a-f0-9]{64}$/.test(c.baselineReportId))) fail(400,'비교 기준 보고서 ID가 올바르지 않습니다.');
    if (c.scopeComparable !== undefined && typeof c.scopeComparable !== 'boolean') fail(400,'scopeComparable은 boolean이어야 합니다.');
    if (c.summary !== undefined && (typeof c.summary !== 'string' || c.summary.length > 20000)) fail(400,'비교 요약은 최대 20,000자 문자열이어야 합니다.');
    if (c.limitations !== undefined && (!Array.isArray(c.limitations) || c.limitations.some((item:any) => typeof item !== 'string'))) fail(400,'비교 한계는 문자열 배열이어야 합니다.');
    if (c.status === 'observed' && (p.runKind !== 'daily' || c.baselineRunKind !== 'daily' || c.scopeComparable !== true || !c.baselineDate || c.baselineDate >= p.reportDate || !c.baselineReportId || typeof c.summary !== 'string' || !c.summary.trim() || typeof p.environment.comparisonScope !== 'string' || !p.environment.comparisonScope.trim() || p.environment.comparisonScope.length > 500)) fail(400,'관측 비교는 동일 환경의 이전 daily 보고서와 실제 변화 요약이 필요합니다.');
  }
  p.improvements ??= []; p.limitations ??= [];
  if(!Array.isArray(p.improvements)||!Array.isArray(p.limitations)) fail(400,'개선안과 한계는 배열이어야 합니다.');
  for(const x of p.improvements) if(!object(x)||!['string','number'].includes(typeof x.priority)||typeof x.title!=='string'||typeof x.action!=='string'||x.evidence===undefined) fail(400,'개선안의 근거가 필요합니다.');
  function walk(v:any,key='') {
    const normalizedKey = key.replace(/[_-]/g,'').toLowerCase();
    if (['owner','owneruserid','createdbyuserid','actoruserid','userid','password','token','accesstoken','refreshtoken','apikey','secret','authorization','cookie','cookies','headers','authheaders','proto','constructor','prototype'].includes(normalizedKey)) fail(400,'보고서에 자격증명·사용자 소유권·세션 헤더를 포함하지 마세요.');
    if(v===null) return;
    if (['url','sourceUrl','latestPostUrl','queryUrl','searchUrl'].includes(key)) publicUrl(v);
    if (key === 'sourceUrls') { if (!Array.isArray(v) || v.length > 50) fail(400,'출처 URL 형식 오류입니다.'); v.forEach(publicUrl); }
    if(typeof v==='number'&&(!Number.isFinite(v)||v<0||v>1_000_000_000)) fail(400,'수치는 유한한 0~10억 값 또는 null이어야 합니다.');
    if(averages.includes(key)&&typeof v!=='number') fail(400,'평균 수치는 유한한 숫자 또는 null이어야 합니다.');
    if(metrics.includes(key)&&(typeof v!=='number'||!Number.isInteger(v))) fail(400,'측정 수치는 정수 또는 null이어야 합니다.');
    if(typeof v==='string'&&v.length>50000) fail(413,'문자열이 너무 큽니다.');
    if(Array.isArray(v)) v.forEach(x=>walk(x)); else if(object(v)) Object.entries(v).forEach(([k,x])=>walk(x,k));
  }
  walk(p); serialize(p); return p;
}
function publicUrl(value:any) {
  if(typeof value!=='string')fail(400,'공개 URL 문자열이 필요합니다.');
  let url:URL;try {url=new URL(value);} catch {return fail(400,'공개 http(s) URL이 필요합니다.');}
  const h=url.hostname.toLowerCase();
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!h.includes('.')||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.includes(':')||/^\d+(?:\.\d+){3}$/.test(h)||/(?:token|password|secret|api.?key)=/i.test(url.search)) fail(400,'자격증명 및 내부 주소는 허용되지 않습니다.');
  return url.href;
}
function canonical(value:any):any {if(Array.isArray(value))return value.map(canonical);if(object(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
async function hash(value:string|Uint8Array) {const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function validMarketingToken(actual:string,expected:string) {const a=await hash(actual),b=await hash(expected);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function sameOrigin(request:Request) {const origin=new URL(request.url).origin,supplied=request.headers.get('origin');let referer='';try{referer=new URL(request.headers.get('referer')||'').origin;}catch{} if(supplied?supplied!==origin:referer!==origin) fail(403,'동일 출처 요청만 허용됩니다.');}
// 보고서 조회는 자기 캠퍼스 선생님·직원 모두 가능. 채널 변경과 수동 수집은 아래에서 관리자만 허용한다.
function campusMember(context:DataCoreAccessContext,campusId:unknown) {return context.memberships.some(m=>m.organizationId===ORG&&Boolean(m.campusId)&&m.campusId===campusId);}
function authorized(context:DataCoreAccessContext) {requireAuthenticatedAccess(context);if(!context.isSuperAdmin&&!context.memberships.some(m=>m.organizationId===ORG&&m.campusId)) fail(403,'소속 캠퍼스가 있는 계정 또는 MASTER 권한이 필요합니다.');}
function campusManager(context:DataCoreAccessContext,campusId:unknown) {return context.isSuperAdmin||context.memberships.some(m=>m.organizationId===ORG&&m.role==='CAMPUS_ADMIN'&&m.campusId===campusId);}
async function campuses(db:D1Database,context:DataCoreAccessContext) {authorized(context);const list=await listAccessibleCampuses(db,context);return list.filter(c=>CAMPUS_DIRECTORY.some(x=>x.id===c.id)&&(context.isSuperAdmin||campusMember(context,c.id)));}
function selectCampus(list:Row[],id:string|null) {if(id&&!list.some(c=>c.id===id))fail(403,'접근 가능한 활성 캠퍼스를 선택하세요.');return id?list.filter(c=>c.id===id):list;}
function parse(row:Row) {try{return JSON.parse(row.metadata_json);}catch{return {};}}
async function present(db:D1Database,row:Row) {const m=parse(row);const images=await db.prepare('SELECT id, original_file_name FROM file_objects WHERE data_record_id=? AND organization_id=? AND campus_id=? AND source_app=? AND category=? AND deleted_at IS NULL').bind(row.id,ORG,row.campus_id,MARKETING_SOURCE,'marketing-report').all<Row>();return {...m.payload,id:row.id,campusId:row.campus_id,campusName:campusDisplayName(row.campus_id,row.campus_name),status:m.status,imageFiles:(images.results||[]).map(f=>({id:f.id,name:f.original_file_name,url:'/api/data-core/files/'+encodeURIComponent(f.id)})),createdAt:row.created_at,updatedAt:row.updated_at};}
export async function validateMarketingPng(file:File) {
  if(file.type!=='image/png'||!file.name.toLowerCase().endsWith('.png'))fail(415,'PNG 원본만 허용됩니다.');
  if(file.size>10*1024*1024)fail(413,'이미지당 최대 10MB입니다.');
  const b=new Uint8Array(await file.arrayBuffer()),view=new DataView(b.buffer);
  if(b.length<45||[137,80,78,71,13,10,26,10].some((v,i)=>b[i]!==v))fail(415,'실제 PNG 원본이 필요합니다.');
  let offset=8,ihdr=false,idat=false,end=false;
  while(offset+12<=b.length){const n=view.getUint32(offset);if(n>b.length-offset-12)fail(415,'손상된 PNG입니다.');const type=String.fromCharCode(...b.subarray(offset+4,offset+8));let crc=0xffffffff;for(let i=offset+4;i<offset+8+n;i++){crc^=b[i];for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==view.getUint32(offset+8+n))fail(415,'PNG 체크섬 오류입니다.');if(!ihdr){if(type!=='IHDR'||n!==13)fail(415,'PNG 헤더가 필요합니다.');const w=view.getUint32(offset+8),h=view.getUint32(offset+12);if(!w||!h||w*h>8000000)fail(415,'PNG 해상도 오류입니다.');ihdr=true;}if(type==='IDAT'&&n>0)idat=true;offset+=n+12;if(type==='IEND'){if(n!==0||offset!==b.length)fail(415,'PNG 종료 형식 오류입니다.');end=true;break;}}
  if(!ihdr||!idat||!end)fail(415,'완전한 PNG가 필요합니다.');
  try {decodePng(b);} catch {fail(415,'PNG 픽셀 데이터가 손상되었습니다.');}
  return b;
}
async function ingest(request:Request,env:MarketingEnv) {
  const db=env.DB!;let owner:string;
  if(request.headers.has('authorization')) {
    if(!env.MARKETING_INGEST_TOKEN)fail(503,'MARKETING_INGEST_TOKEN 미설정입니다.');
    const header=request.headers.get('authorization')||'';
    if(!header.startsWith('Bearer ')||!await validMarketingToken(header.slice(7),env.MARKETING_INGEST_TOKEN))fail(401,'수집 인증에 실패했습니다.');
    await ensureDataCoreDatabase(db);
    const master=await db.prepare("SELECT u.id FROM users u INNER JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.campus_id IS NULL AND m.role IN ('MASTER','SUPER_ADMIN') AND u.status='active' ORDER BY CASE m.role WHEN 'MASTER' THEN 0 ELSE 1 END,u.id LIMIT 1").bind(ORG).first<{id:string}>();
    if(!master)fail(503,'활성 조직 MASTER 계정이 필요합니다.');owner=master.id;
  } else {const context=await resolveDataCoreAccess(request,db,env.DATA_CORE_SUPER_ADMIN_EMAILS);authorized(context);if(!context.isSuperAdmin)fail(403,'수동 수집은 MASTER 전용입니다.');sameOrigin(request);owner=context.user!.internalUserId;}
  if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))fail(415,'multipart/form-data가 필요합니다.');
  if(Number(request.headers.get('content-length')||0)>41*1024*1024)fail(413,'요청이 너무 큽니다.');
  const form=await request.formData();if(form.getAll('payload').length!==1||typeof form.get('payload')!=='string')fail(400,'payload JSON 문자열이 필요합니다.');
  const text=String(form.get('payload'));if(new TextEncoder().encode(text).length>200000)fail(413,'payload 최대 200KB입니다.');let p:any;try{p=JSON.parse(text);}catch{fail(400,'payload JSON 오류입니다.');}p=validateMarketingPayload(p);
  const live=await db.prepare("SELECT id FROM campuses WHERE id=? AND organization_id=? AND status='active'").bind(p.campusId,ORG).first();if(!live)fail(400,'활성 캠퍼스가 아닙니다.');
  if (p.comparison?.status === 'observed') {
    const c = p.comparison;
    const baseline = await db.prepare("SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND campus_id=? AND record_type=? AND source_app=? AND status='active' AND deleted_at IS NULL")
      .bind(c.baselineReportId, ORG, p.campusId, MARKETING_REPORT, MARKETING_SOURCE).first<Row>();
    const original = baseline ? parse(baseline).payload : null;
    if (!original || original.runKind !== 'daily' || original.campusId !== p.campusId || original.reportDate !== c.baselineDate || !Number.isFinite(Date.parse(original.capturedAt)) || Date.parse(original.capturedAt) >= Date.parse(p.capturedAt) || original.environment?.comparisonScope !== p.environment.comparisonScope) fail(400,'동일 캠퍼스·관찰환경의 실제 이전 daily 기준 보고서를 확인할 수 없습니다.');
  }
  const entries=form.getAll('images');if(entries.length>4)fail(413,'최대 PNG 4개입니다.');
  const images=[];for(const entry of entries){if(!(entry instanceof File))fail(415,'PNG 파일이 필요합니다.');images.push({file:entry,bytes:await validateMarketingPng(entry)});}
  if(images.length&&!env.FILES)fail(503,'공통 R2 FILES 연결이 필요합니다.');
  const checks=[];for(const image of images)checks.push({name:image.file.name,hash:await hash(image.bytes)});
  const checksum=await hash(JSON.stringify(canonical({payload:p,images:checks}))),id='marketing:'+await hash(p.campusId+'\n'+p.runId);
  const existing=await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<Row>();
  if(existing){if(parse(existing).checksum!==checksum)fail(409,'동일 runId의 내용이 달라 기존 보고서를 변경하지 않습니다.');return json({ok:true,existing:true,report:await present(db,existing)});}
  const now=new Date().toISOString(),staged:{id:string;key:string;file:File;bytes:Uint8Array}[]=[];
  const complete=images.length>0&&['naver','google'].every(n=>p.platforms[n]?.status==='observed'&&p.platforms[n]?.keywords.length===13&&p.platforms[n].keywords.every((k:any)=>['observed','not_exposed'].includes(k.adStatus)))&&['blog','instagram','website'].every(n=>p.channels[n]?.status==='observed');
  const metadata=serialize({schemaVersion:1,checksum,payload:p,status:complete?'complete':'partial'});
  try {
    for(const image of images){const fid=crypto.randomUUID(),key=['data-core','documents-private',ORG,p.campusId,'marketing-report',id,fid+'.png'].join('/');staged.push({id:fid,key,...image});await env.FILES!.put(key,image.bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{dataCoreFileId:fid,organizationId:ORG,campusId:p.campusId,sourceApp:MARKETING_SOURCE,category:'marketing-report',ownerUserId:owner,dataRecordId:id,visibility:'campus'}});}
    const statements=[db.prepare("INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'campus','active',?,?,?)").bind(id,ORG,p.campusId,owner,MARKETING_REPORT,MARKETING_SOURCE,p.reportDate+' '+p.runKind+' 마케팅 보고서',metadata,now,now)];
    for(const f of staged)statements.push(db.prepare("INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at) VALUES (?,?,?,?,?,'documents-private','marketing-report',?,?,?,'image/png',?,'campus',?)").bind(f.id,ORG,p.campusId,id,owner,MARKETING_SOURCE,f.key,f.file.name,f.bytes.length,now));
    statements.push(db.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,?,'data_record',?,?,?)").bind(crypto.randomUUID(),ORG,p.campusId,owner,'marketing.ingest',id,JSON.stringify({runId:p.runId,runKind:p.runKind,imageFileIds:staged.map(f=>f.id)}),now));
    for (const f of staged) statements.push(db.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,?,'file_object',?,?,?)").bind(crypto.randomUUID(),ORG,p.campusId,owner,'marketing.file.upload',f.id,JSON.stringify({dataRecordId:id}),now));
    await db.batch(statements);
  }catch {
    // A transport error can happen after the atomic batch committed. Never delete
    // R2 objects which a persisted file row still references, including our own run.
    let race: Row | null;
    const unregistered: typeof staged = [];
    try {
      race=await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<Row>();
      for (const f of staged) {
        const persisted=await db.prepare('SELECT id FROM file_objects WHERE id=? AND organization_id=? AND r2_key=?').bind(f.id,ORG,f.key).first();
        if (!persisted) unregistered.push(f);
      }
    } catch {return json({error:'저장 결과 확인이 불가능합니다. 원본은 보존했으며 동일 runId로 재시도하세요.',code:'commit_state_unknown'},500);}
    const cleanup=await Promise.allSettled(unregistered.map(f=>env.FILES!.delete(f.key)));
    if(cleanup.some(x=>x.status==='rejected'))return json({error:'저장 실패 및 R2 정리 실패. 운영자 원본 정리 확인이 필요합니다.',code:'cleanup_failed'},500);
    if(race){if(parse(race).checksum!==checksum)fail(409,'동일 runId 충돌입니다.');return json({ok:true,existing:true,report:await present(db,race)});}
    return json({error:'저장에 실패했습니다. 동일 runId로 재시도하세요.',code:'ingest_failed'},500);
  }
  const row=await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(id,ORG).first<Row>();return json({ok:true,existing:false,report:await present(db,row!)},201);
}
async function profiles(db:D1Database,ids:string[]) {if(!ids.length)return [];const rows=await db.prepare('SELECT * FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL AND campus_id IN ('+ids.map(()=>'?').join(',')+')').bind(ORG,MARKETING_PROFILE,...ids).all<Row>();return (rows.results||[]).map(r=>({id:r.id,campusId:r.campus_id,...parse(r),updatedAt:r.updated_at}));}
export async function handleMarketingApi(request:Request,env:MarketingEnv):Promise<Response|null> {
  const url=new URL(request.url),base='/api/data-core/marketing',route=url.pathname.slice(base.length);
  if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return null;
  try {
    if(!env.DB)fail(503,'DATA CORE DB 연결이 필요합니다.');
    if(route==='/ingest'&&request.method==='POST')return await ingest(request,env);
    const context=await resolveDataCoreAccess(request,env.DB,env.DATA_CORE_SUPER_ADMIN_EMAILS),list=await campuses(env.DB,context);
    const selected=selectCampus(list,url.searchParams.get('campusId')),ids=selected.map(c=>String(c.id));
    if(route==='/config'&&request.method==='GET')return json({campuses:list,keywords:MARKETING_KEYWORDS,schedule:{time:'13:30',timezone:'Asia/Seoul'},capabilities:{ingestConfigured:Boolean(env.MARKETING_INGEST_TOKEN)},channelProfiles:await profiles(env.DB,list.map(c=>String(c.id)))});
    if(route==='/channels'&&request.method==='GET')return json({channelProfiles:await profiles(env.DB,ids)});
    if(route==='/channels'&&request.method==='PUT') {sameOrigin(request);const body=await request.json() as any;selectCampus(list,body.campusId);if(!campusManager(context,body.campusId))fail(403,'채널 설정은 캠퍼스 관리자 또는 MASTER만 바꿀 수 있습니다.');if(!body.campusId||!object(body.channels))fail(400,'campusId와 channels가 필요합니다.');const channels:Row={};for(const [name,value] of Object.entries(body.channels)){if(!['blog','instagram','website'].includes(name))fail(400,'지원하지 않는 채널입니다.');channels[name]=value===null?null:publicUrl(value);}const id='marketing-channel:'+body.campusId,now=new Date().toISOString();await env.DB.batch([env.DB.prepare("INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'campus','active',?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_at=excluded.updated_at WHERE data_records.record_type=excluded.record_type AND data_records.organization_id=excluded.organization_id AND data_records.campus_id=excluded.campus_id").bind(id,ORG,body.campusId,context.user!.internalUserId,MARKETING_PROFILE,MARKETING_SOURCE,'공식 채널',serialize({channels}),now,now),env.DB.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,'marketing.channels.update','data_record',?,'{}',?)").bind(crypto.randomUUID(),ORG,body.campusId,context.user!.internalUserId,id,now)]);return json({ok:true,channelProfiles:await profiles(env.DB,[body.campusId])});}
    if(route==='/reports'&&request.method==='GET') {
      const date=url.searchParams.get('date');if(date)validDate(date);const raw=url.searchParams.get('limit')||'30';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>100)fail(400,'limit은 1~100입니다.');
      if(!ids.length)return json({reports:[],coverage:{campuses:[],latestDaily:[],latestSample:[]}});
      const filter='organization_id=? AND record_type=? AND deleted_at IS NULL AND campus_id IN ('+ids.map(()=>'?').join(',')+')',args:any[]=[ORG,MARKETING_REPORT,...ids];
      const rows=await env.DB.prepare('SELECT * FROM data_records WHERE '+filter+(date?" AND json_extract(metadata_json,'$.payload.reportDate')=?":'')+" ORDER BY json_extract(metadata_json,'$.payload.capturedAt') DESC,created_at DESC,id DESC LIMIT ?").bind(...args,...(date?[date]:[]),Number(raw)).all<Row>();
      const latest=await env.DB.prepare("SELECT campus_id,json_extract(metadata_json,'$.payload.runKind') AS kind,MAX(json_extract(metadata_json,'$.payload.capturedAt')) AS capturedAt FROM data_records WHERE "+filter+" GROUP BY campus_id,json_extract(metadata_json,'$.payload.runKind')").bind(...args).all<Row>();
      return json({reports:await Promise.all((rows.results||[]).map(r=>present(env.DB!,r))),coverage:{campuses:selected,latestDaily:(latest.results||[]).filter(r=>r.kind==='daily'),latestSample:(latest.results||[]).filter(r=>r.kind==='sample')}});
    }
    if(/^\/reports\/[^/]+$/.test(route)&&request.method==='GET') {const id=decodeURIComponent(route.slice('/reports/'.length)),row=await env.DB.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(id,ORG,MARKETING_REPORT).first<Row>();if(!row)fail(404,'보고서를 찾을 수 없습니다.');selectCampus(list,row.campus_id);return json({report:await present(env.DB,row)});}
    return json({error:'지원하지 않는 마케팅 API입니다.'},404);
  }catch(error){return json({error:error instanceof AccessError?error.message:'마케팅 API 처리에 실패했습니다.'},error instanceof AccessError?error.status:500);}
}

import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess, resolveDataCoreAccess } from './data-core-access';
import { readAdmissionsState } from './data-core-admissions-knowledge-sync';
import { managementDeletedIds } from './university-management';
import { SCOPE_RECORD_ID, SCOPE_RECORD_TYPE, SCOPE_VERSION, scopePlan, excludedIds } from '../public/data-core/university-scope-model.js';

type Entry = {id:string;name:string};
type Metadata = {version:1;revision:number;active:boolean;excluded:Entry[];scopeVersion:string};
type Source = Record<string,any>[];
type Env = {DB?:D1Database;FILES?:R2Bucket;DATA_CORE_SUPER_ADMIN_EMAILS?:string};
const headers = {'cache-control':'private, no-store'};
function staff(context:DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.memberships.some(m=>m.organizationId===DEFAULT_ORGANIZATION_ID && ['TEACHER','STAFF','CAMPUS_ADMIN','CAMPUS_DIRECTOR'].includes(m.role))) throw new DataCoreAccessError(403,'교직원만 대학 범위를 조회할 수 있습니다.');
}
async function stored(db:D1Database) {
  const row=await db.prepare("SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND campus_id IS NULL AND source_app='admissions' AND record_type=? AND deleted_at IS NULL")
    .bind(SCOPE_RECORD_ID,DEFAULT_ORGANIZATION_ID,SCOPE_RECORD_TYPE).first<{metadata_json:string}>();
  if(!row)return null;
  let data:Metadata;try{data=JSON.parse(row.metadata_json);}catch{throw new DataCoreAccessError(503,'대학 범위 기록을 확인할 수 없습니다.');}
  if(data.version!==1 || !Number.isSafeInteger(data.revision) || data.revision<1 || typeof data.active!=='boolean' || !Array.isArray(data.excluded) || data.excluded.some(e=>!e||typeof e.id!=='string'||typeof e.name!=='string')) throw new DataCoreAccessError(503,'대학 범위 기록이 올바르지 않습니다.');
  return {raw:row.metadata_json,data};
}
function view(rows:Source, data:Metadata|null, context:DataCoreAccessContext) {
  const ids=data?.active?excludedIds(rows,data.excluded):[];
  const idSet=new Set(ids);
  const excluded=(data?.excluded||[]).filter(e=>idSet.has(e.id));
  return {active:data?.active||false,revision:data?.revision||0,version:1,excludedIds:ids,excluded,
    keptCount:rows.length-ids.length,missing:scopePlan(rows.filter(r=>!idSet.has(String(r.id)))).missing,canManage:context.isSuperAdmin};
}
export async function universityScopeData(db:D1Database,context:DataCoreAccessContext,universities:unknown) {
  const rows=(Array.isArray(universities)?universities:[]) as Source;
  const record=await stored(db);
  const scope=view(rows,record?.data||null,context);
  return {_universityScope:scope,_universityRecommendationExcludedIds:scope.excludedIds,
    _universityManagementDeletedIds:record?scope.excludedIds:await managementDeletedIds(db,rows)};
}
function validIds(value:unknown,rows:Source):string[] {
  if(!Array.isArray(value)||!value.length||value.length>5000||value.some(id=>typeof id!=='string'||!id.trim()||id!==id.trim()||id.length>240||/[\u0000-\u001f\u007f]/.test(id))) throw new DataCoreAccessError(400,'유효한 대학 ID를 1~5000개 지정하세요.');
  const ids=[...new Set(value)] as string[];
  const known=new Set(rows.map(r=>String(r.id)));
  if(ids.some(id=>!known.has(id)))throw new DataCoreAccessError(400,'원본에 없는 대학 ID입니다.');
  return ids;
}
export async function handleUniversityScopeApi(request:Request,env:Env):Promise<Response> {
  try {
    if(!env.DB)throw new DataCoreAccessError(503,'데이터베이스 연결이 필요합니다.');
    const db=env.DB,context=await resolveDataCoreAccess(request,db,env.DATA_CORE_SUPER_ADMIN_EMAILS);
    staff(context);
    if(!['GET','POST'].includes(request.method))return Response.json({error:'허용되지 않는 메서드입니다.'},{status:405,headers:{...headers,allow:'GET, POST'}});
    if(request.method==='POST') {
      if(!context.isSuperAdmin)throw new DataCoreAccessError(403,'마스터 관리자만 대학 범위를 변경할 수 있습니다.');
      if(request.headers.get('origin')!==new URL(request.url).origin)throw new DataCoreAccessError(403,'동일 출처 요청만 허용됩니다.');
    }
    const state=await readAdmissionsState(db,env.FILES);
    const rows=(Array.isArray(state.universities)?state.universities:[]) as Source;
    const record=await stored(db),current=record?.data||null;
    if(request.method==='GET')return Response.json(view(rows,current,context),{headers});
    let body:Record<string,unknown>;
    try{body=await request.json();}catch{throw new DataCoreAccessError(400,'올바른 JSON 요청이 필요합니다.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new DataCoreAccessError(400,'요청이 올바르지 않습니다.');
    const action=body.action;
    if(!['preview','apply','restore','hide','reset'].includes(String(action)))throw new DataCoreAccessError(400,'알 수 없는 작업입니다.');
    // Never accept client-provided source rows, names or exclusion records.
    const allowed=new Set(['action','expectedRevision',...(action==='hide'||action==='restore'?['ids']:[])]);
    if(Object.keys(body).some(key=>!allowed.has(key)))throw new DataCoreAccessError(400,'원본 데이터는 요청으로 전달할 수 없습니다.');
    const plan=scopePlan(rows);
    if(action==='preview')return Response.json({...plan,revision:current?.revision||0,active:current?.active||false,canManage:true,excludedIds:plan.excluded.map((e:Entry)=>e.id),totalCount:rows.length,excludedCount:plan.excluded.length,scopeVersion:plan.version,version:1},{headers});
    if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new DataCoreAccessError(400,'expectedRevision이 필요합니다.');
    if(body.expectedRevision!==(current?.revision||0))throw new DataCoreAccessError(409,'대학 범위가 변경되었습니다. 새로고침 후 다시 시도하세요.');
    const inheritedIds = current ? (current.active ? excludedIds(rows,current.excluded) : []) : await managementDeletedIds(db,rows);
    const liveIds=new Set(inheritedIds);
    let excluded:Entry[]=rows.filter(r=>liveIds.has(String(r.id))).map(r=>({id:String(r.id),name:r.name}));
    let active=true;
    if(action==='apply')excluded=plan.excluded;
    if(action==='reset'){active=false;excluded=[];}
    if(action==='hide'||action==='restore') {
      const ids=new Set(validIds(body.ids,rows));
      if(action==='restore')excluded=excluded.filter(e=>!ids.has(e.id));
      else {
        const merged=new Map(excluded.map(e=>[e.id,e]));
        for(const row of rows)if(ids.has(String(row.id)))merged.set(String(row.id),{id:String(row.id),name:row.name});
        excluded=[...merged.values()];
      }
    }
    const next:Metadata={version:1,scopeVersion:SCOPE_VERSION,revision:(current?.revision||0)+1,active,excluded};
    const now=new Date().toISOString(),raw=JSON.stringify(next);
    const mutation=record?db.prepare('UPDATE data_records SET metadata_json=?, updated_at=? WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL AND metadata_json=?')
      .bind(raw,now,SCOPE_RECORD_ID,DEFAULT_ORGANIZATION_ID,SCOPE_RECORD_TYPE,record.raw):
      db.prepare("INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,NULL,?,?,'admissions','대학 관리 범위','organization','active',?,?,?) ON CONFLICT(id) DO NOTHING")
      .bind(SCOPE_RECORD_ID,DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,SCOPE_RECORD_TYPE,raw,now,now);
    // D1 batch is transactional; changes() gates the audit on the preceding CAS.
    const audit=db.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) SELECT ?,?,NULL,?,?,?,?,?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,'university-scope.'+action,SCOPE_RECORD_TYPE,SCOPE_RECORD_ID,JSON.stringify({revision:next.revision,active,excludedCount:excluded.length,scopeVersion:SCOPE_VERSION}),now);
    const result=await db.batch([mutation,audit]);
    if(Number(result[0]?.meta?.changes)!==1)throw new DataCoreAccessError(409,'대학 범위가 변경되었습니다. 새로고침 후 다시 시도하세요.');
    return Response.json(view(rows,next,context),{headers});
  } catch(error) {
    return Response.json({error:error instanceof DataCoreAccessError?error.message:'대학 범위를 처리하지 못했습니다.'},{status:error instanceof DataCoreAccessError?error.status:503,headers});
  }
}

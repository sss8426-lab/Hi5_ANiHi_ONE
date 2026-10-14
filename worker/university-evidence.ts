import { DEFAULT_ORGANIZATION_ID } from './data-core';
import officialCatalog from '../public/data-core/official-admissions-evidence.json';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess, resolveDataCoreAccess } from './data-core-access';

export const EVIDENCE_RECORD_ID = 'admissions-official-evidence:current';
export const EVIDENCE_RECORD_TYPE = 'admissions-official-evidence';
type Metadata = {version:1;revision:number;catalog:Record<string,unknown>};
type Env = {DB?:D1Database;DATA_CORE_SUPER_ADMIN_EMAILS?:string};
const headers = {'cache-control':'private, no-store'};
function requireStaff(context:DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if(!context.isSuperAdmin&&!context.memberships.some(m=>m.organizationId===DEFAULT_ORGANIZATION_ID&&['TEACHER','STAFF','CAMPUS_ADMIN','CAMPUS_DIRECTOR'].includes(m.role)))throw new DataCoreAccessError(403,'교직원만 공식 입시 근거를 조회할 수 있습니다.');
}
async function stored(db:D1Database) {
  const row=await db.prepare("SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND campus_id IS NULL AND source_app='admissions' AND record_type=? AND deleted_at IS NULL")
    .bind(EVIDENCE_RECORD_ID,DEFAULT_ORGANIZATION_ID,EVIDENCE_RECORD_TYPE).first<{metadata_json:string}>();
  if(!row)return null;
  let data:Metadata;
  try{data=JSON.parse(row.metadata_json);}catch{throw new DataCoreAccessError(503,'공식 입시 근거 기록을 읽지 못했습니다.');}
  if(data?.version!==1||!Number.isSafeInteger(data.revision)||data.revision<1||!data.catalog||typeof data.catalog!=='object'||Array.isArray(data.catalog))throw new DataCoreAccessError(503,'공식 입시 근거 기록이 올바르지 않습니다.');
  return {raw:row.metadata_json,data};
}
function view(data:Metadata|null,context:DataCoreAccessContext) {
  return {version:1,revision:data?.revision||0,catalog:data?.catalog||null,canManage:context.isSuperAdmin};
}
export async function universityEvidenceData(db:D1Database,context:DataCoreAccessContext) {
  return view((await stored(db))?.data||null,context);
}
export async function handleUniversityEvidenceApi(request:Request,env:Env):Promise<Response> {
  try {
    if(!env.DB)throw new DataCoreAccessError(503,'데이터베이스 연결이 필요합니다.');
    const db=env.DB,context=await resolveDataCoreAccess(request,db,env.DATA_CORE_SUPER_ADMIN_EMAILS);
    requireStaff(context);
    if(!['GET','POST'].includes(request.method))return Response.json({error:'허용되지 않는 메서드입니다.'},{status:405,headers:{...headers,allow:'GET, POST'}});
    if(request.method==='POST') {
      if(!context.isSuperAdmin)throw new DataCoreAccessError(403,'마스터 관리자만 공식 입시 근거를 적용할 수 있습니다.');
      if(request.headers.get('origin')!==new URL(request.url).origin)throw new DataCoreAccessError(403,'동일 출처 요청만 허용됩니다.');
    }
    const record=await stored(db),current=record?.data||null;
    if(request.method==='GET')return Response.json(view(current,context),{headers});
    let body:Record<string,unknown>;
    try{body=await request.json();}catch{throw new DataCoreAccessError(400,'올바른 JSON 요청이 필요합니다.');}
    if(!body||typeof body!=='object'||Array.isArray(body)||body.action!=='apply'||Object.keys(body).some(key=>!['action','expectedRevision'].includes(key)))throw new DataCoreAccessError(400,'서버에서 검증한 공식 카탈로그만 적용할 수 있습니다.');
    if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0||Number(body.expectedRevision)>=Number.MAX_SAFE_INTEGER)throw new DataCoreAccessError(400,'올바른 expectedRevision이 필요합니다.');
    if(body.expectedRevision!==(current?.revision||0))throw new DataCoreAccessError(409,'공식 근거가 변경되었습니다. 새로고침 후 다시 시도하세요.');
    // The catalog is bundled with this deployment, never accepted from a caller.
    const next:Metadata={version:1,revision:(current?.revision||0)+1,catalog:officialCatalog};
    const now=new Date().toISOString(),raw=JSON.stringify(next);
    const mutation=record?db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL AND metadata_json=?')
      .bind(raw,now,EVIDENCE_RECORD_ID,DEFAULT_ORGANIZATION_ID,EVIDENCE_RECORD_TYPE,record.raw):
      db.prepare("INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,?,NULL,?,?,'admissions','공식 입시 근거','organization','active',?,?,?) ON CONFLICT(id) DO NOTHING")
      .bind(EVIDENCE_RECORD_ID,DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,EVIDENCE_RECORD_TYPE,raw,now,now);
    // D1 executes both statements atomically; audit only the successful CAS.
    const audit=db.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) SELECT ?,?,NULL,?,?,?,?,?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),DEFAULT_ORGANIZATION_ID,context.user!.internalUserId,'university-evidence.apply',EVIDENCE_RECORD_TYPE,EVIDENCE_RECORD_ID,JSON.stringify({revision:next.revision,observedAt:officialCatalog.observedAt,coverageStatus:officialCatalog.coverageStatus}),now);
    const result=await db.batch([mutation,audit]);
    if(Number(result[0]?.meta?.changes)!==1)throw new DataCoreAccessError(409,'공식 근거가 변경되었습니다. 새로고침 후 다시 시도하세요.');
    return Response.json(view(next,context),{headers});
  }catch(error) {
    return Response.json({error:error instanceof DataCoreAccessError?error.message:'공식 입시 근거를 처리하지 못했습니다.'},{status:error instanceof DataCoreAccessError?error.status:503,headers});
  }
}

import {DEFAULT_ORGANIZATION_ID as ORG} from './data-core';
import {DataCoreAccessContext,DataCoreAccessError,requireWriteAccess} from './data-core-access';

export type UsageEnv={OPENAI_ADMIN_KEY?:string;OPENAI_PROJECT_ID?:string};
type Budget={amount:number;source:'app'|'official';policy:'informational'|'hard'|'inactive';currency:'USD';stale?:boolean};
type Snapshot={cost:number|null;budget:Budget|null;updatedAt:string|null;attemptedAt:string;state:string};
const TYPE='content-ai-usage', TTL=300000;
const pending=new WeakMap<D1Database,Map<string,Promise<Snapshot>>>();
const error=(status:number,message:string):never=>{throw new DataCoreAccessError(status,message);};
const project=(env:UsageEnv)=>env.OPENAI_PROJECT_ID?.trim()||null;
const scope=(env:UsageEnv)=>project(env)||'unconfigured';
const budgetId=(env:UsageEnv)=>`ai-budget:${ORG}:${scope(env)}`;

async function read<T>(db:D1Database,id:string):Promise<T|null>{
  const row=await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND deleted_at IS NULL').bind(id,ORG,TYPE).first<{metadata_json:string}>();
  try{return row?JSON.parse(row.metadata_json):null;}catch{return null;}
}
async function write(db:D1Database,context:DataCoreAccessContext,id:string,metadata:unknown){
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO data_records(id,organization_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES(?,?,?,?,'data-core','AI usage','private','active',?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    WHERE data_records.organization_id=excluded.organization_id AND data_records.record_type=excluded.record_type`)
    .bind(id,ORG,context.user!.internalUserId,TYPE,JSON.stringify(metadata),now,now).run();
}
export async function saveAiBudget(db:D1Database,context:DataCoreAccessContext,env:UsageEnv,input:{amount?:unknown}){
  requireWriteAccess(context);if(!context.isSuperAdmin)error(403,'마스터만 예산을 설정할 수 있습니다.');
  if(typeof input.amount!=='number'||!Number.isFinite(input.amount)||input.amount<=0||input.amount>100000000)error(400,'0보다 큰 USD 월간 예산을 입력하세요.');
  const budget:Budget={amount:Math.round((input.amount as number)*100)/100,currency:'USD',source:'app',policy:'informational'};
  if(budget.amount<=0)error(400,'예산은 최소 0.01 USD입니다.');
  await write(db,context,budgetId(env),budget);return {budget};
}
async function adminJson(env:UsageEnv,path:string){
  const response=await fetch('https://api.openai.com/v1/'+path,{headers:{authorization:`Bearer ${env.OPENAI_ADMIN_KEY}`},signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(!response.ok){await response.body?.cancel();throw new Error([401,403].includes(response.status)?'permission_required':'unavailable');}
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024*1024){await reader.cancel();throw new Error('unavailable');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function refresh(db:D1Database,context:DataCoreAccessContext,env:UsageEnv,start:number,end:number,id:string,prior:Snapshot|null):Promise<Snapshot>{
  const attemptedAt=new Date().toISOString();
  if(!env.OPENAI_ADMIN_KEY||!project(env))return {cost:null,budget:null,updatedAt:null,attemptedAt,state:!project(env)?'project_required':'permission_required'};
  let budget:Budget|null=null;
  try{
    const limit=await adminJson(env,`organization/projects/${encodeURIComponent(project(env)!)}/spend_limit`);
    if(limit.object==='project.spend_limit'&&limit.currency==='USD'&&limit.interval==='month'&&Number.isFinite(limit.threshold_amount)&&limit.threshold_amount>0)
      budget={amount:limit.threshold_amount/100,currency:'USD',source:'official',policy:limit.enforcement?.status==='enforcing'?'hard':'inactive'};
  }catch{ /* A failed budget read must not silently replace an official limit. */ budget=prior?.budget?{...prior.budget,stale:true}:null; }
  let snapshot:Snapshot;
  try{
    let cost=0,page:string|null=null;const seen=new Set<string>();
    do{
      const params=new URLSearchParams({start_time:String(start),end_time:String(end),bucket_width:'1d',limit:'31','project_ids[]':project(env)!,'group_by[]':'project_id'});
      if(page)params.set('page',page);
      const result=await adminJson(env,'organization/costs?'+params);
      if(!Array.isArray(result.data)||typeof result.has_more!=='boolean')throw new Error('unavailable');
      for(const bucket of result.data){
        if(!Array.isArray(bucket.results))throw new Error('unavailable');
        for(const item of bucket.results){
          if(item.project_id!==project(env)||item.object!=='organization.costs.result'||item.amount?.currency!=='usd'||typeof item.amount.value!=='number'||!Number.isFinite(item.amount.value))throw new Error('unavailable');
          cost+=item.amount.value;
        }
      }
      page=result.has_more?result.next_page:null;
      if(result.has_more&&(!page||seen.has(page)||seen.size>=10))throw new Error('unavailable');
      if(page)seen.add(page);
    }while(page);
    snapshot={cost,budget,updatedAt:attemptedAt,attemptedAt,state:'current'};
  }catch(e){snapshot={cost:prior?.cost??null,budget,updatedAt:prior?.updatedAt??null,attemptedAt,state:e instanceof Error&&e.message==='permission_required'?'permission_required':'unavailable'};}
  await write(db,context,id,snapshot);return snapshot;
}
export async function aiUsage(db:D1Database,context:DataCoreAccessContext,env:UsageEnv){
  requireWriteAccess(context);
  const now=new Date(),start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000,end=Math.floor(now.getTime()/1000),month=now.toISOString().slice(0,7);
  const id=`ai-usage:${ORG}:${scope(env)}:${month}`;
  const prior=await read<Snapshot>(db,id);
  let snapshot=env.OPENAI_ADMIN_KEY&&project(env)?prior:null;
  if(!snapshot||Date.now()-Date.parse(snapshot.attemptedAt)>TTL){
    let map=pending.get(db);if(!map)pending.set(db,map=new Map());
    if(!map.has(id))map.set(id,refresh(db,context,env,start,end,id,prior).finally(()=>map!.delete(id)));
    snapshot=await map.get(id)!;
  }
  const budget=snapshot.budget||await read<Budget>(db,budgetId(env));
  const counts=await db.prepare(`SELECT COUNT(*) AS attempts,SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,MIN(created_at) AS since
    FROM data_records WHERE organization_id=? AND record_type='content-ai-call' AND created_at>=?
    AND json_extract(metadata_json,'$.projectScope')=?`).bind(ORG,new Date(start*1000).toISOString(),scope(env)).first<{attempts:number;confirmed:number;since:string|null}>();
  const connection=await db.prepare(`SELECT status,updated_at FROM data_records WHERE organization_id=? AND record_type='content-ai-call'
    AND json_extract(metadata_json,'$.projectScope')=? ORDER BY updated_at DESC LIMIT 1`).bind(ORG,scope(env)).first<{status:string;updated_at:string}>();
  return {period:month,timeZone:'UTC',scope:'공용 OpenAI 프로젝트',cost:snapshot.cost,currency:'USD',budget,percent:snapshot.cost!==null&&budget&&budget.amount>0?snapshot.cost/budget.amount*100:null,
    state:snapshot.state,updatedAt:snapshot.updatedAt,attemptedAt:snapshot.attemptedAt,source:snapshot.cost===null?'unknown':'official',canSetBudget:context.isSuperAdmin,
    calls:counts?.since?{attempts:counts.attempts,confirmed:counts.confirmed||0,unconfirmed:counts.attempts-(counts.confirmed||0),since:counts.since}:null,
    connection:connection?{state:connection.status==='confirmed'?'confirmed':'unconfirmed',checkedAt:connection.updated_at}:{state:'unverified',checkedAt:null}};
}
// One row per actual outbound attempt, including unknown outcomes. No inferred
// cost without validated rates, and no prompts, photos or raw response text.
export async function recordAiCall(db:D1Database,context:DataCoreAccessContext,id:string,sourceApp:string,status:string,usage?:unknown,env:UsageEnv={}){
  const safe:Record<string,number>={};
  if(usage&&typeof usage==='object')for(const key of ['input_tokens','output_tokens','total_tokens']){
    const value=(usage as Record<string,unknown>)[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)safe[key]=value;
  }
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO data_records(id,organization_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES(?,?,?,'content-ai-call',?,'AI call','private',?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind('ai-call:'+id,ORG,context.user!.internalUserId,sourceApp,status,JSON.stringify({usage:safe,projectScope:scope(env)}),now,now).run();
}

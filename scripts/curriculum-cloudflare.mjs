import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ORG } from './curriculum-tree.mjs';
const exec=promisify(execFile);
export function createCloudflareRequest(base, getCredentials, request=fetch, pause=ms=>new Promise(r=>setTimeout(r,ms))) {
  let credentialPromise;
  return async function raw(path,options={}) {
    let refreshed=false;
    for(let attempt=0;attempt<5;attempt++){
      const used=credentialPromise??=getCredentials(),credentials=await used;
      let response;
      try{response=await request(base+path,{...options,headers:{...options.headers,Authorization:`Bearer ${credentials.token}`},signal:AbortSignal.timeout(120000)});}catch{if(attempt===4)throw Error('Cloudflare 연결 실패. 원문은 출력하지 않았습니다.');}
      // Long imports may outlive an OAuth token. Wrangler refreshes it without exposing credentials.
      if(response?.status===401&&credentials.type==='oauth'&&!refreshed){
        await response.body?.cancel();
        if(credentialPromise===used)credentialPromise=getCredentials();
        refreshed=true;attempt--;continue;
      }
      if(response&&response.status!==429&&response.status<500)return response;
      await response?.body?.cancel();
      await pause(1000*2**attempt);
    }
    throw Error('Cloudflare 작업을 완료하지 못했습니다. 재실행 전 preview를 확인하세요.');
  };
}
export async function cloudflare(configPath,{nodePath=process.execPath,nodeArgs=[],wranglerPath=resolve('node_modules/wrangler/bin/wrangler.js'),env={}}={}) {
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const db=config.d1_databases?.find(b=>b.binding==='DB')?.database_id,bucket=config.r2_buckets?.find(b=>b.binding==='FILES')?.bucket_name;
  if(config.name!=='hi5-anihi-one'||!db||!bucket)throw Error('기존 HI5 Worker의 DB/FILES binding 확인이 필요합니다.');
  const run=async args=>{try{return JSON.parse((await exec(nodePath,[...nodeArgs,wranglerPath,...args],{windowsHide:true,maxBuffer:1_000_000,env:{...process.env,...env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'log'}})).stdout);}catch{throw Error('Cloudflare OAuth 인증이 필요합니다. 자격증명 원문은 출력하지 않았습니다.');}};
  // Wrangler credentials are captured only in process memory, never argv, files or logs.
  const getCredentials=async()=>{
    const credentials=await run(['auth','token','--json']);
    if(!['oauth','api_token'].includes(credentials.type)||!credentials.token)throw Error('Cloudflare OAuth/API token 인증을 확인하세요.');
    return credentials;
  };
  const who=await run(['whoami','--json']);
  const account=config.account_id||who.accounts?.[0]?.id;
  if(!account||(!config.account_id&&who.accounts?.length!==1))throw Error('Cloudflare account를 명시적으로 선택해야 합니다.');
  const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
  const raw=createCloudflareRequest(base,getCredentials);
  async function query(sql,params=[]){
    const r=await raw(`/d1/database/${db}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
    if(!r.ok)throw Error(`D1 query 실패 (${r.status}). SQL/응답 원문은 출력하지 않았습니다.`);
    const json=await r.json();if(!json.success||json.result.some(q=>!q.success))throw Error('D1 query 결과 확인 실패.');return json.result[0];
  }
  const scope="organization_id=? AND source_app='curriculum' AND record_type IN ('curriculum-folder','curriculum-page') AND json_valid(metadata_json) AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?";
  async function records(family,stage){return (await query(`SELECT id,title,record_type,status,deleted_at,metadata_json FROM data_records WHERE ${scope} ORDER BY id`,[ORG,family,stage])).results.map(r=>({...r,metadata:JSON.parse(r.metadata_json)}));}
  const objectPath=key=>`/r2/buckets/${encodeURIComponent(bucket)}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  async function objectHash(key){const r=await raw(objectPath(key));if(r.status===404)return null;if(!r.ok)throw Error(`R2 확인 실패 (${r.status})`);const h=createHash('sha256');for await(const chunk of r.body)h.update(chunk);return h.digest('hex');}
  async function put(asset){
    const existing=await objectHash(asset.key);
    if(existing){if(existing!==asset.sha256)throw Error('R2 fingerprint 충돌. 기존 객체를 덮어쓰지 않습니다.');return false;}
    const bytes=await readFile(asset.path);
    if(bytes.length!==asset.size||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('원본/파생 파일 변경 감지. 업로드 중단.');
    const r=await raw(objectPath(asset.key),{method:'PUT',headers:{'Content-Type':asset.mime,'Content-Length':String(bytes.length),'If-None-Match':'*','cf-r2-data-catalog-check':'true'},body:bytes});
    if(!r.ok)throw Error(`R2 업로드 실패 (${r.status}). 기존 객체 삭제 없음.`);
    return true;
  }
  return {query,records,put,objectHash,bucket,db,account};
}

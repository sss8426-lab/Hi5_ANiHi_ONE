// Read-only diagnostics with existing local Wrangler credentials, never copied into Worker secrets.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
const account=config.vars.CLOUDFLARE_USAGE_ACCOUNT_ID;
if(config.name!=='hi5-anihi-one'||!/^[a-f0-9]{32}$/.test(account))throw Error('Worker/account configuration required');
const run=args=>JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{windowsHide:true,encoding:'utf8',maxBuffer:1e6,env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}}));
const credential=run(['auth','token','--json']);
if(!credential.token)throw Error('Local credential unavailable');
const secrets=run(['secret','list']);
console.log(JSON.stringify({runtimeUsageSecretPresent:secrets.some(s=>s.name==='CLOUDFLARE_USAGE_API_TOKEN'),credentialSource:'existing local Wrangler; not installed in runtime'}));
for(const path of [`/accounts/${account}/billable-usage/info`,`/accounts/${account}/billable-usage`,'/graphql']){
  const body=path==='/graphql'?{query:'query($account:string!,$bucket:string,$start:Time){viewer{accounts(filter:{accountTag:$account}){r2StorageAdaptiveGroups(limit:1,filter:{bucketName:$bucket,datetime_geq:$start},orderBy:[datetime_DESC]){max{payloadSize metadataSize}dimensions{datetime}} r2OperationsAdaptiveGroups(limit:1,filter:{bucketName:$bucket,datetime_geq:$start}){sum{requests}dimensions{actionType}}}}}',variables:{account,bucket:config.r2_buckets.find(b=>b.binding==='FILES').bucket_name,start:new Date(Date.now()-86400000).toISOString()}}:undefined;
  try{
    const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${credential.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000),redirect:'manual'});
    const value=await response.json();
    console.log(JSON.stringify({endpoint:path.replace(account,'<account>'),status:response.status,success:value.success??!value.errors?.length,errorCodes:value.errors?.map(e=>e.code??e.extensions?.code??'unspecified'),covered:value.result?.covered,r2Rows:Array.isArray(value.result)?value.result.filter(r=>r.ServiceFamilyName==='R2').length:undefined,storageGroups:value.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.length,operationGroups:value.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups?.length}));
  }catch{console.log(JSON.stringify({endpoint:path.replace(account,'<account>'),state:'unavailable'}));}
}

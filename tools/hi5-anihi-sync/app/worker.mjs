import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { watch } from 'node:fs';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
const root=process.env.HI5_SYNC_ROOT,runtime=join(root,'.runtime'),local=process.env.HI5_SYNC_LOCAL_DIR;
const {SyncService,SettingsStore,safeError,safeBaseUrl}=await import(pathToFileURL(join(runtime,'scripts/curriculum-sync-core.mjs')));
const {cloudflare}=await import(pathToFileURL(join(runtime,'scripts/curriculum-cloudflare.mjs')));
const store=new SettingsStore(process.env.HI5_SYNC_USER_DIR);let settings=await store.load(),service;
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js');
const nodeArgs=['--require',join(root,'app/wrangler-node.cjs')];
const transportOptions={wranglerPath:wrangler,nodeArgs,env:{ELECTRON_RUN_AS_NODE:'1'}};
let connect=()=>cloudflare(join(runtime,'cloudflare.json'),transportOptions);
if(process.env.HI5_SYNC_TEST_REMOTE)connect=(await import(pathToFileURL(process.env.HI5_SYNC_TEST_REMOTE))).connect;
const notify=()=>process.send?.({type:'state',state:service.getState(),settings});
let watches=[],dirty=false;
function watchers(){
  for(const w of watches)w.close();watches=[];
  if(!settings.watch)return;
  for(const target of service.state.targets){try{const w=watch(target.source,{recursive:true},()=>{dirty=true;if(!service.busy){service.invalidate();dirty=false;}});w.on('error',()=>{dirty=true;});watches.push(w);}catch{/* Missing/disconnected drives are surfaced by scan. */}}
}
const logDir=join(local,'logs');await mkdir(logDir,{recursive:true});
async function log(code){
  const files=(await readdir(logDir)).filter(f=>/^sync-\d+\.json$/.test(f)).sort();
  while(files.length>=10)await unlink(join(logDir,files.shift()));
  await writeFile(join(logDir,`sync-${Date.now()}.json`),JSON.stringify({at:new Date().toISOString(),code}));
}
service=new SyncService({connect,cacheDir:join(local,'cache'),protectedPaths:[local,store.dir,root],settings,onChange:()=>{notify();if(!service.busy&&dirty){dirty=false;service.invalidate();}},onHistory:async entry=>{
  settings=await store.save({...settings,history:service.state.history,lastSync:Object.fromEntries(service.state.targets.filter(t=>t.lastSync).map(t=>[t.id,t.lastSync]))});
  await log(entry.status);
}});
let authenticating=false;
async function login(){
  if(service.busy||authenticating)return {error:{message:'현재 작업이 끝난 뒤 로그인해 주세요.'}};
  authenticating=true;
  try{
    await new Promise((resolve,reject)=>execFile(process.execPath,[...nodeArgs,wrangler,'login'],{windowsHide:true,timeout:300_000,maxBuffer:1_000_000,env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}},error=>error?reject(Error('OAuth')):resolve()));
    return await service.scan();
  }finally{authenticating=false;}
}
process.on('message',async({id,command,value})=>{
  try{
    let result;
    if(command==='state')result={...service.getState(),settings};
    else if(command==='scan'){result=await service.scan();watchers();}
    else if(command==='cancel'){service.cancel();result={ok:true};}
    else if(command==='confirm')result=service.confirm(value);
    else if(command==='apply')result=await service.apply(value?.token,value?.allowModified===true);
    else if(command==='login')result=await login();
    else if(command==='folder'){
      const path=await service.setSource(value?.id,value?.path);
      settings=await store.save({...settings,sources:{...settings.sources,[value.id]:path}});watchers();result={ok:true};notify();
    }else if(command==='settings'){
      if(service.busy)throw Object.assign(Error('busy'),{code:'busy'});
      settings=await store.save({...settings,baseUrl:safeBaseUrl(value?.baseUrl||settings.baseUrl),watch:value?.watch!==false,configured:true});watchers();notify();result={ok:true};
    }else throw Error('Unsupported command');
    process.send?.({id,result});
  }catch(e){const error=safeError(e);await log(error.code);process.send?.({id,result:{error}});}
});
watchers();notify();await service.scan();

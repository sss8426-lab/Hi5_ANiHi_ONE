import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { join, resolve, parse, relative, isAbsolute } from 'node:path';
import { inventoryTree, planInventory, diffInventory, prepareAssets, outsideSource, hash } from './curriculum-tree.mjs';
import { applyTree, verifyTree } from './import-curriculum-tree.mjs';

export const VERSION='1.0.0';
export const DEFAULT_URL='https://hi5-anihi-one.sss8426.workers.dev';
export const TARGETS=Object.freeze([
  {id:'content-basic',family:'content',stage:'basic',title:'기초과정',source:'D:\\애니하이 스스로 학습\\기초과정'},
  {id:'content-advanced',family:'content',stage:'advanced',title:'심화과정',source:'D:\\애니하이 스스로 학습\\심화과정'},
  {id:'content-admission',family:'content',stage:'admission',title:'입시과정',source:'D:\\애니하이 스스로 학습\\입시과정'},
]);
const digest=x=>hash(JSON.stringify(x));
const failure=code=>Object.assign(new Error(code),{code});
export function safeError(error){
  const text=String(error?.message||'');
  if(error?.name==='AbortError')return {code:'cancelled',message:'중지했습니다. 변경사항을 다시 확인하면 남은 자료부터 이어갑니다.'};
  if(error?.code==='ENOENT')return {code:'missing',message:'원본 폴더를 찾을 수 없습니다. 드라이브와 폴더 설정을 확인해 주세요.'};
  if(/OAuth|인증|401/.test(text))return {code:'auth',message:'중앙 서버 로그인이 필요합니다. 로그인 후 다시 확인해 주세요.'};
  if(/403/.test(text))return {code:'forbidden',message:'중앙 서버 권한이 없습니다. 관리자 Cloudflare 계정을 확인해 주세요.'};
  const messages={busy:'현재 작업을 마친 후 다시 시도해 주세요.',stale:'로컬 또는 중앙 데이터가 변경되었습니다. 변경사항을 다시 확인해 주세요.',modified:'수정파일 반영을 먼저 확인해 주세요.',blocked:'확인할 충돌 또는 미지원 파일이 있습니다. 상세 내용을 확인해 주세요.',invalid:'설정을 확인해 주세요.',verify:'반영 후 검증을 완료하지 못했습니다. 다시 검사해 주세요.'};
  if(messages[error?.code])return {code:error.code,message:messages[error.code]};
  // Never forward arbitrary SDK/OS errors, credentials, payloads or absolute paths.
  return {code:'connection',message:'작업을 완료하지 못했습니다. 연결을 확인하고 변경사항을 다시 검사해 주세요.'};
}
export function safeBaseUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw failure('invalid');
  return url.origin;
}
export function safeRelative(value){
  return typeof value==='string'&&!isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&![...value].some(c=>c.charCodeAt(0)<32)?value:'자료 경로 확인 필요';
}
export function describeDiff(tree,records){
  const plan=planInventory(tree,records),diff=diffInventory(plan,records);
  const activeIds=new Set(records.filter(r=>r.status==='active').map(r=>r.id));
  const details=[];
  for(const f of plan.folders)if(!records.some(r=>r.id===f.id))details.push({kind:'folder',path:safeRelative(f.relativePath)});
  for(const f of plan.files)if(!activeIds.has(f.id))details.push({kind:f.previousPageId?'modified':'new',path:safeRelative(f.relativePath)});
  for(const r of records.filter(r=>r.status==='active'&&!r.deleted_at&&!r.metadata.supersededByPageId)){
    const found=r.record_type==='curriculum-folder'?plan.folders.some(f=>f.id===r.id):plan.files.some(f=>f.relativePath===r.metadata.relativePath);
    if(!found)details.push({kind:'missing',path:safeRelative(r.metadata.relativePath)});
  }
  for(const b of tree.blockers)details.push({kind:'unsupported',path:safeRelative(b.path)});
  return {...diff,newFiles:diff.newPages-diff.changed,details};
}
export class SyncService {
  constructor({connect,cacheDir,protectedPaths=[],onChange=()=>{},onHistory=async()=>{},settings={}}){
    this.connect=connect;this.cacheDir=resolve(cacheDir);this.onChange=onChange;this.onHistory=onHistory;
    this.settings=settings;this.snapshots=new Map();this.confirmations=new Map();this.busy=false;this.controller=null;
    this.protectedPaths=[this.cacheDir,...protectedPaths.map(p=>resolve(p))];
    this.state={version:VERSION,busy:false,connection:'unknown',progress:null,targets:TARGETS.map(t=>({...t,source:settings.sources?.[t.id]||t.source,status:'waiting',selected:true,lastSync:settings.lastSync?.[t.id]||null})),history:settings.history||[]};
  }
  getState(){return structuredClone(this.state);}
  emit(){this.state.busy=this.busy;this.onChange(this.getState());}
  cancel(){this.controller?.abort();}
  invalidate(){this.snapshots.clear();this.confirmations.clear();for(const t of this.state.targets)if(t.status!=='missing')t.status='stale';this.emit();}
  async sourcePath(value){
    if(typeof value!=='string'||!isAbsolute(value)||resolve(value)===parse(resolve(value)).root)throw failure('invalid');
    const path=await realpath(value);
    for(const protectedPath of this.protectedPaths)outsideSource(path,protectedPath);
    return path;
  }
  async setSource(id,value){
    if(this.busy)throw failure('busy');
    const t=this.state.targets.find(t=>t.id===id);if(!t)throw failure('invalid');
    const path=await this.sourcePath(value);
    for(const other of this.state.targets.filter(t=>t.id!==id)){
      const rel=relative(resolve(other.source),path),back=relative(path,resolve(other.source));
      if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel))||(!back.startsWith('..')&&!isAbsolute(back)))throw failure('invalid');
    }
    t.source=path;this.invalidate();return path;
  }
  progress(id){return p=>{this.state.progress={targetId:id,...p,path:p.path?safeRelative(p.path):undefined};this.emit();};}
  async scan(){
    if(this.busy)throw failure('busy');this.busy=true;this.controller=new AbortController();this.snapshots.clear();this.confirmations.clear();
    const signal=this.controller.signal;this.state.error=null;this.emit();
    let remote,remoteError;
    try{
      try{remote=await this.connect();this.state.connection='connected';}catch(e){remoteError=safeError(e);this.state.connection=remoteError.code==='auth'?'auth':'error';}
      for(const target of this.state.targets){
        signal.throwIfAborted();target.status='scanning';target.error=null;target.diff=null;
        delete target.folders;delete target.files;delete target.sourceBytes;this.emit();
        try{
          const source=await this.sourcePath(target.source);
          const tree=await inventoryTree(source,target.family,target.stage,{signal,onProgress:this.progress(target.id)});
          target.folders=tree.folders.length;target.files=tree.files.length;target.sourceBytes=tree.sourceBytes;
          if(!remote){target.status='offline';target.error=remoteError;continue;}
          const records=await remote.records(target.family,target.stage);
          target.diff=describeDiff(tree,records);
          target.status=!target.diff.canApply?'blocked':target.diff.changed||target.diff.reviewNeeded?'review':target.diff.newPages||target.diff.newFolders?'new':'current';
          this.snapshots.set(target.id,{tree,records,sourceHash:digest(tree),remoteHash:digest(records)});
        }catch(e){if(signal.aborted)throw e;target.error=safeError(e);target.status=target.error.code==='missing'?'missing':'error';if(['auth','forbidden','connection'].includes(target.error.code))this.state.connection=target.error.code==='auth'?'auth':'error';}
        finally{this.emit();}
      }
    }catch(e){this.state.error=safeError(e);for(const t of this.state.targets)if(t.status==='scanning')t.status=signal.aborted?'cancelled':'error';}
    finally{this.busy=false;this.controller=null;this.state.progress=null;this.emit();}
    return this.getState();
  }
  confirm(ids){
    if(this.busy)throw failure('busy');
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!this.snapshots.has(id)))throw failure('stale');
    const targets=ids.map(id=>this.state.targets.find(t=>t.id===id));
    if(targets.some(t=>!t?.diff?.canApply))throw failure('blocked');
    const summary={newFolders:0,newFiles:0,modified:0,missing:0,automaticDeletes:0};
    for(const t of targets){summary.newFolders+=t.diff.newFolders;summary.newFiles+=t.diff.newFiles;summary.modified+=t.diff.changed;summary.missing+=t.diff.reviewNeeded;}
    const token=randomUUID();this.confirmations.clear();this.confirmations.set(token,{ids:[...ids],snapshots:ids.map(id=>this.snapshots.get(id)),summary});
    return {token,...summary};
  }
  async apply(token,allowModified=false){
    if(this.busy)throw failure('busy');
    const confirmation=this.confirmations.get(token);this.confirmations.clear();
    if(!confirmation)throw failure('stale');
    if(confirmation.summary.modified&&!allowModified)throw failure('modified');
    this.busy=true;this.controller=new AbortController();const signal=this.controller.signal;
    this.state.error=null;this.emit();const results=[];
    try{
      const remote=await this.connect();this.state.connection='connected';const fresh=[];
      // Check ALL selected scopes before the first write, not just the active scope.
      for(const [i,id] of confirmation.ids.entries()){
        const target=this.state.targets.find(t=>t.id===id),snapshot=confirmation.snapshots[i];
        if(this.snapshots.get(id)!==snapshot)throw failure('stale');
        const tree=await inventoryTree(target.source,target.family,target.stage,{signal,onProgress:this.progress(id)});
        const records=await remote.records(target.family,target.stage);
        if(digest(tree)!==snapshot.sourceHash||digest(records)!==snapshot.remoteHash)throw failure('stale');
        fresh.push({target,tree,records,snapshot});
      }
      for(const {target,tree,records,snapshot} of fresh){
        signal.throwIfAborted();target.status='syncing';this.emit();
        const plan=planInventory(tree,records),options={signal,onProgress:this.progress(target.id),operator:'hi5-anihi-sync'};
        const output=join(this.cacheDir,target.id);await mkdir(output,{recursive:true});
        let result={created:0,uploaded:0};
        const diff=diffInventory(plan,records);
        // An unchanged launch/confirmation does not write even an audit row.
        const reviewReset=records.some(r=>r.metadata.sourceReview&&[...plan.files,...plan.folders].some(f=>f.id===r.id));
        const missingNotMarked=records.some(r=>r.status==='active'&&!r.deleted_at&&!r.metadata.supersededByPageId&&!r.metadata.sourceReview&&!plan.files.some(f=>f.relativePath===r.metadata.relativePath)&&!plan.folders.some(f=>f.id===r.id));
        if(diff.newPages||diff.newFolders||reviewReset||missingNotMarked){
          await prepareAssets(plan,output,records,options);
          result=await applyTree(plan,remote,snapshot.remoteHash,options);
        }
        let verified;
        try{verified=await verifyTree(plan,remote,options);}catch(e){if(signal.aborted)throw e;throw failure('verify');}
        const after=await inventoryTree(target.source,target.family,target.stage,{signal});
        if(digest(after)!==snapshot.sourceHash)throw failure('verify');
        target.status='done';target.lastSync=new Date().toISOString();
        results.push({id:target.id,newFiles:target.diff.newFiles,modified:target.diff.changed,uploaded:result.uploaded,...verified});
        this.emit();
      }
      const entry={at:new Date().toISOString(),status:'success',targets:results};
      this.state.history=[entry,...this.state.history].slice(0,20);await this.onHistory(entry);return entry;
    }catch(e){
      const error=safeError(e);this.state.error=error;
      for(const t of this.state.targets)if(t.status==='syncing')t.status=error.code==='cancelled'?'cancelled':'error';
      const entry={at:new Date().toISOString(),status:error.code,targets:results};
      this.state.history=[entry,...this.state.history].slice(0,20);await this.onHistory(entry);return entry;
    }finally{this.busy=false;this.controller=null;this.snapshots.clear();this.state.progress=null;this.emit();}
  }
}

export class SettingsStore {
  constructor(dir){this.dir=resolve(dir);this.path=join(this.dir,'config.json');}
  clean(value={}){
    const sources={},lastSync={};
    for(const t of TARGETS){if(typeof value.sources?.[t.id]==='string'&&isAbsolute(value.sources[t.id]))sources[t.id]=value.sources[t.id];if(typeof value.lastSync?.[t.id]==='string'&&Number.isFinite(Date.parse(value.lastSync[t.id])))lastSync[t.id]=value.lastSync[t.id];}
    const history=(Array.isArray(value.history)?value.history:[]).slice(0,20).filter(h=>Number.isFinite(Date.parse(h.at))).map(h=>({at:h.at,status:['success','cancelled','auth','connection','verify','stale','forbidden'].includes(h.status)?h.status:'error',targets:(h.targets||[]).filter(t=>TARGETS.some(a=>a.id===t.id)).map(t=>({id:t.id,...Object.fromEntries(['newFiles','modified','uploaded','originalsVerified','registeredFiles','sourceWrites'].map(k=>[k,Number.isSafeInteger(t[k])&&t[k]>=0?t[k]:0]))}))}));
    let baseUrl=DEFAULT_URL;try{baseUrl=safeBaseUrl(value.baseUrl||DEFAULT_URL);}catch{/* Invalid config cannot open arbitrary protocols. */}
    return {schemaVersion:1,sources,lastSync,history,baseUrl,watch:value.watch!==false,configured:value.configured===true};
  }
  async load(){try{return this.clean(JSON.parse(await readFile(this.path,'utf8')));}catch{return this.clean();}}
  async save(value){const clean=this.clean(value);await mkdir(this.dir,{recursive:true});await writeFile(this.path+'.tmp',JSON.stringify(clean,null,2),{mode:0o600});await rename(this.path+'.tmp',this.path);return clean;}
}

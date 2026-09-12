import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
if(!process.argv.includes('--remote-read-only'))throw Error('Explicit --remote-read-only is required');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object','get','anihi-admissions-images/state/admissions-data.json','--remote','--pipe'],{
  encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024,env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG:'error',WRANGLER_LOG_SANITIZE:'true'},
});
if(result.status!==0)throw Error('Read-only audit failed. Raw output suppressed.');
let data;try{data=JSON.parse(result.stdout);}catch{throw Error('Invalid audit response. Raw output suppressed.');}
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync('public/admissions-web/renderer/campus-locations.js','utf8'),ctx);
const summarize=rows=>{
  const counts={verified:0,needs_review:0,unknown:0};const schools=new Set(),verifiedSchools=new Set();
  for(const row of rows){schools.add(row.name);const status=ctx.window.AdmissionsCampusLocations.resolve(row).verificationStatus;counts[status]++;if(status==='verified')verifiedSchools.add(row.name);}
  return {programRows:rows.length,schoolNameIdentities:schools.size,...counts,schoolsWithVerifiedPrograms:verifiedSchools.size};
};
const rows=Array.isArray(data.universities)?data.universities:[];
// Emit counts and irreversible fingerprints only; no student data, keys or payloads.
console.log(JSON.stringify({all:summarize(rows),checked:summarize(rows.filter(u=>u.checkedComplete&&!u.hiddenDuplicate)),
  fingerprints:Object.fromEntries(['students','universities','cases','awardFolders','settings'].map(k=>[k,createHash('sha256').update(JSON.stringify(data[k]??null)).digest('hex')]))},null,2));

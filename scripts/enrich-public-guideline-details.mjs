import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {decodePublicGuidelines,guidelineIdentity} from '../public/data-core/admissions-model.js';
import {enrichPublicDetails} from '../public/data-core/guideline-details.js';
import {guidelineScope,detailUpdateStatement} from './guideline-enrichment-sql.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const config=['--config','dist/server/wrangler.json','--remote'];
function wrangler(args,json=true){
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',maxBuffer:96*1024*1024,timeout:300000,env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true'}});
  if(r.status!==0)throw Error('Wrangler request failed; raw output suppressed');
  if(!json)return;
  try{return JSON.parse(r.stdout);}catch{throw Error('Invalid Wrangler JSON; raw output suppressed');}
}
const scope=guidelineScope;
function read(){return wrangler(['d1','execute','DB',...config,'--json','--command',`SELECT id,metadata_json,deleted_at FROM data_records WHERE ${scope} ORDER BY id`]).flatMap(r=>r.results||[]);}
const stable=rows=>hash(rows.map(r=>{const m=JSON.parse(r.metadata_json);delete m.publicDetails;delete m.detailsCheckedAt;return [r.id,r.deleted_at,m];}));
let sqlFile;
try{
  if(!process.argv.includes('--remote-read-only') && !process.argv.includes('--apply'))throw Error('Explicit remote mode required');
  const source=new Map();
  for(const season of ['susi','jungsi']){
    const pageUrl=`https://grinalda.net/univ-info-${season}/`;
    const htmlResponse=await fetch(pageUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!htmlResponse.ok)throw Error('Public source page unavailable');
    const html=await htmlResponse.text();
    const match=html.match(/var META = (\[[^;]+\]);/);
    if(!match)throw Error('Public table allowlist unavailable');
    const visible=new Set(JSON.parse(match[1]).map(c=>c.t));
    const response=await fetch(`https://grinalda.net/wp-content/uploads/grinalda/grinalda-${season==='susi'?'susi':'jeongsi'}-2027-data.json`,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Public source unavailable');
    const raw=await response.json();
    const rows=decodePublicGuidelines(raw,season,{sourceName:'그리날다',sourceUrl:pageUrl});
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      // Decode only fields from the anonymous table, never hidden/member-only JSON columns.
      const {detailColumns}=await import('../public/data-core/guideline-details.js');
      for(const key of Object.keys(row.publicDetails))if(!detailColumns[key].some(c=>visible.has(c)))throw Error('Detail not publicly displayed');
      const id=`admission-guideline:${hash(guidelineIdentity(row))}`;
      if(source.has(id))throw Error('Ambiguous source identity');
      source.set(id,row);
    }
  }
  const before=read();const changes=[];const counts={};const mapping={};
  for(const row of before){
    const previous=JSON.parse(row.metadata_json);if(row.deleted_at)continue;
    counts[previous.admissionSeason]=(counts[previous.admissionSeason]||0)+1;
    mapping[previous.mappingStatus]=(mapping[previous.mappingStatus]||0)+1;
    const incoming=source.get(row.id);if(!incoming || guidelineIdentity(previous)!==guidelineIdentity(incoming))throw Error('Stored source identity mismatch');
    const next=enrichPublicDetails(previous,incoming.publicDetails);
    if(JSON.stringify(next.publicDetails)!==JSON.stringify(previous.publicDetails))changes.push({row,next});
  }
  const plan=hash(changes.map(({row,next})=>[row.id,hash(row.metadata_json),next.publicDetails]));
  const beforeHash=stable(before);
  console.log(JSON.stringify({mode:'preview',counts,mapping,total:before.filter(r=>!r.deleted_at).length,additiveRows:changes.length,plan,existingFieldsHash:beforeHash}));
  if(process.argv.includes('--apply')){
    const expected=process.argv.find(a=>a.startsWith('--expected-plan='))?.split('=')[1];
    if(expected!==plan)throw Error('Fresh preview plan confirmation required');
    if(changes.length){
      const now=new Date().toISOString();
      const sql=changes.map(({row,next})=>detailUpdateStatement(row,next,now)).join('\n');
      const directory=path.resolve('outputs/guideline-enrichment');await fs.mkdir(directory,{recursive:true});
      sqlFile=path.join(directory,`public-details-${process.pid}.sql`);
      await fs.writeFile(sqlFile,sql,{flag:'wx'});
      wrangler(['d1','execute','DB',...config,'--file',sqlFile,'--yes'],false);
    }
    const after=read();if(stable(after)!==beforeHash)throw Error('Preservation hash mismatch');
    const lookup=new Map(after.map(r=>[r.id,JSON.parse(r.metadata_json)]));
    if(changes.some(({row,next})=>JSON.stringify(lookup.get(row.id)?.publicDetails)!==JSON.stringify(next.publicDetails)))throw Error('Concurrent update detected; some details remain unapplied');
    console.log(JSON.stringify({mode:'applied',rows:changes.length,total:after.filter(r=>!r.deleted_at).length,existingFieldsPreserved:true,existingFieldsHash:stable(after)}));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(sqlFile)await fs.unlink(sqlFile).catch(()=>{});}

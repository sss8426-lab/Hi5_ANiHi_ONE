import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {universityIdentity,indexUniversities,explainUniversityMatch,normalizeName} from '../public/data-core/admissions-model.js';

// Read production only through Wrangler. Keep legacy payloads in memory; emit counts only.
let stage='start';
function wrangler(args){
  stage=args[0];
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',maxBuffer:64*1024*1024,timeout:60000,env:{...process.env,WRANGLER_LOG:'log',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true'}});
  if(r.status!==0){console.error(JSON.stringify({stage,exit:r.status,stdoutBytes:r.stdout?.length||0,apiCode:r.stderr?.match(/\[code: (\d+)\]/)?.[1]||null}));stage+=`-exit-${Number(r.status)}`;throw new Error('Read-only production audit could not complete. Raw output suppressed.');}
  stage+='-json';
  try{return JSON.parse(r.stdout);}catch{throw new Error('Production audit response was not JSON. Raw output suppressed.');}
}
if(!process.argv.includes('--remote-read-only'))throw new Error('Explicit --remote-read-only is required.');
try{
  const original=wrangler(['r2','object','get','anihi-admissions-images/state/admissions-data.json','--remote','--pipe']);
  if(!Array.isArray(original.universities))throw new Error('University array missing.');
  const columns=['universityName','campus','department','academicYear','admissionType','mappingStatus','universityId'];
  const projection=columns.map(key=>`'${key}',json_extract(metadata_json,'$.${key}')`).join(',');
  const result=wrangler(['d1','execute','DB','--config','dist/server/wrangler.json','--remote','--json','--command',`SELECT json_object(${projection}) AS metadata_json FROM data_records WHERE organization_id='org-hi5-anihi' AND campus_id IS NULL AND source_app='admissions' AND record_type IN ('university-admission-susi','university-admission-jungsi') AND deleted_at IS NULL`]);
  const rows=result.flatMap(r=>r.results||[]).map(r=>JSON.parse(r.metadata_json));
  const schools=indexUniversities(original.universities);
  const counts={},reasons={},years={},candidateYears={},proposedCounts={},proposedReasons={},changes={newLinks:0,changedLinks:0,removedLinks:0},potential={departmentSuffixOnly:0,admissionSuffixOnly:0};
  const bump=(obj,key)=>obj[key]=(obj[key]||0)+1;
  const department=s=>normalizeName(s).replace(/(?:학과|학부|전공|과)$/,'');
  const admission=s=>normalizeName(s).replace(/전형$/,'');
  for(const row of rows){
    bump(counts,row.mappingStatus||'missing');
    const proposed=explainUniversityMatch(row,schools);
    bump(proposedCounts,proposed.mappingStatus);bump(proposedReasons,proposed.mappingReason);
    if(proposed.universityId!==row.universityId){if(!row.universityId)changes.newLinks++;else if(!proposed.universityId)changes.removedLinks++;else changes.changedLinks++;}
    if(row.mappingStatus!=='review')continue;
    bump(years,String(row.academicYear));
    const wanted=universityIdentity(row.universityName,row.campus);
    const candidates=schools.get(wanted.school)||[];
    const campus=candidates.filter(u=>universityIdentity(u.name||u.universityName,u.campus).campus===wanted.campus);
    const majors=campus.filter(u=>normalizeName(u.major||u.department)===normalizeName(row.department));
    const year=majors.filter(u=>!u.year||String(u.year)===String(row.academicYear));
    const programs=year.filter(u=>!u.admission||normalizeName(u.admission)===normalizeName(row.admissionType));
    bump(reasons,!campus.length?'campus':!majors.length?'department':!year.length?'year':!programs.length?'admission':programs.length>1?'multiple-programs':'campus-ambiguity');
    for(const u of majors)bump(candidateYears,String(u.year||'missing'));
    if(!majors.length && campus.some(u=>department(u.major||u.department)===department(row.department)))potential.departmentSuffixOnly++;
    if(year.length && !programs.length && year.some(u=>admission(u.admission)===admission(row.admissionType)))potential.admissionSuffixOnly++;
  }
  const fingerprints=Object.fromEntries(['students','universities','cases','awardFolders','settings'].map(key=>[key,createHash('sha256').update(JSON.stringify(original[key]??null)).digest('hex')]));
  console.log(JSON.stringify({total:rows.length,counts,reasons,years,candidateYears,potential,proposedCounts,proposedReasons,changes,originalDomainHashes:fingerprints},null,2));
}catch{
  console.error(`Read-only mapping audit failed (${stage}). No raw records or credentials printed.`);process.exitCode=1;
}

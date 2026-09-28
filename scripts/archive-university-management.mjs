import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { managementUniversities, managementUniversityName, managementArchiveId, managementArchiveType } from '../public/data-core/university-management.js';

if (!process.argv.includes('--remote-read-only') && !process.argv.includes('--apply-approved-74')) throw new Error('Choose --remote-read-only or --apply-approved-74');
const apply = process.argv.includes('--apply-approved-74');
const output = resolve('outputs/university-management-74');
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function wrangler(args) {
  const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding:'utf8', maxBuffer:64*1024*1024, timeout:120000,
    env:{...process.env,WRANGLER_LOG:'log',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true'},
  });
  if(r.status!==0) throw new Error(`Wrangler ${args[0]} failed (${r.status}); raw output suppressed`);
  return JSON.parse(r.stdout);
}
const d1 = sql => wrangler(['d1','execute','DB','--config','dist/server/wrangler.json','--remote','--json','--command',sql]).flatMap(r=>r.results || []);
const read = () => wrangler(['r2','object','get','anihi-admissions-images/state/admissions-data.json','--remote','--pipe']);
const catalogSql = "SELECT id,metadata_json,deleted_at FROM data_records WHERE source_app='admissions' AND record_type IN ('university-admission-susi','university-admission-jungsi') ORDER BY id";
const state = read();
if (!Array.isArray(state.universities) || !state.universities.length) throw new Error('No university source');
const catalog = d1(catalogSql);
const previous = d1(`SELECT metadata_json FROM data_records WHERE id='${managementArchiveId}'`)[0];
const kept = state.universities.filter(u=>managementUniversityName(u.name));
const removed = state.universities.filter(u=>!managementUniversityName(u.name));
if (new Set(state.universities.map(u=>String(u.id))).size !== state.universities.length) throw new Error('Ambiguous university IDs');
const actualSchools = [...new Set(kept.map(u=>managementUniversityName(u.name)))].sort();
const report = { approvedSchools:managementUniversities.length, presentSchools:actualSchools.length,
  missingSchools:managementUniversities.filter(n=>!actualSchools.includes(n)), totalRows:state.universities.length,
  keptRows:kept.length, archivedRows:removed.length, removedNames:[...new Set(removed.map(u=>u.name))].sort(),
  sourceHash:hash(state), universityHash:hash(state.universities), guidelineCount:catalog.length, guidelineHash:hash(catalog),
  existingArchive:!!previous,
};
await writeFile(resolve(output,'audit.json'),JSON.stringify(report,null,2));
if (!apply) { console.log(JSON.stringify(report,null,2)); process.exit(0); }
if (report.missingSchools.length || actualSchools.length !== 74) throw new Error('Approved school scope is incomplete; no archive written');
if (previous) {
  const archived=JSON.parse(previous.metadata_json).archived;
  if (JSON.stringify(archived?.map(r=>[r.id,r.name]))!==JSON.stringify(removed.map(u=>[String(u.id),u.name]))) throw new Error('Existing archive differs; manual review required');
  console.log(JSON.stringify({...report,alreadyApplied:true}));process.exit(0);
}
// Backup only university data; student/case/account payloads never leave process memory.
const now=new Date().toISOString();
const backupFile=resolve(output,`university-backup-${now.replace(/[:.]/g,'-')}.json`);
await writeFile(backupFile,JSON.stringify({universities:state.universities,sourceHash:report.sourceHash,createdAt:now},null,2),{flag:'wx'});
if(hash(read())!==report.sourceHash || hash(d1(catalogSql))!==report.guidelineHash) throw new Error('Source changed; no archive written');
const metadata={version:1,scope:'university-management-only',approvedSchools:managementUniversities,sourceHash:report.sourceHash,
  archived:removed.map(u=>({id:String(u.id),name:u.name})),deletedAt:now,createdAt:now,
  reason:'User approved domestic 74 school scope; keep original records for counseling and guideline references'};
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=`INSERT INTO data_records(id,organization_id,campus_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
VALUES(${q(managementArchiveId)},'org-hi5-anihi',NULL,${q(managementArchiveType)},'admissions','대학 데이터 관리 74개교 범위 정리','organization','active',${q(JSON.stringify(metadata))},${q(now)},${q(now)}) ON CONFLICT(id) DO NOTHING;`;
if(Buffer.byteLength(sql,'utf8')>100000)throw new Error('Archive exceeds D1 statement limit; no write attempted');
const sqlFile=resolve(output,'apply-approved-74.sql');await writeFile(sqlFile,sql);
wrangler(['d1','execute','DB','--config','dist/server/wrangler.json','--remote','--json','--file',sqlFile]);
const saved=d1(`SELECT metadata_json FROM data_records WHERE id='${managementArchiveId}'`)[0];
if(saved?.metadata_json!==JSON.stringify(metadata)) throw new Error('Archive write not verified');
const after=read(), afterCatalog=d1(catalogSql);
const result={...report,applied:true,sourceUnchanged:hash(after)===report.sourceHash,guidelinesUnchanged:hash(afterCatalog)===report.guidelineHash,backupFile};
await writeFile(resolve(output,'applied.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(!result.sourceUnchanged || !result.guidelinesUnchanged) throw new Error('Concurrent source changes detected; review required');

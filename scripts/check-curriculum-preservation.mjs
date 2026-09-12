import { readFile, writeFile } from 'node:fs/promises';
import { cloudflare } from './curriculum-cloudflare.mjs';
import { hash } from './curriculum-tree.mjs';

const mode=process.argv[2],path='outputs/curriculum-preservation.json';
if(!['baseline','verify'].includes(mode))throw Error('Use baseline or verify. Read-only D1 verification only.');
const remote=await cloudflare('dist/server/wrangler.json'),summary={};
const tables=['app_state','campus_admissions_state','data_records','file_objects','knowledge_nodes','knowledge_edges','data_backups','campuses','memberships'];
// Private payloads exist only transiently in memory; persist/print aggregate digests only.
for(const table of tables){
  const where=['data_records','file_objects'].includes(table)?" WHERE COALESCE(source_app,'')<>'curriculum'":'';
  const rows=(await remote.query(`SELECT * FROM ${table}${where} ORDER BY rowid`)).results;
  summary[table]={count:rows.length,sha256:hash(JSON.stringify(rows))};
}
if(mode==='baseline'){
  try{await readFile(path);throw Error('Existing baseline is retained. Do not overwrite it.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await writeFile(path,JSON.stringify(summary,null,2),{flag:'wx'});
  console.log(JSON.stringify({baseline:true,tables:tables.length,payloadsPrinted:false}));
}else{
  const baseline=JSON.parse(await readFile(path,'utf8'));
  const changed=tables.filter(t=>JSON.stringify(baseline[t])!==JSON.stringify(summary[t]));
  console.log(JSON.stringify({unchanged:!changed.length,checkedTables:tables.length,changed,payloadsPrinted:false}));
  if(changed.length)process.exitCode=1;
}

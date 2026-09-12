import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { libraryHarness } from '../../../tests/support/library-harness.mjs';
import { hash } from '../.runtime/scripts/curriculum-tree.mjs';
const h=await libraryHarness(),objects=new Map();let writes=0,uploads=0;
const stats=()=>writeFile(join(process.env.HI5_SYNC_TEST_DIR,'transport-counts.json'),JSON.stringify({writes,uploads}));
await stats();
const remote={
  records:async(family,stage)=>(await h.env.DB.prepare("SELECT * FROM data_records WHERE source_app='curriculum' AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=? ORDER BY id").bind(family,stage).all()).results.map(r=>({...r,metadata:JSON.parse(r.metadata_json)})),
  query:async(sql,params=[])=>{if(!sql.startsWith('SELECT')){writes++;await stats();}return h.env.DB.prepare(sql).bind(...params).all();},
  objectHash:async key=>objects.get(key)||null,
  put:async a=>{if(objects.has(a.key))return false;const b=await readFile(a.path);objects.set(a.key,hash(b));await h.env.FILES.put(a.key,b);uploads++;await stats();return true;}
};
export const connect=async()=>remote;
process.on('disconnect',()=>h.mf.dispose().then(()=>process.exit(0)));

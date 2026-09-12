import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { SyncService,TARGETS } from '../../../scripts/curriculum-sync-core.mjs';
import { cloudflare } from '../../../scripts/curriculum-cloudflare.mjs';
import { inventoryTree,hash } from '../../../scripts/curriculum-tree.mjs';
const remote=await cloudflare('dist/server/wrangler.json'),before={};
for(const t of TARGETS)before[t.id]=hash(JSON.stringify(await remote.records(t.family,t.stage)));
const readOnly={records:remote.records,query:async sql=>{assert.ok(sql.startsWith('SELECT'));return remote.query(sql);},put:()=>{throw Error('Production apply prohibited in smoke');},objectHash:remote.objectHash};
const s=new SyncService({connect:async()=>readOnly,cacheDir:resolve('outputs/sync-readonly-cache')});await s.scan();
const results=[];
for(const t of TARGETS){
  const target=s.state.targets.find(x=>x.id===t.id),snapshot=s.snapshots.get(t.id);assert.ok(snapshot);assert.equal(target.status,'current');
  assert.equal(target.diff.newPages,0);assert.equal(target.diff.changed,0);
  assert.equal(hash(JSON.stringify(await inventoryTree(t.source,t.family,t.stage))),snapshot.sourceHash);
  assert.equal(hash(JSON.stringify(await remote.records(t.family,t.stage))),before[t.id]);
  results.push({stage:t.stage,folders:target.folders,files:target.files,newFiles:target.diff.newFiles,modified:target.diff.changed,unchanged:target.diff.unchanged,reviewNeeded:target.diff.reviewNeeded,unsupported:target.diff.unsupported,sourceHashAndMtimeUnchanged:true,centralRowsUnchanged:true});
}
await mkdir('outputs/sync-gui',{recursive:true});await writeFile(join('outputs/sync-gui','production-readonly.json'),JSON.stringify({results,productionWrites:0},null,2));
console.log(JSON.stringify({results,productionWrites:0}));

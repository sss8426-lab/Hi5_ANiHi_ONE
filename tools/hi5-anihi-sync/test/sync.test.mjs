import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import sharp from 'sharp';
import vm from 'node:vm';
import { SyncService,SettingsStore,safeError,safeRelative,safeBaseUrl,TARGETS } from '../.runtime/scripts/curriculum-sync-core.mjs';
import { hash,inventoryTree } from '../.runtime/scripts/curriculum-tree.mjs';
import { libraryHarness,users } from '../../../tests/support/library-harness.mjs';

async function fixture(count=1){
  const temp=await mkdtemp(join(tmpdir(),'hi5-sync-synthetic-')),source=join(temp,'source'),cache=join(temp,'cache');await mkdir(source);
  const image=await sharp({create:{width:48,height:64,channels:3,background:'#96c7b5'}}).jpeg().toBuffer();
  for(let i=0;i<count;i++){const folder=join(source,`${Math.floor(i/10)+1}-1 합성 수업`);await mkdir(folder,{recursive:true});await writeFile(join(folder,`${i+1}.jpg`),image);}
  const h=await libraryHarness(),objects=new Map();let writes=0,puts=0,broken=false;
  const remote={
    records:async(family,stage)=>(await h.env.DB.prepare("SELECT * FROM data_records WHERE source_app='curriculum' AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=? ORDER BY id").bind(family,stage).all()).results.map(r=>({...r,metadata:JSON.parse(r.metadata_json)})),
    query:async(sql,params=[])=>{if(!sql.startsWith('SELECT'))writes++;return h.env.DB.prepare(sql).bind(...params).all();},
    objectHash:async key=>broken?'wrong':objects.get(key)||null,
    put:async asset=>{const bytes=await readFile(asset.path);if(objects.has(asset.key)){assert.equal(objects.get(asset.key),hash(bytes));return false;}await h.env.FILES.put(asset.key,bytes,{httpMetadata:{contentType:asset.mime}});objects.set(asset.key,hash(bytes));puts++;return true;}
  };
  const settings={sources:Object.fromEntries(TARGETS.map(t=>[t.id,source]))};
  const create=(options={})=>new SyncService({connect:async()=>remote,cacheDir:cache,settings,...options});
  return {temp,source,cache,image,h,remote,objects,create,writes:()=>writes,puts:()=>puts,breakVerify:()=>{broken=true;},cleanup:async()=>{await h.mf.dispose();assert.ok(resolve(temp).startsWith(resolve(tmpdir())));assert.ok(temp.includes('hi5-sync-synthetic-'));await rm(temp,{recursive:true,force:true});}};
}
test('GUI core: 100 initial, unchanged zero write, +10, modified version, missing preserved; live central API updates without deploy',async()=>{
  const f=await fixture(100);let events=[];
  try{
    const s=f.create({onChange:state=>{if(state.progress)events.push(state.progress);}}),id='content-basic';
    const before=await inventoryTree(f.source,'content','basic');
    await s.scan();assert.equal(f.writes(),0);assert.equal(f.puts(),0);assert.equal(s.state.targets[0].diff.newFiles,100);
    assert.equal((await s.apply(s.confirm([id]).token)).status,'success');assert.equal(f.puts(),400);
    assert.ok(events.some(e=>e.phase==='upload'&&e.completed===100&&e.total===100));assert.ok(events.some(e=>e.phase==='verify'&&e.completed===100));
    assert.deepEqual(await inventoryTree(f.source,'content','basic'),before);
    const originalObjects=new Map(f.objects),writeCount=f.writes();
    await s.scan();assert.equal(s.state.targets[0].diff.unchanged,100);assert.equal((await s.apply(s.confirm([id]).token)).status,'success');assert.equal(f.writes(),writeCount);assert.equal(f.puts(),400);
    await mkdir(join(f.source,'11 신규'));
    for(let i=1;i<=10;i++)await writeFile(join(f.source,'11 신규',`${i}.jpg`),f.image);
    await s.scan();assert.equal(s.state.targets[0].diff.newFolders,1);assert.equal(s.state.targets[0].diff.newFiles,10);assert.equal(s.state.targets[0].diff.unchanged,100);
    assert.equal((await s.apply(s.confirm([id]).token)).status,'success');assert.equal(f.puts(),440);
    const response=await f.h.request('GET','/api/data-core/curriculum?family=content&stage=basic',users.foreign);assert.equal(response.status,200);assert.equal(response.body.totalFolders,11);assert.equal(response.body.totalPages,110);
    const changed=await sharp(f.image).negate().jpeg().toBuffer();await writeFile(before.files[0].sourcePath,changed);
    await s.scan();assert.equal(s.state.targets[0].diff.changed,1);assert.equal(s.state.targets[0].diff.newFiles,0);assert.equal(s.state.targets[0].diff.unchanged,109);
    await assert.rejects(()=>s.apply(s.confirm([id]).token,false),e=>e.code==='modified');assert.equal(f.puts(),440);
    assert.equal((await s.apply(s.confirm([id]).token,true)).status,'success');assert.equal(f.puts(),444);
    for(const [key,value] of originalObjects)assert.equal(f.objects.get(key),value);
    await rm(before.files[1].sourcePath);
    await s.scan();assert.equal(s.state.targets[0].diff.reviewNeeded,1);assert.equal(s.confirm([id]).automaticDeletes,0);
    assert.equal((await s.apply(s.confirm([id]).token)).status,'success');assert.equal(f.puts(),444);
    assert.equal((await f.h.request('GET','/api/data-core/curriculum?family=content&stage=basic',users.foreign)).body.totalPages,110);
    const rows=await f.remote.records('content','basic');assert.equal(rows.filter(r=>r.metadata.sourceReview).length,1);
    const immutable=rows.find(r=>r.metadata.supersededByPageId);assert.ok(immutable);assert.equal(immutable.deleted_at,null);
    assert.equal(s.state.history.length,5);
    assert.equal(await (await f.h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
  }finally{await f.cleanup();}
});
test('all selected targets checked before writes; source drift, remote drift and stale confirmations fail closed',async()=>{
  const f=await fixture();
  try{
    const s=f.create();await s.scan();const c=s.confirm(['content-basic','content-advanced']);
    await f.h.env.DB.prepare("INSERT INTO data_records(id,organization_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES('synthetic-concurrent','org-hi5-anihi','curriculum-folder','curriculum','new','organization','active','{\"family\":\"content\",\"stage\":\"advanced\",\"relativePath\":\"new\",\"active\":true}','now','now')").run();
    assert.equal((await s.apply(c.token)).status,'stale');assert.equal(f.puts(),0);assert.equal(f.writes(),0);
    await s.scan();const next=s.confirm(['content-basic']);await writeFile(join(f.source,'1-1 합성 수업','2.jpg'),f.image);
    assert.equal((await s.apply(next.token)).status,'stale');assert.equal(f.writes(),0);
    await s.scan();const old=s.confirm(['content-basic']);s.invalidate();await assert.rejects(()=>s.apply(old.token),e=>e.code==='stale');
  }finally{await f.cleanup();}
});
test('cancel after a committed page then restart skips immutable assets and completes; verification failure not success',async()=>{
  const f=await fixture(12);let s,cancelled=false;
  try{
    s=f.create({onChange:state=>{if(state.progress?.phase==='upload'&&state.progress.completed===1&&!cancelled){cancelled=true;s.cancel();}}});
    await s.scan();assert.equal((await s.apply(s.confirm(['content-basic']).token)).status,'cancelled');assert.equal(f.puts(),4);
    s=f.create();await s.scan();assert.equal(s.state.targets[0].diff.unchanged,1);assert.equal(s.state.targets[0].diff.newFiles,11);
    assert.equal((await s.apply(s.confirm(['content-basic']).token)).status,'success');assert.equal(f.puts(),48);
    await s.scan();f.breakVerify();assert.notEqual((await s.apply(s.confirm(['content-basic']).token)).status,'success');
    assert.equal(f.puts(),48);
  }finally{await f.cleanup();}
});
test('network interruption leaves immutable uploads resumable, without exposing error payloads',async()=>{
  const f=await fixture(3);
  try{
    const put=f.remote.put;let once=true;
    f.remote.put=async a=>{if(f.puts()===2&&once){once=false;throw Error('SYNTHETIC_SECRET_DO_NOT_FORWARD C:\\private\\source');}return put(a);};
    let s=f.create();await s.scan();const failed=await s.apply(s.confirm(['content-basic']).token);assert.notEqual(failed.status,'success');assert.equal(f.puts(),2);assert.doesNotMatch(JSON.stringify(s.getState()),/SYNTHETIC_SECRET/);
    s=f.create();await s.scan();assert.equal((await s.apply(s.confirm(['content-basic']).token)).status,'success');assert.equal(f.puts(),12);
  }finally{await f.cleanup();}
});
test('empty, missing, unsupported, Korean long names and duplicate numerical prefixes are safe; offline scan works',async()=>{
  const f=await fixture(0);
  try{
    const s=f.create();await s.scan();assert.equal(s.state.targets[0].status,'blocked');assert.equal(s.state.targets[0].folders,0);
    const a='1-1 합성 수업',b='1-1 다른 수업';for(const dir of [a,b])await mkdir(join(f.source,dir));
    // Linux filename limits count UTF-8 bytes, unlike Windows UTF-16 characters.
    const longName='한글'.repeat(20)+'long-name-'.repeat(10)+'.jpg';
    assert.ok(longName.length>120&&Buffer.byteLength(longName)<255);
    await writeFile(join(f.source,a,longName),f.image);await writeFile(join(f.source,b,'2.jpg'),f.image);
    await s.scan();assert.equal(s.state.targets[0].diff.conflicts,0);assert.equal(s.state.targets[0].diff.sourceFiles,2);
    await writeFile(join(f.source,a,'문서.pdf'),'synthetic unsupported');await s.scan();assert.equal(s.state.targets[0].diff.unsupported,1);assert.throws(()=>s.confirm(['content-basic']),e=>e.code==='blocked');
    const offline=f.create({connect:async()=>{throw Error('OAuth');}});await offline.scan();assert.equal(offline.state.connection,'auth');assert.equal(offline.state.targets[0].files,2);assert.equal(offline.state.targets[0].status,'offline');assert.equal(f.writes(),0);
    offline.state.targets[0].source=join(f.temp,'missing');await offline.scan();assert.equal(offline.state.targets[0].status,'missing');
    await assert.rejects(()=>s.setSource('content-basic',f.temp));
    assert.equal(f.writes(),0);
  }finally{await f.cleanup();}
});
test('config whitelist strips secrets and stores at most 20 histories; URL and relative path validation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hi5-sync-settings-'));
  try{
    const store=new SettingsStore(dir),payload={token:'SYNTHETIC_SECRET',password:'SYNTHETIC_SECRET',sources:{'content-basic':join(dir,'original'),extra:'SYNTHETIC_SECRET'},history:Array.from({length:25},()=>({at:'2026-09-12T10:00:00Z',status:'success',token:'SYNTHETIC_SECRET',targets:[{id:'content-basic',newFiles:1,token:'SYNTHETIC_SECRET'}]}))};
    await store.save(payload);assert.doesNotMatch(await readFile(store.path,'utf8'),/SYNTHETIC_SECRET/);assert.equal((await store.load()).history.length,20);
    assert.throws(()=>safeBaseUrl('javascript:alert(1)'));assert.throws(()=>safeBaseUrl('https://name:password@example.com'));assert.throws(()=>safeBaseUrl('https://example.com/?token=secret'));
    assert.equal(safeBaseUrl('https://example.com/'),'https://example.com');assert.equal(safeRelative('../private'),'자료 경로 확인 필요');assert.equal(safeRelative('1 수업/그림.jpg'),'1 수업/그림.jpg');
    assert.doesNotMatch(JSON.stringify(safeError(Error('secret-token C:\\path'))),/secret-token|C:/);
    assert.equal(safeError(Error('403 raw payload')).code,'forbidden');
    assert.ok((await stat(store.path)).size);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Wrangler Node argv compatibility applies only to Electron RUN_AS_NODE',async()=>{
  const code=await readFile(new URL('../app/wrangler-node.cjs',import.meta.url),'utf8');
  for(const [electron,run,expected] of [[true,'1',true],[true,'',undefined],[false,'1',undefined]]){
    const process={versions:electron?{electron:'synthetic'}:{node:'synthetic'},env:{ELECTRON_RUN_AS_NODE:run}};
    vm.runInNewContext(code,{process});assert.equal(process.defaultApp,expected);
  }
});

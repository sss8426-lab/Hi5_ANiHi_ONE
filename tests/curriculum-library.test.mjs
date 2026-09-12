import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inventoryTree, diffInventory, prepareAssets, folderMetadata, pageMetadata, hash, outsideSource } from '../scripts/curriculum-tree.mjs';
import { applyTree } from '../scripts/import-curriculum-tree.mjs';
import { libraryHarness, users } from './support/library-harness.mjs';

async function sourceFixture() {
  const temp=await mkdtemp(join(tmpdir(),'hi5-curriculum-synthetic-')),source=join(temp,'source');await mkdir(source);
  const bytes=await sharp({create:{width:96,height:128,channels:3,background:'#99bda9'}}).jpeg().toBuffer();
  for(const dir of ['1-10 수업','1-2 수업','1-1 수업','1-2 수업/추가 자료','2 빈 폴더'])await mkdir(join(source,dir),{recursive:true});
  for(const name of ['1-1 수업/10.jpg','1-1 수업/2.jpg','1-1 수업/1.jpg','1-2 수업/1.jpg','1-2 수업/대표.jpg','1-2 수업/추가 자료/2.jpg','1-10 수업/1.jpg'])await writeFile(join(source,name),bytes);
  return {temp,source,bytes,cleanup:()=>rm(temp,{recursive:true,force:true})};
}
test('curriculum inventory preserves names, nested paths, natural order, cover priority and immutable source bytes',async()=>{
  const f=await sourceFixture();
  try{
    const tree=await inventoryTree(f.source,'content','basic');
    assert.deepEqual(tree.folders.map(f=>f.title),['1-1 수업','1-2 수업','추가 자료','1-10 수업','2 빈 폴더']);
    assert.deepEqual(tree.files.filter(f=>f.folderId===tree.folders[0].id).map(f=>f.sourceFileName),['1.jpg','2.jpg','10.jpg']);
    assert.equal(tree.files.find(p=>p.id===tree.folders[1].representativePageId).sourceFileName,'대표.jpg');
    assert.equal(tree.folders[2].parentFolderId,tree.folders[1].id);
    const originalHashes=tree.files.map(f=>f.sha256);
    await prepareAssets(tree,join(f.temp,'output'));
    assert.deepEqual(tree.files.map(f=>f.sha256),originalHashes);
    for(const p of tree.files){assert.equal(hash(await readFile(p.sourcePath)),p.sha256);assert.equal(p.assets.length,4);assert.equal(pageMetadata(tree,p).originalFileId,p.assets[0].id);}
    assert.equal(new Set(tree.files.flatMap(f=>f.assets.map(a=>a.id))).size,28);
    assert.throws(()=>outsideSource(f.source,join(f.source,'out')));
    assert.equal((await inventoryTree(f.source,'content','advanced')).folders[0].id===tree.folders[0].id,false);
    const records=[...tree.folders.map(f=>({id:f.id,title:f.title,record_type:'curriculum-folder',status:'active',metadata:folderMetadata(tree,f)})),...tree.files.map(f=>({id:f.id,record_type:'curriculum-page',status:'active',metadata:pageMetadata(tree,f)}))];
    assert.equal(diffInventory(tree,records).newPages,0);
    assert.equal(diffInventory({...tree,files:[]},records).canApply,false);
    assert.equal(diffInventory({...tree,files:tree.files.slice(1)},records).reviewNeeded,1);
    await writeFile(join(f.source,'1-1 수업','bad.jpg'),'not an image');
    await writeFile(join(f.source,'1-1 수업','slides.pptx'),'synthetic unsupported');
    const broken=await inventoryTree(f.source,'content','basic');assert.equal(broken.blockers.length,2);assert.equal(diffInventory(broken,[]).canApply,false);
  }finally{await f.cleanup();}
});

test('central curriculum imports idempotently, resumes partial files, shares read-only across campuses and protects originals',async()=>{
  const h=await libraryHarness(),f=await sourceFixture();
  try{
    const tree=await prepareAssets(await inventoryTree(f.source,'content','basic'),join(f.temp,'derivatives'));
    const objects=new Map();let puts=0,fail=true;
    const remote={
      query:async(sql,params=[])=>h.env.DB.prepare(sql).bind(...params).all(),
      records:async(family,stage)=>(await h.env.DB.prepare("SELECT * FROM data_records WHERE source_app='curriculum' AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?").bind(family,stage).all()).results.map(r=>({...r,metadata:JSON.parse(r.metadata_json)})),
      put:async a=>{if(objects.has(a.key))return false;const bytes=await readFile(a.path);await h.env.FILES.put(a.key,bytes,{httpMetadata:{contentType:a.mime}});objects.set(a.key,hash(bytes));puts++;return true;},
    };
    const query=remote.query;
    remote.query=async(sql,params)=>{if(fail&&sql.includes('INSERT INTO file_objects')&&params[0]===tree.files[0].assets[1].id){fail=false;throw Error('Synthetic interruption');}return query(sql,params);};
    const baseline=await remote.records('content','basic');
    await assert.rejects(()=>applyTree(tree,remote,hash(JSON.stringify(baseline))),/Synthetic interruption/);
    const interrupted=await remote.records('content','basic');
    assert.equal(interrupted.find(r=>r.record_type==='curriculum-page').status,'draft');
    let r=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',users.teacher);assert.equal(r.body.totalPages,0);
    await applyTree(tree,remote,hash(JSON.stringify(interrupted)));
    const firstPuts=puts,records=await remote.records('content','basic');
    await applyTree(tree,remote,hash(JSON.stringify(records)));assert.equal(puts,firstPuts);
    assert.equal(puts,28);
    for(const user of [users.admin,users.teacher,users.foreign,users.staff]){
      r=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',user);assert.equal(r.status,200);assert.equal(r.body.folders.length,4);assert.equal(r.body.totalPages,7);
      r=await h.request('GET',`/api/data-core/curriculum/folders/${tree.folders[0].id}`,user);assert.equal(r.body.pages.length,3);
      const file=await h.raw('GET',r.body.pages[0].previewUrl,user);assert.equal(file.status,200);assert.match(file.headers.get('cache-control'),/private, no-cache/);await file.arrayBuffer();
      const cached=await h.raw('GET',r.body.pages[0].previewUrl,user,undefined,'http://localhost',{'If-None-Match':file.headers.get('etag')});assert.equal(cached.status,304);
    }
    for(const user of [null,users.outsider]){
      r=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',user);assert.equal(r.status,user?403:401);
      r=await h.raw('GET',`/api/data-core/files/${tree.files[0].assets[1].id}`,user);assert.equal(r.status,user?403:401);
    }
    const p=tree.files[0],folder=tree.folders[0];
    await h.env.DB.prepare("UPDATE memberships SET role='CAMPUS_ADMIN' WHERE id=?").bind(users.teacher.id).run();
    r=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',users.teacher);assert.equal(r.status,200);
    r=await h.raw('DELETE',`/api/data-core/files/${p.assets[0].id}`,users.admin,undefined,'https://outside.example');assert.equal(r.status,403);
    r=await h.raw('POST','/api/data-core/records',users.admin,{recordType:'curriculum-folder',sourceApp:'curriculum',title:'forged'},'https://outside.example');assert.equal(r.status,403);
    for(const user of [users.teacher,users.staff,users.foreign]){
      for(const method of ['PATCH','DELETE']){r=await h.request(method,`/api/data-core/records/${folder.id}`,user,method==='PATCH'?{title:'forbidden'}:undefined);assert.equal(r.status,403);}
      r=await h.request('POST','/api/data-core/records',user,{recordType:'curriculum-folder',sourceApp:'curriculum',title:'forged'});assert.equal(r.status,403);
      r=await h.request('POST','/api/data-core/records',user,{recordType:'note',sourceApp:' curriculum ',title:'forged'});assert.equal(r.status,403);
      r=await h.request('DELETE',`/api/data-core/files/${p.assets[0].id}`,user);assert.equal(r.status,403);
      const upload=new FormData();upload.set('file',new File([f.bytes],'fake.jpg',{type:'image/jpeg'}));upload.set('category','curriculum-original');
      r=await h.request('POST','/api/data-core/upload',user,upload);assert.equal(r.status,403);
    }
    r=await h.request('GET','/api/data-core/curriculum/print?family=content&stage=basic',users.teacher);
    assert.equal(r.body.pages.length,7);assert.deepEqual(r.body.pages.slice(0,3).map(p=>p.id),tree.files.slice(0,3).map(p=>p.id));
    r=await h.request('GET',`/api/data-core/curriculum/print?family=content&stage=basic&lesson=${folder.id}`,users.teacher);assert.equal(r.body.pages.length,3);
    r=await h.request('GET','/api/data-core/curriculum?family=design&stage=basic',users.teacher);assert.equal(r.status,404);
    await h.env.DB.prepare('UPDATE file_objects SET deleted_at=? WHERE id=?').bind('synthetic-trash',p.assets[0].id).run();
    r=await h.raw('GET',`/api/data-core/files/${p.assets[1].id}`,users.teacher);assert.equal(r.status,403);
    await h.env.DB.prepare('UPDATE file_objects SET deleted_at=NULL WHERE id=?').bind(p.assets[0].id).run();
    await h.env.DB.prepare("UPDATE data_records SET deleted_at='synthetic-trash' WHERE id=?").bind(folder.id).run();
    r=await h.raw('GET',`/api/data-core/files/${p.assets[0].id}`,users.teacher);assert.equal(r.status,403);
    assert.equal(hash(new Uint8Array(await (await h.env.FILES.get(p.assets[0].key)).arrayBuffer())),p.sha256);
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
  }finally{await h.mf.dispose();await f.cleanup();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {libraryHarness,users,ORG} from './support/library-harness.mjs';
import {inventoryTree,prepareAssets,planInventory,hash} from '../scripts/curriculum-tree.mjs';
import {applyTree,verifyTree} from '../scripts/import-curriculum-tree.mjs';
import {prepareCovers,previewCovers,publishCovers,verifyCover,curriculumPreservation,COVER_SPEC} from '../scripts/publish-curriculum-covers.mjs';

test('folder covers are private, immutable, idempotent, preserve 4-file pages and survive reimport without the source PC',async()=>{
  const h=await libraryHarness(),dir=await mkdtemp(join(tmpdir(),'hi5-cover-synthetic-'));
  try {
    const source=join(dir,'source'),out=join(dir,'output');await mkdir(join(source,'1 눈'),{recursive:true});await mkdir(out);
    const original=await sharp({create:{width:100,height:160,channels:3,background:'#adc7b9'}}).jpeg().toBuffer();
    await writeFile(join(source,'1 눈','1.jpg'),original);
    let drift=false,puts=0;
    const remote={
      records:async(family,stage)=>(await h.env.DB.prepare("SELECT * FROM data_records WHERE source_app='curriculum' AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=? ORDER BY id").bind(family,stage).all()).results.map(r=>({...r,metadata:JSON.parse(r.metadata_json)})),
      query:async(sql,params=[])=>{
        if(drift&&sql.startsWith('UPDATE data_records SET metadata_json')){drift=false;await h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.concurrentMarker',1) WHERE id=?").bind(params[2]).run();}
        return h.env.DB.prepare(sql).bind(...params).all();
      },
      objectHash:async key=>{const object=await h.env.FILES.get(key);return object?hash(new Uint8Array(await object.arrayBuffer())):null;},
      put:async a=>{if(await remote.objectHash(a.key)){assert.equal(await remote.objectHash(a.key),a.sha256);return false;}await h.env.FILES.put(a.key,await readFile(a.path),{httpMetadata:{contentType:a.mime}});puts++;return true;},
    };
    const tree=await prepareAssets(await inventoryTree(source,'content','basic'),out);
    await applyTree(tree,remote,hash(JSON.stringify([])));
    const folder=tree.folders[0],page=tree.files[0],before=await curriculumPreservation(remote);
    const refs=[{pageId:page.id,originalFileId:page.assets[0].id,fingerprint:page.sha256}];
    const plan=[{key:'basic-01',folderId:folder.id,family:'content',stage:'basic',title:folder.title,references:refs,sourceFingerprint:hash(JSON.stringify(refs.map(r=>[r.pageId,r.fingerprint])))}];
    const png=join(out,'basic-01.png');
    await sharp({create:{width:900,height:675,channels:3,background:'#ddeedd'}}).withMetadata({orientation:1}).png().toFile(png);
    const assets=await prepareCovers(plan,out),a=assets[0],meta=await sharp(await readFile(a.path)).metadata();
    assert.deepEqual([meta.width,meta.height],[640,480]);assert.equal(meta.exif,undefined);assert.ok(a.size<COVER_SPEC.maxBytes);
    const preview=await previewCovers(assets,remote);
    assert.equal((await publishCovers(assets,remote,preview.stateHash)).published,1);await verifyCover(a,remote);
    assert.deepEqual(await curriculumPreservation(remote),before);
    const unchanged=await previewCovers(assets,remote);
    assert.equal((await publishCovers(assets,remote,unchanged.stateHash)).skipped,1);assert.equal(puts,5);
    await assert.rejects(()=>publishCovers(assets,remote,preview.stateHash),/preview changed/);
    // Existing importer retains custom cover metadata and counts only printable page assets.
    const records=await remote.records('content','basic');
    const again=await prepareAssets(planInventory(await inventoryTree(source,'content','basic'),records),out,records);
    await applyTree(again,remote,hash(JSON.stringify(records)));
    assert.equal((await verifyTree(again,remote)).registeredFiles,4);
    await rm(source,{recursive:true});
    const url=`/api/data-core/files/${a.id}`;
    for(const user of [users.admin,users.teacher,users.foreign,users.staff]) {
      const list=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',user);
      assert.equal(list.body.totalPages,1);assert.equal(list.body.folders[0].representativeUrl,url);
      assert.equal(list.body.folders[0].fallbackRepresentativeUrl,`/api/data-core/files/${page.assets.find(f=>f.kind==='thumbnail').id}`);
      assert.equal(list.body.folders[0].coverAlt,a.alt);
      const file=await h.raw('GET',url,user);assert.equal(file.status,200);assert.equal(hash(new Uint8Array(await file.arrayBuffer())),a.sha256);
      assert.match(file.headers.get('cache-control'),/private/);
      const print=await h.request('GET','/api/data-core/curriculum/print?family=content&stage=basic',user);
      assert.equal(print.body.pages.length,1);assert.equal(print.body.pages[0].originalUrl,`/api/data-core/files/${page.assets[0].id}`);
    }
    for(const user of [null,users.outsider])assert.equal((await h.raw('GET',url,user)).status,user?403:401);
    for(const user of [users.teacher,users.foreign])assert.equal((await h.request('DELETE',url,user)).status,403);
    // Tombstoned covers fall back immediately without touching the original page.
    await h.env.DB.prepare("UPDATE file_objects SET deleted_at='synthetic' WHERE id=?").bind(a.id).run();
    const fallback=await h.request('GET','/api/data-core/curriculum?family=content&stage=basic',users.foreign);
    assert.equal(fallback.body.folders[0].representativeUrl,fallback.body.folders[0].fallbackRepresentativeUrl);
    assert.notEqual((await h.raw('GET',url,users.foreign)).status,200);
    await h.env.DB.prepare('UPDATE file_objects SET deleted_at=NULL WHERE id=?').bind(a.id).run();
    const saved=(await remote.records('content','basic')).find(r=>r.id===folder.id).metadata_json;
    for(const patch of [{active:false},{parentFolderId:folder.id},{coverFileId:page.assets[0].id}]) {
      await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify({...JSON.parse(saved),...patch}),folder.id).run();
      assert.notEqual((await h.raw('GET',url,users.foreign)).status,200);
    }
    await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(saved,folder.id).run();
    // New versions use a new object; a concurrent edit blocks only the cover link.
    await sharp({create:{width:900,height:675,channels:3,background:'#ccddee'}}).png().toFile(png);
    const next=await prepareCovers(plan,out),nextPreview=await previewCovers(next,remote);drift=true;
    await assert.rejects(()=>publishCovers(next,remote,nextPreview.stateHash),/Concurrent folder edit/);
    assert.equal((await remote.records('content','basic')).find(r=>r.id===folder.id).metadata.coverFileId,a.id);
    const resume=await previewCovers(next,remote);await publishCovers(next,remote,resume.stateHash);
    assert.equal(await remote.objectHash(a.key),a.sha256);assert.equal((await h.raw('GET',url,users.foreign)).status,403);
    assert.deepEqual(await curriculumPreservation(remote),before);
    assert.equal(hash(new Uint8Array(await (await h.env.FILES.get(page.assets[0].key)).arrayBuffer())),hash(original));
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
    assert.equal((await remote.query('SELECT count(*) AS n FROM file_objects WHERE organization_id=? AND category=?',[ORG,'curriculum-cover'])).results[0].n,2);
  } finally {await h.mf.dispose();await rm(dir,{recursive:true,force:true});}
});

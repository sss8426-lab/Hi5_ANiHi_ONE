import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { libraryHarness, users, A, ORG } from './support/library-harness.mjs';

test('protected image revalidation and immutable library thumbnail provenance', async t => {
  const h=await libraryHarness();
  try {
    const folder=(await h.folder(`category:${A}:admission-material`,'__synthetic_thumbnail',users.staff)).body.folder.id;
    const original=await sharp({create:{width:1200,height:900,channels:3,background:'#2879af'}}).jpeg().toBuffer();
    const small=await sharp(original).resize({width:480}).withIccProfile('srgb').webp({quality:76}).toBuffer();
    const uploaded=await h.upload(folder,users.staff,{name:'synthetic.jpg',mime:'image/jpeg',bytes:original});assert.equal(uploaded.status,201);
    const id=uploaded.body.file.id, sourceBefore=await h.file(id);
    const path=`/api/data-core/library/files/${id}`, generic=`/api/data-core/files/${id}`;
    const create=(user=users.staff,bytes=small,mime='image/webp',origin='http://localhost',source=id)=>{
      const form=new FormData();form.set('file',new File([bytes],'thumbnail.webp',{type:mime}));
      form.set('campusId','forged');form.set('ownerUserId','forged');form.set('width','1');form.set('derivedFromFileId','forged');
      return h.request('POST',`/api/data-core/library/files/${source}/thumbnail`,user,form,origin);
    };
    const conditional=(route,user,tag)=>h.raw('GET',route,user,undefined,'http://localhost',{'if-none-match':tag});
    let tag;
    await t.test('first200, strong/weak/list/wildcard304, wrongETag200 on both protected APIs',async()=>{
      for(const route of [path,generic]){
        const first=await h.raw('GET',route,users.staff);assert.equal(first.status,200);tag=first.headers.get('etag');assert.ok(tag);
        assert.equal(first.headers.get('cache-control'),'private, no-cache');assert.deepEqual(Buffer.from(await first.arrayBuffer()),original);
        for(const value of [tag,`W/${tag}`,`"wrong", ${tag}`,'*']){const next=await conditional(route,users.staff,value);assert.equal(next.status,304);assert.equal((await next.arrayBuffer()).byteLength,0);}
        const wrong=await conditional(route,users.staff,'"wrong"');assert.equal(wrong.status,200);await wrong.arrayBuffer();
      }
    });
    await t.test('anonymous401; foreign private403 before304; download/nonimage no-store',async()=>{
      assert.equal((await conditional(path,null,tag)).status,401);
      await h.env.DB.prepare("UPDATE file_objects SET visibility='private' WHERE id=?").bind(id).run();
      for(const route of [path,generic])assert.equal((await conditional(route,users.foreign,tag)).status,403);
      await h.env.DB.prepare('UPDATE file_objects SET visibility=? WHERE id=?').bind(sourceBefore.visibility,id).run();
      const download=await conditional(path+'/download',users.staff,tag);assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'private, no-store');await download.arrayBuffer();
      const plain=await h.upload(folder,users.staff);const r=await conditional(`/api/data-core/library/files/${plain.body.file.id}`,users.staff,'*');
      assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');await r.arrayBuffer();
      assert.equal((await create(users.staff,small,'image/webp','http://localhost',plain.body.file.id)).status,415);
    });
    let derived;
    await t.test('new WebP shares source scope, separate ID/key, server dimensions and JSON relation; no original update',async()=>{
      const result=await create();assert.equal(result.status,201,JSON.stringify(result.body));derived=result.body.file;
      assert.notEqual(derived.id,id);assert.equal(derived.metadata.derivedFromFileId,id);assert.equal(derived.metadata.width,480);assert.equal(derived.metadata.height,360);
      assert.equal(derived.metadata.derivativeType,'thumbnail');assert.equal(derived.sourceApp,'data-core-thumbnail');
      assert.deepEqual(await h.file(id),sourceBefore);
      assert.deepEqual(Buffer.from(await (await h.env.FILES.get(sourceBefore.r2_key)).arrayBuffer()),original);
      const row=await h.file(derived.id);assert.notEqual(row.r2_key,sourceBefore.r2_key);
      for(const key of ['campus_id','owner_user_id','visibility'])assert.equal(row[key],sourceBefore[key]);
      const list=await h.list(folder,users.staff);assert.equal(list.body.files.filter(f=>f.id===derived.id).length,0);
      assert.equal(list.body.files.find(f=>f.id===id).thumbnailUrl,`/api/data-core/library/files/${derived.id}`);
      const regular=await h.request('GET','/api/data-core/files',users.staff);assert.ok(!JSON.stringify(regular.body).includes(derived.id));
    });
    await t.test('thumbnail read/304 inherits library sharing, generic campus boundary unchanged',async()=>{
      const route=`/api/data-core/library/files/${derived.id}`;
      const response=await h.raw('GET',route,users.foreign);assert.equal(response.status,200);const etag=response.headers.get('etag');await response.arrayBuffer();
      assert.equal((await conditional(route,users.foreign,etag)).status,304);
      assert.equal((await conditional(`/api/data-core/files/${derived.id}`,users.foreign,etag)).status,403);
      await h.env.DB.prepare("UPDATE file_objects SET visibility='private' WHERE id=?").bind(id).run();
      assert.equal((await conditional(route,users.foreign,etag)).status,403);
      await h.env.DB.prepare('UPDATE file_objects SET visibility=? WHERE id=?').bind(sourceBefore.visibility,id).run();
      await h.env.DB.prepare("UPDATE data_records SET deleted_at='synthetic-deleted' WHERE id=?").bind(folder).run();
      assert.equal((await conditional(route,users.staff,etag)).status,403);
      await h.env.DB.prepare('UPDATE data_records SET deleted_at=NULL WHERE id=?').bind(folder).run();
    });
    await t.test('foreign mutation/origin/MIME/malformed/oversized bytes and dimensions rejected; original preserved',async()=>{
      assert.equal((await create(users.foreign)).status,403);
      assert.equal((await create(users.staff,small,'image/webp','https://elsewhere.test')).status,403);
      assert.equal((await create(users.staff,small,'image/png')).status,400);
      assert.equal((await create(users.staff,Buffer.from('RIFF invalid'))).status,400);
      assert.equal((await create(users.staff,Buffer.alloc(257*1024))).status,400);
      const large=await sharp(original).resize(481).webp().toBuffer();assert.equal((await create(users.staff,large)).status,400);
      assert.equal((await create(users.staff,small,'image/webp','http://localhost',derived.id)).status,415);
      assert.deepEqual(await h.file(id),sourceBefore);
    });
    await t.test('reserved metadata cannot be forged/mutated with general record API',async()=>{
      const row=await h.file(derived.id);
      const forged=await h.request('POST','/api/data-core/records',users.admin,{recordType:'image-thumbnail',title:'forged',metadata:{derivedFromFileId:id}});
      assert.equal(forged.status,403);
      assert.equal((await h.request('PATCH',`/api/data-core/records/${row.data_record_id}`,users.admin,{title:'forged'})).status,403);
      await h.env.DB.prepare("UPDATE data_records SET metadata_json='{}' WHERE id=?").bind(row.data_record_id).run();
      assert.equal((await conditional(`/api/data-core/library/files/${derived.id}`,users.staff,'*')).status,403);
      await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify(derived.metadata),row.data_record_id).run();
    });
    await t.test('trashed source never304; restore reuses original; missing source/object never304',async()=>{
      assert.equal((await h.request('DELETE',path,users.staff)).status,200);
      assert.equal((await conditional(path,users.staff,tag)).status,404);
      assert.equal((await conditional(`/api/data-core/library/files/${derived.id}`,users.staff,'*')).status,403);
      assert.ok(await h.env.FILES.head(sourceBefore.r2_key));
      assert.equal((await h.request('POST',`/api/data-core/trash/files/${id}/restore`,users.admin)).status,200);
      assert.equal((await conditional(path,users.staff,tag)).status,304);
      // Ephemeral synthetic bucket only: simulate an absent original object.
      await h.env.FILES.delete(sourceBefore.r2_key);
      assert.equal((await conditional(path,users.staff,tag)).status,404);
      assert.equal((await conditional(`/api/data-core/library/files/${derived.id}`,users.staff,'*')).status,404);
      assert.equal((await conditional(`/api/data-core/files/${derived.id}`,users.staff,'*')).status,404);
      await h.env.FILES.put(sourceBefore.r2_key,original,{httpMetadata:{contentType:'image/jpeg'}});
    });
    await t.test('FAMILY storage and original bytes preserved',async()=>{
      assert.equal((await h.env.FAMILY_DB.prepare('SELECT value FROM library_sentinel').first()).value,'preserved');
      assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
      assert.equal((await h.env.FAMILY_FILES.list()).objects.length,1);
      assert.deepEqual(Buffer.from(await (await h.env.FILES.get(sourceBefore.r2_key)).arrayBuffer()),original);
      assert.equal((await h.file(id)).organization_id,ORG);
    });
  } finally { await h.mf.dispose(); }
});

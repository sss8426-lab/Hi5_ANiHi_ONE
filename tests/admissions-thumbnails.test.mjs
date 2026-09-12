import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {libraryHarness,users,A} from './support/library-harness.mjs';

test('admissions thumbnails preserve originals, isolate campus and reuse a committed derivative',async()=>{
  const h=await libraryHarness();
  try {
    const bytes=await sharp({create:{width:900,height:1200,channels:3,background:'#539181'}}).jpeg().toBuffer();
    const thumb=await sharp(bytes).resize({height:480}).webp({quality:76}).toBuffer();
    const form=new FormData();form.set('file',new File([bytes],'SYNTHETIC.jpg',{type:'image/jpeg'}));
    form.set('category','student-artwork');form.set('sourceApp','admissions');form.set('campusId',A);
    const upload=await h.request('POST','/api/data-core/upload',users.staff,form);assert.equal(upload.status,201);
    const id=upload.body.file.id,row=await h.file(id),path=`/api/admissions/files/${id}/thumbnail`;
    const create=(route=path,user=users.staff,data=thumb,origin='http://localhost')=>{
      const f=new FormData();f.set('file',new File([data],'thumbnail.webp',{type:'image/webp'}));f.set('campusId','forged');
      return h.request('POST',route,user,f,origin);
    };
    const fallback=await h.raw('GET',path,users.staff);assert.equal(fallback.status,200);assert.ok(Buffer.from(await fallback.arrayBuffer()).equals(bytes));
    assert.equal((await create(path,users.foreign)).status,403);
    assert.equal((await create(path,users.staff,thumb,'https://foreign.test')).status,403);
    assert.equal((await create(path,users.staff,Buffer.from('invalid'))).status,400);
    const [one,two]=await Promise.all([create(),create()]);
    assert.equal(one.status,201);assert.equal(two.status,201);assert.equal(one.body.file.id,two.body.file.id);
    assert.notEqual(one.body.file.id,id);assert.equal(one.body.file.metadata.derivedFromFileId,id);
    assert.equal(one.body.file.metadata.width,360);assert.equal(one.body.file.metadata.height,480);
    const small=await h.raw('GET',path,users.staff);assert.equal(small.headers.get('content-type'),'image/webp');
    assert.deepEqual(Buffer.from(await small.arrayBuffer()),thumb);
    assert.equal((await h.raw('GET',path,users.foreign,undefined,'http://localhost',{'if-none-match':'*'})).status,403);
    assert.deepEqual(await h.file(id),row);assert.deepEqual(Buffer.from(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()),bytes);

    const state={students:[{id:1,campusId:A,artworks:[{path:'artworks/SYNTHETIC-original.jpg'}]}],universities:[],cases:[],settings:{},awardFolders:[]};
    const serialized=JSON.stringify(state);await h.env.FILES.put('state/admissions-data.json',serialized);
    await h.env.FILES.put('artworks/SYNTHETIC-original.jpg',bytes,{httpMetadata:{contentType:'image/jpeg'}});
    const legacy='/api/admissions/students/1/artworks/0/thumbnail';
    assert.deepEqual(Buffer.from(await (await h.raw('GET',legacy,users.staff)).arrayBuffer()),bytes);
    assert.equal((await create(legacy,users.staff)).status,403);
    assert.equal((await create(legacy,users.admin)).status,201);
    assert.equal((await create(legacy,users.admin)).body.reused,true);
    assert.deepEqual(Buffer.from(await (await h.raw('GET',legacy,users.staff)).arrayBuffer()),thumb);
    assert.deepEqual(Buffer.from(await (await h.raw('GET',legacy.replace('/thumbnail',''),users.staff)).arrayBuffer()),bytes);
    assert.equal((await h.raw('GET',legacy,users.foreign)).status,403);
    const derived=await h.env.DB.prepare("SELECT id,data_record_id FROM file_objects WHERE category='admissions-legacy-thumbnail'").first();
    assert.equal((await h.raw('GET',`/api/data-core/files/${derived.id}`,users.admin)).status,403);
    assert.equal((await h.request('PATCH',`/api/data-core/records/${derived.data_record_id}`,users.admin,{title:'forged'})).status,403);
    assert.equal(await (await h.env.FILES.get('state/admissions-data.json')).text(),serialized);
    assert.deepEqual(Buffer.from(await (await h.env.FILES.get('artworks/SYNTHETIC-original.jpg')).arrayBuffer()),bytes);
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
    state.students[0].campusId='campus-gwangjin';await h.env.FILES.put('state/admissions-data.json',JSON.stringify(state));
    assert.equal((await h.raw('GET',legacy,users.staff)).status,403);
    assert.deepEqual(Buffer.from(await (await h.raw('GET',legacy,users.foreign)).arrayBuffer()),bytes);
  }finally{await h.mf.dispose();}
});

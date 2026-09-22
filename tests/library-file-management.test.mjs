import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

test('library management: atomic moves, paths, counts, sorts, idempotency and original preservation',async t=>{
 const h=await libraryHarness();try{
  const make=async(parent,name)=>{const r=await h.folder(parent,'__synthetic_'+name,users.staff);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.folder;};
  const root=`category:${A}:academy-photo`,dest=await make(root,'destination'),source=await make(root,'source'),child=await make(source.id,'child');
  const uploaded=await h.upload(child.id,users.staff,{name:'protected-original.txt'});assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));const before=await h.file(uploaded.body.file.id);
  const move=(items,targetId,requestId=crypto.randomUUID(),user=users.staff)=>h.request('POST','/api/data-core/library/move',user,{items,targetId,requestId});
  const item={kind:'folder',id:source.id,revision:source.revision};
  await t.test('cycles, same parent, cross-campus, protected roots and foreign mutations fail',async()=>{
    for(const target of [source.id,child.id])assert.equal((await move([item],target)).status,409);
    assert.equal((await move([item],root)).status,409);
    assert.equal((await move([item],`category:${B}:academy-photo`)).status,403);
    assert.equal((await move([{kind:'folder',id:root,revision:null}],dest.id)).status,403);
    assert.equal((await move([item],dest.id,crypto.randomUUID(),users.foreign)).status,403);
    assert.equal((await move([item],`category:${A}:student-artwork`)).status,400);
  });
  await t.test('upload leases and stale revisions prevent partial moves',async()=>{
    const now=new Date().toISOString();await h.env.DB.prepare(`INSERT INTO data_records(id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,status,visibility,metadata_json,created_at,updated_at) VALUES('synthetic-lease','org-hi5-anihi',?,'oai:library-staff','library-write-lease','data-core-library','test','uploading','private',?,?,?)`).bind(A,JSON.stringify({folderId:child.id}),now,now).run();
    assert.equal((await move([item],dest.id)).status,409);assert.deepEqual(await h.file(before.id),before);
    await h.env.DB.prepare("DELETE FROM data_records WHERE id='synthetic-lease'").run();
    assert.equal((await move([{...item,revision:'stale'}],dest.id)).status,409);
  });
  await t.test('metadata-only subtree move is atomic and replayable; latest paths and direct counts',async()=>{
    const r2calls=[];const bucket=h.env.FILES;h.env.FILES=new Proxy(bucket,{get(target,key){if(['get','head','put','delete','list','createMultipartUpload','resumeMultipartUpload'].includes(key))return (...args)=>{r2calls.push(key);return target[key](...args);};return target[key];}});
    const requestId=crypto.randomUUID(),items=[item,{kind:'folder',id:child.id,revision:child.revision},{kind:'file',id:before.id,revision:child.id}];
    const result=await move(items,dest.id,requestId);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.moved,1);assert.equal(result.body.folders,2);assert.equal(result.body.files,1);
    assert.deepEqual((await move(items,dest.id,requestId)).body,result.body);assert.deepEqual(r2calls,[]);h.env.FILES=bucket;
    assert.deepEqual(await h.file(before.id),before);
    const listing=await h.list(child.id,users.staff);assert.deepEqual(listing.body.files[0].path.slice(-3).map(p=>p.id),[dest.id,source.id,child.id]);
    const browse=await h.browse(root,users.staff);const d=browse.body.folders.find(f=>f.id===dest.id);assert.equal(d.folderCount,1);assert.equal(d.fileCount,0);
    const row=(await h.browse(source.id,users.staff)).body.folder;
    const cross=await move([{kind:'folder',id:source.id,revision:row.revision}],`category:${A}:promotion-material`);assert.equal(cross.status,200,JSON.stringify(cross.body));
    const after=await h.file(before.id);assert.equal(after.category,'promotion-material');assert.equal(after.r2_key,before.r2_key);assert.equal(after.visibility,before.visibility);
    assert.equal((await h.list(child.id,users.staff)).body.files.length,1);
  });
  await t.test('server sort spans pages and focus seeks actual page',async()=>{
    const template=await h.file(before.id),now=new Date().toISOString();
    const statements=[];for(let i=0;i<105;i++)statements.push(h.env.DB.prepare(`INSERT INTO file_objects(id,organization_id,campus_id,data_record_id,owner_user_id,source_app,area,category,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`synthetic-sort-${i}`,template.organization_id,A,dest.id,template.owner_user_id,template.source_app,template.area,'academy-photo',`synthetic/${i}`,`item-${String(i).padStart(3,'0')}.txt`,'text/plain',i+1,template.visibility,now));await h.env.DB.batch(statements);
    const a=await h.list(dest.id,users.staff,'&sort=name&page=1'),b=await h.list(dest.id,users.staff,'&sort=name&page=2');assert.equal(a.body.files.length,50);assert.equal(b.body.files[0].fileName,'item-050.txt');
    const focus=await h.list(dest.id,users.staff,'&sort=name&focusId=synthetic-sort-104');assert.equal(focus.body.page,3,JSON.stringify(focus.body));assert.equal(focus.body.files.at(-1).id,'synthetic-sort-104');
    assert.equal((await h.list(dest.id,users.staff,'&sort=size')).body.files[0].sizeBytes,105);
  });
  await t.test('simple upload retries reuse original file; internal records cannot be forged',async()=>{
    const fields={uploadRequestId:crypto.randomUUID()},a=await h.upload(dest.id,users.staff,{fields}),b=await h.upload(dest.id,users.staff,{fields});assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(b.status,201,JSON.stringify(b.body));assert.equal(a.body.file.id,b.body.file.id);
    assert.equal((await h.upload(dest.id,users.staff,{fields,name:'different.txt'})).status,409);
    for(const recordType of ['library-write-lease','library-upload-request','library-upload-session']){const r=await h.request('POST','/api/data-core/records',users.admin,{recordType,title:'forgery',campusId:A});assert.equal(r.status,403,JSON.stringify(r.body));}
  });
  await t.test('name collisions and AI protection downgrades fail; count errors remain unknown',async()=>{
    const a=await make(root,'collision-source'),b=await make(dest.id,'collision-source');
    assert.equal((await move([{kind:'folder',id:a.id,revision:a.revision}],dest.id)).status,409);
    assert.ok(b.id);
    const file=await h.upload(a.id,users.staff,{name:'duplicate.txt'});await h.upload(dest.id,users.staff,{name:'duplicate.txt'});
    assert.equal((await move([{kind:'file',id:file.body.file.id,revision:a.id}],dest.id)).status,409);
    const guarded=await make(`category:${A}:admission-material`,'ai-protected');
    assert.equal((await move([{kind:'folder',id:guarded.id,revision:guarded.revision}],dest.id)).status,400);
    const db=h.env.DB;h.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(sql.includes('COUNT(*) AS n'))throw Error('Synthetic count failure');return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    try{const result=await h.browse(root,users.staff);assert.equal(result.status,200);assert.equal(result.body.folders.find(f=>f.id===dest.id).fileCount,null);}finally{h.env.DB=db;}
  });
 }finally{await h.mf.dispose();}
});

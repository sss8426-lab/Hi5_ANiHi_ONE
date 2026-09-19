import assert from 'node:assert/strict';
import test from 'node:test';
import {libraryHarness,users,ORG,A} from './support/library-harness.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=','base64');
const base='/api/data-core/awards';
async function folder(h,user,title='SYNTHETIC folder',extra={}) {
  const r=await h.request('POST',base+'/folders',user,{title,collectionType:'enrolled',...extra});
  assert.equal(r.status,201,JSON.stringify(r.body));return r.body.record;
}
async function upload(h,user,parent,name='SYNTHETIC.png') {
  const form=new FormData();form.set('file',new File([png],name,{type:'image/png'}));
  form.set('recordId',parent.id);form.set('category','competition-material');form.set('campusId','forged-campus');form.set('fileName','forged-name');
  const r=await h.request('POST','/api/data-core/files',user,form);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.file;
}
test('six academy roles share folders/uploads; anonymous and nonmembers cannot enter',async()=>{
  const h=await libraryHarness();
  try {
    for(const user of [users.master,users.admin,users.campusAdmin,users.director,users.teacher,users.staff]) {
      for(const type of ['enrolled','public']) {
        const root=await folder(h,user,'SYNTHETIC '+user.id,{collectionType:type});
        const child=await folder(h,users.foreign,'SYNTHETIC child',{parentFolderId:root.id,collectionType:type});
        const file=await upload(h,user,child);
        assert.equal(file.campusId,null);assert.equal(file.sourceApp,'competition');
        assert.equal((await h.request('GET','/api/data-core/files/'+file.id,users.foreign)).status,200);
        const dl=await h.raw('POST',`${base}/files/${file.id}/download`,users.foreign);
        assert.equal(dl.status,200);assert.deepEqual(Buffer.from(await dl.arrayBuffer()),png);
        const row=await h.file(file.id);
        assert.equal((await h.request('DELETE',`${base}/folders/${root.id}`,users.teacher)).status,200);
        assert.equal((await h.request('GET','/api/data-core/files/'+file.id,user)).status,403);
        assert.deepEqual(await h.file(file.id),row);
        assert.deepEqual(Buffer.from(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()),png);
        assert.equal((await h.request('POST',`${base}/folders/${root.id}/restore`,users.admin)).status,200);
        assert.equal((await h.request('GET','/api/data-core/files/'+file.id,user)).status,200);
      }
    }
    for(const user of [null,users.outsider])for(const path of ['/folders','/activity']) {
      assert.equal((await h.request('GET',base+path,user)).status,user?403:401);
      assert.equal((await h.request('POST',base+path,user,{})).status,user?403:401);
    }
    assert.equal((await h.request('GET',base+'/folders',null,undefined,undefined,{cookie:'family_session=synthetic-guardian'})).status,401);
    assert.equal((await h.request('POST',base+'/folders',users.teacher,{title:'X',collectionType:'enrolled'},'https://attacker.invalid')).status,403);
    assert.equal((await h.request('POST',base+'/folders',users.teacher,{title:'X',collectionType:'enrolled'},null)).status,403);
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT value FROM library_sentinel').first()).value,'preserved');
  } finally {await h.mf.dispose();}
});
test('three-level breadcrumbs, eight-level bound, parent immutability and nondestructive legacy classification',async()=>{
  const h=await libraryHarness();
  try {
    const root=await folder(h,users.teacher),path=[root];
    for(let i=1;i<8;i++)path.push(await folder(h,users.staff,'SYNTHETIC '+i,{parentFolderId:path.at(-1).id}));
    const leaf=await h.request('GET',`${base}/folders/${path.at(-1).id}`,users.foreign);
    assert.deepEqual(leaf.body.breadcrumbs.map(r=>r.id),path.map(r=>r.id));
    assert.equal((await h.request('POST',base+'/folders',users.teacher,{title:'Too deep',parentFolderId:path.at(-1).id})).status,400);
    for(const parent of [root.id,path.at(-1).id]) {
      assert.equal((await h.request('PATCH',`${base}/folders/${root.id}`,users.admin,{parentFolderId:parent})).status,400);
      assert.equal((await h.request('PATCH',`/api/data-core/records/${root.id}`,users.admin,{metadata:{parentFolderId:parent}})).status,400);
    }
    const legacy=(await h.request('POST','/api/data-core/records',users.admin,{recordType:'competition-award-folder',sourceApp:'competition',title:'SYNTHETIC legacy'})).body.record;
    assert.equal(legacy.collectionType,null);
    assert.equal((await h.request('GET',base+'/folders?collectionType=enrolled',users.teacher)).body.folders.find(r=>r.id===legacy.id).needsClassification,true);
    assert.equal((await h.request('PATCH',`${base}/folders/${legacy.id}`,users.teacher,{collectionType:'public'})).status,403);
    assert.equal((await h.request('PATCH',`${base}/folders/${legacy.id}`,users.admin,{collectionType:'public'})).status,200);
    assert.equal((await h.request('GET',base+'/folders?collectionType=public',users.teacher)).body.folders.find(r=>r.id===legacy.id).title,legacy.title);
    const child=path[1];
    await h.request('PATCH',`${base}/folders/${root.id}`,users.admin,{collectionType:'public'});
    assert.equal((await h.request('GET',`${base}/folders/${child.id}`,users.teacher)).body.record.collectionType,'public');
  } finally {await h.mf.dispose();}
});
test('original filenames and collisions preserved, downloads audited, previews never audited',async()=>{
  const h=await libraryHarness();
  try {
    const root=await folder(h,users.teacher),child=await folder(h,users.staff,'SYNTHETIC child',{parentFolderId:root.id});
    const files=[];
    for(const name of ['대상 작품.jpg','김민지_청강대.png','수상작 (최종).webp','한글 파일 이름.jpeg','수상작.jpg','수상작.jpg']) {
      const f=await upload(h,users.teacher,child,name),row=await h.file(f.id);files.push(row);
      assert.equal(row.original_file_name,name);assert.equal(f.fileName,name);
      assert.equal((await h.request('GET','/api/data-core/files/'+f.id,users.foreign)).status,200);
      assert.equal((await h.request('GET',base+'/activity?filter=download',users.admin)).body.events.length,0);
    }
    assert.equal(new Set(files.map(r=>r.r2_key)).size,6);assert.equal(new Set(files.map(r=>r.id)).size,6);
    for(const file of files) {
      const r=await h.raw('POST',`${base}/files/${file.id}/download`,users.foreign);
      assert.equal(r.status,200);assert.equal(decodeURIComponent(r.headers.get('content-disposition').split("filename*=UTF-8''")[1]),file.original_file_name);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
    }
    const activity=(await h.request('GET',base+'/activity',users.admin)).body.events;
    assert.equal(activity.filter(e=>e.action==='folder.create').length,2);
    assert.equal(activity.filter(e=>e.action==='file.upload').length,6);
    assert.equal(activity.filter(e=>e.action==='file.download').length,6);
    assert.ok(activity.every(e=>e.actorDisplayName==='Synthetic Library' && !JSON.stringify(e).includes('r2_key')));
    const dl=activity.find(e=>e.action==='file.download');assert.match(dl.actorCampusName,/광진/);
    const stored=await h.env.DB.prepare("SELECT * FROM audit_logs WHERE resource_type='competition_award' AND action='file.upload' LIMIT 1").first();
    assert.equal(stored.actor_user_id,'oai:'+users.teacher.id);assert.equal(stored.campus_id,A);
    assert.equal(JSON.parse(stored.metadata_json).folderId,child.id);
    const file=files[0];
    assert.equal((await h.request('DELETE',`/api/data-core/files/${file.id}?awardFolderId=${root.id}`,users.teacher)).status,403);
    assert.equal((await h.request('DELETE',`/api/data-core/files/${file.id}?awardFolderId=${child.id}`,users.staff)).status,200);
    assert.ok((await h.file(file.id)).deleted_at);assert.ok(await h.env.FILES.head(file.r2_key));
    assert.equal((await h.request('POST',`/api/data-core/trash/files/${file.id}/restore`,users.admin,undefined,'https://evil.example')).status,403);
    assert.equal((await h.request('POST',`/api/data-core/trash/files/${file.id}/restore`,users.admin)).status,200);
    assert.equal((await h.request('DELETE',`${base}/folders/${root.id}`,users.teacher)).status,200);
    const after=(await h.request('GET',base+'/activity',users.teacher)).body.events;
    assert.equal(after.filter(e=>e.action==='folder.delete').length,1);
    assert.equal((await h.request('DELETE',base+'/activity',users.admin)).status,405);
    for(const row of files)assert.deepEqual(Buffer.from(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()),png);
  }finally{await h.mf.dispose();}
});
test('activity keyset pages remain unique when new events arrive; private files stay private',async()=>{
  const h=await libraryHarness();
  try {
    const root=await folder(h,users.teacher),file=await upload(h,users.teacher,root);
    for(let i=0;i<30;i++) {const r=await h.raw('POST',`${base}/files/${file.id}/download`,users.staff);await r.arrayBuffer();}
    const first=(await h.request('GET',base+'/activity',users.teacher)).body;
    assert.equal(first.events.length,25);assert.ok(first.nextCursor);
    await folder(h,users.staff,'SYNTHETIC newer');
    const second=(await h.request('GET',base+'/activity?cursor='+encodeURIComponent(first.nextCursor),users.teacher)).body;
    assert.equal(new Set([...first.events,...second.events].map(e=>e.eventId)).size,32);
    const row=await h.file(file.id);
    await h.env.DB.prepare("UPDATE file_objects SET visibility='private',area='student-private' WHERE id=?").bind(file.id).run();
    assert.equal((await h.request('GET','/api/data-core/files/'+file.id,users.foreign)).status,403);
    assert.equal((await h.request('POST',`${base}/files/${file.id}/download`,users.foreign)).status,403);
    assert.equal((await h.request('DELETE',`/api/data-core/files/${file.id}?awardFolderId=${root.id}`,users.foreign)).status,403);
    assert.ok(await h.env.FILES.head(row.r2_key));
    const privateDownload=await h.raw('POST',`${base}/files/${file.id}/download`,users.teacher);assert.equal(privateDownload.status,200);await privateDownload.arrayBuffer();
    const restricted=await h.env.DB.prepare("SELECT id FROM audit_logs WHERE resource_type='competition_award' AND json_extract(metadata_json,'$.restricted')=1").first();
    assert.ok(restricted);
    const safeEvents=(await h.request('GET',base+'/activity',users.foreign)).body.events;
    assert.ok(safeEvents.every(e=>e.eventId!==restricted.id));
    assert.equal((await h.request('GET',base+'/folders?trash=1',users.teacher)).status,403);
    assert.equal((await h.request('GET',base+'/activity?cursor=not-json',users.teacher)).status,400);
    assert.equal((await h.request('POST',base+'/folders',users.teacher,{title:'X',collectionType:'unknown'})).status,400);
    assert.equal((await h.request('GET','/api/data-core/records?recordType=competition-award-folder',users.outsider)).body.records.length,0);
    assert.equal((await h.env.DB.prepare('SELECT count(*) AS n FROM data_records WHERE organization_id<>?').bind(ORG).first()).n,0);
  }finally{await h.mf.dispose();}
});

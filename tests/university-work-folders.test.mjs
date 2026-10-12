import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {libraryHarness,users} from './support/library-harness.mjs';
const base='/api/data-core/awards';
test('university roots: master-only POST, concurrent idempotency, shared workspace and tombstone preservation', async()=>{
  const h=await libraryHarness();
  try {
    const list=()=>h.request('GET',base+'/folders?collectionType=admitted',users.teacher);
    assert.equal((await list()).body.folders.length,0);
    for(const user of [null,users.teacher,users.campusAdmin]) {
      assert.equal((await h.request('POST',base+'/university-folders',user,{})).status,user?403:401);
    }
    assert.equal((await h.request('POST',base+'/university-folders',users.master,{},'https://attacker.invalid')).status,403);
    const results=await Promise.all([h.request('POST',base+'/university-folders',users.master,{}),h.request('POST',base+'/university-folders',users.master,{})]);
    for(const result of results)assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(results[0].body.universityCount,68);
    assert.equal(results.reduce((sum,result)=>sum+result.body.created,0),136);
    assert.equal((await h.request('POST',base+'/university-folders',users.master,{})).body.created,0);
    const roots=(await list()).body.folders;
    assert.equal(roots.length,68);
    assert.equal((await h.request('GET',base+'/folders?collectionType=university',users.foreign)).body.folders.length,68);
    assert.equal((await h.request('GET',base+'/folders?collectionType=public',users.teacher)).body.folders.length,0);
    const root=roots.find(row=>row.title==='건국대학교 (글로컬캠퍼스)');
    const year=await h.request('POST',base+'/folders',users.teacher,{title:'2026',parentFolderId:root.id,collectionType:'admitted'});
    assert.equal(year.status,201);
    const detail=await h.request('GET',base+'/folders/'+year.body.record.id,users.foreign);
    assert.deepEqual(detail.body.breadcrumbs.map(row=>row.title),[root.title,'2026']);
    assert.equal((await h.request('DELETE',base+'/folders/'+root.id,users.teacher)).status,200);
    assert.equal((await h.request('POST',base+'/university-folders',users.master,{})).body.created,0);
    assert.equal((await list()).body.folders.length,67);
    const audit=await h.env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='folder.create' AND resource_id LIKE 'university-works:%'").first();
    assert.equal(audit.n,136);
  } finally {await h.mf.dispose();}
});
test('existing abbreviated college root is reused with its ID, metadata and contents preserved',async()=>{
  const h=await libraryHarness();
  try {
    const original=await h.request('POST',base+'/folders',users.teacher,{title:'경성대',collectionType:'university'});
    const before=await h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(original.body.record.id).first();
    const seeded=await h.request('POST',base+'/university-folders',users.master,{});
    assert.equal(seeded.body.created,135);
    const after=await h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(original.body.record.id).first();
    assert.deepEqual(after,before);
    const list=await h.request('GET',base+'/folders?collectionType=university',users.foreign);
    assert.equal(list.body.folders.length,68);
    assert.ok(list.body.folders.some(row=>row.id===before.id));
    assert.ok(!list.body.folders.some(row=>row.title==='경성대학교'));
  } finally {await h.mf.dispose();}
});
test('roadmap removes dashboard and duplicate counseling nav, retaining legacy dashboard routing',()=>{
  const roadmap=fs.readFileSync('public/admissions-web/renderer/index.html','utf8');
  const home=fs.readFileSync('public/data-core/index.html','utf8');
  const app=fs.readFileSync('public/admissions-web/renderer/app.js','utf8');
  assert.doesNotMatch(roadmap,/data-page="dashboard"|id="dashboard"/);
  assert.doesNotMatch(home,/data-view="works"/);
  assert.match(roadmap,/대학합격 우수작·우수작/);
  assert.match(app,/if\(page === 'dashboard'\) page = 'students'/);
});

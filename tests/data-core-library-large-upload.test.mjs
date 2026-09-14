import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

const MiB=1024*1024;
const GiB=1024*1024*1024;
const folder=`category:${A}:instagram-source`;
const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.body));

function start(h,{name='synthetic.ai',size=51*MiB,mime='application/octet-stream',user=users.staff,target=folder}={}) {
  return h.request('POST','/api/data-core/library/uploads',user,{folderId:target,fileName:name,mimeType:mime,sizeBytes:size});
}
function part(h,sessionId,partNumber,bytes,user=users.staff) {
  return h.request('PUT',`/api/data-core/library/uploads/${encodeURIComponent(sessionId)}/parts/${partNumber}`,user,bytes);
}
function complete(h,sessionId,parts,user=users.staff) {
  return h.request('POST',`/api/data-core/library/uploads/${encodeURIComponent(sessionId)}/complete`,user,{parts});
}
function abort(h,sessionId,user=users.staff) {
  return h.request('DELETE',`/api/data-core/library/uploads/${encodeURIComponent(sessionId)}`,user);
}

async function session(h,id) {
  return h.env.DB.prepare('SELECT id,status,metadata_json FROM data_records WHERE id=?').bind(id).first();
}

async function uploadSynthetic(h,{name='중앙대,대진대수상_cs6.ai',mime='application/pdf',size=50*MiB+123}={}) {
  const began=await start(h,{name,mime,size});ok(began,201);
  assert.equal(began.body.chunkSize,16*MiB);
  assert.equal(began.body.partCount,Math.ceil(size/(16*MiB)));
  const uploaded=[];
  const expected=createHash('sha256');
  for(let n=1;n<=began.body.partCount;n++) {
    const length=n===began.body.partCount ? size-(n-1)*began.body.chunkSize : began.body.chunkSize;
    const bytes=new Uint8Array(length);bytes.fill((n*37)%251);
    expected.update(bytes);
    const result=await part(h,began.body.sessionId,n,bytes);ok(result);
    uploaded.push({partNumber:result.body.partNumber,etag:result.body.etag});
  }
  const done=await complete(h,began.body.sessionId,uploaded);ok(done);
  return {began,done,expected:expected.digest('hex')};
}

test('library large design uploads use private R2 multipart sessions without exposing incomplete files',async t=>{
  const h=await libraryHarness();
  try {
    await t.test('51/110/250MiB design and archive files start multipart; blocked executables and >2GiB fail before R2 data upload',async()=>{
      for(const [name,size,mime] of [
        ['51MB.ai',51*MiB,''],
        ['110MB.psd',110*MiB,'application/octet-stream'],
        ['110MB.psb',110*MiB,'application/octet-stream'],
        ['250MB.zip',250*MiB,'application/zip'],
      ]) {
        const r=await start(h,{name,size,mime});ok(r,201);
        assert.equal(r.body.fileName,name);
        assert.equal(r.body.sizeBytes,size);
        assert.equal(r.body.mimeType,mime||'application/octet-stream');
        assert.equal((await h.list(folder,users.staff)).body.files.length,0,'pending session leaked into business file list');
        ok(await abort(h,r.body.sessionId));
        assert.equal((await session(h,r.body.sessionId)).status,'aborted');
      }
      ok(await start(h,{name:'danger.exe',size:51*MiB}),415);
      ok(await start(h,{name:'too-large.ai',size:2*GiB+1}),413);
    });

    await t.test('AI MIME is opaque, Unicode names are preserved, duplicate names get unique object identities',async()=>{
      const empty=await start(h,{name:'2026 청강대 수상작.ai',size:51*MiB,mime:''});ok(empty,201);
      assert.equal(empty.body.mimeType,'application/octet-stream');
      const postscript=await start(h,{name:'2026 청강대 수상작.ai',size:51*MiB,mime:'application/postscript'});ok(postscript,201);
      assert.equal(postscript.body.mimeType,'application/postscript');
      assert.notEqual(empty.body.sessionId,postscript.body.sessionId);
      assert.notEqual(empty.body.fileId,postscript.body.fileId);
      const rows=(await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id IN (?,?)').bind(empty.body.sessionId,postscript.body.sessionId).all()).results;
      const keys=rows.map(row=>JSON.parse(row.metadata_json).r2Key);
      assert.equal(new Set(keys).size,2);
      ok(await abort(h,empty.body.sessionId));ok(await abort(h,postscript.body.sessionId));
    });

    await t.test('session owner and campus boundaries protect part, complete and abort requests',async()=>{
      const began=await start(h,{name:'권한검증.ai',size:51*MiB});ok(began,201);
      ok(await part(h,began.body.sessionId,1,new Uint8Array([1]),users.foreign),404);
      ok(await complete(h,began.body.sessionId,[],users.foreign),404);
      ok(await abort(h,began.body.sessionId,users.foreign),404);
      assert.equal((await h.list(folder,users.staff)).body.files.length,0);
      ok(await abort(h,began.body.sessionId));
      const foreignFolder=`category:${B}:instagram-source`;
      const foreign=await start(h,{name:'foreign.ai',size:51*MiB,user:users.foreign,target:foreignFolder});ok(foreign,201);
      ok(await abort(h,foreign.body.sessionId,users.staff),404);
      ok(await abort(h,foreign.body.sessionId,users.foreign));
    });

    await t.test('cancel after a stored part aborts R2 multipart and never creates file_objects',async()=>{
      const began=await start(h,{name:'취소중.ai',size:51*MiB});ok(began,201);
      const first=new Uint8Array(16*MiB);first.fill(17);
      ok(await part(h,began.body.sessionId,1,first));
      assert.equal((await session(h,began.body.sessionId)).status,'uploading');
      assert.equal((await h.list(folder,users.staff)).body.files.length,0);
      ok(await abort(h,began.body.sessionId));
      assert.equal((await session(h,began.body.sessionId)).status,'aborted');
      assert.equal((await h.list(folder,users.staff)).body.files.length,0);
    });

    await t.test('50MiB+123B AI completes with <5MiB final part, registers only after R2 completion, and downloads byte-identically',async()=>{
      const {began,done,expected}=await uploadSynthetic(h,{});
      assert.equal(began.body.partCount,4);
      assert.ok(began.body.sizeBytes-(began.body.partCount-1)*began.body.chunkSize<5*MiB,'final part should exercise R2 small-final-part rule');
      const stored=await h.file(done.body.file.id);
      assert.equal(stored.original_file_name,'중앙대,대진대수상_cs6.ai');
      assert.equal(stored.mime_type,'application/pdf');
      assert.equal(stored.size_bytes,50*MiB+123);
      assert.equal(stored.data_record_id,folder);
      const listed=await h.list(folder,users.staff);ok(listed);assert.ok(listed.body.files.some(file=>file.id===done.body.file.id));
      const response=await h.raw('GET',`/api/data-core/library/files/${encodeURIComponent(done.body.file.id)}/download`,users.staff);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-disposition')||'',/^attachment;/);
      assert.ok((response.headers.get('content-disposition')||'').includes(encodeURIComponent('중앙대,대진대수상_cs6.ai')));
      assert.equal(response.headers.get('content-type'),'application/octet-stream');
      const downloaded=Buffer.from(await response.arrayBuffer());
      assert.equal(downloaded.length,50*MiB+123);
      assert.equal(createHash('sha256').update(downloaded).digest('hex'),expected);
      assert.equal((await session(h,began.body.sessionId)).status,'completed');
    });

    await t.test('AI declared application/pdf is never served as inline preview',async()=>{
      const listed=await h.list(folder,users.staff);ok(listed);
      const ai=listed.body.files.find(file=>file.fileName==='중앙대,대진대수상_cs6.ai');assert.ok(ai);
      const response=await h.raw('GET',`/api/data-core/library/files/${encodeURIComponent(ai.id)}`,users.staff);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-disposition')||'',/^attachment;/);
      assert.equal(response.headers.get('content-type'),'application/octet-stream');
    });
  } finally { await h.mf.dispose(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {libraryHarness, users, A, B} from './support/library-harness.mjs';
const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.body));

test('default folder edit preserves canonical IDs, bytes and private authorization',async t=>{
  const h=await libraryHarness(), path=id=>`/api/data-core/library/folders/${encodeURIComponent(id)}`;
  const patch=(id,user,body)=>h.request('PATCH',path(id),user,body);
  const remove=(id,user)=>h.request('DELETE',path(id),user);
  try {
    await t.test('every own-campus writer and master can rename, archive, browse and restore defaults',async()=>{
      for(const user of [users.staff,users.teacher,users.director,users.campusAdmin,users.master,users.admin]) {
        const id=`category:${A}:academy-photo`,parent=`campus:${A}`, title=`__synthetic_default_${user.id}`;
        assert.equal((await h.browse(id,user)).body.folder.canRename,true);
        ok(await patch(id,user,{title,campusId:B,libraryShareMode:'public'}));
        assert.equal((await h.browse(id,user)).body.folder.title,title);
        const upload=await h.upload(id,user);ok(upload,201);const before=await h.file(upload.body.file.id);
        ok(await remove(id,user));
        assert.ok(!(await h.browse(parent,user)).body.folders.some(f=>f.id===id));
        const archived=await h.request('GET',`/api/data-core/library/folders?parentId=${parent}&archived=1`,user);ok(archived);
        assert.ok(archived.body.folders.some(f=>f.id===id&&f.canRestore));
        const view=await h.browse(id,user);ok(view);assert.equal(view.body.folder.canWrite,false);assert.equal(view.body.folder.canRestore,true);
        ok(await h.upload(id,user),403);ok(await h.folder(id,'__synthetic_blocked',user),403);
        ok(await patch(id,user,{title:'blocked'}),403);
        ok(await h.request('GET',`/api/data-core/library/files/${before.id}/download`,user));
        assert.deepEqual(await h.file(before.id),before);
        assert.equal(await(await h.env.FILES.get(before.r2_key)).text(),'synthetic library content');
        ok(await patch(id,user,{restore:true}));
        assert.ok((await h.browse(parent,user)).body.folders.some(f=>f.id===id&&f.title===title));
        assert.equal((await h.browse(id,user)).body.folder.canWrite,true);
      }
    });
    await t.test('cross-campus mutation, restore, trash listing and CSRF denied',async()=>{
      const id=`category:${B}:promotion-material`;
      ok(await patch(id,users.foreign,{title:'__synthetic_B'}));
      ok(await h.browse(id,users.staff));
      ok(await patch(id,users.staff,{title:'spoof',campusId:A}),403);ok(await remove(id,users.staff),403);
      ok(await remove(id,users.master));
      ok(await patch(id,users.staff,{restore:true}),403);
      ok(await h.request('GET',`/api/data-core/library/folders?parentId=campus:${B}&archived=1`,users.staff),403);
      ok(await h.request('PATCH',path(id),users.master,{restore:true},'https://evil.test'),403);
      ok(await patch(id,users.master,{restore:true}));
      ok(await patch('root',users.master,{title:'blocked'}),403);
      ok(await remove(`campus:${A}`,users.master),403);
    });
    await t.test('private student and director defaults keep boundaries after rename/archive/restore',async()=>{
      for(const id of [`category:${B}:student-artwork`,'hq-default:director-only']) {
        const file=await h.upload(id,users.master);ok(file,201);const before=await h.file(file.body.file.id);
        ok(await patch(id,users.master,{title:'__synthetic_private'}));ok(await remove(id,users.master));
        ok(await h.browse(id,users.staff),403);
        ok(await h.request('GET',`/api/data-core/library/files/${before.id}/download`,users.staff),403);
        ok(await patch(id,users.staff,{restore:true}),403);
        assert.deepEqual(await h.file(before.id),before);
        ok(await patch(id,users.master,{restore:true}));
        ok(await h.browse(id,users.staff),403);
      }
    });
    await t.test('virtual deletion persists, name validation, children and pending uploads are safe',async()=>{
      const id=`category:${A}:blog-source`;
      ok(await patch(id,users.staff,{title:''}),400);
      ok(await patch(id,users.staff,{title:'학원사진'}));
      ok(await remove(id,users.staff));
      assert.ok(!(await h.browse(`campus:${A}`,users.staff)).body.folders.some(f=>f.id===id));
      const collision=await h.folder(`campus:${A}`,'학원사진',users.staff);ok(collision,201);
      ok(await patch(id,users.staff,{restore:true}),409);
      ok(await remove(collision.body.folder.id,users.staff));ok(await patch(id,users.staff,{restore:true}));
      const child=await h.folder(id,'__synthetic_child',users.staff);ok(child,201);
      ok(await remove(id,users.staff),409);ok(await remove(child.body.folder.id,users.staff));
      const start=await h.request('POST','/api/data-core/library/uploads',users.staff,{folderId:id,fileName:'synthetic.psd',sizeBytes:80*1024*1024});ok(start,201);
      ok(await remove(id,users.staff),409);
      ok(await h.request('DELETE',`/api/data-core/library/uploads/${start.body.sessionId}`,users.staff));
      ok(await remove(id,users.staff));
      ok(await patch(id,users.staff,{restore:true}));
      const fresh=`category:${A}:instagram-source`;
      ok(await remove(fresh,users.staff));
      assert.equal((await h.browse(fresh,users.staff)).body.folder.archived,true);
      ok(await patch(fresh,users.staff,{restore:true}));
    });
  } finally {await h.mf.dispose();}
});

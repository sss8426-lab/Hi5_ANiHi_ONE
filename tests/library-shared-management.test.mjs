import assert from 'node:assert/strict';
import test from 'node:test';
import {libraryHarness, users, A, B} from './support/library-harness.mjs';
const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.body));

test('library shared read versus campus write, safe rename/move/delete and privacy',async t=>{
  const h=await libraryHarness();
  const route=id=>`/api/data-core/library/files/${id}`;
  const folderRoute=id=>`/api/data-core/library/folders/${id}`;
  try {
    const b=(await h.folder(`category:${B}:class-photo`,'__synthetic_shared_b',users.foreign)).body.folder.id;
    const file=(await h.upload(b,users.foreign)).body.file.id;
    await t.test('campus admin/director/teacher/staff read/download B but every mutation is 403',async()=>{
      for(const user of [users.campusAdmin,users.director,users.teacher,users.staff]){
        ok(await h.browse(b,user));ok(await h.list(b,user));
        ok(await h.request('GET',route(file),user));ok(await h.request('GET',route(file)+'/download',user));
        ok(await h.folder(b,'forbidden',user),403);ok(await h.upload(b,user),403);
        ok(await h.request('PATCH',folderRoute(b),user,{title:'forbidden',campusId:A}),403);
        ok(await h.request('DELETE',folderRoute(b),user),403);
        ok(await h.request('PATCH',route(file),user,{folderId:`category:${A}:class-photo`}),403);
        ok(await h.request('DELETE',route(file),user),403);
        ok(await h.request('POST','/api/data-core/library/uploads',user,{folderId:b,fileName:'test.psd',sizeBytes:80*1024*1024}),403);
        // Download permission does not imply generic API or AI input permission.
        ok(await h.request('GET',`/api/data-core/files/${file}`,user),403);
        ok(await h.request('POST','/api/data-core/content/generate',user,{sourceApp:'blog',campusId:A,prompt:'Synthetic',selectedFileIds:[file]}),403);
      }
    });
    await t.test('own-campus writers and both master roles rename, move, delete; source bytes and IDs stay unchanged',async()=>{
      for(const user of [users.master,users.admin,users.campusAdmin,users.director,users.teacher,users.staff]){
        for(const campus of user===users.master||user===users.admin?[A,B]:[A]){
          const parent=`category:${campus}:promotion-material`;
          const from=await h.folder(parent,`__synthetic_from_${user.id}_${campus}`,user);ok(from,201);
          const to=await h.folder(parent,`__synthetic_to_${user.id}_${campus}`,users.admin);ok(to,201);
          const id=from.body.folder.id,target=to.body.folder.id;
          ok(await h.request('PATCH',folderRoute(id),user,{title:'__synthetic_renamed'}));
          assert.equal((await h.browse(id,user)).body.folder.title,'__synthetic_renamed');
          const upload=await h.upload(id,users.admin);ok(upload,201);const fid=upload.body.file.id,before=await h.file(fid);
          ok(await h.request('PATCH',route(fid),user,{folderId:target}));
          assert.deepEqual(await h.file(fid),{...before,data_record_id:target});
          const count=(await h.browse(parent,user)).body.folders.find(f=>f.id===target).fileCount;assert.equal(count,1);
          ok(await h.request('DELETE',route(fid),user));
          const removed=await h.request('DELETE',folderRoute(target),user);ok(removed);
          assert.equal((await h.file(fid)).data_record_id,parent);
          ok(await h.request('POST',`/api/data-core/trash/files/${fid}/restore`,users.master));
          assert.equal(await (await h.env.FILES.get(before.r2_key)).text(),'synthetic library content');
          ok(await h.request('DELETE',folderRoute(id),user));
        }
      }
    });
    await t.test('explicit private, student-private, FAMILY, restricted and malformed lineage never cross campuses',async()=>{
      const original=await h.file(file);
      for(const [column,value] of [['visibility','private'],['area','student-private'],['source_app','family'],['r2_key','family/protected']]){
        await h.env.DB.prepare(`UPDATE file_objects SET ${column}=? WHERE id=?`).bind(value,file).run();
        for(const user of [users.staff,users.campusAdmin]){
          ok(await h.request('GET',route(file),user),403);ok(await h.request('GET',route(file)+'/download',user),403);
          const recent=await h.request('GET','/api/data-core/library/recent',user);ok(recent);assert.ok(!recent.body.files.some(f=>f.id===file));
        }
        await h.env.DB.prepare(`UPDATE file_objects SET ${column}=? WHERE id=?`).bind(original[column],file).run();
      }
      ok(await h.browse('hq-default:director-only',users.staff),403);
      const legacy=await h.request('POST','/api/data-core/records',users.admin,{recordType:'hq-library-folder',sourceApp:'data-core-library',title:'원장전용',visibility:'organization',metadata:{folderKey:'director-only'}});ok(legacy,201);
      const protectedFolder=legacy.body.record.id, protectedFile=(await h.upload(protectedFolder)).body.file.id;
      const protectedChild=await h.folder(protectedFolder,'__synthetic_protected');ok(protectedChild,201);
      for(const user of [users.staff,users.campusAdmin]){
        ok(await h.browse(protectedFolder,user),403);ok(await h.browse(protectedChild.body.folder.id,user),403);
        ok(await h.request('GET',route(protectedFile),user),403);ok(await h.request('GET',`/api/data-core/files/${protectedFile}`,user),403);
      }
      ok(await h.request('PATCH',route(protectedFile),users.master,{folderId:'hq-default:resources'}),400);
      assert.ok(!(await h.request('GET','/api/data-core/library/recent',users.master)).body.files.some(f=>f.id===protectedFile));
      const student=await h.upload(`category:${B}:student-artwork`,users.foreign);ok(student,201);
      ok(await h.request('GET',route(student.body.file.id),users.staff),403);
      const record=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(b).first();
      await h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.campusId',?) WHERE id=?").bind(A,b).run();
      ok(await h.request('GET',route(file),users.staff),403);
      await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(record.metadata_json,b).run();
    });
    await t.test('same-origin checks, duplicate names, wrong target and folder child safety',async()=>{
      ok(await h.request('PATCH',folderRoute(b),users.admin,{title:'csrf'},'https://evil.test'),403);
      ok(await h.request('PATCH',route(file),users.admin,{folderId:b},'https://evil.test'),403);
      ok(await h.request('PATCH',route(file),users.foreign,{folderId:`category:${A}:class-photo`}),403);
      ok(await h.request('PATCH',folderRoute(b),users.foreign,{title:''}),400);
      const child=await h.folder(b,'__synthetic_child',users.foreign);ok(child,201);
      ok(await h.request('DELETE',folderRoute(b),users.master),409);
      assert.equal((await h.file(file)).data_record_id,b);
      assert.deepEqual(await h.env.FAMILY_DB.prepare('SELECT * FROM library_sentinel').first(),{value:'preserved'});
      assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
    });
    await t.test('ordinary category move keeps original privacy and R2 identity',async()=>{
      const before=await h.file(file);
      ok(await h.request('PATCH',route(file),users.foreign,{folderId:`category:${B}:promotion-material`}));
      const after=await h.file(file);assert.deepEqual(after,{...before,data_record_id:`category:${B}:promotion-material`,category:'promotion-material'});
      ok(await h.request('GET',route(file)+'/download',users.staff));
      ok(await h.request('PATCH',route(file),users.foreign,{folderId:`category:${B}:student-artwork`}),400);
      assert.equal(await (await h.env.FILES.get(after.r2_key)).text(),'synthetic library content');
    });
    await t.test('pending upload blocks folder removal; HQ originals relocate without deletion',async()=>{
      const f=await h.folder(`category:${A}:promotion-material`,'__synthetic_pending',users.staff);ok(f,201);
      const start=await h.request('POST','/api/data-core/library/uploads',users.staff,{folderId:f.body.folder.id,fileName:'synthetic.psd',mimeType:'application/octet-stream',sizeBytes:80*1024*1024});ok(start,201);
      ok(await h.request('DELETE',folderRoute(f.body.folder.id),users.master),409);
      ok(await h.request('DELETE',`/api/data-core/library/uploads/${start.body.sessionId}`,users.staff));
      ok(await h.request('DELETE',folderRoute(f.body.folder.id),users.master));
      const hq=await h.folder('hq','__synthetic_hq_nonempty');ok(hq,201);
      const upload=await h.upload(hq.body.folder.id);ok(upload,201);const before=await h.file(upload.body.file.id);
      ok(await h.request('DELETE',folderRoute(hq.body.folder.id),users.master));
      assert.deepEqual(await h.file(before.id),{...before,data_record_id:'hq-default:resources'});
      ok(await h.request('GET',route(before.id)+'/download',users.staff));
    });
  } finally {await h.mf.dispose();}
});

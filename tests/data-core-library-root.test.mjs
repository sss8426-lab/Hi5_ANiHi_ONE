import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryHarness, users, A, B, ORG } from './support/library-harness.mjs';

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
test('library root: admin-only custom folders, protected projections and zero legacy cleanup writes', async t => {
  const h = await libraryHarness();
  const remove = (id, user = users.admin) => h.request('DELETE', `/api/data-core/library/folders/${encodeURIComponent(id)}`, user);
  const row = id => h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(id).first();
  const rootCreate = (title, user = users.admin, extras = {}) => h.request('POST', '/api/data-core/library/folders', user,
    { parentFolderId: null, title, ...extras });
  let root;
  try {
    await t.test('hide only common and the exact legacy test projection; no persistent object is deleted', async () => {
      const legacy = 'campus-synthetic-acceptance-20260909';
      await h.env.DB.prepare(`INSERT INTO campuses (id,organization_id,code,name,status,created_at,updated_at)
        VALUES (?,?,'synthetic-acceptance-20260909','SYNTHETIC TEST 20260909','active','2026-09-09','2026-09-09')`).bind(legacy,ORG).run();
      const fixture = await h.folder(`category:${legacy}:admission-material`, '__synthetic_legacy_preserved'); ok(fixture,201);
      const uploaded = await h.upload(fixture.body.folder.id); ok(uploaded,201);
      const fileBefore = await h.file(uploaded.body.file.id), folderBefore = await row(fixture.body.folder.id);
      await h.env.FILES.put('__synthetic_root_sentinel', 'unchanged');
      for (const user of [users.admin,users.director,users.teacher,users.staff,users.admin]) {
        for (let repeat=0;repeat<2;repeat++) {
          const view=await h.browse('root',user);ok(view);
          assert.equal(view.body.folders.some(f=>f.id==='organization'||f.group==='공통'||f.id===`campus:${legacy}`),false);
          assert.ok(view.body.folders.some(f=>f.id===`campus:${A}`));assert.ok(view.body.folders.some(f=>f.id===`campus:${B}`));
          assert.equal(view.body.folder.canWrite,user===users.admin);
        }
      }
      // Old deep links are not an authorization bypass and are not destructively retired.
      ok(await h.browse('organization'));ok(await h.browse(`campus:${legacy}`));
      assert.ok(await h.env.DB.prepare('SELECT id FROM campuses WHERE id=?').bind(legacy).first());
      assert.deepEqual(await h.file(fileBefore.id),fileBefore);assert.deepEqual(await row(folderBefore.id),folderBefore);
      assert.equal(await (await h.env.FILES.get('__synthetic_root_sentinel')).text(),'unchanged');
    });
    await t.test('canonical custom root POST201; no client scope/owner/flags trusted', async () => {
      const r=await rootCreate('__synthetic_custom_root',users.admin,{campusId:B,ownerUserId:'forged',systemManaged:true,
        metadata:{parentFolderId:`campus:${B}`,libraryScope:'campus',createdFrom:'forged',libraryShareMode:'restricted'}});ok(r,201);
      root=r.body.folder.id;assert.equal(r.body.folder.parentId,'root');assert.equal(r.body.folder.canDelete,true);
      const stored=await row(root), m=JSON.parse(stored.metadata_json);
      assert.equal(stored.campus_id,null);assert.equal(stored.created_by_user_id,`oai:${users.admin.id}`);
      assert.deepEqual(m,{schemaVersion:1,parentFolderId:null,campusId:null,libraryScope:'organization',category:'library-material',
        libraryShareMode:'organization',systemManaged:false,createdFrom:'library-root',testOnly:true});
      assert.equal((await h.browse()).body.folders.filter(f=>f.id===root).length,1);
      ok(await rootCreate('__synthetic_custom_root'),409);
      const byString=await rootCreate('__synthetic_root_string',users.admin,{parentFolderId:'root'});ok(byString,201);ok(await remove(byString.body.folder.id));
    });
    await t.test('director/teacher/staff root POST and DELETE403; anonymous401; CSRF403', async () => {
      for (const user of [users.director,users.teacher,users.staff]) {
        for (const parentFolderId of [null,'root','']) ok(await rootCreate('__synthetic_forbidden',user,{parentFolderId}),403);
        ok(await remove(root,user),403);
        const view=await h.browse('root',user);ok(view);
        assert.equal(view.body.folder.canWrite,false);assert.equal(view.body.folders.find(f=>f.id===root).canDelete,false);
        ok(await h.browse(root,user));ok(await h.folder(root,'__synthetic_forbidden_child',user),403);
        ok(await h.upload(root,user),403);
      }
      ok(await rootCreate('__synthetic_anon',null),401);ok(await remove(root,null),401);
      ok(await h.request('POST','/api/data-core/library/folders',users.admin,{title:'__synthetic_csrf'},'https://evil.test'),403);
      ok(await h.request('DELETE',`/api/data-core/library/folders/${root}`,users.admin,undefined,'https://evil.test'),403);
    });
    await t.test('system campus/default/HQ roots protected including persisted legacy defaults', async () => {
      for (const id of ['root','hq','organization',`campus:${A}`,`campus:${B}`,'hq-default:resources',`category:${A}:admission-material`]) {
        const view=await h.browse(id);ok(view);assert.equal(view.body.folder.canDelete,false);assert.equal(view.body.folder.systemManaged,true);ok(await remove(id),403);
      }
      const legacy=await h.request('POST','/api/data-core/records',users.admin,{recordType:'hq-library-folder',sourceApp:'data-core-library',
        title:'__synthetic_hq_default',visibility:'organization',metadata:{folderKey:'class-artwork'}});ok(legacy,201);
      const id=legacy.body.record.id, before=await row(id);
      assert.equal((await h.browse(id)).body.folder.canDelete,false);ok(await remove(id),403);assert.deepEqual(await row(id),before);
      // Protect materialized default projections without blocking normal content management inside them.
      const file=await h.upload('hq-default:resources');ok(file,201);ok(await remove('hq-default:resources'),403);
      const child=await h.folder('hq-default:resources','__synthetic_default_child');ok(child,201);ok(await remove(child.body.folder.id));
      ok(await h.request('DELETE',`/api/data-core/library/files/${file.body.file.id}`));
      const managed=await h.folder('hq','__synthetic_system_managed');ok(managed,201);
      await h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.systemManaged',json('true')) WHERE id=?").bind(managed.body.folder.id).run();
      ok(await remove(managed.body.folder.id),403);
    });
    await t.test('custom root children/upload/share unchanged; active and restorable trash block folder deletion', async () => {
      const child=await h.folder(root,'__synthetic_child');ok(child,201);
      assert.equal(JSON.parse((await row(child.body.folder.id)).metadata_json).libraryScope,'organization');
      const view=await h.browse(child.body.folder.id,users.staff);ok(view);assert.deepEqual(view.body.breadcrumbs.map(f=>f.id),['root',root,child.body.folder.id]);
      let blocked=await remove(root);ok(blocked,409);assert.equal(blocked.body.error,'폴더 안에 자료가 있습니다. 내부 자료를 먼저 정리해주세요.');
      ok(await remove(child.body.folder.id));
      const f=await h.upload(root);ok(f,201);const before=await h.file(f.body.file.id), bytes=await (await h.env.FILES.get(before.r2_key)).text();
      for(const user of [users.director,users.teacher,users.staff]) {
        ok(await h.list(root,user));const download=await h.request('GET',`/api/data-core/library/files/${f.body.file.id}/download`,user);ok(download);assert.equal(download.body,bytes);
        ok(await h.request('DELETE',`/api/data-core/library/files/${f.body.file.id}`,user),403);
      }
      ok(await remove(root),409);ok(await h.request('DELETE',`/api/data-core/library/files/${f.body.file.id}`));ok(await remove(root),409);
      assert.equal(await (await h.env.FILES.get(before.r2_key)).text(),bytes);
      ok(await h.request('POST',`/api/data-core/trash/files/${f.body.file.id}/restore`));assert.deepEqual(await h.file(before.id),before);
    });
    await t.test('empty custom root delete200 soft-deletes only its row; reserved metadata forgery is denied', async () => {
      const created=await rootCreate('__synthetic_empty_delete');ok(created,201);const id=created.body.folder.id;
      const fileCount=await h.env.DB.prepare('SELECT COUNT(*) n FROM file_objects').first();
      ok(await remove(id));assert.ok((await row(id)).deleted_at);ok(await h.browse(id),404);
      assert.equal((await h.browse()).body.folders.some(f=>f.id===id),false);
      assert.deepEqual(await h.env.DB.prepare('SELECT COUNT(*) n FROM file_objects').first(),fileCount);
      ok(await h.request('PATCH',`/api/data-core/records/${root}`,users.admin,{metadata:{systemManaged:false}}),403);
      const original=(await row(root)).metadata_json;
      for(const patch of [{createdFrom:'forged'},{campusId:B},{libraryScope:'hq'},{parentFolderId:'root'},{systemManaged:true}]) {
        await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify({...JSON.parse(original),...patch}),root).run();
        ok(await h.browse(root),403);
      }
      await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(original,root).run();
      assert.deepEqual(await h.env.FAMILY_DB.prepare('SELECT * FROM library_sentinel').first(),{value:'preserved'});
      assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
    });
  } finally { await h.mf.dispose(); }
});

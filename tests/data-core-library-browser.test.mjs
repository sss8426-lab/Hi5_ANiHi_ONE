import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryHarness, users, A, B, ORG } from './support/library-harness.mjs';

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
test('library folder browser: synthetic storage, complete ancestry and role boundaries', async t => {
  const h = await libraryHarness();
  const category = `category:${A}:admission-material`;
  const foreignCategory = `category:${B}:admission-material`;
  let parent, nested, uploaded, foreignFile, privateFile, hq;
  try {
    await t.test('root GET is projection only; anonymous/outsider denied; HQ legacy visibility preserved', async () => {
      const before = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM data_records').first();
      ok(await h.browse()); ok(await h.browse());
      assert.deepEqual(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM data_records').first(), before);
      ok(await h.browse('root', null), 401); ok(await h.browse('root', users.outsider), 403);
      for (const user of [users.director, users.teacher, users.staff, users.foreign]) {
        ok(await h.browse('root', user)); ok(await h.browse(`campus:${B}`, user));
      }
      const legacy = await h.request('POST', '/api/data-core/records', users.admin, { recordType: 'hq-library-folder', sourceApp: 'data-core-library',
        title: '원장전용', campusId: null, visibility: 'organization', metadata: { folderKey: 'director-only' } });
      ok(legacy, 201); hq = legacy.body.record.id;
      ok(await h.browse(hq, users.staff)); ok(await h.upload(hq, users.staff), 403);
      const restricted = await h.request('POST', '/api/data-core/records', users.admin, { recordType: 'hq-library-folder', sourceApp: 'data-core-library',
        title: 'Synthetic restricted', campusId: null, visibility: 'private' });
      ok(restricted, 201); ok(await h.browse(restricted.body.record.id, users.staff), 403);
      const f = await h.upload(restricted.body.record.id); ok(f, 201);
      ok(await h.request('GET', `/api/data-core/files/${f.body.file.id}`, users.staff), 403);
      ok(await h.request('GET', `/api/data-core/library/files/${f.body.file.id}`, users.staff), 403);
      ok(await h.request('DELETE', `/api/data-core/records/${hq}`, users.admin), 403);
    });
    await t.test('Unicode folders, duplicate validation, eight levels and current-folder isolation', async () => {
      const r = await h.folder(category, '  2026 합격 자료  ', users.staff); ok(r, 201);
      parent = r.body.folder.id; assert.equal(r.body.folder.title, '2026 합격 자료');
      ok(await h.folder(category, '2026 합격 자료', users.staff), 409);
      ok(await h.folder(category, '   ', users.staff), 400); ok(await h.folder(category, '가'.repeat(81), users.staff), 400);
      nested = parent;
      for (let i = 0; i < 8; i++) { const r = await h.folder(nested, `단계 ${i+1}`, users.staff); ok(r, 201); nested = r.body.folder.id; }
      const view = await h.browse(nested, users.teacher); ok(view); assert.equal(view.body.breadcrumbs.length, 12);
      assert.equal(view.body.breadcrumbs[0].id, 'root'); assert.equal(view.body.breadcrumbs.at(-1).id, nested);
      const f = await h.upload(nested, users.staff, { fields: { campusId: B, ownerId: 'forged', sourceApp: 'family', category: 'student-artwork' } }); ok(f, 201);
      uploaded = f.body.file.id;
      const row = await h.file(uploaded); assert.equal(row.campus_id, A); assert.equal(row.data_record_id, nested);
      assert.equal(row.source_app, 'data-core-library'); assert.equal(row.owner_user_id, `oai:${users.staff.id}`);
      assert.equal(row.original_file_name, '검증 자료.txt'); assert.equal(row.category, 'admission-material');
      assert.equal((await h.list(parent, users.staff)).body.files.length, 0);
      assert.equal((await h.list(nested, users.staff)).body.files.length, 1);
      assert.equal((await h.list(nested, users.staff, '&q=absent')).body.files.length, 0);
      assert.equal((await h.list(nested, users.staff, '&q='+encodeURIComponent('검증'))).body.files.length, 1);
      ok(await h.request('DELETE', `/api/data-core/library/folders/${parent}`, users.staff), 409);
      const empty = await h.folder(parent, '빈 폴더', users.teacher); ok(empty, 201);
      ok(await h.request('DELETE', `/api/data-core/library/folders/${empty.body.folder.id}`, users.staff), 403);
      ok(await h.request('DELETE', `/api/data-core/library/folders/${empty.body.folder.id}`, users.director));
      ok(await h.browse(empty.body.folder.id), 404);
    });
    await t.test('foreign library read/download only; generic #166 remains 403', async () => {
      const r = await h.folder(foreignCategory, 'Synthetic foreign folder', users.foreign); ok(r, 201);
      const foreign = r.body.folder.id;
      const f = await h.upload(foreign, users.foreign); ok(f, 201); foreignFile = f.body.file.id;
      for (const user of [users.staff, users.teacher, users.director]) {
        const view = await h.browse(foreign, user); ok(view); assert.equal(view.body.folder.canWrite, false);
        const list = await h.list(foreign, user); ok(list); assert.equal(list.body.files.length, 1); assert.equal(list.body.files[0].canDelete, false);
        ok(await h.request('GET', `/api/data-core/library/files/${foreignFile}`, user));
        const download = await h.request('GET', `/api/data-core/library/files/${foreignFile}/download`, user); ok(download);
        assert.match(download.headers.get('content-disposition'), /attachment; filename\*=UTF-8''/);
        assert.ok(download.headers.get('content-disposition').includes(encodeURIComponent('검증 자료.txt')));
        ok(await h.upload(foreign, user), 403); ok(await h.folder(foreign, 'forbidden', user), 403);
        ok(await h.request('DELETE', `/api/data-core/library/files/${foreignFile}`, user), 403);
        ok(await h.request('DELETE', `/api/data-core/library/folders/${foreign}`, user), 403);
        ok(await h.request('GET', `/api/data-core/files?campusId=${B}&sourceApp=data-core-library`, user), 403);
        ok(await h.request('GET', `/api/data-core/files/${foreignFile}`, user), 403);
      }
      const privateFolder = await h.folder(`category:${B}:student-artwork`, 'Private synthetic', users.foreign); ok(privateFolder, 201);
      const privateUpload = await h.upload(privateFolder.body.folder.id, users.foreign); ok(privateUpload, 201); privateFile=privateUpload.body.file.id;
      ok(await h.browse(privateFolder.body.folder.id, users.staff), 403);
      ok(await h.request('GET', `/api/data-core/library/files/${privateFile}/download`, users.staff), 403);
      const ownPrivateFolder = await h.folder(`category:${A}:student-artwork`, 'Own private synthetic', users.staff); ok(ownPrivateFolder, 201);
      const ownPrivate = await h.upload(ownPrivateFolder.body.folder.id, users.staff); ok(ownPrivate, 201);
      ok(await h.request('GET', `/api/data-core/library/files/${ownPrivate.body.file.id}`, users.teacher), 403);
      ok(await h.request('GET', `/api/data-core/library/files/${ownPrivate.body.file.id}`, users.staff));
    });
    await t.test('virtual upload materializes once; HQ uses same browser; creation CSRF and record forgery denied', async () => {
      ok(await h.upload(category, users.staff), 201); ok(await h.upload(category, users.staff), 201);
      assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM data_records WHERE id=?').bind(category).first()).n, 1);
      const f = await h.upload(hq); ok(f, 201);
      ok(await h.request('GET', `/api/data-core/library/files/${f.body.file.id}/download`, users.staff));
      const child = await h.folder(hq, '본원 하위'); ok(child, 201); ok(await h.browse(child.body.folder.id, users.staff));
      ok(await h.upload(child.body.folder.id, users.staff), 403);
      ok(await h.request('POST', '/api/data-core/library/folders', users.staff, { parentFolderId: parent, title: 'CSRF' }, 'https://evil.example'), 403);
      ok(await h.upload(parent, users.staff, { origin: 'https://evil.example' }), 403);
      ok(await h.request('POST', '/api/data-core/records', users.staff, { recordType: 'library-folder', sourceApp: 'data-core-library', campusId: A, title: 'forged', visibility: 'organization', metadata: {} }), 403);
      ok(await h.request('PATCH', `/api/data-core/records/${parent}`, users.admin, { metadata: { parentFolderId: foreignCategory } }), 403);
      const ordinary = await h.request('POST', '/api/data-core/records', users.staff, {recordType:'document',sourceApp:'data-core',title:'Synthetic ordinary',campusId:A});
      ok(ordinary,201);
      for (const recordType of ['library-folder',' library-folder ','hq-library-folder',' hq-library-folder ']) {
        ok(await h.request('PATCH', `/api/data-core/records/${ordinary.body.record.id}`, users.staff, {recordType,sourceApp:'data-core-library'}),403);
      }
    });
    await t.test('soft trash preserves R2 and restores into original folder; other owners denied', async () => {
      const before = await h.file(uploaded), bytes = await (await h.env.FILES.get(before.r2_key)).text();
      ok(await h.request('DELETE', `/api/data-core/library/files/${uploaded}`, users.teacher), 403);
      ok(await h.request('DELETE', `/api/data-core/library/files/${uploaded}`, users.director));
      assert.equal((await h.list(nested, users.staff)).body.files.length, 0);
      ok(await h.request('DELETE', `/api/data-core/library/folders/${nested}`, users.staff), 409);
      assert.equal(await (await h.env.FILES.get(before.r2_key)).text(), bytes);
      ok(await h.request('POST', `/api/data-core/trash/files/${uploaded}/restore`, users.staff));
      assert.equal((await h.list(nested, users.staff)).body.files[0].id, uploaded);
      assert.deepEqual(await h.file(uploaded), before);
    });
    await t.test('malformed/missing/deleted/cyclic lineage and FAMILY cannot bypass file access', async () => {
      const row = await h.file(foreignFile), folderId = row.data_record_id;
      const original = await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(folderId).first();
      for (const patch of [{parentFolderId: folderId}, {campusId: A}, {libraryShareMode:'restricted'}, {parentFolderId: 'missing'}]) {
        await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify({...JSON.parse(original.metadata_json), ...patch}),folderId).run();
        assert.ok([403,404,409].includes((await h.request('GET', `/api/data-core/library/files/${foreignFile}`, users.staff)).status));
      }
      await h.env.DB.prepare('UPDATE data_records SET metadata_json=?, deleted_at=? WHERE id=?').bind(original.metadata_json,'synthetic-deleted',folderId).run();
      ok(await h.request('GET', `/api/data-core/library/files/${foreignFile}`, users.staff),403);
      ok(await h.request('GET', `/api/data-core/files/${foreignFile}`, users.admin),403);
      await h.env.DB.prepare('UPDATE data_records SET deleted_at=NULL WHERE id=?').bind(folderId).run();
      await h.env.DB.prepare("UPDATE file_objects SET source_app='family' WHERE id=?").bind(foreignFile).run();
      ok(await h.request('GET', `/api/data-core/library/files/${foreignFile}`, users.admin),403);
      await h.env.DB.prepare('UPDATE file_objects SET source_app=? WHERE id=?').bind(row.source_app,foreignFile).run();
      await h.env.DB.prepare("UPDATE file_objects SET visibility='private' WHERE id=?").bind(foreignFile).run();
      ok(await h.request('GET', `/api/data-core/library/files/${foreignFile}`, users.staff),403);
      await h.env.DB.prepare('UPDATE file_objects SET visibility=? WHERE id=?').bind(row.visibility,foreignFile).run();
      assert.deepEqual(await h.env.FAMILY_DB.prepare('SELECT * FROM library_sentinel').first(), {value:'preserved'});
      assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(), 'preserved');
    });
  } finally { await h.mf.dispose(); }
});

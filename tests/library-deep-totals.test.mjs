import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryHarness, users, A } from './support/library-harness.mjs';

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test('자료보관함 totals, 하위 폴더 포함 listing, 사진/문서 tabs and uploader search keep folder rules', async t => {
  const h = await libraryHarness();
  try {
    const category = `category:${A}:academy-photo`;
    const make = async (parent, title, user = users.staff) => { const r = await h.folder(parent, title, user); ok(r, 201); return r.body.folder; };
    const put = async (folder, name, mime, user = users.staff) => { const r = await h.upload(folder, user, mime.startsWith('image/') ? { name, mime, bytes: PNG } : { name, mime }); ok(r, 201); return r.body.file.id; };
    const top = await make(category, '__synthetic_top'), child = await make(top.id, '__synthetic_child');
    const topPhoto = await put(top.id, 'top.png', 'image/png');
    const childPhoto = await put(child.id, 'child.png', 'image/png');
    const childDoc = await put(child.id, 'child.txt', 'text/plain');
    const art = await make(`category:${A}:student-artwork`, '__synthetic_private');
    const privateFile = await put(art.id, 'private.png', 'image/png');

    await t.test('folder cards: fileCount stays direct, totalFiles/totalImages cover every depth', async () => {
      const view = await h.browse(category, users.staff); ok(view);
      const card = view.body.folders.find(f => f.id === top.id);
      assert.deepEqual([card.fileCount, card.totalFiles, card.totalImages], [1, 3, 2]);
      const root = await h.browse('root', users.staff); ok(root);
      const campus = root.body.folders.find(f => f.id === `campus:${A}`);
      assert.equal(campus.totalFiles, campus.fileCount, 'campus cards keep every-depth counts');
      assert.equal(campus.totalImages, 3, 'student artwork the staff member may read is counted once');
      const none = await h.request('GET', '/api/data-core/library/folders?parentId=root&counts=0', users.staff);
      assert.ok(none.body.folders.every(f => f.totalFiles === null && f.totalImages === null), 'unknown, not zero');
    });

    await t.test('하위 폴더 포함 lists files of every folder below, each with its own folder and path', async () => {
      const direct = await h.list(top.id, users.staff); ok(direct);
      assert.deepEqual(direct.body.files.map(f => f.id), [topPhoto]);
      assert.deepEqual(direct.body.totals, { files: 1, images: 1 });
      const deep = await h.list(top.id, users.staff, '&deep=1'); ok(deep);
      assert.deepEqual(deep.body.files.map(f => f.id).sort(), [topPhoto, childPhoto, childDoc].sort());
      assert.deepEqual(deep.body.totals, { files: 3, images: 2 });
      const nested = deep.body.files.find(f => f.id === childDoc);
      assert.equal(nested.folderId, child.id); assert.equal(nested.path.at(-1).id, child.id);
      const campus = await h.list(`campus:${A}`, users.staff, '&deep=1'); ok(campus);
      assert.ok([topPhoto, childPhoto, childDoc].every(id => campus.body.files.some(f => f.id === id)), 'a campus folder lists its whole tree');
      ok(await h.list('root', users.staff, '&deep=1'));
      assert.deepEqual((await h.list('root', users.staff, '&deep=1')).body.files, [], 'the root never lists every campus at once');
    });

    await t.test('사진 / 문서 tabs filter by file type', async () => {
      const photos = await h.list(top.id, users.staff, '&deep=1&kind=image'); ok(photos);
      assert.deepEqual(photos.body.files.map(f => f.id).sort(), [topPhoto, childPhoto].sort());
      const docs = await h.list(top.id, users.staff, '&deep=1&kind=doc'); ok(docs);
      assert.deepEqual(docs.body.files.map(f => f.id), [childDoc]);
    });

    await t.test('search matches the file name or the uploader name', async () => {
      const byName = await h.list(top.id, users.staff, '&deep=1&q=child'); ok(byName);
      assert.deepEqual(byName.body.files.map(f => f.id).sort(), [childPhoto, childDoc].sort());
      const byOwner = await h.list(top.id, users.staff, '&deep=1&q=Synthetic'); ok(byOwner);
      assert.equal(byOwner.body.files.length, 3, 'uploaders are named "Synthetic Library" in the harness');
      assert.deepEqual((await h.list(top.id, users.staff, '&deep=1&q=__nobody__')).body.files, []);
    });

    await t.test('another campus never sees protected files through deep listing or totals', async () => {
      const foreign = await h.list(`campus:${A}`, users.foreign, '&deep=1'); ok(foreign);
      assert.equal(foreign.body.files.some(f => f.id === privateFile), false);
      const root = await h.browse('root', users.foreign); ok(root);
      const campus = root.body.folders.find(f => f.id === `campus:${A}`);
      assert.equal(campus.totalImages, 2, 'student artwork of campus A is not counted for a campus B account');
      const admin = await h.list(`campus:${A}`, users.admin, '&deep=1'); ok(admin);
      assert.ok(admin.body.files.some(f => f.id === privateFile));
    });
  } finally { await h.mf.dispose(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));

test('library recent uploads: newest-10 scope, folder navigation, exclusions and permission reuse', async t => {
  const h = await libraryHarness();
  const recent = (id = 'root', user = users.admin) =>
    h.request('GET', `/api/data-core/library/recent?folderId=${encodeURIComponent(id)}`, user);
  try {
    await t.test('shows the newest 10 of 12 uploads, newest first, 11th/12th excluded', async () => {
      const created = [];
      for (let i = 0; i < 12; i++) {
        const r = await h.upload(`category:${A}:blog-source`, users.admin, { name: `순서파일${String(i).padStart(2, '0')}.txt` });
        ok(r, 201);
        created.push(r.body.file.id);
        await h.env.DB.prepare('UPDATE file_objects SET created_at = ? WHERE id = ?')
          .bind(new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), r.body.file.id).run();
      }
      const view = await recent('root'); ok(view);
      assert.equal(view.body.files.length, 10);
      assert.deepEqual(view.body.files.map(f => f.id), created.slice(2).reverse());
      assert.equal(view.body.files.some(f => f.id === created[0] || f.id === created[1]), false);
      // Only the fields the spec asks for, no internal storage path.
      const [top] = view.body.files;
      assert.deepEqual(Object.keys(top).sort(), ['campusId', 'campusName', 'createdAt', 'fileName', 'folderId', 'folderTitle', 'id', 'mimeType', 'sizeBytes'].sort());
      assert.equal(top.campusId, A); assert.ok(top.campusName);
    });

    await t.test('clicking a recent row resolves to the real folder the file lives in', async () => {
      const uploaded = await h.upload(`category:${A}:academy-photo`, users.admin, { name: '최근이동.jpg', mime: 'image/jpeg' });
      ok(uploaded, 201);
      const view = await recent(`campus:${A}`); ok(view);
      const row = view.body.files.find(f => f.id === uploaded.body.file.id);
      assert.ok(row, 'newly uploaded file should be the newest campus row');
      assert.equal(row.folderId, `category:${A}:academy-photo`);
      assert.equal(row.folderTitle, '학원사진');
      const inFolder = await h.list(row.folderId); ok(inFolder);
      assert.ok(inFolder.body.files.some(f => f.id === uploaded.body.file.id));
    });

    await t.test('trashed files disappear from recent uploads immediately', async () => {
      const uploaded = await h.upload(`category:${A}:blog-source`, users.admin, { name: '곧삭제.txt' });
      ok(uploaded, 201);
      assert.ok((await recent('root')).body.files.some(f => f.id === uploaded.body.file.id));
      ok(await h.request('DELETE', `/api/data-core/library/files/${uploaded.body.file.id}`, users.admin));
      assert.equal((await recent('root')).body.files.some(f => f.id === uploaded.body.file.id), false);
    });

    await t.test('generated thumbnails and pending multipart sessions never appear in recent uploads', async () => {
      const original = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2879af' } }).jpeg().toBuffer();
      const uploaded = await h.upload(`category:${A}:academy-photo`, users.admin, { name: '원본사진.jpg', bytes: original, mime: 'image/jpeg' });
      ok(uploaded, 201);
      const small = await sharp(original).resize({ width: 400 }).webp({ quality: 70 }).toBuffer();
      const form = new FormData(); form.set('file', new File([small], 'thumbnail.webp', { type: 'image/webp' }));
      const thumb = await h.request('POST', `/api/data-core/library/files/${uploaded.body.file.id}/thumbnail`, users.admin, form);
      ok(thumb, 201);
      const view = await recent('root'); ok(view);
      assert.ok(view.body.files.some(f => f.id === uploaded.body.file.id), 'the original upload should still be listed');
      assert.equal(view.body.files.some(f => f.id === thumb.body.file.id), false, 'the derived thumbnail must not be listed');

      const start = await h.request('POST', '/api/data-core/library/uploads', users.admin,
        { folderId: `category:${A}:blog-source`, fileName: '대용량.psd', mimeType: 'application/octet-stream', sizeBytes: 80 * 1024 * 1024 });
      ok(start, 201);
      assert.equal((await recent('root')).body.files.some(f => f.id === start.body.fileId), false);
    });

    await t.test('root scope keeps campus-personal categories campus-bound while org-wide categories stay cross-campus, exactly like existing library reads', async () => {
      const personalB = await h.upload(`category:${B}:class-photo`, users.admin, { name: 'B캠퍼스수업사진.jpg', mime: 'image/jpeg' });
      ok(personalB, 201);
      const orgWideB = await h.upload(`category:${B}:blog-source`, users.admin, { name: 'B캠퍼스블로그소스.txt' });
      ok(orgWideB, 201);

      const admin = await recent('root', users.admin); ok(admin);
      assert.ok(admin.body.files.some(f => f.id === personalB.body.file.id));
      assert.ok(admin.body.files.some(f => f.id === orgWideB.body.file.id));

      const staff = await recent('root', users.staff); ok(staff); // campus A membership only
      assert.equal(staff.body.files.some(f => f.id === personalB.body.file.id), false, 'campus B personal-category file must not leak to campus A staff');
      assert.ok(staff.body.files.some(f => f.id === orgWideB.body.file.id), 'org-wide categories stay readable across campuses, matching the rest of the library');

      ok(await recent('root', users.outsider), 403);
      ok(await recent('root', null), 401);
    });

    await t.test('campus-scoped recent uploads reuse folder-level read permission, never a client-trusted campusId', async () => {
      const personalB = await h.upload(`category:${B}:class-photo`, users.admin, { name: 'B전용수업사진.jpg', mime: 'image/jpeg' });
      ok(personalB, 201);
      // Browsing campus:B itself is allowed for any staff (see data-core-library-browser.test.mjs); the
      // personal-category file inside it must still be excluded per-row, not by rejecting the whole request.
      const asForeignDirector = await recent(`campus:${B}`, users.director); ok(asForeignDirector);
      assert.equal(asForeignDirector.body.files.some(f => f.id === personalB.body.file.id), false);
      const asAdmin = await recent(`campus:${B}`, users.admin); ok(asAdmin);
      assert.ok(asAdmin.body.files.some(f => f.id === personalB.body.file.id));
      assert.ok(asAdmin.body.files.every(f => f.campusId === B));
    });
  } finally { await h.mf.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { libraryHarness, users, ORG } from './support/library-harness.mjs';

const image = (format, w = 120, h = 90) => sharp({ create: { width: w, height: h, channels: 3, background: '#9cc3b0' } })[format]().toBuffer();
async function pageForm(name = '1.jpg') {
  const form = new FormData();
  form.set('original', new File([await image('jpeg', 400, 300)], name, { type: 'image/jpeg' }));
  form.set('preview', new File([await image('webp', 220, 165)], 'preview.webp', { type: 'image/webp' }));
  form.set('thumbnail', new File([await image('webp', 64, 48)], 'thumbnail.webp', { type: 'image/webp' }));
  form.set('print', new File([await image('jpeg', 320, 240)], 'print.jpg', { type: 'image/jpeg' }));
  form.set('width', '400'); form.set('height', '300');
  return form;
}

test('only a master can add lesson folders and upload pages, in every course family, and they read like imported lessons', async () => {
  const h = await libraryHarness();
  try {
  const create = (user, body, origin) => h.request('POST', '/api/data-core/curriculum/folders', user, body, origin);
  for (const user of [users.campusAdmin, users.director, users.teacher, users.staff]) assert.equal((await create(user, { family: 'design', stage: 'basic', title: '금지' })).status, 403);
  assert.equal((await create(users.master, { family: 'design', stage: 'basic', title: '교차 출처' }, 'https://evil.example')).status, 403);
  assert.equal((await create(users.master, { family: 'start', stage: 'basic', title: '없는 단계' })).status, 404);
  for (const stage of ['main', 'comics', 'design']) assert.equal((await create(users.teacher, {family: 'start', stage, title: '금지'})).status, 403);
  assert.equal((await create(users.master, { family: 'design', stage: 'basic', title: '  ' })).status, 400);

  for (const [family, stage] of [['start', 'main'], ['start', 'comics'], ['start', 'design'], ['content', 'admission'], ['design', 'advanced']]) {
    const made = await create(users.master, { family, stage, title: `${family} 새 수업` });
    assert.equal(made.status, 201);
    const id = made.body.folder.id;
    const empty = await h.request('GET', `/api/data-core/curriculum/folders/${id}`, users.master);
    assert.equal(empty.body.canManage, true); assert.equal(empty.body.folder.webManaged, true); assert.equal(empty.body.pages.length, 0);
    assert.equal((await h.request('GET', `/api/data-core/curriculum/folders/${id}`, users.teacher)).body.canManage, false);

    assert.equal((await h.request('POST', `/api/data-core/curriculum/folders/${id}/pages`, users.teacher, await pageForm())).status, 403);
    for (const name of ['2.jpg', '1.jpg']) assert.equal((await h.request('POST', `/api/data-core/curriculum/folders/${id}/pages`, users.master, await pageForm(name))).status, 201);
    const bad = await pageForm(); bad.set('print', new File(['not an image'], 'print.jpg', { type: 'image/jpeg' }));
    assert.equal((await h.request('POST', `/api/data-core/curriculum/folders/${id}/pages`, users.master, bad)).status, 415);

    const list = await h.request('GET', `/api/data-core/curriculum?family=${family}&stage=${stage}`, users.teacher);
    assert.equal(list.status, 200);
    const card = list.body.folders.find(f => f.id === id);
    assert.equal(card.pageCount, 2); assert.match(card.representativeUrl, /^\/api\/data-core\/files\/cur-file-/);
    if (family === 'start') assert.equal(list.body.folders.length, 1, 'elementary categories must not share each other\'s lessons');
    const lesson = await h.request('GET', `/api/data-core/curriculum/folders/${id}`, users.teacher);
    assert.deepEqual(lesson.body.pages.map(p => p.order), [1, 2]);
    const print = await h.request('GET', `/api/data-core/curriculum/print?family=${family}&stage=${stage}&lesson=${id}`, users.staff);
    assert.equal(print.body.pages.length, 2);
    for (const p of lesson.body.pages) for (const url of [p.previewUrl, p.thumbnailUrl, p.printUrl, p.originalUrl]) {
      const file = await h.raw('GET', url, users.foreign); assert.equal(file.status, 200); assert.ok((await file.arrayBuffer()).byteLength);
    }
    assert.equal((await h.raw('GET', lesson.body.pages[0].originalUrl, users.outsider)).status >= 400, true);
  }

  // Folders from the desktop importer stay read-only on the web.
  const now = new Date().toISOString();
  await h.env.DB.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES ('cur-folder-imported',?,NULL,NULL,'curriculum-folder','curriculum','가져온 수업','organization','active',?,?,?)`)
    .bind(ORG, JSON.stringify({ schemaVersion: 1, family: 'content', stage: 'basic', order: 1, relativePath: '1 수업', parentFolderId: null, representativeFileId: null, active: true }), now, now).run();
  assert.equal((await h.request('POST', '/api/data-core/curriculum/folders/cur-folder-imported/pages', users.master, await pageForm())).status, 403);
  const audit = await h.env.DB.prepare("SELECT action, count(*) AS n FROM audit_logs WHERE resource_type='curriculum' GROUP BY action ORDER BY action").all();
  assert.deepEqual(audit.results.map(r => [r.action, r.n]), [['curriculum.folder.create', 5], ['curriculum.page.upload', 10]]);
  } finally { await h.mf.dispose(); }
});

test('a master can rename and delete web-made lesson folders; deleted lessons and files disappear for everyone', async () => {
  const h = await libraryHarness();
  try {
    const made = await h.request('POST', '/api/data-core/curriculum/folders', users.master, { family: 'design', stage: 'basic', title: '옛 이름' });
    const id = made.body.folder.id, path = `/api/data-core/curriculum/folders/${id}`;
    assert.equal((await h.request('POST', `${path}/pages`, users.master, await pageForm())).status, 201);
    const page = (await h.request('GET', path, users.master)).body.pages[0];

    for (const user of [users.campusAdmin, users.teacher, users.staff]) {
      assert.equal((await h.request('PATCH', path, user, { title: '금지' })).status, 403);
      assert.equal((await h.request('DELETE', path, user)).status, 403);
    }
    assert.equal((await h.request('PATCH', path, users.master, { title: '새 이름' }, 'https://evil.example')).status, 403);
    assert.equal((await h.request('PATCH', path, users.master, { title: ' ' })).status, 400);
    assert.equal((await h.request('PATCH', path, users.master, { title: '새 이름' })).status, 200);
    assert.equal((await h.request('GET', path, users.teacher)).body.folder.title, '새 이름');

    assert.equal((await h.raw('GET', page.previewUrl, users.teacher)).status, 200);
    assert.equal((await h.request('DELETE', path, users.master)).status, 200);
    assert.equal((await h.request('GET', path, users.teacher)).status, 404);
    const list = await h.request('GET', '/api/data-core/curriculum?family=design&stage=basic', users.teacher);
    assert.equal(list.body.totalFolders, 0); assert.equal(list.body.totalPages, 0);
    assert.ok((await h.raw('GET', page.previewUrl, users.teacher)).status >= 400);
    assert.equal((await h.request('DELETE', path, users.master)).status, 404);
    // Bytes stay in storage so a mistaken delete can be recovered by an administrator.
    const kept = await h.env.DB.prepare("SELECT count(*) AS n FROM file_objects WHERE data_record_id=? AND deleted_at IS NULL").bind(page.id).first();
    assert.equal(kept.n, 4);

    const now = new Date().toISOString();
    await h.env.DB.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES ('cur-folder-imported2',?,NULL,NULL,'curriculum-folder','curriculum','가져온 수업','organization','active',?,?,?)`)
      .bind(ORG, JSON.stringify({ schemaVersion: 1, family: 'content', stage: 'basic', order: 1, relativePath: '1 수업', parentFolderId: null, representativeFileId: null, active: true }), now, now).run();
    assert.equal((await h.request('PATCH', '/api/data-core/curriculum/folders/cur-folder-imported2', users.master, { title: 'x' })).status, 403);
    assert.equal((await h.request('DELETE', '/api/data-core/curriculum/folders/cur-folder-imported2', users.master)).status, 403);
  } finally { await h.mf.dispose(); }
});

test('every course family opens the shared lesson library with master-only folder and upload controls', () => {
  const page = readFileSync('public/data-core/curriculum.js', 'utf8'), library = readFileSync('public/data-core/curriculum-library.js', 'utf8');
  assert.match(page, /const libraryStage = family === 'start' \? startLibraryStages\[startStage\] : Object\.hasOwn\(stages, stage\) \? stage : null;/);
  assert.match(page, /const startLibraryStages = \{ drawing: 'main', comics: 'comics', design: 'design' \};/);
  assert.match(page, /has\('lesson'\)/);
  assert.match(page, /family=\$\{family\}&stage=/);
  assert.match(library, /data\.canManage&&!lesson\?'<form class="lesson-new-folder"/);
  assert.match(library, /data\.canManage&&data\.folder\?\.webManaged\?`<button type="button" data-upload>/);
  assert.match(library, /rendition\(bitmap, 2200, 'image\/webp', \.88\)/);
  assert.match(readFileSync('worker/router.ts', 'utf8'), /start\(\?:\\\/\(\?:drawing\|comics\|design\)/);
});

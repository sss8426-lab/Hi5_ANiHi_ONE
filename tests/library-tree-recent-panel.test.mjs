import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { unzipSync, strFromU8 } from '../public/data-core/vendor/fflate-0.8.3.js';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
const read = path => fs.readFileSync(path, 'utf8');

test('recent uploads name the uploader and, from any subfolder, stay inside that folder\'s campus', async t => {
  const h = await libraryHarness();
  const recent = (id, user = users.admin) => h.request('GET', `/api/data-core/library/recent?folderId=${encodeURIComponent(id)}`, user);
  try {
    const inA = await h.upload(`category:${A}:blog-source`, users.admin, { name: '가캠퍼스.txt' }); ok(inA, 201);
    const inB = await h.upload(`category:${B}:blog-source`, users.admin, { name: '나캠퍼스.txt' }); ok(inB, 201);
    await t.test('each row carries ownerName but never the internal owner id', async () => {
      const view = await recent('root'); ok(view);
      const row = view.body.files.find(f => f.id === inA.body.file.id);
      assert.equal(row.ownerName, 'Synthetic Library', 'the users.display_name the harness signs in with');
      assert.equal('ownerUserId' in row, false);
    });
    await t.test('"이 캠퍼스" from a subfolder lists only that campus; "전체" (root) lists both', async () => {
      const campus = await recent(`category:${A}:blog-source`); ok(campus);
      assert.ok(campus.body.files.some(f => f.id === inA.body.file.id));
      assert.equal(campus.body.files.some(f => f.id === inB.body.file.id), false);
      const all = await recent('root'); ok(all);
      assert.ok([inA, inB].every(u => all.body.files.some(f => f.id === u.body.file.id)));
    });
  } finally { await h.mf.dispose(); }
});

test('several selected files download as one zip with unique UTF-8 names; one file downloads directly', async () => {
  const saved = [], blobs = new Map();
  globalThis.document = { body: { append() {} }, createElement: () => ({ click() { saved.push({ href: this.href, name: this.download }); }, remove() {} }) };
  globalThis.URL.createObjectURL = blob => { const url = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; };
  globalThis.URL.revokeObjectURL = () => {};
  const bytes = { '/a': 'first', '/b': 'second', '/c': 'third' };
  globalThis.fetch = async url => new Response(bytes[url]);
  const { downloadFiles } = await import('../public/data-core/work/library-download.js');
  await downloadFiles([{ fileName: '수업 사진.jpg', downloadUrl: '/a', sizeBytes: 5 }], '10월');
  assert.deepEqual(saved.pop(), { href: '/a', name: '수업 사진.jpg' });
  const progress = [];
  await downloadFiles([
    { fileName: '수업 사진.jpg', downloadUrl: '/a', sizeBytes: 5 },
    { fileName: '수업 사진.jpg', downloadUrl: '/b', sizeBytes: 6 },
    { fileName: '계획:표.pdf', downloadUrl: '/c', sizeBytes: 5 },
  ], '최근 파일_2026-10-09', text => progress.push(text));
  const { href, name } = saved.pop();
  assert.equal(name, '최근 파일_2026-10-09.zip');
  const entries = unzipSync(new Uint8Array(await blobs.get(href).arrayBuffer()));
  assert.deepEqual(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strFromU8(v)])),
    { '수업 사진.jpg': 'first', '수업 사진 (2).jpg': 'second', '계획_표.pdf': 'third' });
  assert.ok(progress.includes('3/3개 받는 중…'));
  await assert.rejects(downloadFiles([{ fileName: 'a', downloadUrl: '/a', sizeBytes: 400e6 }, { fileName: 'b', downloadUrl: '/b', sizeBytes: 200e6 }], 'x'), /500MB/);
});

test('자료보관함 layout: folder tree, recent panel for every folder, selection bar; no 상위 폴더 button', () => {
  const hq = read('public/data-core/work/hq-library.js');
  assert.match(hq, /<aside id="libraryTree" class="lb-tree" aria-label="폴더 목록">/);
  assert.match(hq, /<aside id="libraryRecent" class="lb-recent" aria-labelledby="libraryRecentTitle" hidden>/);
  assert.doesNotMatch(hq, /id="libraryUp"|\$\('libraryUp'\)|최근 업로드 파일/);
  // The recent list is no longer limited to the root and campus folders.
  assert.doesNotMatch(hq, /if \(!\(id === 'root' \|\| id\.startsWith\('campus:'\)\)\)/);
  assert.match(hq, /const target=scope==='all'\?'root':picked\?`campus:\$\{picked\}`:id;/, 'recent panel: 이 캠퍼스 / a picked campus / 전체');
  assert.match(hq, /data-recent-campus="\$\{h\(c\.campusId\)\}"/);
  assert.match(hq, /data-recent-day=/); assert.match(hq, /data-recent-download-picked/); assert.match(hq, /class="lb-recent-dl"[^>]*download/);
  const manager = read('public/data-core/work/library-manager.js');
  assert.match(manager, /import \{ setupTree \} from '\.\/library-tree\.js/);
  assert.match(manager, /bar\.className='lb-selbar';bar\.hidden=true/);
  assert.match(manager, /download\.disabled=!items\.length\|\|items\.some\(i=>i\.kind!=='file'\)/);
  assert.match(manager, /void tree\.sync\(\);/);
  const tree = read('public/data-core/work/library-tree.js');
  assert.match(tree, /data-lb-folder="\$\{h\(folder\.id\)\}"/, 'tree links reuse the existing folder navigation');
  assert.match(tree, /navigationHidden\(folder\)/, 'hidden legacy folders stay out of the tree');
  const css = read('public/data-core/work/library-browser.css');
  assert.match(css, /\.lb-layout\{display:grid;grid-template-columns:250px minmax\(0,1fr\) 360px/);
  assert.match(css, /@container \(max-width:820px\)/);
  const index = read('public/data-core/index.html');
  assert.match(index, /work\/hq-library\.js\?v=20261009-mobile-app/);
  assert.match(read('public/data-core/work/kkumeum-nav.js'), /hq-library\.js\?v=20261009-mobile-app/);
});

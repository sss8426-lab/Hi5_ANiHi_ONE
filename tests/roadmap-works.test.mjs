import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = p => fs.readFileSync(p, 'utf8');

test('대학 합격 로드맵: 합격 재현작·우수작 menu shows the DATA CORE folder view inside the roadmap', () => {
  const html = read('public/admissions-web/renderer/index.html'), app = read('public/admissions-web/renderer/app.js');
  assert.match(html, /<button data-page="works">합격 재현작·우수작<\/button>/);
  assert.match(html, /<section id="works" class="page hidden"><\/section>/);
  assert.match(app, /'cases','works','strategy'/, 'the page can be opened from the address (#page=works)');
  assert.match(app, /src="\/data-core\/counseling\/works\?embed=1"/);
  assert.match(app, /event\.origin !== location\.origin \|\| event\.data\?\.type !== 'data-core-embed-height'/, 'only same-site height messages');
});

test('DATA CORE 합격 재현작·우수작 view: two 모음 on the shared award workspace, embeddable', () => {
  const html = read('public/data-core/index.html'), app = read('public/data-core/app.js'), css = read('public/data-core/award-workspace.css');
  for (const id of ['view-works', 'awardAdmittedCollection', 'awardUniversityCollection', 'admittedAwardFolderList', 'universityAwardFolderList', 'openAdmittedAwardFolderBtn', 'openUniversityAwardFolderBtn', 'awardSortAdmitted', 'awardSortUniversity']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /data-view="works"/);
  assert.match(app, /admitted:\{label:'합격생 재현작 모음'/); assert.match(app, /university:\{label:'대학 공개 우수작 모음'/);
  assert.match(app, /if \(path === '\/data-core\/counseling\/works'\) return 'works';/);
  assert.match(app, /document\.body\.classList\.add\('data-core-embed'\)/);
  assert.match(css, /body\.data-core-embed :is\(\.sidebar, \.topbar/);
  assert.match(read('worker/router.ts'), /url\.pathname === "\/data-core\/counseling\/works"/);
});

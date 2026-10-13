import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = p => fs.readFileSync(p, 'utf8');

test('대학 합격 로드맵: 대학합격 재현작 및 공개우수작 menu shows the DATA CORE folder view inside the roadmap', () => {
  const html = read('public/admissions-web/renderer/index.html'), app = read('public/admissions-web/renderer/app.js');
  assert.match(html, /<button data-page="works">대학합격 재현작 및 공개우수작<\/button>/);
  assert.match(html, /<section id="works" class="page hidden"><\/section>/);
  assert.match(app, /'home','students','cases','works'/, 'the page can be opened from the address (#page=works)');
  assert.match(app, /src="\/data-core\/counseling\/works\?embed=1"/);
  assert.match(app, /event\.origin !== location\.origin \|\| event\.data\?\.type !== 'data-core-embed-height'/, 'only same-site height messages');
});

test('DATA CORE 대학합격 재현작 및 공개우수작 view: two 모음 on the shared award workspace, embeddable', () => {
  const html = read('public/data-core/index.html'), app = read('public/data-core/app.js'), css = read('public/data-core/award-workspace.css');
  for (const id of ['view-works', 'awardAdmittedCollection', 'awardUniversityCollection', 'admittedAwardFolderList', 'universityAwardFolderList', 'openAdmittedAwardFolderBtn', 'openUniversityAwardFolderBtn', 'awardSortAdmitted', 'awardSortUniversity']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /data-view="works"/);
  assert.match(app, /admitted:\{label:'대학합격 재현작'/); assert.match(app, /university:\{label:'대학발표 우수작'/);
  assert.match(app, /if \(path === '\/data-core\/counseling\/works'\) return 'works';/);
  assert.match(app, /document\.body\.classList\.add\('data-core-embed'\)/);
  assert.match(css, /body\.data-core-embed :is\(\.sidebar, \.topbar/);
  assert.match(read('worker/router.ts'), /url\.pathname === "\/data-core\/counseling\/works"/);
});

test('대학 합격 로드맵: 다른 메뉴·뒤로가기 후 다시 들어오면 첫 화면 (이전 대학·폴더·그림·검색어가 남지 않음)', () => {
  const app = read('public/admissions-web/renderer/app.js'), guide = read('public/admissions-web/renderer/guidelines.js');
  assert.match(app, /if\(page !== activePageId\(\)\)\{ resetPageView\(page\); window\.scrollTo\(0, 0\); \}/, 'entering a page from another one resets it');
  const reset = app.slice(app.indexOf('function resetPageView('), app.indexOf('// 추천 대학'));
  assert.match(reset, /resetStudentView\(\)/);
  assert.match(reset, /caseSearch: ''/);
  assert.match(reset, /adminSearch: ''/);
  assert.match(reset, /page === 'admin'\) state\.selectedUniversityId = null/);
  assert.match(reset, /page === 'works' && \$\('works'\)\) \$\('works'\)\.innerHTML = ''/, '재현작·우수작 folder frame is opened anew');
  assert.match(reset, /freshGuidelinePage = page/);
  assert.match(app, /m\.renderGuidelines\(page, \{fresh\}\)/);
  assert.match(guide, /if\(fresh\) state\[season\]=\{\};/);
  // an address with ?university= still picks that university after the reset
  assert.ok(app.indexOf("showPage(page, false);") < app.indexOf("if(page === 'admin' && university"), 'deep link applies after the reset');
});

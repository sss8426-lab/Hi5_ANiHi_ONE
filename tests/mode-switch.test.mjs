import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(path, 'utf8');
const sw = read('public/data-core/mode-switch.js');

test('업무용 | 상담용 스위치 loads early on every DATA CORE page with a menu', () => {
  for (const page of ['public/data-core/index.html', 'public/data-core/content.html', 'public/data-core/reports.html', 'public/data-core/operations.html',
    'public/data-core/accounts.html', 'public/data-core/work/kkumeum.html', 'public/admissions-web/renderer/index.html']) {
    const html = read(page), at = html.indexOf('/data-core/mode-switch.js?v=20261012-mode-switch');
    assert.ok(at > 0 && at < html.indexOf('</head>'), page);
  }
  assert.match(sw, /brand\.after\(build\(\)\)/, 'right under the logo');
  assert.match(sw, />업무용<\/button><button type="button" data-core-mode="counseling">상담용</);
});

test('pressing a mode shows only that mode: in place on the DATA CORE page, otherwise straight to its home', () => {
  assert.match(sw, /if \(target === mode \|\| !HOMES\[target\]\) return;/);
  assert.match(sw, /window\.DataCoreSwitchMode\(target\)\) return;/);
  assert.match(sw, /HOMES = \{ work: '\/data-core\/work', counseling: '\/data-core\/counseling' \}/);
  const app = read('public/data-core/app.js');
  assert.match(app, /switchView\(mode === 'counseling' \? 'counseling-home' : 'work-home'\);/);
  assert.match(app, /document\.documentElement\.classList\.remove\('core-mode-direct'\);/);
  // A mode address never flashes the 모드 선택 screen before app.js picks the view.
  assert.match(sw, /html\.core-mode-direct #view-mode-home, html\.core-mode-direct \[data-nav-scope="mode"\] \{ display:none!important; \}/);
});

test('모드 선택으로 돌아가기 is gone from the work menu, the 상담용 menu and the phone menu', () => {
  for (const file of ['public/data-core/work-navigation.js', 'public/data-core/mobile-app.js']) assert.doesNotMatch(read(file), /모드 선택/, file);
  const index = read('public/data-core/index.html');
  const counseling = index.slice(index.indexOf('data-nav-scope="counseling"'), index.indexOf('data-nav-scope="work"'));
  assert.doesNotMatch(counseling, /mode-home|모드 선택/);
  assert.match(read('public/data-core/mobile-app.js'), /window\.DataCoreModeSwitch\?\.build\(true\)/);
});

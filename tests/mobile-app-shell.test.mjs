import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(path, 'utf8');
const index = read('public/data-core/index.html');
const shell = read('public/data-core/mobile-app.js');
const css = read('public/data-core/mobile-app.css');

test('업무용 홈 has a phone home screen with the same apps as the work menu', () => {
  const start = index.indexOf('<div class="work-app"');
  assert.ok(start > index.indexOf('id="view-work-home"'), 'the app home lives inside 업무용 홈');
  const block = index.slice(start, index.indexOf('</nav>', start));
  assert.match(block, /data-work-today/);
  for (const target of ['data-view="library"', 'href="/data-core/content/blog"', 'href="/data-core/content/instagram"', 'data-view="attendance"', 'href="/data-core/reports"', 'href="/data-core/kkumeum"'])
    assert.ok(block.includes(target), `${target} icon`);
  // 운영관리·계정 icons start hidden; only a MASTER context reveals them (the server still checks access).
  assert.match(block, /href="\/data-core\/operations" data-work-app-admin hidden/);
  assert.match(block, /href="\/data-core\/accounts" data-work-app-admin hidden/);
  assert.match(shell, /node\.hidden = !master/);
  // The desktop cards and 출석부 link stay for wide screens.
  assert.match(index, /class="menu-card-grid exact-three"/);
  assert.match(index, /class="at-work-link" data-view="attendance"/);
  assert.match(read('public/data-core/app.js'), /\.work-app-icon\[data-view\]/);
});

test('the phone shell loads on every 업무용 page except 꿈이음, which has its own app shell', () => {
  for (const page of ['index.html', 'content.html', 'reports.html', 'operations.html', 'accounts.html']) {
    const html = read(`public/data-core/${page}`);
    assert.match(html, /mobile-app\.css\?v=20261009-mobile-app/, page);
    assert.match(html, /mobile-app\.js\?v=20261009-mobile-app/, page);
  }
  assert.doesNotMatch(read('public/data-core/work/kkumeum.html'), /mobile-app\.js/);
  assert.match(shell, /classList\.contains\('kk-mobile'\)/);
});

test('the shell is phone-only and reuses existing navigation', () => {
  assert.match(shell, /matchMedia\('\(max-width: 760px\)'\)/);
  assert.match(css, /^\.ma-bar, \.ma-tabs, \.work-app \{ display: none; \}/m, 'nothing shows on desktop until body.mobile-app is set');
  assert.match(shell, /button\[data-work-menu="\$\{id\}"\]/, 'SPA buttons are clicked instead of re-implementing view switching');
  assert.match(shell, /document\.getElementById\('logoutBtn'\)/, 'logout goes through the page logout so caches are cleared');
  assert.match(css, /@media print \{ \.ma-bar, \.ma-tabs, \.ma-sheet \{ display: none !important; \}/);
});

test('calendar shares today\'s events with the 오늘 widget', () => {
  const calendar = read('public/data-core/calendar.js');
  assert.match(calendar, /new CustomEvent\('academy-calendar:today'/);
  assert.match(shell, /addEventListener\('academy-calendar:today'/);
  assert.match(index, /calendar\.js\?v=20261009-mobile-app/);
});

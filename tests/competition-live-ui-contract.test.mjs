import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ui = await readFile('public/data-core/competition-live-enhancement.js', 'utf8');
const loader = await readFile('public/data-core/mode-home-artwork.js', 'utf8');

test('competition news UI is permanently visible and uses only refresh', () => {
  assert.match(ui, /document\.querySelectorAll\('\[data-competition-source\]'\)\.forEach\(\(button\) => button\.remove\(\)\)/);
  assert.match(ui, /button\.textContent = '새로고침'/);
  assert.doesNotMatch(ui, /소식 가리기|소식 보이기|setNewsOpen/);
});

test('competition news auto-loads active source previews and renders source status', () => {
  assert.match(ui, /const SOURCES = \['mgood', 'artmd'\]/);
  assert.match(ui, /item\.sourceStatus === 'open' \|\| item\.sourceStatus === 'upcoming'/);
  assert.match(ui, /접수중/);
  assert.match(ui, /예정/);
  assert.match(ui, /setTimeout\(\(\) => refreshLiveNews\(false\), 700\)/);
  assert.match(loader, /competition-live-enhancement\.js\?v=20260909-counseling/);
});

test('registration deadlines are projected into both shared calendars without DATA CORE writes', () => {
  assert.match(ui, /function renderCalendarDeadlines\(/);
  assert.match(ui, /\[data-calendar-home\]/);
  assert.match(ui, /공모전 마감/);
  assert.match(ui, /공모전 접수 마감/);
  assert.match(ui, /item\.applicationEnd === date/);
  assert.doesNotMatch(ui, /\/api\/data-core\/calendar[^'"`]*['"`][\s\S]{0,120}method:\s*'POST'/);
});

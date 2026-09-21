import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
  assert.match(loader, /competition-live-enhancement\.js\?v=20260921-calendar/);
});

test('calendar redraw reuses exactly two observers without orphan subscriptions', () => {
  const instances = [];
  const homes = Array.from({ length: 2 }, () => ({ querySelectorAll: () => [], querySelector: () => null }));
  class Observer {
    constructor(callback) { this.callback = callback; this.connected = false; instances.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }
  const context = vm.createContext({
    calendarObservers: [], MutationObserver: Observer,
    document: { querySelectorAll: selector => selector === '[data-calendar-home]' ? homes : [] },
  });
  const functions = ui.slice(ui.indexOf('  function disconnectCalendarObservers()'), ui.indexOf('  async function refreshLiveNews('));
  vm.runInContext(functions + '\nrenderCalendarDeadlines();', context);
  for (let i = 0; i < 100; i++) {
    instances[i % 2].callback([]);
    assert.equal(instances.length, 2);
    assert.equal(instances.filter(observer => observer.connected).length, 2);
  }
});

test('registration deadlines are projected into both shared calendars without DATA CORE writes', () => {
  assert.match(ui, /function renderCalendarDeadlines\(/);
  assert.match(ui, /\[data-calendar-home\]/);
  assert.match(ui, /공모전 마감/);
  assert.match(ui, /공모전 접수 마감/);
  assert.match(ui, /item\.applicationEnd === date/);
  assert.doesNotMatch(ui, /\/api\/data-core\/calendar[^'"`]*['"`][\s\S]{0,120}method:\s*'POST'/);
});

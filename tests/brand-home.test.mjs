import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const controller = readFileSync('public/data-core/brand-home.js', 'utf8');
const html = readFileSync('public/data-core/index.html', 'utf8');
const master = {active: true, ready: true, master: true};

function harness({saved = null, storageBlocked = false} = {}) {
  const classes = new Set();
  const elements = Object.fromEntries(['brandPresentationStart', 'brandPresentationExit'].map(id => [id, {
    hidden: true, listeners: {}, attrs: {}, focused: false,
    addEventListener(event, fn) { this.listeners[event] = fn; },
    setAttribute(key, value) { this.attrs[key] = value; },
    focus() { this.focused = true; },
    click() { this.listeners.click(); },
  }]));
  let value = saved;
  const storage = {
    getItem() { if (storageBlocked) throw Error('Storage disabled'); return value; },
    setItem(_key, next) { if (storageBlocked) throw Error('Storage disabled'); value = next; },
    removeItem() { if (storageBlocked) throw Error('Storage disabled'); value = null; },
  };
  const window = {};
  runInNewContext(controller, {window, sessionStorage: storage, document: {
    getElementById: id => elements[id],
    body: {classList: {toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }}},
  }});
  return {api: window.DataCoreBrandHome, start: elements.brandPresentationStart,
    exit: elements.brandPresentationExit, presenting: () => classes.has('brand-presenting'), saved: () => value};
}

test('brand home retains original routes and calendar while removing introductory copy', () => {
  const home = html.split('id="view-counseling-home"')[1].split('id="view-curriculum"')[0];
  assert.match(home, /하이파이브\.애니하이/);
  assert.doesNotMatch(home, /상담용|컨설팅|<small>|상담 중 바로/);
  assert.match(home, /data-view="competitions"/);
  assert.match(home, /href="\/data-core\/roadmap"/);
  assert.match(home, /href="\/"/);
  for (const action of ['prev', 'next', 'today', 'add']) assert.match(home, new RegExp(`data-calendar-${action}`));
  const app = readFileSync('public/data-core/app.js', 'utf8');
  assert.match(app, /'counseling-home': '너와 나의 합격의 순간'/);
  assert.match(app, /authenticated && state\.context\?\.isSuperAdmin/);
  assert.match(app, /DataCoreBrandHome\?\.reset\(\)/);
  assert.ok(html.indexOf('/brand-home.js') < html.indexOf('/app.js'));
});

test('presentation requires confirmed MASTER context, not a sessionStorage flag', () => {
  const h = harness({saved: 'on'});
  assert.equal(h.presenting(), false);
  h.start.click();
  assert.equal(h.presenting(), false);
  h.api.update({active: true, ready: false, master: false});
  assert.equal(h.saved(), 'on');
  h.api.update({...master, master: false});
  assert.equal(h.saved(), null);
  assert.equal(h.start.hidden, true);
  assert.equal(h.presenting(), false);
});

test('MASTER can enter/exit with focus restored and no network or role mutation', () => {
  const h = harness();
  h.api.update(master);
  assert.equal(h.start.hidden, false);
  h.start.click();
  assert.equal(h.presenting(), true);
  assert.equal(h.exit.hidden, false);
  assert.equal(h.exit.focused, true);
  assert.equal(h.saved(), 'on');
  h.exit.click();
  assert.equal(h.presenting(), false);
  assert.equal(h.start.focused, true);
  assert.equal(h.saved(), null);
  assert.doesNotMatch(controller, /fetch\(|XMLHttpRequest|\/api\/|localStorage/);
});

test('refresh restores MASTER choice but other views retain their normal UI', () => {
  const h = harness({saved: 'on'});
  h.api.update(master);
  assert.equal(h.presenting(), true);
  h.api.update({...master, active: false});
  assert.equal(h.presenting(), false);
  assert.equal(h.start.hidden, true);
  h.api.update(master);
  assert.equal(h.presenting(), true);
  h.api.reset();
  assert.equal(h.saved(), null);
  assert.equal(h.presenting(), false);
});

test('storage denied still permits an in-memory MASTER presentation', () => {
  const h = harness({storageBlocked: true});
  h.api.update(master);
  h.start.click();
  assert.equal(h.presenting(), true);
  h.exit.click();
  assert.equal(h.presenting(), false);
});

test('new browser session starts in normal mode and lost role restores normal UI', () => {
  const h = harness();
  h.api.update(master);
  assert.equal(h.presenting(), false);
  h.start.click();
  h.api.update({...master, master: false});
  assert.equal(h.presenting(), false);
  assert.equal(h.saved(), null);
});

test('brand tokens are shared while editorial crop and presentation stay scoped', () => {
  const tokens = readFileSync('public/data-core/design-tokens.css', 'utf8');
  assert.match(tokens, /:root \{/);
  assert.match(tokens, /--core-sidebar: #151715/);
  assert.match(tokens, /--core-bg: #f8f8f5/);
  const css = readFileSync('public/data-core/design-system.css', 'utf8');
  assert.match(css, /object-position: var\(--card-focus, 50% 50%\)/);
  assert.match(css, /aspect-ratio: 3 \/ 2/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /body\.brand-home\.brand-presenting :is\(/);
});

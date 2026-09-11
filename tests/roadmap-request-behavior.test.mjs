import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../public/data-core/roadmap-model.js';
import {paginate} from '../public/data-core/pagination.js';

const source = (await fs.readFile('public/data-core/roadmap.js', 'utf8')).replace(/^import .+;\r?$/gm, '');

function harness() {
  const elements = new Map(), requests = [], shown = [], timers = new Map();
  let items = [], dialog, timerId = 0;
  const element = () => ({
    value: '', hidden: false, textContent: '', innerHTML: '', children: [],
    addEventListener() {}, focus() {}, after() {}, scrollIntoView() {}, setAttribute() {},
    append(child) { this.children.push(child); },
    querySelectorAll(selector) { return selector === '.university-item' ? items : []; },
    querySelector() { return null; },
  });
  const el = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = {
    ...model, paginate, occupationImageConcepts: [], foundationImages: {},
    resolveUniversityLogo: () => null, AbortController, URLSearchParams,
    location: { hash: '' }, history: {pushState() {},replaceState() {}},
    window: { HI5_ROADMAP_CONTENT: { careers: [], tracks: [], lessonAreas: [], sources: [] }, addEventListener() {}, scrollTo() {} },
    document: { getElementById: el, createElement: element, querySelectorAll: () => [], querySelector: () => dialog },
    showGuideline(row) { shown.push(row.id); dialog = { close() { dialog = null; } }; },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      // Ignore cancellation deliberately: generation guards must also reject late responses.
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  };
  vm.runInNewContext(source + '\n;globalThis.actions={state,route,linkUniversitySources,loadConnectedPrograms};', context);
  return {
    ...context.actions, el, requests, shown, timers,
    hasDialog: () => Boolean(dialog),
    buttons(ids) {
      items = ids.map(() => element());
      context.actions.state.visiblePrograms = ids.map(guidelineId => ({ guidelineId }));
      context.actions.linkUniversitySources();
      return items.map(item => item.children[0]);
    },
    respond(index, data) { requests[index].resolve({ ok: true, json: async () => data }); },
  };
}

test('guideline details are latest-click-wins even if an old transport ignores abort', async () => {
  const h = harness(), [a, b] = h.buttons(['synthetic-a', 'synthetic-b']);
  const first = a.onclick(), second = b.onclick();
  h.respond(1, { rows: [{ id: 'synthetic-b' }] }); await second;
  h.respond(0, { rows: [{ id: 'synthetic-a' }] }); await first;
  assert.deepEqual(h.shown, ['synthetic-b']);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(a.disabled, false); assert.equal(b.disabled, false);
  assert.equal(h.timers.size, 0);
});

test('career navigation discards both late guideline success and late failure', async () => {
  for (const failure of [false, true]) {
    const h = harness(), [button] = h.buttons(['synthetic-old']);
    const pending = button.onclick(); h.route();
    const before = h.el('notice').innerHTML;
    if (failure) h.requests[0].reject(new Error('synthetic network failure'));
    else h.respond(0, { rows: [{ id: 'synthetic-old' }] });
    await pending;
    assert.deepEqual(h.shown, []);
    assert.equal(h.el('notice').innerHTML, before);
    assert.equal(button.disabled, false);
  }
});

test('career navigation closes an already-open guideline', async () => {
  const h = harness(), [button] = h.buttons(['synthetic-a']);
  const pending = button.onclick(); h.respond(0, { rows: [{ id: 'synthetic-a' }] }); await pending;
  assert.equal(h.hasDialog(), true);
  h.route(); assert.equal(h.hasDialog(), false);
});

test('guideline response must match the selected file-independent guideline ID', async () => {
  const h = harness(), [button] = h.buttons(['synthetic-a']);
  const pending = button.onclick(); h.respond(0, { rows: [{ id: 'synthetic-wrong' }] }); await pending;
  assert.deepEqual(h.shown, []);
  assert.match(h.el('notice').innerHTML, /찾을 수 없습니다/);
});

test('timed-out guideline lookup releases the button for a successful retry', async () => {
  const h = harness(), [button] = h.buttons(['synthetic-a']);
  const pending = button.onclick();
  for (const fn of h.timers.values()) fn();
  assert.equal(h.requests[0].options.signal?.aborted, true);
  h.requests[0].reject(Object.assign(new Error('timeout'), { name: 'AbortError' })); await pending;
  assert.equal(button.disabled, false); assert.match(h.el('notice').innerHTML, /다시 눌러/);
  const retry = button.onclick(); h.respond(1, { rows: [{ id: 'synthetic-a' }] }); await retry;
  assert.deepEqual(h.shown, ['synthetic-a']); assert.equal(h.timers.size, 0);
  assert.equal(h.el('notice').hidden, true);
});

test('a new program page or filter cancels a pending guideline without an error banner', async () => {
  const h = harness(), [button] = h.buttons(['synthetic-a']);
  const pending = button.onclick();
  const refresh = h.loadConnectedPrograms({ id: 'D001' });
  h.respond(1, { programs: [] }); await refresh;
  h.requests[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); await pending;
  assert.deepEqual(h.shown, []);
  assert.equal(h.el('notice').hidden, true);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('guideline requests preserve authenticated same-origin read-only transport', async () => {
  const h = harness(), [button] = h.buttons(['synthetic-guideline']);
  const pending = button.onclick();
  assert.equal(h.requests[0].url, '/api/data-core/admissions/guidelines?id=synthetic-guideline');
  assert.equal(h.requests[0].options.credentials, 'include');
  assert.equal(h.requests[0].options.cache, 'no-store');
  assert.equal(h.requests[0].options.method, undefined);
  h.requests[0].resolve({ ok: false, status: 403 }); await pending;
  assert.deepEqual(h.shown, []); assert.equal(button.disabled, false);
});

test('existing program request guard preserves the current view after a stale failure', async () => {
  const h = harness();
  const first = h.loadConnectedPrograms({ id: 'D001' });
  const second = h.loadConnectedPrograms({ id: 'D017' });
  h.respond(1, { programs: [] }); await second;
  h.requests[0].reject(new Error('stale request')); await first;
  assert.equal(h.el('notice').hidden, true);
  assert.equal(h.timers.size, 0);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const origin = 'https://synthetic.example';
const source = await readFile(new URL('../public/family/sw.js', import.meta.url), 'utf8');
const currentCache = 'kkumeum-family-shell-v6';

function response(body, status = 200) {
  const result = new Response(body, { status });
  Object.defineProperty(result, 'type', { value: 'basic' });
  return result;
}

function harness() {
  const handlers = new Map();
  const stores = new Map();
  const calls = [];
  const installed = [];
  let network = async () => response('new shell');
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => ({
      addAll: async (paths) => { installed.push(...paths); for (const path of paths) store(name).set(key(path), response('installed')); },
      match: async (request) => store(name).get(key(request))?.clone(),
      put: async (request, value) => { store(name).set(key(request), value); },
    }),
  };
  vm.runInNewContext(source, {
    URL, caches,
    fetch: async (request, options) => { calls.push({ url: key(request), options }); return network(request); },
    self: { location: { origin }, addEventListener: (event, fn) => handlers.set(event, fn), skipWaiting() {}, clients: { claim() {} } },
  });
  async function dispatch(type, request) {
    const pending = [];
    let result;
    handlers.get(type)({ request, waitUntil: (p) => pending.push(p), respondWith: (p) => { result = p; } });
    const value = await result;
    await Promise.all(pending);
    return value;
  }
  return { stores, store, calls, installed, dispatch, setNetwork: (fn) => { network = fn; } };
}

test('PWA install includes every deployed guardian script, including report confirmation', async () => {
  const h = harness();
  await h.dispatch('install');
  const html = await readFile(new URL('../public/family/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1],origin).pathname);
  assert.ok(scripts.includes('/family/family-growth-labels.js'));
  for (const script of scripts) assert.ok(h.installed.includes(script), script);
  const sharedShell = ['/data-core/design-tokens.css','/data-core/assets/core-icons.svg','/data-core/image-gallery.js','/data-core/image-gallery.css'];
  assert.ok(h.installed.every((path) => (path.startsWith('/family/') || sharedShell.includes(path)) && !path.includes('/api/')));
  assert.ok(h.installed.includes('/family/family-theme.css'));
});

test('activation removes obsolete FAMILY shell caches only', async () => {
  const h = harness();
  for (const name of ['kkumeum-family-shell-v2', currentCache, 'unrelated-data-core-cache']) h.store(name);
  await h.dispatch('activate');
  assert.deepEqual([...h.stores.keys()], [currentCache, 'unrelated-data-core-cache']);
});

test('online HTML and scripts replace stale shell responses without changing cached query identities', async () => {
  const h = harness();
  for (const path of ['/family/', '/family/family.js', '/family/family-growth-labels.js', '/data-core/image-gallery.js', '/data-core/image-gallery.css']) {
    h.store(currentCache).set(origin + path, response('old shell without confirmation'));
    const result = await h.dispatch('fetch', new Request(origin + path + '?openNotice=synthetic-notice'));
    assert.equal(await result.text(), 'new shell');
    assert.equal(await h.store(currentCache).get(origin + path).clone().text(), 'new shell');
  }
  assert.ok([...h.store(currentCache).keys()].every((k) => !k.includes('?')));
  assert.ok(h.calls.every((call) => call.options.cache === 'no-cache'));
});

test('offline shell uses current cache, not unrelated or obsolete caches', async () => {
  const h = harness();
  h.store(currentCache).set(origin + '/family/', response('current offline shell'));
  h.store('kkumeum-family-shell-v2').set(origin + '/family/family.js', response('obsolete'));
  h.setNetwork(async () => { throw new TypeError('offline'); });
  assert.equal(await (await h.dispatch('fetch', new Request(origin + '/family/?openNotice=synthetic'))).text(), 'current offline shell');
  await assert.rejects(h.dispatch('fetch', new Request(origin + '/family/family.js')), /offline/);
});

test('HTTP failure does not overwrite a good shell or pretend success from cache', async () => {
  const h = harness();
  h.store(currentCache).set(origin + '/family/', response('good shell'));
  h.setNetwork(async () => response('unavailable', 503));
  assert.equal((await h.dispatch('fetch', new Request(origin + '/family/'))).status, 503);
  assert.equal(await h.store(currentCache).get(origin + '/family/').text(), 'good shell');
});

test('private APIs never use or populate caches; non-shell and mutation requests are not intercepted', async () => {
  const h = harness();
  for (const path of ['/api/family/children/synthetic/reports', '/api/family/files/synthetic', '/api/kkumeum/files/synthetic']) {
    h.store(currentCache).set(origin + path, response('must never read'));
    h.setNetwork(async () => response('denied', 401));
    assert.equal((await h.dispatch('fetch', new Request(origin + path))).status, 401);
    assert.equal(await h.store(currentCache).get(origin + path).clone().text(), 'must never read');
    h.setNetwork(async () => { throw new TypeError('offline'); });
    await assert.rejects(h.dispatch('fetch', new Request(origin + path)), /offline/);
  }
  const count = h.calls.length;
  for (const request of [new Request(origin + '/family/not-allowlisted'), new Request('https://other.example/family/'), new Request(origin + '/api/family/read-receipts', { method: 'POST' })]) {
    assert.equal(await h.dispatch('fetch', request), undefined);
  }
  assert.equal(h.calls.length, count);
});

import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const html = readFileSync('public/data-core/login.html', 'utf8');
const script = readFileSync('public/data-core/login.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness({session = {authenticated: false}, search = '', respond} = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const classes = new Set(id === 'passwordFormWrap' ? ['hidden'] : []);
    const button = {disabled: false};
    return [id, {value: '', textContent: '', button, listeners: {},
      classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)},
      focus() { this.focused = true; },
      addEventListener(event, fn) { this.listeners[event] = fn; },
      querySelector(selector) { assert.equal(selector, 'button'); return button; },
    }];
  }));
  const calls = [], redirects = [];
  runInNewContext(script, {
    URLSearchParams,
    document: {getElementById: id => { assert.ok(nodes.has(id)); return nodes.get(id); }},
    location: {search, assign: path => redirects.push(path)},
    fetch: async (path, options) => {
      calls.push({path, options});
      const result = path === '/api/auth/session' ? {body: session} : await respond(path, options);
      return {ok: !result.status || result.status < 400, json: async () => result.body};
    },
  });
  await tick();
  return {nodes, calls, redirects, submit: id => {
    const node = nodes.get(id);
    return node.listeners.submit({preventDefault() {}, currentTarget: node});
  }};
}

test('approved local image, accessible exact headline and isolated versioned login stylesheet', () => {
  assert.match(html, /너와 나의 합격의 순간<br>하이파이브/);
  assert.match(html, /login-highfive-v1\.webp" width="1536" height="1024" fetchpriority="high"/);
  assert.match(html, /login\.css\?v=20260910-editorial-v1/);
  assert.doesNotMatch(html, /layout-theme\.css|mode-sidebar\.svg|https?:\/\//);
  assert.match(html, /href="\/data-core\/counseling"/);
  assert.match(html, /autocomplete="username" required/);
  assert.match(html, /type="password" autocomplete="current-password" required/);
  const asset = readFileSync('public/data-core/assets/login-highfive-v1.webp');
  assert.equal(asset.subarray(0, 4).toString(), 'RIFF');
  assert.equal(asset.subarray(8, 12).toString(), 'WEBP');
  assert.ok(statSync('public/data-core/assets/login-highfive-v1.webp').size < 300_000);
});

test('anonymous session keeps login form and password-change controls hidden', async () => {
  const h = await harness();
  assert.deepEqual(h.redirects, []);
  assert.equal(h.nodes.get('loginFormWrap').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('passwordFormWrap').classList.contains('hidden'), true);
});

test('active session resumes the requested internal route', async () => {
  const h = await harness({session: {authenticated: true}, search: '?next=/data-core/work/library'});
  assert.deepEqual(h.redirects, ['/data-core/work/library']);
});

test('external next is not used for session redirection', async () => {
  for (const next of ['https://example.invalid', '//example.invalid', '/other']) {
    const h = await harness({session: {authenticated: true}, search: '?next=' + encodeURIComponent(next)});
    assert.deepEqual(h.redirects, ['/data-core/work']);
  }
});

test('successful login sends existing same-origin contract and redirects', async () => {
  const h = await harness({respond: async () => ({body: {mustChangePassword: false}})});
  h.nodes.get('loginId').value = 'synthetic-ui';
  h.nodes.get('password').value = 'synthetic-only-not-a-real-secret';
  await h.submit('loginForm');
  const call = h.calls.at(-1);
  assert.equal(call.path, '/api/auth/login');
  assert.equal(call.options.credentials, 'include');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(Object.keys(JSON.parse(call.options.body)), ['loginId', 'password']);
  assert.deepEqual(h.redirects, ['/data-core/work']);
  assert.equal(h.nodes.get('loginForm').button.disabled, false);
});

test('failed login displays error and permits retry without redirect', async () => {
  const h = await harness({respond: async () => ({status: 401, body: {error: 'Synthetic login denied'}})});
  await h.submit('loginForm');
  assert.equal(h.nodes.get('message').textContent, 'Synthetic login denied');
  assert.equal(h.nodes.get('loginForm').button.disabled, false);
  assert.deepEqual(h.redirects, []);
});

test('login submit remains disabled until the request settles', async () => {
  let complete;
  const h = await harness({respond: () => new Promise(resolve => { complete = resolve; })});
  const pending = h.submit('loginForm');
  assert.equal(h.nodes.get('loginForm').button.disabled, true);
  complete({status: 503, body: {error: 'Synthetic retry'}});
  await pending;
  assert.equal(h.nodes.get('loginForm').button.disabled, false);
});

test('temporary session and first login both expose password change and move focus', async () => {
  for (const existing of [false, true]) {
    const h = await harness({session: {authenticated: existing, mustChangePassword: existing},
      respond: async () => ({body: {mustChangePassword: true}})});
    if (!existing) await h.submit('loginForm');
    assert.equal(h.nodes.get('loginFormWrap').classList.contains('hidden'), true);
    assert.equal(h.nodes.get('passwordFormWrap').classList.contains('hidden'), false);
    assert.equal(h.nodes.get('currentPassword').focused, true);
    assert.deepEqual(h.redirects, []);
  }
});

test('password confirmation mismatch never submits a mutation', async () => {
  const h = await harness();
  h.nodes.get('nextPassword').value = 'synthetic-next';
  h.nodes.get('confirmPassword').value = 'synthetic-mismatch';
  await h.submit('passwordForm');
  assert.equal(h.calls.length, 1);
  assert.equal(h.nodes.get('passwordMessage').textContent, '새 비밀번호가 일치하지 않습니다.');
});

test('password change keeps PUT contract, handles failure and successful retry', async () => {
  let fail = true;
  const h = await harness({respond: async () => fail ? {status: 400, body: {error: 'Synthetic rejected'}} : {body: {}}});
  h.nodes.get('currentPassword').value = 'synthetic-old';
  h.nodes.get('nextPassword').value = h.nodes.get('confirmPassword').value = 'synthetic-only-new';
  await h.submit('passwordForm');
  assert.equal(h.nodes.get('passwordMessage').textContent, 'Synthetic rejected');
  assert.deepEqual(h.redirects, []);
  fail = false;
  await h.submit('passwordForm');
  assert.equal(h.calls.at(-1).path, '/api/auth/password');
  assert.equal(h.calls.at(-1).options.method, 'PUT');
  assert.equal(h.calls.at(-1).options.credentials, 'include');
  assert.deepEqual(h.redirects, ['/data-core/work']);
});

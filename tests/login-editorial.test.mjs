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
  assert.match(html, /login\.css\?v=20260928-signup/);
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

test('active session opens mode selection even with an internal next route', async () => {
  const h = await harness({session: {authenticated: true}, search: '?next=/data-core/work/library'});
  assert.deepEqual(h.redirects, ['/data-core']);
});

test('external next is not used for session redirection', async () => {
  for (const next of ['https://example.invalid', '//example.invalid', '/other']) {
    const h = await harness({session: {authenticated: true}, search: '?next=' + encodeURIComponent(next)});
    assert.deepEqual(h.redirects, ['/data-core']);
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
  assert.deepEqual(h.redirects, ['/data-core']);
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

test('pending change identifies the account and switch-account clears the old credentials', async () => {
  const h=await harness({session:{authenticated:true,mustChangePassword:true,user:{loginId:'as'}},respond:async()=>({body:{ok:true}})});
  assert.equal(h.nodes.get('changeLoginId').value,'as');
  for(const id of ['password','currentPassword','nextPassword','confirmPassword'])h.nodes.get(id).value='synthetic-only';
  await h.nodes.get('switchAccount').listeners.click();
  assert.equal(h.calls.at(-1).path,'/api/auth/logout');
  for(const id of ['password','currentPassword','nextPassword','confirmPassword'])assert.equal(h.nodes.get(id).value,'');
  assert.equal(h.nodes.get('passwordFormWrap').classList.contains('hidden'),true);
  assert.equal(h.nodes.get('loginFormWrap').classList.contains('hidden'),false);
});

test('직원인증 button sits under the login button and opens the application form', async () => {
  assert.match(html, /<button type="submit">로그인<\/button>\s*<\/form>\s*<div class="signup-entry"><button id="openSignup"[^>]*>직원인증<\/button>/);
  for (const id of ['signupName', 'signupCampus', 'signupPosition', 'signupLoginId', 'signupPassword', 'signupPasswordConfirm', 'signupPhone']) assert.match(html, new RegExp(`id="${id}"`));
  const h = await harness({respond: async path => path === '/api/auth/signup/options'
    ? {body: {campuses: [{id: 'campus-wonjong', name: '부천 원종 캠퍼스'}]}} : {status: 201, body: {id: 'r1', status: 'pending'}}});
  await h.nodes.get('openSignup').listeners.click();
  await tick();
  assert.equal(h.nodes.get('loginFormWrap').classList.contains('hidden'), true);
  assert.equal(h.nodes.get('signupFormWrap').classList.contains('hidden'), false);
  assert.match(h.nodes.get('signupCampus').innerHTML, /campus-wonjong/);
});

test('직원인증 checks the form before sending and shows the pending notice after', async () => {
  const h = await harness({respond: async () => ({status: 201, body: {id: 'r1', status: 'pending'}})});
  const fill = values => { for (const [id, value] of Object.entries(values)) h.nodes.get(id).value = value; };
  fill({signupName: '가상 선생님', signupCampus: 'campus-wonjong', signupPosition: '강사', signupLoginId: 'Synthetic-UI',
    signupPassword: 'synthetic-only-password', signupPasswordConfirm: 'synthetic-other', signupPhone: '010-0000-1234'});
  await h.submit('signupForm');
  assert.equal(h.nodes.get('signupMessage').textContent, '비밀번호 확인이 일치하지 않습니다.');
  assert.equal(h.calls.length, 1, 'nothing sent while the form is wrong');
  fill({signupPasswordConfirm: 'synthetic-only-password'});
  await h.submit('signupForm');
  const call = h.calls.at(-1);
  assert.equal(call.path, '/api/auth/signup'); assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), {displayName: '가상 선생님', campusId: 'campus-wonjong', position: '강사',
    loginId: 'synthetic-ui', password: 'synthetic-only-password', phone: '010-0000-1234'});
  assert.equal(h.nodes.get('signupDoneWrap').classList.contains('hidden'), false);
  assert.match(h.nodes.get('signupDoneText').textContent, /synthetic-ui/);
  assert.equal(h.nodes.get('signupPassword').value, '', 'password is cleared from the form');
  assert.deepEqual(h.redirects, []);
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
  assert.deepEqual(h.redirects, ['/data-core']);
});

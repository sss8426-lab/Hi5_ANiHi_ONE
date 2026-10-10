import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic account only.
const ADMIN = { id: 'entry-admin', email: 'entry-admin@example.test', name: '가상 원장' };
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });

test('처음 접속: 로그인 전 /data-core는 로그인 화면, 로그인 후에는 모드 선택', async () => {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true, d1Databases: ['DB', 'FAMILY_DB'], d1Persist: false });
  try {
    const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('entry', `${process.pid}-${Math.random()}`);
    const worker = (await import(url.href)).default;
    // Static pages straight from public/, like the Workers assets binding.
    const ASSETS = { async fetch(request) {
      try { return new Response(fs.readFileSync(`public${new URL(request.url).pathname}`), { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
      catch { return new Response('Not found', { status: 404 }); }
    } };
    const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), ASSETS, DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
    const page = async (path, user) => {
      const r = await worker.fetch(new Request(`http://localhost${path}`, { headers: user ? auth(user) : {} }), env, { waitUntil() {}, passThroughOnException() {} });
      const html = await r.text();
      return { status: r.status, title: (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '' };
    };
    for (const path of ['/data-core', '/data-core/', '/data-core/index.html']) {
      assert.deepEqual(await page(path), { status: 200, title: 'DATA CORE 로그인' }, `${path} before login`);
      assert.deepEqual(await page(path, ADMIN), { status: 200, title: 'HI5·ANiHi DATA CORE' }, `${path} after login`);
    }
  } finally { await mf.dispose(); }
});

test('the 모드 선택 page itself always goes through the worker (never served as a bare static file)', () => {
  const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  for (const route of ['/data-core', '/data-core/', '/data-core/index.html']) assert.ok(config.assets.run_worker_first.includes(route), route);
});

test('휴대폰으로 새로 열면 모드 선택에서 시작 (앱 안 이동·새로고침·대상 있는 링크·PC는 그대로)', () => {
  const entry = fs.readFileSync('public/data-core/phone-entry.js', 'utf8');
  assert.match(entry, /matchMedia\('\(max-width: 760px\)'\)/);
  assert.match(entry, /location\.search \|\| location\.hash\) return/);
  assert.match(entry, /entry\.type !== 'navigate'\) return/);
  assert.match(entry, /from === location\.origin\) return/);
  assert.match(entry, /location\.replace\('\/data-core'\)/);
  for (const page of ['index.html', 'content.html', 'reports.html', 'accounts.html', 'operations.html', 'work/kkumeum.html']) {
    const html = fs.readFileSync(`public/data-core/${page}`, 'utf8');
    const at = html.indexOf('/data-core/phone-entry.js');
    assert.ok(at > 0 && at < html.indexOf('</head>'), `${page} loads phone-entry.js in <head>`);
  }
  assert.match(fs.readFileSync('public/data-core/login.js', 'utf8'), /const nextPath = '\/data-core';/, 'login always returns to 모드 선택');
});

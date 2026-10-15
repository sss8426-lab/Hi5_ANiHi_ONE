import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// 속도 개선 (2026-10-15). Synthetic people only.
const ADMIN = { id: 'speed-admin', email: 'speed-admin@example.test', name: '속도 관리자' };
const STAFF = { id: 'speed-staff', email: 'speed-staff@example.test', name: '캠퍼스 관리자' };
const CAMPUS = 'campus-design-admission';
const auth = u => ({ 'oai-authenticated-user-id': u.id, 'oai-authenticated-user-email': u.email,
  'oai-authenticated-user-full-name': encodeURIComponent(u.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const WEBP = fs.readFileSync('public/data-core/assets/mode-work.webp');

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FILES', 'FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('speed', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const realFamily = await mf.getD1Database('FAMILY_DB');
  const counts = { familyBatch: 0 };
  // Count schema batches on FAMILY_DB (the same object for every request, like a real worker instance).
  const FAMILY_DB = new Proxy(realFamily, { get(target, key) { const v = Reflect.get(target, key); if (key === 'batch') return (...a) => { counts.familyBatch++; return v.apply(target, a); }; return typeof v === 'function' ? v.bind(target) : v; } });
  const env = { DB: await mf.getD1Database('DB'), FILES: await mf.getR2Bucket('FILES'), FAMILY_DB, FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, form, headers = {} } = {}) {
    const h = new Headers({ ...(user ? auth(user) : {}), ...headers });
    if (body !== undefined) { h.set('content-type', 'application/json'); h.set('origin', 'http://localhost'); }
    if (form) h.set('origin', 'http://localhost');
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers: h, body: form || (body === undefined ? undefined : JSON.stringify(body)) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, headers: r.headers, raw: r, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  }
  return { mf, env, request, counts };
}

test('꿈이음 schema checks run once per worker instance, not on every request', async () => {
  const h = await harness();
  try {
    const cls = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: 'campus-anihi-admission', name: '기초반' } });
    assert.equal(cls.status, 201, JSON.stringify(cls.body));
    const before = h.counts.familyBatch;
    for (let i = 0; i < 5; i++) assert.equal((await h.request('/api/kkumeum/classes?campusId=campus-anihi-admission')).status, 200);
    assert.equal(h.counts.familyBatch, before, 'five more class lists run no schema batches');
  } finally { await h.mf.dispose(); }
});

test('업로드 전 이름 확인은 이름만 한 번에, 권한 밖 폴더는 거절; 같은 그림은 본문 없이 304', async () => {
  const h = await harness();
  try {
    await h.request('/api/data-core/context', { user: STAFF });
    const now = new Date().toISOString();
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES ('m-speed', 'org-hi5-anihi', ?, ?, 'CAMPUS_ADMIN', ?, ?)`)
      .bind(CAMPUS, `oai:${STAFF.id}`, now, now).run();
    const kids = (await h.request(`/api/data-core/library/folders?parentId=${encodeURIComponent('campus:' + CAMPUS)}`, { user: STAFF })).body.folders;
    const target = kids.find(f => f.canWrite && f.category);
    for (const name of ['가.webp', '나.webp']) {
      const form = new FormData(); form.append('file', new Blob([WEBP], { type: 'image/webp' }), name); form.append('recordId', target.id); form.append('libraryScoped', 'true');
      assert.equal((await h.request(`/api/data-core/library/files?folderId=${encodeURIComponent(target.id)}`, { user: STAFF, method: 'POST', form })).status, 201);
    }
    const names = await h.request(`/api/data-core/library/file-names?folderId=${encodeURIComponent(target.id)}`, { user: STAFF });
    assert.equal(names.status, 200); assert.deepEqual(names.body.names.sort(), ['가.webp', '나.webp']);
    const other = (await h.request(`/api/data-core/library/folders?parentId=${encodeURIComponent('campus:campus-anihi-admission')}`)).body.folders.find(f => f.category);
    const denied = await h.request(`/api/data-core/library/file-names?folderId=${encodeURIComponent(other.id)}`, { user: STAFF });
    assert.ok(denied.status === 403 || (denied.status === 200 && denied.body.names.length === 0), `other campus: ${denied.status}`);

    const list = await h.request(`/api/data-core/library/files?folderId=${encodeURIComponent(target.id)}`, { user: STAFF });
    const file = list.body.files[0];
    const first = await h.request(file.previewUrl, { user: STAFF });
    assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-cache', '권한 재확인 정책은 그대로');
    const etag = first.headers.get('etag'); await first.raw.arrayBuffer();
    const again = await h.request(file.previewUrl, { user: STAFF, headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    assert.equal((await h.request(file.previewUrl, { user: null, headers: { 'if-none-match': etag } })).status === 304, false, '로그인 없이 304를 주지 않는다');
  } finally { await h.mf.dispose(); }
});

test('static cache rules: app JS/CSS/images only, never HTML; upload window closes after success', () => {
  const rules = fs.readFileSync('public/_headers', 'utf8');
  const patterns = rules.split(/\r?\n/).filter(l => l.startsWith('/'));
  assert.ok(patterns.includes('/data-core/*.js') && patterns.includes('/family/*.css') && patterns.includes('/_next/static/*'));
  assert.ok(patterns.every(p => !/html|\/\*$/.test(p) || p === '/_next/static/*'), 'no rule covers HTML pages');
  assert.ok(patterns.length <= 100);
  const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
  assert.equal(config.placement?.mode, 'smart');
  const panel = fs.readFileSync('public/data-core/work/library-upload-panel.js', 'utf8');
  assert.match(panel, /panel\.hidden=true;panel\.classList\.remove\('lb-collapsed'\);batches\.length=0/);
  assert.match(panel, /\/api\/data-core\/library\/file-names\?folderId=/);
  assert.doesNotMatch(panel, /library\/files\?folderId=\$\{encodeURIComponent\(folderId\)\}&page=/, 'no paging through the folder before uploads');
});

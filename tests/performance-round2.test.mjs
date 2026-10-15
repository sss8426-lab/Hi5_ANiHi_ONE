import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users } from './support/library-harness.mjs';

// 전체 속도 개선 2차 (2026-10-15). Synthetic accounts only.
test('큰 입시 데이터·학생 목록은 바뀌지 않았으면 304(본문 없음), 바뀌면 새로 받는다', async () => {
  const h = await libraryHarness();
  try {
    await h.env.FILES.put('state/admissions-data.json', JSON.stringify({ version: 1, settings: {}, universities: [{ id: 1, name: '가상대학교' }], admissionGradeRules: [], cases: [], awardFolders: [], changeLogs: [], students: [] }));
    const first = await h.raw('GET', '/api/data', users.admin);
    assert.equal(first.status, 200); const etag = first.headers.get('etag'); await first.arrayBuffer();
    assert.match(etag, /^"[0-9a-f]{32}"$/); assert.equal(first.headers.get('cache-control'), 'private, no-cache');
    const again = await h.raw('GET', '/api/data', users.admin, undefined, undefined, { 'if-none-match': etag });
    assert.equal(again.status, 304); assert.equal((await again.arrayBuffer()).byteLength, 0);
    // 문서를 저장하면(R2 etag가 바뀜) 같은 작업자도 새 문서를 읽는다.
    const doc = await (await h.raw('GET', '/api/data', users.admin)).json();
    doc.settings = { note: '바뀜' };
    assert.equal((await h.request('PUT', '/api/data', users.admin, doc)).status, 200);
    const fresh = await h.raw('GET', '/api/data', users.admin, undefined, undefined, { 'if-none-match': etag });
    assert.equal(fresh.status, 200); assert.equal((await fresh.json()).settings.note, '바뀜');

    const list = await h.raw('GET', '/api/admissions/students', users.teacher);
    assert.equal(list.status, 200); const tag = list.headers.get('etag'); await list.arrayBuffer();
    assert.equal((await h.raw('GET', '/api/admissions/students', users.teacher, undefined, undefined, { 'if-none-match': tag })).status, 304);
    const created = await h.request('POST', '/api/admissions/students', users.teacher, { student: { name: '가상학생', entryYear: 2026, studentType: 'current' } });
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
    const changed = await h.raw('GET', '/api/admissions/students', users.teacher, undefined, undefined, { 'if-none-match': tag });
    assert.equal(changed.status, 200, '학생이 바뀌면 새로 받는다'); assert.notEqual(changed.headers.get('etag'), tag);
    assert.equal((await h.raw('GET', '/api/data', users.outsider, undefined, undefined, { 'if-none-match': etag })).status, 403, '권한 검사는 304보다 먼저');
  } finally { await h.mf.dispose(); }
});

test('API 응답마다 D1 질의 수와 시간(Server-Timing)', async () => {
  const h = await libraryHarness();
  try {
    const r = await h.raw('GET', '/api/data-core/context', users.teacher);
    assert.match(r.headers.get('server-timing') || '', /^db;dur=[\d.]+;desc="\d+ queries", app;dur=[\d.]+$/);
    const page = await h.raw('GET', '/data-core/login', null);
    assert.equal(page.headers.get('server-timing'), null, '화면 파일에는 붙이지 않는다');
  } finally { await h.mf.dispose(); }
});

test('화면: 큰 데이터는 다시 확인(no-cache), 블로그 소식은 목록 먼저·새 글은 따로', () => {
  const api = fs.readFileSync('public/admissions-web/renderer/web-desktop-api.js', 'utf8');
  assert.match(api, /fetch\(dataUrl\(\), \{ cache: 'no-cache'/);
  const feed = fs.readFileSync('public/data-core/blog-publish-feed.js', 'utf8');
  assert.match(feed, /body\.syncDue && !afterSync/); assert.match(feed, /\$\{API\}\/sync/);
  const nav = fs.readFileSync('public/data-core/work-navigation.js', 'utf8'), mobile = fs.readFileSync('public/data-core/mobile-app.js', 'utf8');
  assert.match(nav, /window\.__coreSignupRequests\|\|=/); assert.match(mobile, /window\.__coreSignupRequests \|\|=/);
});

test('같은 요청 나눠 쓰기: 동시에·1.5초 안의 같은 GET은 한 번만, 저장 요청이 오면 바로 새로', async () => {
  const vm = await import('node:vm');
  const calls = [];
  const window = { fetch: async (input, init = {}) => { calls.push(`${init.method || 'GET'} ${input}`); return new Response(JSON.stringify({ n: calls.length }), { headers: { 'content-type': 'application/json' } }); } };
  const context = { window, location: { href: 'https://core.test/data-core/kkumeum', origin: 'https://core.test' }, URL, Request, Response, Date, JSON, Map, String };
  vm.runInNewContext(fs.readFileSync('public/data-core/fetch-share.js', 'utf8'), context);
  const [a, b, c] = await Promise.all([window.fetch('/api/data-core/context'), window.fetch('/api/data-core/context'), window.fetch('/api/data-core/context')]);
  assert.deepEqual([await a.json(), await b.json(), await c.json()], [{ n: 1 }, { n: 1 }, { n: 1 }], '세 곳이 한 답을 나눠 읽는다');
  assert.equal((await (await window.fetch('/api/data-core/context')).json()).n, 1, '1.5초 안에는 다시 묻지 않는다');
  await window.fetch('/api/kkumeum/classes', { method: 'POST', body: '{}' });
  assert.equal((await (await window.fetch('/api/data-core/context')).json()).n, 3, '저장한 뒤에는 서버에 다시 묻는다');
  await window.fetch('/data-core/app.js'); await window.fetch('/data-core/app.js');
  assert.equal(calls.filter(c => c.endsWith('app.js')).length, 2, 'API가 아닌 파일은 손대지 않는다');
  for (const page of ['work/kkumeum.html', 'index.html', 'content.html', 'reports.html']) {
    const html = fs.readFileSync(`public/data-core/${page}`, 'utf8');
    assert.ok(html.indexOf('fetch-share.js') > 0 && html.indexOf('fetch-share.js') < html.indexOf('<script', html.indexOf('fetch-share.js') + 20) + 1, page);
  }
});

test('새 작업자 첫 요청: 같은 배포에서 이미 준비한 표는 다시 만들지 않는다(배포마다 한 번)', async () => {
  const h = await libraryHarness();
  try {
    const raw = h.env.DB;
    const freshWorker = () => new Proxy(raw, { get(t, k) { const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
    const queries = async (path, user = users.teacher) => { const r = await h.raw('GET', path, user); await r.arrayBuffer(); return Number(/desc="(\d+) queries"/.exec(r.headers.get('server-timing'))[1]); };
    const path = '/api/data-core/staff-reports?month=2026-10';
    h.env.CF_VERSION_METADATA = { id: 'deploy-A' };
    h.env.DB = freshWorker();
    const first = await queries(path);              // first worker of deploy A prepares everything
    h.env.DB = freshWorker();
    const second = await queries(path);             // a new worker of the same deploy only reads the stamps
    h.env.DB = freshWorker();
    const warm = (await queries(path), await queries(path));
    assert.ok(second < first, `same deploy, new worker: ${second} < ${first}`);
    assert.ok(second <= warm + 2, `new worker costs about one extra read: ${second} vs warm ${warm}`);
    const stamps = await raw.prepare("SELECT COUNT(*) AS n FROM core_schema_stamps WHERE build='deploy-A'").first();
    assert.ok(stamps.n >= 3, 'steps written down for deploy A');
    h.env.CF_VERSION_METADATA = { id: 'deploy-B' };
    h.env.DB = freshWorker();
    const redeploy = await queries(path);
    assert.ok(redeploy > second, 'a new deploy prepares again once');
    assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM core_schema_stamps WHERE build='deploy-A'").first()).n, 0, '지난 배포 기록은 지운다');
  } finally { await h.mf.dispose(); }
});

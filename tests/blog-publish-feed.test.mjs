import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { libraryHarness, A, B, users } from './support/library-harness.mjs';
import { assembleBlocks } from '../public/data-core/blog-post-model.js';

// 블로그 발행 소식 (2026-10-15). Synthetic posts and accounts only.
const feed = (h, user, query = '') => h.request('GET', `/api/data-core/content/blog/publications${query}`, user);

async function save(h, user, campusId, title, { date, url, status = 'published', id } = {}) {
  const post = { schemaVersion: 1, revision: 0, title, privacyConfirmed: true, photos: [], strategyMode: 'balanced',
    blocks: assembleBlocks({ body: `${title} 수업 이야기입니다. 학생들이 소실점을 찾으며 복도를 그렸어요.`, photos: [], tags: ['부천미술학원', '입시미술'] }),
    brief: { exclude: '' }, generation: { selectedTitleKind: 'search' }, template: { templateId: 'class' },
    publication: date ? { url: url || `https://blog.naver.com/synthetic/${Date.now()}${Math.floor(Math.random() * 1e6)}`, date } : {} };
  if (id) {
    const current = (await h.request('GET', `/api/data-core/content/${encodeURIComponent(id)}`, user)).body.draft;
    post.revision = current.metadata.blogPost.revision;
  }
  const r = await h.request('POST', '/api/data-core/content/blog/save', user, { requestId: randomUUID(), campusId, publishStatus: status, post, ...(id ? { id } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.draft.id;
}

test('발행한 글은 모든 캠퍼스가 보고, 초안은 안 보이고, 글을 지워도 발행 기록은 남는다', async () => {
  const h = await libraryHarness();
  try {
    await save(h, users.staff, A, '임시 초안', { status: 'draft' });
    const a = await save(h, users.staff, A, '애니 입시본원 소식', { date: '2026-10-10' });
    await save(h, users.foreign, B, '광진 캠퍼스 소식', { date: '2026-10-12' });

    const seen = await feed(h, users.teacher);
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    assert.deepEqual(seen.body.items.map(i => i.title), ['광진 캠퍼스 소식', '애니 입시본원 소식'], '최신 게시일 먼저, 다른 캠퍼스 글도 보인다');
    const first = seen.body.items[1];
    assert.equal(first.campusId, A); assert.ok(first.campusName); assert.match(first.url, /^https:\/\/blog\.naver\.com\//);
    assert.equal(first.date, '2026-10-10'); assert.ok(first.hashtags.includes('#부천미술학원')); assert.match(first.summary, /소실점/);
    assert.equal(seen.body.total, 2);

    const onlyA = await feed(h, users.foreign, `?campusId=${A}`);
    assert.deepEqual(onlyA.body.items.map(i => i.campusId), [A]);
    assert.equal(onlyA.body.campuses.length, 2);

    // 글을 지워도 실제로 발행한 기록은 남는다.
    assert.equal((await h.request('DELETE', `/api/data-core/content/${encodeURIComponent(a)}`, users.staff)).status, 200);
    assert.ok((await feed(h, users.teacher)).body.items.some(i => i.recordId === a));
    const stored = await h.env.DB.prepare('SELECT body_text FROM blog_publications WHERE record_id=?').bind(a).first();
    assert.match(stored.body_text, /소실점/, '본문도 함께 저장');

    assert.equal((await feed(h, users.outsider)).status, 403);
    assert.equal((await feed(h, null)).status, 401);
  } finally { await h.mf.dispose(); }
});

test('최대 30개까지만 보여 주고, 주소를 바꿔 다시 올린 글은 둘 다 기록', async () => {
  const h = await libraryHarness();
  try {
    const id = await save(h, users.staff, A, '다시 올린 글', { date: '2026-10-01', url: 'https://blog.naver.com/synthetic/224000000101' });
    await save(h, users.staff, A, '다시 올린 글', { date: '2026-10-02', url: 'https://blog.naver.com/synthetic/224000000102', id });
    assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM blog_publications WHERE record_id=?').bind(id).first()).n, 2);
    const now = new Date().toISOString();
    for (let i = 0; i < 32; i++) await h.env.DB.prepare(`INSERT INTO blog_publications (id, organization_id, record_id, campus_id, title, url, published_date, recorded_at, updated_at)
      VALUES (?, 'org-hi5-anihi', ?, ?, ?, ?, ?, ?, ?)`).bind(`bulk-${i}`, `bulk-${i}`, B, `글 ${i}`, `https://blog.naver.com/synthetic/22400000${1000 + i}`, '2026-09-01', now, now).run();
    const list = await feed(h, users.teacher, '?limit=500');
    assert.equal(list.body.items.length, 30); assert.equal(list.body.total, 34);
  } finally { await h.mf.dispose(); }
});

test('화면: 블로그 자동화 오른쪽 발행 소식 패널, 인스타에서는 숨김', () => {
  const html = fs.readFileSync('public/data-core/content.html', 'utf8');
  const script = fs.readFileSync('public/data-core/blog-publish-feed.js', 'utf8');
  const content = fs.readFileSync('public/data-core/content.js', 'utf8');
  assert.match(html, /blog-publish-feed\.js\?v=20261015-collect/);
  assert.match(html, /blog-publish-feed\.css\?v=20261015-collect/);
  assert.match(script, /블로그 발행 소식/);
  assert.match(script, /limit: '30'/);
  assert.match(script, /rel="noopener noreferrer"/);
  assert.match(content, /BlogPublishFeed\?\.show\(state\.sourceApp === 'blog'\)/);
});

// Fake Naver: one campus blog RSS and one post page. Every other address fails like an outage would.
const RSS = `<?xml version="1.0"?><rss><channel>
<item><author>synthetic_a</author><category><![CDATA[수업 이야기]]></category><title><![CDATA[원근법 수업 &amp; 소실점]]></title>
<link><![CDATA[https://blog.naver.com/synthetic_a/224000000001?fromRss=true&trackingCode=rss]]></link><guid>https://blog.naver.com/synthetic_a/224000000001</guid>
<description><![CDATA[<p>복도 사진에서 소실점을 찾았어요.</p>]]></description><pubDate>Wed, 14 Oct 2026 23:30:00 +0900</pubDate><tag><![CDATA[입시미술,원근법]]></tag></item>
<item><title><![CDATA[두 번째 글]]></title><guid>https://blog.naver.com/synthetic_a/224000000002</guid><description>요약</description><pubDate>Mon, 12 Oct 2026 10:00:00 +0900</pubDate></item>
</channel></rss>`;
function fakeNaver() {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (!/naver\.com/.test(url)) return real(input, init);
    calls.push(url);
    if (url === 'https://rss.blog.naver.com/synthetic_a.xml') return new Response(RSS, { headers: { 'content-type': 'application/xml' } });
    if (url === 'https://m.blog.naver.com/synthetic_b/224000000009') return new Response('<meta property="og:title" content="광진 오픈 소식"/><meta property="og:description" content="새 캠퍼스가 문을 열었어요"/><span class="se_publishDate pcol2">2026. 10. 9. 14:00</span>');
    return new Response('nope', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test('캠퍼스 블로그 연결은 원장·마스터만, 연결하면 새 글을 자동으로 모으고 같은 글은 한 번만', async () => {
  const h = await libraryHarness(), naver = fakeNaver();
  try {
    const link = blogUrl => ({ campusId: A, blogUrl });
    assert.equal((await h.request('PUT', '/api/data-core/content/blog/campus-blogs', users.teacher, link('https://blog.naver.com/synthetic_a'))).status, 403);
    assert.equal((await h.request('PUT', '/api/data-core/content/blog/campus-blogs', users.campusAdmin, link('https://example.com/x'))).status, 400);
    const ok = await h.request('PUT', '/api/data-core/content/blog/campus-blogs', users.campusAdmin, link('https://m.blog.naver.com/synthetic_a'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.blogUrl, 'https://blog.naver.com/synthetic_a');
    const profile = await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE id=?").bind(`marketing-channel:${A}`).first();
    assert.equal(JSON.parse(profile.metadata_json).channels.blog, 'https://blog.naver.com/synthetic_a', 'AI 마케팅 모니터링과 같은 채널 정보');

    const list = await feed(h, users.foreign);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const first = list.body.items.find(i => i.url === 'https://blog.naver.com/synthetic_a/224000000001');
    assert.ok(first, '다른 캠퍼스 선생님도 자동 수집 글을 본다');
    assert.deepEqual([first.title, first.date, first.campusId, first.source, first.category], ['원근법 수업 & 소실점', '2026-10-14', A, 'rss', '수업 이야기']);
    assert.match(first.summary, /소실점/); assert.deepEqual(first.hashtags, ['#입시미술', '#원근법']);
    assert.equal(list.body.linkedCount, 1);
    assert.deepEqual(list.body.linkCampuses, [], '선생님·직원에게는 연결 버튼이 없다');

    // 같은 글을 블로그 자동화에서 발행으로 저장하면 한 줄로 합쳐지고 선생님 이름이 붙는다.
    await save(h, users.staff, A, '원근법 수업 정리', { date: '2026-10-14', url: 'https://m.blog.naver.com/synthetic_a/224000000001' });
    const merged = (await feed(h, users.teacher)).body.items.filter(i => i.url.endsWith('/224000000001'));
    assert.equal(merged.length, 1); assert.equal(merged[0].source, 'app'); assert.equal(merged[0].title, '원근법 수업 정리'); assert.ok(merged[0].authorName);
    // 30분 안에는 다시 가져오지 않는다.
    const before = naver.calls.length; await feed(h, users.teacher); assert.equal(naver.calls.length, before);
  } finally { naver.restore(); await h.mf.dispose(); }
});

test('발행 주소 넣기: 자기 캠퍼스에만, 제목·요약·게시일은 네이버 글에서, 숨기기는 넣은 사람·원장·마스터', async () => {
  const h = await libraryHarness(), naver = fakeNaver();
  try {
    const add = (user, body) => h.request('POST', '/api/data-core/content/blog/publications', user, body);
    assert.equal((await add(users.teacher, { campusId: A, url: 'https://example.com/post' })).status, 400);
    assert.equal((await add(users.teacher, { campusId: B, url: 'https://blog.naver.com/synthetic_b/224000000009' })).status, 403, '다른 캠퍼스로는 못 넣는다');
    const ok = await add(users.foreign, { campusId: B, url: 'https://blog.naver.com/PostView.naver?blogId=synthetic_b&logNo=224000000009' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const item = (await feed(h, users.teacher)).body.items.find(i => i.id === 'naver:synthetic_b/224000000009');
    assert.deepEqual([item.title, item.summary, item.date, item.url, item.source], ['광진 오픈 소식', '새 캠퍼스가 문을 열었어요', '2026-10-09', 'https://blog.naver.com/synthetic_b/224000000009', 'manual']);
    assert.equal(item.canHide, false);
    assert.equal((await h.request('DELETE', `/api/data-core/content/blog/publications/${encodeURIComponent(item.id)}`, users.teacher)).status, 403);
    assert.equal((await h.request('DELETE', `/api/data-core/content/blog/publications/${encodeURIComponent(item.id)}`, users.foreign)).status, 200);
    assert.equal((await feed(h, users.teacher)).body.items.some(i => i.id === item.id), false);
    assert.ok(await h.env.DB.prepare('SELECT hidden_at FROM blog_publications WHERE id=?').bind(item.id).first(), '숨겨도 기록은 남는다');
    assert.equal((await add(users.foreign, { campusId: B, url: 'https://blog.naver.com/synthetic_b/224000000010', date: '2026-10-01' })).status, 200, '네이버 글을 못 읽어도 주소와 날짜는 기록');
  } finally { naver.restore(); await h.mf.dispose(); }
});

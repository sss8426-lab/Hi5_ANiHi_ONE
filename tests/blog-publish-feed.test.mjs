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
    publication: date ? { url: url || `https://blog.naver.com/synthetic/${randomUUID().slice(0, 8)}`, date } : {} };
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
    const id = await save(h, users.staff, A, '다시 올린 글', { date: '2026-10-01', url: 'https://blog.naver.com/synthetic/first' });
    await save(h, users.staff, A, '다시 올린 글', { date: '2026-10-02', url: 'https://blog.naver.com/synthetic/second', id });
    assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM blog_publications WHERE record_id=?').bind(id).first()).n, 2);
    const now = new Date().toISOString();
    for (let i = 0; i < 32; i++) await h.env.DB.prepare(`INSERT INTO blog_publications (id, organization_id, record_id, campus_id, title, url, published_date, recorded_at, updated_at)
      VALUES (?, 'org-hi5-anihi', ?, ?, ?, ?, ?, ?, ?)`).bind(`bulk-${i}`, `bulk-${i}`, B, `글 ${i}`, `https://blog.naver.com/synthetic/${i}`, '2026-09-01', now, now).run();
    const list = await feed(h, users.teacher, '?limit=500');
    assert.equal(list.body.items.length, 30); assert.equal(list.body.total, 34);
  } finally { await h.mf.dispose(); }
});

test('화면: 블로그 자동화 오른쪽 발행 소식 패널, 인스타에서는 숨김', () => {
  const html = fs.readFileSync('public/data-core/content.html', 'utf8');
  const script = fs.readFileSync('public/data-core/blog-publish-feed.js', 'utf8');
  const content = fs.readFileSync('public/data-core/content.js', 'utf8');
  assert.match(html, /blog-publish-feed\.js\?v=20261015-feed/);
  assert.match(html, /blog-publish-feed\.css\?v=20261015-feed/);
  assert.match(script, /블로그 발행 소식/);
  assert.match(script, /limit: '30'/);
  assert.match(script, /rel="noopener noreferrer"/);
  assert.match(content, /BlogPublishFeed\?\.show\(state\.sourceApp === 'blog'\)/);
});

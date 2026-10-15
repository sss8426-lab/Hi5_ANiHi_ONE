// 블로그 발행 소식: every blog post the academy published on Naver, for all campuses to see (최근 30개).
// Three ways a post gets in, all into one table keyed by the Naver post (blogId/logNo), so a post never
// shows twice:
//  1. 자동 수집 — each campus's registered Naver blog RSS (rss.blog.naver.com/{blogId}.xml), refreshed
//     when the panel opens (at most every 30 minutes) and by the daily cron.
//  2. 발행 주소 넣기 — a teacher pastes the address; title and summary come from the public post page.
//  3. 블로그 자동화 저장 — a post saved as 발행 with its real address and date.
// Published posts are public on Naver already, so every academy member may read the list. Rows are never
// deleted; a wrong entry is hidden (hidden_at) by its author, the campus 원장 or 마스터.
import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, leadsCampus, requireCampusAccess, requireWriteAccess } from './data-core-access';
import { campusDisplayName, presentCampuses } from './campus-directory';
import { schemaOnce } from './schema-once';
import { convertBlogFromReference, type OpenAiEnv } from './content-openai-provider';
import { blogSeo, HI5_CONTENT_BRAND_CONTEXT } from './data-core-content-generation';

export const BLOG_FEED_LIMIT = 30;
const SYNC_EVERY_MS = 30 * 60_000;
const PROFILE = 'marketing-channel-profile';
type Row = Record<string, any>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parse = (json: unknown) => { try { const v = JSON.parse(String(json || '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const tags = (json: unknown) => { const v = parse(json); return Array.isArray(v) ? v.filter(t => typeof t === 'string').slice(0, 8) : []; };
const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const fail = (status: number, message: string): never => { throw new DataCoreAccessError(status, message); };
const decode = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", apos: "'", nbsp: ' ' } as Record<string, string>)[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Naver post address → one key and one clean address, whatever form was pasted. */
export function naverPost(value: unknown) {
  let url: URL;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || !/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const blogId = url.searchParams.get('blogId') || parts[0];
  const logNo = url.searchParams.get('logNo') || parts[1];
  if (!blogId || !/^[A-Za-z0-9_-]{2,40}$/.test(blogId) || !logNo || !/^\d{6,20}$/.test(logNo)) return null;
  return { key: `naver:${blogId.toLowerCase()}/${logNo}`, blogId, logNo, url: `https://blog.naver.com/${blogId}/${logNo}` };
}
/** A campus blog home (blog.naver.com/{blogId}) → blogId. */
export function naverBlogId(value: unknown) {
  let url: URL;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (!/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) return null;
  const id = url.searchParams.get('blogId') || url.pathname.split('/').filter(Boolean)[0];
  return id && /^[A-Za-z0-9_-]{2,40}$/.test(id) && !/\.naver$/i.test(id) ? id : null;
}

function ensureBlogPublications(db: D1Database) {
  return schemaOnce(db, 'blog-publications-v2', async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS blog_publications (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, record_id TEXT NOT NULL, campus_id TEXT,
        author_user_id TEXT, author_name TEXT, title TEXT NOT NULL, url TEXT NOT NULL, published_date TEXT NOT NULL,
        title_kind TEXT, template_id TEXT, photo_count INTEGER NOT NULL DEFAULT 0, hashtags_json TEXT, summary TEXT, body_text TEXT,
        views INTEGER, homefeed_views INTEGER, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      db.prepare('CREATE TABLE IF NOT EXISTS blog_feed_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)'),
    ]);
    const columns = new Set(((await db.prepare('PRAGMA table_info(blog_publications)').all<{ name: string }>()).results || []).map(c => c.name));
    const add = [['source', 'TEXT'], ['category', 'TEXT'], ['hidden_at', 'TEXT'], ['hidden_by', 'TEXT']].filter(([name]) => !columns.has(name));
    if (add.length) await db.batch(add.map(([name, type]) => db.prepare(`ALTER TABLE blog_publications ADD COLUMN ${name} ${type}`)));
    await db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS blog_publications_recent_idx ON blog_publications(organization_id, published_date DESC, recorded_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS blog_publications_campus_idx ON blog_publications(organization_id, campus_id, published_date DESC)'),
    ]);
    // Posts saved as 발행 before this log existed are copied in once.
    const rows = (await db.prepare(`SELECT d.*, u.display_name AS author_name FROM data_records d LEFT JOIN users u ON u.id = d.created_by_user_id
      WHERE d.organization_id=? AND d.record_type='blog-draft' AND d.metadata_json LIKE '%"publishStatus":"published"%' LIMIT 2000`).bind(ORG).all<Row>()).results || [];
    const statements = rows.map(row => draftStatement(db, row)).filter(Boolean) as D1PreparedStatement[];
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  });
}

const COLUMNS = 'id, organization_id, record_id, campus_id, author_user_id, author_name, title, url, published_date, title_kind, template_id, photo_count, hashtags_json, summary, body_text, views, homefeed_views, recorded_at, updated_at, source, category';
const PLACEHOLDERS = COLUMNS.split(',').map(() => '?').join(',');

// 3. A post saved in 블로그 자동화 is the richest record: it replaces what 자동 수집 or 주소 넣기 had.
function draftStatement(db: D1Database, row: Row) {
  const m = parse(row.metadata_json), p = m.blogPost || {}, pub = p.publication || {};
  const post = naverPost(pub.url);
  if (m.publishStatus !== 'published' || !post || !DAY.test(String(pub.date || ''))) return null;
  const blocks: Row[] = Array.isArray(p.blocks) ? p.blocks : [];
  const text = (types: string[]) => blocks.filter(b => types.includes(b.type) && typeof b.text === 'string').map(b => b.text);
  const hashtags = (text(['hashtags']).join(' ').match(/#[^\s#]+/g) || []).slice(0, 30);
  const body = text(['greeting', 'lead', 'heading', 'paragraph', 'caption', 'quote', 'related', 'closing', 'contact']).join('\n\n');
  const now = new Date().toISOString();
  return db.prepare(`INSERT INTO blog_publications (${COLUMNS}) VALUES (${PLACEHOLDERS})
    ON CONFLICT(id) DO UPDATE SET record_id=excluded.record_id, campus_id=excluded.campus_id, author_user_id=excluded.author_user_id,
      author_name=excluded.author_name, title=excluded.title, published_date=excluded.published_date, title_kind=excluded.title_kind,
      template_id=excluded.template_id, photo_count=excluded.photo_count, hashtags_json=excluded.hashtags_json, summary=excluded.summary,
      body_text=excluded.body_text, views=excluded.views, homefeed_views=excluded.homefeed_views, source='app', updated_at=excluded.updated_at`)
    .bind(post.key, ORG, row.id, row.campus_id ?? null, row.created_by_user_id ?? null, clip(row.author_name, 80) || null,
      clip(p.title || row.title, 240) || '제목 없음', post.url, String(pub.date), clip(p.generation?.selectedTitleKind || m.selectedTitleKind, 40) || null,
      clip(p.template?.templateId, 80) || null, Array.isArray(p.photos) ? p.photos.length : 0, JSON.stringify(hashtags),
      clip(text(['lead', 'paragraph']).join(' '), 180), body.slice(0, 60000),
      Number.isSafeInteger(pub.views) ? pub.views : null, Number.isSafeInteger(pub.homefeedViews) ? pub.homefeedViews : null, now, now, 'app', null);
}

/** Called after a blog post is saved. Only posts with a real Naver address and date are logged. */
export async function recordBlogPublication(db: D1Database, recordId: string) {
  await ensureBlogPublications(db);
  const row = await db.prepare(`SELECT d.*, u.display_name AS author_name FROM data_records d LEFT JOIN users u ON u.id = d.created_by_user_id
    WHERE d.id=? AND d.organization_id=? AND d.record_type='blog-draft'`).bind(recordId, ORG).first<Row>();
  const statement = row && draftStatement(db, row);
  if (statement) await statement.run();
}

async function fetchText(url: string, ms = 6000) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; HI5-ANiHi-CORE/1.0)', accept: 'text/html,application/xml;q=0.9' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).slice(0, 2_000_000);
}

async function campusBlogs(db: D1Database) {
  return blogsFrom((await db.prepare('SELECT campus_id, metadata_json FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL').bind(ORG, PROFILE).all<Row>()).results || []);
}
function blogsFrom(rows: Row[]) {
  return rows.map(r => ({ campusId: String(r.campus_id), blogUrl: parse(r.metadata_json).channels?.blog || null }))
    .map(r => ({ ...r, blogId: naverBlogId(r.blogUrl) })).filter(r => r.blogId) as { campusId: string; blogUrl: string; blogId: string }[];
}

// 1. 자동 수집: newest 30 posts of each registered campus blog. Never overwrites a teacher's record.
export async function syncCampusBlogs(db: D1Database, minAgeMs = SYNC_EVERY_MS) {
  await ensureBlogPublications(db);
  const last = await db.prepare("SELECT value FROM blog_feed_meta WHERE key='rss-sync'").first<{ value: string }>();
  if (last && Date.now() - Date.parse(last.value) < minAgeMs) return { skipped: true };
  const now = new Date().toISOString();
  // Claim the slot first so concurrent page loads do not all fetch.
  await db.prepare("INSERT INTO blog_feed_meta (key, value, updated_at) VALUES ('rss-sync', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(now, now).run();
  const blogs = await campusBlogs(db);
  const results = await Promise.all(blogs.map(async blog => {
    try {
      const xml = await fetchText(`https://rss.blog.naver.com/${encodeURIComponent(blog.blogId)}.xml`);
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30).map(m => {
        const field = (name: string) => decode((new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1]) || [])[1] || '').trim();
        const post = naverPost(field('guid') || field('link'));
        const date = Date.parse(field('pubDate'));
        return post && Number.isFinite(date) ? { post, title: clip(field('title'), 240) || '제목 없음', summary: clip(field('description'), 180), category: clip(field('category'), 60) || null,
          tags: (field('tag').split(',').map(t => t.trim()).filter(Boolean).map(t => '#' + t.replace(/^#+/, ''))).slice(0, 30), date: kstDay(date) } : null;
      }).filter(Boolean) as { post: NonNullable<ReturnType<typeof naverPost>>; title: string; summary: string; category: string | null; tags: string[]; date: string }[];
      if (items.length) await db.batch(items.map(item => db.prepare(`INSERT INTO blog_publications (${COLUMNS}) VALUES (${PLACEHOLDERS})
        ON CONFLICT(id) DO UPDATE SET category=COALESCE(blog_publications.category, excluded.category),
          campus_id=COALESCE(blog_publications.campus_id, excluded.campus_id),
          title=CASE WHEN blog_publications.source='rss' THEN excluded.title ELSE blog_publications.title END,
          summary=CASE WHEN blog_publications.source='rss' THEN excluded.summary ELSE blog_publications.summary END`)
        .bind(item.post.key, ORG, `rss:${item.post.key}`, blog.campusId, null, null, item.title, item.post.url, item.date, null, null, 0,
          JSON.stringify(item.tags), item.summary, null, null, null, now, now, 'rss', item.category)));
      return { campusId: blog.campusId, posts: items.length };
    } catch (error) {
      return { campusId: blog.campusId, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const texts = await fillPostTexts(db, minAgeMs === 0 ? 60 : 10).catch(() => 0);
  return { blogs: blogs.length, results, texts };
}

/** The post's text in reading order, with its structure: "## 소제목", "> 인용", "[사진]", "---". */
export function naverPostText(html: string) {
  const lines: string[] = [];
  for (const part of html.split('class="se-component se-').slice(1)) {
    const kind = (/^[a-zA-Z]+/.exec(part) || [''])[0];
    const inner = part.slice(part.indexOf('>') + 1);
    const text = (chunk: string) => decode(chunk.replace(/<\/p>|<br\s*\/?>/gi, '\n')).split('\n').map(line => line.replace(/[\s​ ]+/g, ' ').trim()).filter(Boolean);
    if (kind === 'documentTitle' || kind === 'oglink' || kind === 'placesMap') continue;
    if (kind === 'image' || kind === 'imageStrip' || kind === 'imageGroup' || kind === 'video') { lines.push('[사진]'); continue; }
    if (kind === 'horizontalLine') { lines.push('---'); continue; }
    const body = text(inner);
    if (!body.length) continue;
    if (kind === 'sectionTitle') lines.push('## ' + body.join(' '));
    else if (kind === 'quotation') lines.push('> ' + body.join(' '));
    else lines.push(body.join('\n'));
  }
  return lines.join('\n\n').slice(0, 20000);
}
async function fetchPostText(post: NonNullable<ReturnType<typeof naverPost>>) {
  return naverPostText(await fetchText(`https://m.blog.naver.com/${post.blogId}/${post.logNo}`));
}
// Auto-collected posts arrive with only a short summary; their full text is read in the background so
// search and AI 변환 see the whole post. '' marks a post that could not be read (not retried each time).
async function fillPostTexts(db: D1Database, max: number) {
  const rows = (await db.prepare("SELECT id, url FROM blog_publications WHERE organization_id=? AND body_text IS NULL ORDER BY published_date DESC LIMIT ?").bind(ORG, max).all<Row>()).results || [];
  await Promise.all(rows.map(async row => {
    const post = naverPost(row.url);
    let text = '';
    try { if (post) text = await fetchPostText(post); } catch { text = ''; }
    await db.prepare('UPDATE blog_publications SET body_text=? WHERE id=? AND body_text IS NULL').bind(text, row.id).run();
  }));
  return rows.length;
}

// 2. 발행 주소 넣기: title, summary and (when shown) the date come from the public post page.
async function postPage(post: NonNullable<ReturnType<typeof naverPost>>) {
  try {
    const html = await fetchText(`https://m.blog.naver.com/${post.blogId}/${post.logNo}`);
    const meta = (name: string) => decode((new RegExp(`<meta[^>]+property="og:${name}"[^>]+content="([^"]*)"`).exec(html) || [])[1] || '');
    const shown = /se_publishDate[^>]*>\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./.exec(html);
    return { title: clip(meta('title'), 240), summary: clip(meta('description'), 180), text: naverPostText(html),
      date: shown ? `${shown[1]}-${shown[2].padStart(2, '0')}-${shown[3].padStart(2, '0')}` : null };
  } catch { return { title: '', summary: '', text: null as string | null, date: null }; }
}

export async function addBlogPublication(db: D1Database, context: DataCoreAccessContext, input: Row) {
  requireWriteAccess(context);
  await ensureBlogPublications(db);
  const campusId = String(input?.campusId || '');
  requireCampusAccess(context, campusId);
  const post = naverPost(input?.url) || fail(400, '네이버 블로그 글 주소를 넣어 주세요. 예) https://blog.naver.com/아이디/글번호');
  const date = input?.date ? String(input.date) : null;
  if (date && (!DAY.test(date) || date > kstDay(Date.now() + 86400_000))) fail(400, '게시일을 확인하세요.');
  const page = await postPage(post);
  const title = clip(input?.title, 240) || page.title || '네이버 블로그 글';
  const now = new Date().toISOString(), me = context.user!;
  await db.prepare(`INSERT INTO blog_publications (${COLUMNS}) VALUES (${PLACEHOLDERS})
    ON CONFLICT(id) DO UPDATE SET author_user_id=COALESCE(blog_publications.author_user_id, excluded.author_user_id),
      author_name=COALESCE(blog_publications.author_name, excluded.author_name), campus_id=COALESCE(blog_publications.campus_id, excluded.campus_id),
      hidden_at=NULL, hidden_by=NULL, updated_at=excluded.updated_at`)
    .bind(post.key, ORG, `manual:${post.key}`, campusId, me.internalUserId, clip(me.displayName || me.loginId, 80) || null, title, post.url,
      date || page.date || kstDay(), null, null, 0, '[]', page.summary, page.text || null, null, null, now, now, 'manual', null).run();
  return { ok: true, id: post.key };
}

export async function hideBlogPublication(db: D1Database, context: DataCoreAccessContext, id: string) {
  requireWriteAccess(context);
  await ensureBlogPublications(db);
  const row = await db.prepare('SELECT id, campus_id, author_user_id FROM blog_publications WHERE id=? AND organization_id=? AND hidden_at IS NULL').bind(id, ORG).first<Row>()
    || fail(404, '발행 기록을 찾을 수 없습니다.');
  if (!context.isSuperAdmin && !leadsCampus(context, row.campus_id) && row.author_user_id !== context.user?.internalUserId) fail(403, '본인이 넣은 기록만 숨길 수 있습니다.');
  await db.prepare('UPDATE blog_publications SET hidden_at=?, hidden_by=? WHERE id=?').bind(new Date().toISOString(), context.user!.internalUserId, id).run();
  return { ok: true };
}

/** 캠퍼스 블로그 연결 — saved into the same channel profile AI 마케팅 모니터링 uses; other channels are kept. */
export async function setCampusBlog(db: D1Database, context: DataCoreAccessContext, input: Row) {
  requireWriteAccess(context);
  const campusId = String(input?.campusId || '');
  requireCampusAccess(context, campusId);
  if (!context.isSuperAdmin && !leadsCampus(context, campusId)) fail(403, '캠퍼스 블로그는 원장 또는 마스터만 연결할 수 있습니다.');
  const blogId = input?.blogUrl ? naverBlogId(input.blogUrl) || fail(400, '네이버 블로그 주소를 넣어 주세요. 예) https://blog.naver.com/아이디') : null;
  const id = `marketing-channel:${campusId}`, now = new Date().toISOString();
  const existing = await db.prepare('SELECT metadata_json FROM data_records WHERE id=? AND organization_id=?').bind(id, ORG).first<Row>();
  const metadata = parse(existing?.metadata_json);
  metadata.channels = { ...(metadata.channels || {}), blog: blogId ? `https://blog.naver.com/${blogId}` : null };
  await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'marketing-monitoring','공식 채널','campus','active',?,?,?)
      ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
      WHERE data_records.record_type=excluded.record_type AND data_records.organization_id=excluded.organization_id AND data_records.campus_id=excluded.campus_id`)
    .bind(id, ORG, campusId, context.user!.internalUserId, PROFILE, JSON.stringify(metadata), now, now).run();
  await db.prepare("INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,'blog.campus-blog.update','data_record',?,'{}',?)")
    .bind(crypto.randomUUID(), ORG, campusId, context.user!.internalUserId, id, now).run();
  if (blogId) await syncCampusBlogs(db, 0);
  return { ok: true, campusId, blogUrl: metadata.channels.blog };
}

/** 블로그 발행 소식: newest first, at most 30, optionally one campus. Every academy member sees every campus. */
export async function listBlogPublications(db: D1Database, context: DataCoreAccessContext, url: URL) {
  requireWriteAccess(context);
  await ensureBlogPublications(db);
  const campusId = url.searchParams.get('campusId') || '';
  if (campusId.length > 120) fail(400, '캠퍼스를 확인하세요.');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || BLOG_FEED_LIMIT, 1), BLOG_FEED_LIMIT);
  const where = `organization_id=? AND hidden_at IS NULL AND (?='' OR campus_id=?)`;
  const fields = 'id, record_id, campus_id, author_user_id, author_name, title, url, published_date, title_kind, photo_count, hashtags_json, summary, views, source, category';
  // 블로그 글 검색: every saved post (not only the newest 30), most related first.
  const terms = [...new Set(String(url.searchParams.get('q') || '').replace(/#/g, ' ').split(/\s+/).map(t => t.trim().slice(0, 30)).filter(t => t.length >= 1))].slice(0, 6);
  const like = terms.map(() => `(title LIKE ? ESCAPE '!' OR summary LIKE ? ESCAPE '!' OR hashtags_json LIKE ? ESCAPE '!' OR category LIKE ? ESCAPE '!' OR body_text LIKE ? ESCAPE '!')`).join(' OR ');
  const values = terms.flatMap(t => { const v = '%' + t.replace(/[!%_]/g, c => '!' + c) + '%'; return [v, v, v, v, v]; });
  // Everything this panel needs in one D1 round trip (was six, one after another).
  const [meta, listed, counted, perCampusResult, campusResult, profileResult] = await db.batch([
    db.prepare("SELECT value FROM blog_feed_meta WHERE key='rss-sync'"),
    terms.length
      ? db.prepare(`SELECT ${fields}, body_text FROM blog_publications WHERE ${where} AND (${like}) ORDER BY published_date DESC LIMIT 400`).bind(ORG, campusId, campusId, ...values)
      : db.prepare(`SELECT ${fields} FROM blog_publications WHERE ${where} ORDER BY published_date DESC, recorded_at DESC LIMIT ?`).bind(ORG, campusId, campusId, limit),
    db.prepare(`SELECT COUNT(*) AS n FROM blog_publications WHERE ${where}`).bind(ORG, campusId, campusId),
    db.prepare('SELECT campus_id, COUNT(*) AS n FROM blog_publications WHERE organization_id=? AND hidden_at IS NULL GROUP BY campus_id').bind(ORG),
    db.prepare("SELECT id, code, name FROM campuses WHERE organization_id=? AND status='active' ORDER BY name").bind(ORG),
    db.prepare('SELECT campus_id, metadata_json FROM data_records WHERE organization_id=? AND record_type=? AND deleted_at IS NULL').bind(ORG, PROFILE),
  ]);
  // The list answers from D1 at once; collecting new posts from Naver runs as its own request (syncDue).
  const lastSync = (meta.results || [])[0] as { value: string } | undefined;
  const syncDue = !lastSync || Date.now() - Date.parse(lastSync.value) >= SYNC_EVERY_MS;
  let rows = (listed.results || []) as Row[], total = { n: Number(((counted.results || [])[0] as { n: number } | undefined)?.n || 0) };
  if (terms.length) {
    const score = (r: Row) => terms.reduce((sum, t) => {
      const has = (v: unknown, w: number) => String(v || '').toLowerCase().includes(t.toLowerCase()) ? w : 0;
      const inBody = String(r.body_text || '').toLowerCase().split(t.toLowerCase()).length - 1;
      return sum + has(r.title, 6) + has(r.hashtags_json, 4) + has(r.category, 3) + has(r.summary, 2) + Math.min(inBody, 5);
    }, 0) + (terms.every(t => [r.title, r.summary, r.hashtags_json, r.category, r.body_text].some(v => String(v || '').toLowerCase().includes(t.toLowerCase()))) ? 10 : 0);
    total = { n: rows.length };
    rows = rows.map(r => ({ ...r, score: score(r) }) as Row).sort((a, b) => b.score - a.score || String(b.published_date).localeCompare(String(a.published_date))).slice(0, limit);
  }
  const perCampus = (perCampusResult.results || []) as { campus_id: string | null; n: number }[];
  const campuses = presentCampuses((campusResult.results || []) as Row[]);
  const linked = new Map(blogsFrom((profileResult.results || []) as Row[]).map(b => [b.campusId, `https://blog.naver.com/${b.blogId}`]));
  const me = context.user?.internalUserId;
  const canHide = (r: Row) => context.isSuperAdmin || leadsCampus(context, r.campus_id) || Boolean(me && r.author_user_id === me);
  return {
    total: Number(total?.n || 0), limit, query: terms.join(' '), syncDue,
    campuses: perCampus.map(c => ({ campusId: c.campus_id, campusName: campusDisplayName(c.campus_id, c.campus_id) || '본사', count: Number(c.n) })),
    // Where this person may record a post, and which campus blogs they may connect.
    recordCampuses: campuses.filter(c => context.isSuperAdmin || context.campusIds.includes(String(c.id))).map(c => ({ campusId: c.id, campusName: c.name })),
    linkCampuses: campuses.filter(c => context.isSuperAdmin || leadsCampus(context, c.id)).map(c => ({ campusId: c.id, campusName: c.name, blogUrl: linked.get(String(c.id)) || null })),
    linkedCount: linked.size,
    items: rows.map(r => ({
      id: r.id, recordId: r.record_id, campusId: r.campus_id, campusName: campusDisplayName(r.campus_id, r.campus_id) || '본사',
      authorName: r.author_name || null, source: r.source || 'app', title: r.title, url: r.url, date: r.published_date, titleKind: r.title_kind,
      category: r.category || null, photoCount: Number(r.photo_count || 0), hashtags: tags(r.hashtags_json),
      summary: r.summary || '', views: r.views ?? null, mine: Boolean(me && r.author_user_id === me), canHide: canHide(r),
    })),
  };
}

/** AI로 변환하기: this post's structure and story, rewritten for the caller's campus (same rules as 글 만들기). */
export async function convertBlogPublication(env: OpenAiEnv, db: D1Database, context: DataCoreAccessContext, id: string, input: Row, signal?: AbortSignal) {
  requireWriteAccess(context);
  await ensureBlogPublications(db);
  const campusId = String(input?.campusId || '');
  requireCampusAccess(context, campusId);
  const row = await db.prepare('SELECT * FROM blog_publications WHERE id=? AND organization_id=? AND hidden_at IS NULL').bind(id, ORG).first<Row>() || fail(404, '발행 기록을 찾을 수 없습니다.');
  let text = String(row.body_text || '');
  if (text.length < 200) {
    const post = naverPost(row.url);
    try { if (post) { const fresh = await fetchPostText(post); if (fresh.length > text.length) { text = fresh; await db.prepare('UPDATE blog_publications SET body_text=? WHERE id=?').bind(text, id).run(); } } } catch { /* use what was saved */ }
  }
  if (text.replace(/\s|\[사진\]/g, '').length < 80) fail(422, '이 글의 본문을 읽지 못했습니다. 네이버에서 글이 비공개이거나 지워졌는지 확인해 주세요.');
  const recentTitles = Array.isArray(input?.recentTitles) ? input.recentTitles.filter((t: unknown) => typeof t === 'string').map((t: string) => t.slice(0, 200)).slice(0, 20) : [];
  const keywordTags = Array.isArray(input?.keywordTags) ? input.keywordTags : [];
  const result = await convertBlogFromReference(env, db, context, {
    campusName: campusDisplayName(campusId), seo: await blogSeo(db, campusId, input?.keywordBrand, keywordTags), brandContext: HI5_CONTENT_BRAND_CONTEXT,
    strategyMode: input?.strategyMode, recentTitles, notes: clip(input?.notes, 2000),
    source: { title: String(row.title), campusName: campusDisplayName(row.campus_id, row.campus_id) || '다른 캠퍼스', text },
  }, signal);
  return { ...result, source: { id: row.id, title: row.title, url: row.url, campusName: campusDisplayName(row.campus_id, row.campus_id) || '' } };
}

/** 새 글 가져오기: the panel asks for this after showing the saved list. 새로고침 may ask every 2 minutes. */
export async function syncBlogPublications(db: D1Database, context: DataCoreAccessContext, input: Row) {
  requireWriteAccess(context);
  const result = await syncCampusBlogs(db, input?.refresh === true ? 2 * 60_000 : SYNC_EVERY_MS);
  return { ok: true, synced: !('skipped' in result) };
}

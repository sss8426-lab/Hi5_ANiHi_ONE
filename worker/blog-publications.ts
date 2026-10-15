// 블로그 발행 소식: every blog post a teacher marks as published (실제 게시 URL·게시일) is copied into an
// append-only log, so all campuses can see who published what, where and how. Published posts are public
// on Naver already, so every academy member may read the log. Rows are never deleted — deleting or
// re-editing a draft keeps what was actually published.
import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess } from './data-core-access';
import { campusDisplayName } from './campus-directory';
import { schemaOnce } from './schema-once';

export const BLOG_FEED_LIMIT = 30;
type Row = Record<string, any>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAVER = /^https:\/\/([a-z0-9-]+\.)?(blog\.naver\.com|m\.blog\.naver\.com)\//i;
const parse = (json: unknown) => { try { const v = JSON.parse(String(json || '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const tags = (json: unknown) => { const v = parse(json); return Array.isArray(v) ? v.filter(t => typeof t === 'string').slice(0, 8) : []; };
const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function ensureBlogPublications(db: D1Database) {
  return schemaOnce(db, 'blog-publications', async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS blog_publications (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, record_id TEXT NOT NULL, campus_id TEXT,
        author_user_id TEXT, author_name TEXT, title TEXT NOT NULL, url TEXT NOT NULL, published_date TEXT NOT NULL,
        title_kind TEXT, template_id TEXT, photo_count INTEGER NOT NULL DEFAULT 0, hashtags_json TEXT, summary TEXT, body_text TEXT,
        views INTEGER, homefeed_views INTEGER, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
      db.prepare('CREATE INDEX IF NOT EXISTS blog_publications_recent_idx ON blog_publications(organization_id, published_date DESC, recorded_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS blog_publications_campus_idx ON blog_publications(organization_id, campus_id, published_date DESC)'),
    ]);
    // Posts published before this log existed: copy them in once (only rows that look published are parsed).
    const rows = (await db.prepare(`SELECT d.*, u.display_name AS author_name FROM data_records d LEFT JOIN users u ON u.id = d.created_by_user_id
      WHERE d.organization_id=? AND d.record_type='blog-draft' AND d.metadata_json LIKE '%"publishStatus":"published"%' LIMIT 2000`).bind(ORG).all<Row>()).results || [];
    const statements = rows.map(row => publicationStatement(db, row, true)).filter(Boolean) as D1PreparedStatement[];
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  });
}

function publication(row: Row) {
  const m = parse(row.metadata_json), p = m.blogPost || {}, pub = p.publication || {};
  if (m.publishStatus !== 'published' || !NAVER.test(String(pub.url || '')) || !DAY.test(String(pub.date || ''))) return null;
  const blocks: Row[] = Array.isArray(p.blocks) ? p.blocks : [];
  const text = (types: string[]) => blocks.filter(b => types.includes(b.type) && typeof b.text === 'string').map(b => b.text);
  const hashtags = (text(['hashtags']).join(' ').match(/#[^\s#]+/g) || []).slice(0, 30);
  const body = text(['greeting', 'lead', 'heading', 'paragraph', 'caption', 'quote', 'related', 'closing', 'contact']).join('\n\n');
  return {
    url: String(pub.url).slice(0, 500), date: String(pub.date), title: clip(p.title || row.title, 240) || '제목 없음',
    titleKind: clip(p.generation?.selectedTitleKind || m.selectedTitleKind, 40) || null, templateId: clip(p.template?.templateId, 80) || null,
    photoCount: Array.isArray(p.photos) ? p.photos.length : 0, hashtags,
    summary: clip(text(['lead', 'paragraph']).join(' '), 180), body: body.slice(0, 60000),
    views: Number.isSafeInteger(pub.views) ? pub.views : null, homefeedViews: Number.isSafeInteger(pub.homefeedViews) ? pub.homefeedViews : null,
  };
}

function publicationStatement(db: D1Database, row: Row, keepExisting = false) {
  const p = publication(row);
  if (!p) return null;
  const now = new Date().toISOString();
  // One row per post and address. A new URL (re-published) adds a row; the earlier one stays.
  const id = `${row.id}|${p.url}`;
  return db.prepare(`INSERT INTO blog_publications (id, organization_id, record_id, campus_id, author_user_id, author_name, title, url, published_date,
      title_kind, template_id, photo_count, hashtags_json, summary, body_text, views, homefeed_views, recorded_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO ${keepExisting ? 'NOTHING' : `UPDATE SET title=excluded.title, published_date=excluded.published_date, title_kind=excluded.title_kind,
      template_id=excluded.template_id, photo_count=excluded.photo_count, hashtags_json=excluded.hashtags_json, summary=excluded.summary,
      body_text=excluded.body_text, views=excluded.views, homefeed_views=excluded.homefeed_views, updated_at=excluded.updated_at`}`)
    .bind(id, ORG, row.id, row.campus_id ?? null, row.created_by_user_id ?? null, clip(row.author_name, 80) || null, p.title, p.url, p.date,
      p.titleKind, p.templateId, p.photoCount, JSON.stringify(p.hashtags), p.summary, p.body, p.views, p.homefeedViews, now, now);
}

/** Called after a blog post is saved. Only posts with a real Naver address and date are logged. */
export async function recordBlogPublication(db: D1Database, recordId: string) {
  await ensureBlogPublications(db);
  const row = await db.prepare(`SELECT d.*, u.display_name AS author_name FROM data_records d LEFT JOIN users u ON u.id = d.created_by_user_id
    WHERE d.id=? AND d.organization_id=? AND d.record_type='blog-draft'`).bind(recordId, ORG).first<Row>();
  const statement = row && publicationStatement(db, row);
  if (statement) await statement.run();
}

/** 블로그 발행 소식: newest first, at most 30, optionally one campus. Every academy member sees every campus. */
export async function listBlogPublications(db: D1Database, context: DataCoreAccessContext, url: URL) {
  requireWriteAccess(context);
  await ensureBlogPublications(db);
  const campusId = url.searchParams.get('campusId') || '';
  if (campusId.length > 120) throw new DataCoreAccessError(400, '캠퍼스를 확인하세요.');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || BLOG_FEED_LIMIT, 1), BLOG_FEED_LIMIT);
  const where = `organization_id=? AND (?='' OR campus_id=?)`;
  const rows = (await db.prepare(`SELECT id, record_id, campus_id, author_user_id, author_name, title, url, published_date, title_kind, photo_count, hashtags_json, summary, views
    FROM blog_publications WHERE ${where} ORDER BY published_date DESC, recorded_at DESC LIMIT ?`).bind(ORG, campusId, campusId, limit).all<Row>()).results || [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM blog_publications WHERE ${where}`).bind(ORG, campusId, campusId).first<{ n: number }>();
  const perCampus = (await db.prepare('SELECT campus_id, COUNT(*) AS n FROM blog_publications WHERE organization_id=? GROUP BY campus_id').bind(ORG).all<{ campus_id: string | null; n: number }>()).results || [];
  const me = context.user?.internalUserId;
  return {
    total: Number(total?.n || 0), limit,
    campuses: perCampus.map(c => ({ campusId: c.campus_id, campusName: campusDisplayName(c.campus_id, c.campus_id) || '본사', count: Number(c.n) })),
    items: rows.map(r => ({
      id: r.id, recordId: r.record_id, campusId: r.campus_id, campusName: campusDisplayName(r.campus_id, r.campus_id) || '본사',
      authorName: r.author_name || '선생님', title: r.title, url: r.url, date: r.published_date, titleKind: r.title_kind,
      photoCount: Number(r.photo_count || 0), hashtags: tags(r.hashtags_json),
      summary: r.summary || '', views: r.views ?? null, mine: Boolean(me && r.author_user_id === me),
    })),
  };
}

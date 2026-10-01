// Blog helpers for the Naver-style editor: publishing consistency, which posts read well, and how much
// of the current text already appears in another saved blog post (near-duplicate risk). Only counts and
// percentages leave the server — never another campus's text or title.
import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess, requireCampusAccess } from './data-core-access';

const scope = (context: DataCoreAccessContext, raw: unknown) => {
  requireAuthenticatedAccess(context);
  const campusId = typeof raw === 'string' && raw ? raw : null;
  if (!context.isSuperAdmin || campusId) requireCampusAccess(context, campusId);
  return campusId;
};
const parse = (json: string) => { try { return JSON.parse(json || '{}'); } catch { return {}; } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function blogStats(db: D1Database, context: DataCoreAccessContext, campusIdParam: unknown) {
  const campusId = scope(context, campusIdParam);
  const rows = (await db.prepare(`SELECT title, metadata_json FROM data_records WHERE organization_id=? AND record_type='blog-draft' AND deleted_at IS NULL
    AND (campus_id=? OR (? IS NULL AND ?=1)) ORDER BY updated_at DESC LIMIT 500`).bind(ORG, campusId, campusId, context.isSuperAdmin ? 1 : 0).all<{ title: string; metadata_json: string }>()).results || [];
  const posts = rows.map(row => {
    const m = parse(row.metadata_json), p = m.blogPost || {}, pub = p.publication || {};
    return { title: String(row.title || '').slice(0, 120), titleKind: p.generation?.selectedTitleKind || m.selectedTitleKind || null,
      templateId: p.template?.templateId || null, date: DAY.test(pub.date || '') ? pub.date : null,
      views: Number.isSafeInteger(pub.views) ? pub.views : null, homefeedViews: Number.isSafeInteger(pub.homefeedViews) ? pub.homefeedViews : null };
  });
  const measured = posts.filter(p => p.views != null);
  const kinds: Record<string, { posts: number; avgViews: number }> = {};
  for (const p of measured) { const k = p.titleKind || 'unknown', v = kinds[k] || (kinds[k] = { posts: 0, avgViews: 0 }); v.avgViews = (v.avgViews * v.posts + p.views!) / (v.posts + 1); v.posts++; }
  return {
    publishedDates: posts.map(p => p.date).filter(Boolean),
    top: measured.sort((a, b) => b.views! - a.views!).slice(0, 5),
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { posts: v.posts, avgViews: Math.round(v.avgViews) }])),
  };
}

const SHINGLE = 12;
const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]+/gu, '');
export async function blogOverlap(db: D1Database, context: DataCoreAccessContext, input: any) {
  const campusId = scope(context, input?.campusId);
  const text = typeof input?.text === 'string' ? input.text : '';
  if (text.length > 60000) throw new DataCoreAccessError(400, '본문이 너무 깁니다.');
  const own = normalize(text), mine = new Set<string>();
  for (let i = 0; i + SHINGLE <= own.length; i++) mine.add(own.slice(i, i + SHINGLE));
  if (mine.size < 20) return { percent: 0, compared: 0, otherCampus: false };
  const id = typeof input?.id === 'string' ? input.id : '';
  const rows = (await db.prepare(`SELECT campus_id, content_text FROM data_records WHERE organization_id=? AND record_type='blog-draft' AND deleted_at IS NULL AND id<>?
    AND content_text IS NOT NULL ORDER BY updated_at DESC LIMIT 100`).bind(ORG, id).all<{ campus_id: string | null; content_text: string }>()).results || [];
  let best = 0, otherCampus = false;
  for (const row of rows) {
    const other = normalize(String(row.content_text || '')), found = new Set<string>();
    for (let i = 0; i + SHINGLE <= other.length; i++) { const s = other.slice(i, i + SHINGLE); if (mine.has(s)) found.add(s); }
    const share = found.size / mine.size;
    if (share > best) { best = share; otherCampus = row.campus_id !== campusId; }
  }
  return { percent: Math.round(best * 100), compared: rows.length, otherCampus };
}

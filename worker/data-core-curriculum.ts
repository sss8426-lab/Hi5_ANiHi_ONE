import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from './data-core-access';

export const CURRICULUM_TYPES = ['curriculum-folder', 'curriculum-page'];
export const CURRICULUM_CATEGORIES = ['curriculum-original', 'curriculum-preview', 'curriculum-thumbnail', 'curriculum-print'];
type Row = {
  id: string; title: string; record_type: string; organization_id: string;
  campus_id: string | null; visibility: string; source_app: string;
  status: string; deleted_at: string | null; metadata_json: string;
};
export function curriculumRecord(row: { record_type?: unknown; source_app?: unknown }) {
  return CURRICULUM_TYPES.includes(String(row.record_type).trim()) || String(row.source_app).trim() === 'curriculum';
}
export function curriculumFile(row: { category?: unknown; source_app?: unknown }) {
  return CURRICULUM_CATEGORIES.includes(String(row.category).trim()) || String(row.source_app).trim() === 'curriculum';
}
export function requireCurriculumRead(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.memberships.length) throw new DataCoreAccessError(403, '조직 사용 권한이 필요합니다.');
}
function metadata(row: Row) { try { return JSON.parse(row.metadata_json); } catch { return null; } }
function valid(row: Row) {
  return row.organization_id === DEFAULT_ORGANIZATION_ID && row.campus_id === null && row.visibility === 'organization' &&
    row.source_app === 'curriculum' && row.status === 'active' && !row.deleted_at;
}
const fileUrl = (id: string) => `/api/data-core/files/${encodeURIComponent(id)}`;

export async function curriculumFileReadable(db: D1Database, context: DataCoreAccessContext, file: Record<string, unknown>) {
  if (!context.user || (!context.isSuperAdmin && !context.memberships.length) || file.organization_id !== DEFAULT_ORGANIZATION_ID ||
    file.campus_id !== null || file.visibility !== 'organization' || file.source_app !== 'curriculum' || file.area !== 'documents-private' || !CURRICULUM_CATEGORIES.includes(String(file.category))) return false;
  let row = await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(file.data_record_id, DEFAULT_ORGANIZATION_ID).first<Row>();
  const m = row && metadata(row);
  if (!row || !valid(row) || row.record_type !== 'curriculum-page' || !m || m.schemaVersion !== 1 || !m.active ||
    !['originalFileId','previewFileId','printFileId','thumbnailFileId'].some(key => m[key] === file.id)) return false;
  const original = await db.prepare("SELECT id FROM file_objects WHERE id=? AND organization_id=? AND data_record_id=? AND source_app='curriculum' AND category='curriculum-original' AND campus_id IS NULL AND visibility='organization' AND deleted_at IS NULL")
    .bind(m.originalFileId, DEFAULT_ORGANIZATION_ID, file.data_record_id).first();
  if (!original) return false;
  const visited = new Set<string>();
  let parent = m.curriculumFolderId;
  while (parent) {
    if (visited.has(parent) || visited.size >= 32) return false;
    visited.add(parent);
    row = await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(parent, DEFAULT_ORGANIZATION_ID).first<Row>();
    const folder = row && metadata(row);
    if (!row || !valid(row) || row.record_type !== 'curriculum-folder' || !folder?.active || folder.family !== m.family || folder.stage !== m.stage) return false;
    parent = folder.parentFolderId;
  }
  return visited.size > 0;
}

async function collection(db: D1Database, family: string, stage: string) {
  if (family !== 'content' || !['basic','advanced','admission'].includes(stage)) throw new DataCoreAccessError(404, '과정을 찾을 수 없습니다.');
  const result = await db.prepare(`SELECT * FROM data_records WHERE organization_id=? AND source_app='curriculum'
    AND record_type IN ('curriculum-folder','curriculum-page') AND campus_id IS NULL AND visibility='organization'
    AND status='active' AND deleted_at IS NULL AND json_valid(metadata_json)
    AND json_extract(metadata_json,'$.family')=? AND json_extract(metadata_json,'$.stage')=?`)
    .bind(DEFAULT_ORGANIZATION_ID, family, stage).all<Row>();
  const rows = (result.results || []).map(row => ({ ...row, m: metadata(row) })).filter(row => row.m?.active && row.m.schemaVersion === 1);
  type CurriculumRow = (typeof rows)[number];
  const folders = rows.filter(r => r.record_type === 'curriculum-folder');
  const byId = new Map(folders.map(r => [r.id, r]));
  function live(id: string) {
    const seen = new Set();
    while (id) { const f = byId.get(id); if (!f || seen.has(id) || seen.size >= 32) return false; seen.add(id); id = f.m.parentFolderId; }
    return seen.size > 0;
  }
  const order = (a: CurriculumRow, b: CurriculumRow) => Number(a.m.order) - Number(b.m.order) || String(a.id).localeCompare(String(b.id));
  const activeFolders = folders.filter(f => live(f.id)).sort(order);
  const pages = rows.filter(r => r.record_type === 'curriculum-page' && !r.m.supersededByPageId && live(r.m.curriculumFolderId)).sort(order);
  const viewPage = (p: CurriculumRow) => ({ id: p.id, folderId: p.m.curriculumFolderId, order: p.m.order, width: p.m.width, height: p.m.height,
    previewUrl: fileUrl(p.m.previewFileId), thumbnailUrl: fileUrl(p.m.thumbnailFileId), originalUrl: fileUrl(p.m.originalFileId), printUrl: fileUrl(p.m.printFileId) });
  const viewFolder = (f: CurriculumRow) => ({ id: f.id, title: f.title, order: f.m.order, parentFolderId: f.m.parentFolderId || null,
    representativeUrl: f.m.representativeFileId ? fileUrl(f.m.representativeFileId) : null,
    pageCount: pages.filter(p => p.m.curriculumFolderId === f.id).length });
  function orderedPages(parent: string | null): CurriculumRow[] {
    return activeFolders.filter(f => (f.m.parentFolderId || null) === parent).flatMap(f => [
      ...pages.filter(p => p.m.curriculumFolderId === f.id), ...orderedPages(f.id),
    ]);
  }
  return { folders: activeFolders, pages, byId, viewPage, viewFolder, orderedPages };
}

export async function handleCurriculumApi(request: Request, db: D1Database, context: DataCoreAccessContext) {
  requireCurriculumRead(context);
  if (request.method !== 'GET') throw new DataCoreAccessError(405, '읽기 전용 경로입니다.');
  const url = new URL(request.url), match = url.pathname.match(/^\/api\/data-core\/curriculum\/folders\/([^/]+)$/);
  let family = url.searchParams.get('family') || '', stage = url.searchParams.get('stage') || '', target: string | null = null;
  if (match) {
    target = decodeURIComponent(match[1]);
    const row = await db.prepare("SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type='curriculum-folder'").bind(target, DEFAULT_ORGANIZATION_ID).first<Row>();
    if (!row || !valid(row)) throw new DataCoreAccessError(404, '수업을 찾을 수 없습니다.');
    const m = metadata(row); family = m?.family; stage = m?.stage;
  } else if (!['/api/data-core/curriculum','/api/data-core/curriculum/print'].includes(url.pathname)) throw new DataCoreAccessError(404, '경로를 찾을 수 없습니다.');
  const c = await collection(db, family, stage);
  if (target && !c.folders.some(f => f.id === target)) throw new DataCoreAccessError(404, '수업을 찾을 수 없습니다.');
  const breadcrumbs: ReturnType<typeof c.viewFolder>[] = [];
  let parent = target;
  while (parent) { const f = c.byId.get(parent)!; breadcrumbs.unshift(c.viewFolder(f)); parent = f.m.parentFolderId; }
  const printLesson = url.searchParams.get('lesson');
  if (url.pathname.endsWith('/print') && printLesson && !c.folders.some(f => f.id === printLesson)) throw new DataCoreAccessError(404, '수업을 찾을 수 없습니다.');
  const printPages = printLesson ? [...c.pages.filter(p => p.m.curriculumFolderId === printLesson), ...c.orderedPages(printLesson)] : c.orderedPages(null);
  return Response.json({ family, stage, folder: target ? c.viewFolder(c.byId.get(target)!) : null, breadcrumbs,
    folders: c.folders.filter(f => (f.m.parentFolderId || null) === target).map(c.viewFolder),
    pages: (url.pathname.endsWith('/print') ? printPages : target ? c.pages.filter(p => p.m.curriculumFolderId === target) : []).map(c.viewPage),
    totalFolders: c.folders.length, totalPages: c.pages.length }, { headers: { 'cache-control': 'private, no-store' } });
}

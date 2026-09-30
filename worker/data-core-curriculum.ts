import { DEFAULT_ORGANIZATION_ID } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from './data-core-access';

export const CURRICULUM_TYPES = ['curriculum-folder', 'curriculum-page'];
export const CURRICULUM_CATEGORIES = ['curriculum-original', 'curriculum-preview', 'curriculum-thumbnail', 'curriculum-print', 'curriculum-cover'];
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
    file.campus_id !== null || file.visibility !== 'organization' || file.source_app !== 'curriculum' || file.area !== 'documents-private' || file.deleted_at || !CURRICULUM_CATEGORIES.includes(String(file.category))) return false;
  let row = await db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=?').bind(file.data_record_id, DEFAULT_ORGANIZATION_ID).first<Row>();
  const m = row && metadata(row);
  if (!row || !valid(row) || !m || m.schemaVersion !== 1 || !m.active) return false;
  const cover = file.category === 'curriculum-cover';
  if (cover) {
    if (row.record_type !== 'curriculum-folder' || m.coverFileId !== file.id) return false;
  } else {
    if (row.record_type !== 'curriculum-page' || !['originalFileId','previewFileId','printFileId','thumbnailFileId'].some(key => m[key] === file.id)) return false;
    const original = await db.prepare("SELECT id FROM file_objects WHERE id=? AND organization_id=? AND data_record_id=? AND source_app='curriculum' AND category='curriculum-original' AND campus_id IS NULL AND visibility='organization' AND deleted_at IS NULL")
      .bind(m.originalFileId, DEFAULT_ORGANIZATION_ID, file.data_record_id).first();
    if (!original) return false;
  }
  const visited = new Set<string>();
  let parent = cover ? row.id : m.curriculumFolderId;
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

// 꿈 그림의 시작 has no stage split, so its lessons live under a single 'main' stage.
export const CURRICULUM_STAGES: Record<string, string[]> = { start: ['main'], content: ['basic','advanced','admission'], design: ['basic','advanced','admission'] };
const knownStage = (family: string, stage: string) => Object.hasOwn(CURRICULUM_STAGES, family) && CURRICULUM_STAGES[family].includes(stage);

async function collection(db: D1Database, family: string, stage: string) {
  if (!knownStage(family, stage)) throw new DataCoreAccessError(404, '과정을 찾을 수 없습니다.');
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
  // Covers belong to folders, never to the printable page sequence. Resolve them in one query.
  const coverFiles = activeFolders.some(f => f.m.coverFileId) ? await db.prepare(`SELECT f.id,f.data_record_id FROM file_objects f
    JOIN data_records r ON r.id=f.data_record_id WHERE f.organization_id=? AND f.source_app='curriculum'
    AND f.category='curriculum-cover' AND f.area='documents-private' AND f.visibility='organization'
    AND f.campus_id IS NULL AND f.deleted_at IS NULL AND r.record_type='curriculum-folder'
    AND json_valid(r.metadata_json) AND json_extract(r.metadata_json,'$.family')=? AND json_extract(r.metadata_json,'$.stage')=?`)
    .bind(DEFAULT_ORGANIZATION_ID, family, stage).all<{id: string; data_record_id: string}>() : null;
  const covers = new Map((coverFiles?.results || []).map(f => [f.id, f.data_record_id]));
  const pages = rows.filter(r => r.record_type === 'curriculum-page' && !r.m.supersededByPageId && live(r.m.curriculumFolderId)).sort(order);
  const viewPage = (p: CurriculumRow) => ({ id: p.id, folderId: p.m.curriculumFolderId, order: p.m.order, width: p.m.width, height: p.m.height,
    previewUrl: fileUrl(p.m.previewFileId), thumbnailUrl: fileUrl(p.m.thumbnailFileId), originalUrl: fileUrl(p.m.originalFileId), printUrl: fileUrl(p.m.printFileId) });
  const viewFolder = (f: CurriculumRow) => ({ id: f.id, title: f.title, order: f.m.order, parentFolderId: f.m.parentFolderId || null,
    representativeUrl: covers.get(f.m.coverFileId) === f.id ? fileUrl(f.m.coverFileId) : f.m.representativeFileId ? fileUrl(f.m.representativeFileId) : null,
    fallbackRepresentativeUrl: f.m.representativeFileId ? fileUrl(f.m.representativeFileId) : null,
    coverAlt: covers.get(f.m.coverFileId) === f.id && typeof f.m.cover?.alt === 'string' ? f.m.cover.alt : null,
    webManaged: f.m.createdVia === 'web',
    pageCount: pages.filter(p => p.m.curriculumFolderId === f.id).length });
  function orderedPages(parent: string | null): CurriculumRow[] {
    return activeFolders.filter(f => (f.m.parentFolderId || null) === parent).flatMap(f => [
      ...pages.filter(p => p.m.curriculumFolderId === f.id), ...orderedPages(f.id),
    ]);
  }
  return { folders: activeFolders, pages, byId, viewPage, viewFolder, orderedPages };
}

const MAX_BYTES: Record<string, number> = { original: 40 * 1024 * 1024, preview: 12 * 1024 * 1024, thumbnail: 3 * 1024 * 1024, print: 30 * 1024 * 1024 };
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function sniff(bytes: Uint8Array) {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && text(1, 4) === 'PNG') return 'image/png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(0, 4) === 'GIF8') return 'image/gif';
  return null;
}
const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

function requireCurriculumManager(request: Request, context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '커리큘럼 폴더와 수업자료는 마스터 관리자만 추가할 수 있습니다.');
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new DataCoreAccessError(403, '동일 출처 요청만 허용됩니다.');
}
async function audit(db: D1Database, context: DataCoreAccessContext, action: string, id: string, metadata: Record<string, unknown>) {
  await db.prepare('INSERT INTO audit_logs (id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, context.user?.internalUserId ?? null, action, 'curriculum', id, JSON.stringify(metadata), new Date().toISOString()).run();
}

// A master adds a top-level lesson folder at the end of one course stage.
async function createFolder(request: Request, db: D1Database, context: DataCoreAccessContext) {
  const body = await request.json().catch(() => null) as { family?: unknown; stage?: unknown; title?: unknown } | null;
  const family = String(body?.family ?? ''), stage = String(body?.stage ?? ''), title = String(body?.title ?? '').trim();
  if (!knownStage(family, stage)) throw new DataCoreAccessError(404, '과정을 찾을 수 없습니다.');
  if (!title || title.length > 60) throw new DataCoreAccessError(400, '폴더 이름은 1~60자로 입력해 주세요.');
  const c = await collection(db, family, stage);
  const order = Math.max(0, ...c.folders.filter(f => !f.m.parentFolderId).map(f => Number(f.m.order) || 0)) + 1;
  const id = `cur-folder-${crypto.randomUUID()}`, now = new Date().toISOString();
  const m = { schemaVersion: 1, family, stage, order, relativePath: `web/${id}`, parentFolderId: null, representativeFileId: null, active: true, createdVia: 'web' };
  await db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES (?,?,NULL,NULL,'curriculum-folder','curriculum',?,'organization','active',?,?,?)`).bind(id, DEFAULT_ORGANIZATION_ID, title, JSON.stringify(m), now, now).run();
  await audit(db, context, 'curriculum.folder.create', id, { family, stage, title });
  return Response.json({ folder: { id, title, family, stage } }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
}

// One page per request: the browser sends the original plus preview/thumbnail/print renditions it made.
async function uploadPage(request: Request, db: D1Database, files: R2Bucket, context: DataCoreAccessContext, folderId: string) {
  const folder = await db.prepare("SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type='curriculum-folder'").bind(folderId, DEFAULT_ORGANIZATION_ID).first<Row>();
  const fm = folder && metadata(folder);
  if (!folder || !valid(folder) || !fm?.active) throw new DataCoreAccessError(404, '수업을 찾을 수 없습니다.');
  if (fm.createdVia !== 'web') throw new DataCoreAccessError(403, '새로 만든 폴더에만 수업자료를 올릴 수 있습니다.');
  const c = await collection(db, fm.family, fm.stage);
  if (!c.folders.some(f => f.id === folderId)) throw new DataCoreAccessError(404, '수업을 찾을 수 없습니다.');
  const form = await request.formData().catch(() => null);
  if (!form) throw new DataCoreAccessError(400, '업로드 형식이 올바르지 않습니다.');
  const width = Number(form.get('width')), height = Number(form.get('height'));
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 30000)) throw new DataCoreAccessError(400, '이미지 크기를 확인하지 못했습니다.');
  const pageId = `cur-page-${crypto.randomUUID()}`, now = new Date().toISOString();
  const assets: { id: string; kind: string; key: string; mime: string; size: number; sha256: string; bytes: ArrayBuffer }[] = [];
  let sourceFileName = '';
  for (const kind of ['original', 'preview', 'thumbnail', 'print']) {
    const file = form.get(kind);
    if (!(file instanceof File) || !file.size) throw new DataCoreAccessError(400, '업로드할 이미지가 없습니다.');
    if (file.size > MAX_BYTES[kind]) throw new DataCoreAccessError(413, '이미지 파일이 너무 큽니다.');
    const bytes = await file.arrayBuffer(), mime = sniff(new Uint8Array(bytes.slice(0, 16)));
    if (!mime || (kind === 'print' && mime !== 'image/jpeg') || (kind !== 'original' && mime === 'image/gif')) throw new DataCoreAccessError(415, 'JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.');
    if (kind === 'original') sourceFileName = (file.name || '수업자료').slice(0, 200);
    const hash = await sha256(bytes);
    assets.push({ id: `cur-file-${crypto.randomUUID()}`, kind, mime, size: bytes.byteLength, sha256: hash, bytes,
      key: `data-core/documents-private/${DEFAULT_ORGANIZATION_ID}/organization/curriculum/${fm.family}/${fm.stage}/${pageId}/${kind}-${hash}.${EXTENSIONS[mime]}` });
  }
  for (const a of assets) await files.put(a.key, a.bytes, { httpMetadata: { contentType: a.mime } });
  const order = Math.max(0, ...c.pages.filter(p => p.m.curriculumFolderId === folderId).map(p => Number(p.m.order) || 0)) + 1;
  const byKind = Object.fromEntries(assets.map(a => [a.kind, a]));
  const m = { schemaVersion: 1, family: fm.family, stage: fm.stage, curriculumFolderId: folderId, order, version: 1, previousPageId: null,
    relativePath: `web/${folderId}/${pageId}`, sourceFileName, fingerprint: byKind.original.sha256, sourceSize: byKind.original.size, width, height,
    originalFileId: byKind.original.id, previewFileId: byKind.preview.id, thumbnailFileId: byKind.thumbnail.id, printFileId: byKind.print.id,
    assets: assets.map(({ id, kind, sha256, size }) => ({ id, kind, sha256, size })), active: true, createdVia: 'web' };
  const statements = [db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
    VALUES (?,?,NULL,NULL,'curriculum-page','curriculum',?,'organization','active',?,?,?)`).bind(pageId, DEFAULT_ORGANIZATION_ID, sourceFileName, JSON.stringify(m), now, now),
  ...assets.map(a => db.prepare(`INSERT INTO file_objects (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
    VALUES (?,?,NULL,?,NULL,'documents-private',?,'curriculum',?,?,?,?,'organization',?)`).bind(a.id, DEFAULT_ORGANIZATION_ID, pageId, `curriculum-${a.kind}`, a.key, sourceFileName, a.mime, a.size, now))];
  // The first uploaded page becomes the folder's card image.
  if (!fm.representativeFileId) statements.push(db.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.representativeFileId',?),updated_at=? WHERE id=? AND json_extract(metadata_json,'$.representativeFileId') IS NULL")
    .bind(byKind.thumbnail.id, now, folderId));
  await db.batch(statements);
  await audit(db, context, 'curriculum.page.upload', pageId, { folderId, sourceFileName, size: byKind.original.size });
  return Response.json({ page: { id: pageId, order } }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
}

export async function handleCurriculumApi(request: Request, db: D1Database, context: DataCoreAccessContext, files?: R2Bucket) {
  requireCurriculumRead(context);
  if (request.method === 'POST') {
    requireCurriculumManager(request, context);
    const path = new URL(request.url).pathname, upload = path.match(/^\/api\/data-core\/curriculum\/folders\/([^/]+)\/pages$/);
    if (path === '/api/data-core/curriculum/folders') return createFolder(request, db, context);
    if (upload) {
      if (!files) throw new DataCoreAccessError(503, 'DATA CORE 저장소가 연결되지 않았습니다.');
      return uploadPage(request, db, files, context, decodeURIComponent(upload[1]));
    }
    throw new DataCoreAccessError(404, '경로를 찾을 수 없습니다.');
  }
  if (request.method !== 'GET') throw new DataCoreAccessError(405, '지원하지 않는 요청입니다.');
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
    totalFolders: c.folders.length, totalPages: c.pages.length, canManage: context.isSuperAdmin }, { headers: { 'cache-control': 'private, no-store' } });
}

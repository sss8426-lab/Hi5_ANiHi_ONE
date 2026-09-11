import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { uploadDataCoreFile, deleteDataCoreFile } from './data-core-files';
import { LibraryTree, LibraryFolder, LIBRARY_FOLDER, HQ_FOLDER, LIBRARY_SOURCE, LIBRARY_CATEGORIES, HQ_DEFAULTS,
  libraryMetadata, libraryCanWrite, libraryCanDelete, libraryCanDeleteFolder, libraryFolderScope, requireLibraryWrite, libraryFileReadable } from './data-core-library-policy';

function error(status: number, message: string): never { throw new DataCoreAccessError(status, message); }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const serialize = (tree: LibraryTree, f: LibraryFolder) => ({ id: f.id, title: f.title, parentId: f.parentId,
  campusId: f.campusId, category: f.category, group: f.group, canWrite: libraryCanWrite(tree.context, f),
  systemManaged: Boolean(f.systemManaged), canDelete: libraryCanDeleteFolder(tree.context, f),
  readOnly: !libraryCanWrite(tree.context, f) });

async function audit(tree: LibraryTree, action: string, folder: LibraryFolder) {
  await tree.db.prepare(`INSERT INTO audit_logs (id, organization_id, campus_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'data_record', ?, '{}', ?)`).bind(crypto.randomUUID(), ORG, folder.campusId,
    tree.context.user!.internalUserId, action, folder.id, new Date().toISOString()).run();
}

async function children(tree: LibraryTree, parent: LibraryFolder) {
  const rows = (await tree.db.prepare(`SELECT * FROM data_records WHERE organization_id = ? AND source_app = ? AND deleted_at IS NULL
    AND record_type IN (?, ?) AND (CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.parentFolderId') END = ?
      OR (? IN ('root','hq') AND campus_id IS NULL AND (record_type = ? OR
        CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.parentFolderId') END = 'hq'))
      OR (? = 'root' AND campus_id IS NULL AND record_type = ? AND json_valid(metadata_json)
        AND json_extract(metadata_json, '$.parentFolderId') IS NULL)) ORDER BY created_at, id`)
    .bind(ORG, LIBRARY_SOURCE, LIBRARY_FOLDER, HQ_FOLDER, parent.id, parent.id, HQ_FOLDER, parent.id, LIBRARY_FOLDER).all<Record<string, any>>()).results || [];
  for (const row of rows) tree.rows.set(row.id, row);
  const output: LibraryFolder[] = [];
  for (const row of rows) {
    if (libraryMetadata(row).rootProjection) continue;
    try { const f = await tree.resolve(row.id); if (f.parentId === parent.id || parent.id === 'root' && f.parentId === 'hq') output.push(f); }
    catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
  }
  if (['root','hq'].includes(parent.id)) {
    for (const [key] of HQ_DEFAULTS) {
      if (rows.some(r => libraryMetadata(r).folderKey === key)) continue;
      try { output.push(await tree.resolve(`hq-default:${key}`)); } catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
    }
    for (const f of output) if (f.parentId === 'hq') f.group = '본원 작업물';
    output.sort((a,b) => {
      const order = (f: LibraryFolder) => { const i = HQ_DEFAULTS.findIndex(d => d[0] === (libraryMetadata(f.row || {}).folderKey || f.id.split(':')[1])); return i < 0 ? 10 : i; };
      return order(a) - order(b);
    });
  }
  if (parent.id === 'root') {
    // Retire only this known legacy acceptance projection, not its campus, files or access policy.
    // Its three trashed file objects lack test-only provenance and must remain restorable.
    for (const campus of tree.campuses) {
      if (campus.id === 'campus-synthetic-acceptance-20260909') continue;
      output.push(await tree.resolve(`campus:${campus.id}`));
    }
  }
  if (parent.id.startsWith('campus:') || parent.id === 'organization') {
    for (const [key] of LIBRARY_CATEGORIES) {
      try { output.unshift(await tree.resolve(`category:${parent.campusId || 'organization'}:${key}`)); }
      catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
    }
    const rank = (f: LibraryFolder) => f.virtual ? LIBRARY_CATEGORIES.findIndex(c => c[0] === f.category) : 99;
    output.sort((a,b) => rank(a) - rank(b));
  }
  return output;
}

async function materialize(tree: LibraryTree, folder: LibraryFolder) {
  if (folder.row || !folder.virtual) return folder;
  if (!folder.category) error(400, '파일을 저장할 폴더를 먼저 선택하세요.');
  requireLibraryWrite(tree.context, folder);
  const hq = folder.id.startsWith('hq-default:');
  const now = new Date().toISOString();
  const metadata = hq ? { folderKey: folder.id.split(':')[1], system: true, libraryShareMode: folder.shareMode } :
    { schemaVersion: 1, rootProjection: true, parentFolderId: folder.parentId, category: folder.category,
      campusId: folder.campusId, libraryScope: folder.campusId ? 'campus' : 'hq', libraryShareMode: folder.shareMode };
  await tree.db.prepare(`INSERT INTO data_records (id, organization_id, campus_id, created_by_user_id, record_type, source_app,
    title, visibility, status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(folder.id, ORG, folder.campusId, tree.context.user!.internalUserId, hq ? HQ_FOLDER : LIBRARY_FOLDER,
      LIBRARY_SOURCE, folder.title, hq && folder.shareMode === 'restricted' ? 'private' : folder.campusId ? 'campus' : 'organization', JSON.stringify(metadata), now, now).run();
  tree.rows.delete(folder.id); tree.folders.delete(folder.id);
  if (!await tree.row(folder.id)) error(409, '폴더 상태가 변경되었습니다.');
  return tree.resolve(folder.id);
}

async function createFolder(tree: LibraryTree, input: Record<string, unknown>) {
  const parent = await tree.resolve(text(input.parentFolderId) || 'root');
  requireLibraryWrite(tree.context, parent);
  if (parent.id === 'root' && !tree.context.isSuperAdmin) error(403, '최상위 폴더는 마스터 관리자만 만들 수 있습니다.');
  if (parent.depth >= 14) error(400, '폴더 위치 또는 깊이를 확인하세요.');
  const title = text(input.title);
  if (!title || [...title].length > 80 || /[\u0000-\u001f]/.test(title)) error(400, '폴더 이름은 1~80자로 입력하세요.');
  if ((await children(tree, parent)).some(f => f.title.normalize('NFC') === title.normalize('NFC'))) error(409, '같은 이름의 폴더가 있습니다.');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const metadata = { schemaVersion: 1, parentFolderId: parent.id === 'root' ? null : parent.id, campusId: parent.campusId,
    libraryScope: libraryFolderScope(parent), category: parent.category || (parent.id === 'hq' ? 'hq-workspace' : 'library-material'),
    libraryShareMode: parent.shareMode, systemManaged: false,
    ...(parent.id === 'root' ? { createdFrom: 'library-root' } : {}),
    ...(title.startsWith('__synthetic_') || libraryMetadata(parent.row || {}).testOnly === true ? { testOnly: true } : {}) };
  const result = await tree.db.prepare(`INSERT INTO data_records (id, organization_id, campus_id, created_by_user_id,
    record_type, source_app, title, visibility, status, metadata_json, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ? WHERE ? = 1 OR EXISTS
      (SELECT 1 FROM data_records WHERE id = ? AND organization_id = ? AND deleted_at IS NULL)`)
    .bind(id, ORG, parent.campusId, tree.context.user!.internalUserId, LIBRARY_FOLDER, LIBRARY_SOURCE, title,
      parent.campusId ? 'campus' : 'organization', JSON.stringify(metadata), now, now, parent.virtual ? 1 : 0, parent.id, ORG).run();
  if (Number(result.meta?.changes) !== 1) error(409, '상위 폴더 상태가 변경되었습니다.');
  const folder = await tree.resolve(id);
  await audit(tree, 'create', folder);
  return serialize(tree, folder);
}

async function deleteFolder(tree: LibraryTree, id: string) {
  const folder = await tree.resolve(id);
  requireLibraryWrite(tree.context, folder);
  if (!libraryCanDeleteFolder(tree.context, folder)) error(403, '이 폴더는 삭제할 수 없습니다.');
  const now = new Date().toISOString();
  // Include trashed files: a later Operations restore must never lose its folder.
  const result = await tree.db.prepare(`UPDATE data_records SET deleted_at = ?, updated_at = ?, status = 'deleted'
    WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM file_objects WHERE data_record_id = ?)
    AND NOT EXISTS (SELECT 1 FROM data_records WHERE organization_id = ? AND deleted_at IS NULL
      AND CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.parentFolderId') END = ?)`)
    .bind(now, now, id, ORG, id, ORG, id).run();
  if (Number(result.meta?.changes) !== 1) error(409, '폴더 안에 자료가 있습니다. 내부 자료를 먼저 정리해주세요.');
  await audit(tree, 'delete', folder);
  return { ok: true, id, deletedAt: now };
}

async function fileFolder(tree: LibraryTree, row: Record<string, any>) {
  if (row.data_record_id) {
    const record = await tree.row(row.data_record_id);
    if (record && [HQ_FOLDER, LIBRARY_FOLDER].includes(record.record_type)) return tree.resolve(record.id);
    if (record && /family|kkumeum/i.test(`${record.record_type} ${record.source_app}`)) error(403, '자료보관함 파일이 아닙니다.');
  }
  if (row.source_app === LIBRARY_SOURCE || row.category === 'hq-workspace') error(403, '원본 폴더를 확인할 수 없습니다.');
  if (!LIBRARY_CATEGORIES.some(c => c[0] === row.category)) error(403, '자료보관함 파일이 아닙니다.');
  return tree.resolve(`category:${row.campus_id || 'organization'}:${row.category}`);
}

async function fileRow(tree: LibraryTree, id: string) {
  const row = await tree.db.prepare('SELECT * FROM file_objects WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
    .bind(id, ORG).first<Record<string, any>>();
  if (!row) error(404, '파일을 찾을 수 없습니다.');
  const folder = await fileFolder(tree, row);
  if (!libraryFileReadable(tree.context, folder, row)) error(403, '이 파일을 볼 권한이 없습니다.');
  return { row, folder };
}

async function listFiles(tree: LibraryTree, folder: LibraryFolder, url: URL) {
  if (!folder.category) return { files: [], hasMore: false };
  const q = text(url.searchParams.get('q')).slice(0,120), page = Math.max(1, Math.min(100000, Number(url.searchParams.get('page')) || 1));
  const legacy = folder.id.startsWith('category:');
  const rows = (await tree.db.prepare(`SELECT fo.*, u.display_name AS owner_name FROM file_objects fo LEFT JOIN users u ON u.id = fo.owner_user_id
    WHERE fo.organization_id = ? AND fo.campus_id IS ? AND fo.category = ? AND fo.deleted_at IS NULL
    AND (fo.data_record_id = ? OR (? = 1 AND NOT EXISTS (SELECT 1 FROM data_records dr WHERE dr.id = fo.data_record_id AND dr.record_type IN (?, ?))))
    AND fo.original_file_name LIKE ? ESCAPE '\\' ORDER BY fo.created_at DESC, fo.id LIMIT 51 OFFSET ?`)
    .bind(ORG, folder.campusId, folder.category, folder.id, legacy ? 1 : 0, LIBRARY_FOLDER, HQ_FOLDER,
      `%${q.replace(/[\\%_]/g, '\\$&')}%`, (Math.floor(page)-1)*50).all<Record<string, any>>()).results || [];
  const files = [];
  for (const row of rows.slice(0,50)) {
    try {
      const sourceFolder = await fileFolder(tree, row);
      if (sourceFolder.id !== folder.id || !libraryFileReadable(tree.context, sourceFolder, row)) continue;
      files.push({ id: row.id, fileName: row.original_file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes,
        createdAt: row.created_at, campusId: row.campus_id, ownerName: row.owner_name, recordId: row.data_record_id,
        canDelete: libraryCanDelete(tree.context, folder, row.owner_user_id),
        previewUrl: `/api/data-core/library/files/${encodeURIComponent(row.id)}`,
        downloadUrl: `/api/data-core/library/files/${encodeURIComponent(row.id)}/download` });
    } catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
  }
  return { files, hasMore: rows.length > 50 };
}

export async function handleLibraryApi(request: Request, db: D1Database, bucket: R2Bucket, context: DataCoreAccessContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/data-core/library/')) return null;
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin) error(403, '동일 출처 요청만 허용됩니다.');
  const tree = await new LibraryTree(db, context).init();
  if (url.pathname === '/api/data-core/library/folders' && request.method === 'GET') {
    const folder = await tree.resolve(text(url.searchParams.get('parentId')) || 'root');
    return json({ folder: serialize(tree, folder), breadcrumbs: await tree.breadcrumbs(folder), folders: (await children(tree, folder)).map(f => serialize(tree, f)) });
  }
  if (url.pathname === '/api/data-core/library/folders' && request.method === 'POST') {
    let input; try { input = await request.json(); } catch { error(400, 'JSON 요청을 확인하세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '폴더 요청을 확인하세요.');
    return json({ folder: await createFolder(tree, input as Record<string, unknown>) }, 201);
  }
  const folderMatch = /^\/api\/data-core\/library\/folders\/([^/]+)$/.exec(url.pathname);
  if (folderMatch && request.method === 'DELETE') return json(await deleteFolder(tree, decodeURIComponent(folderMatch[1])));
  if (url.pathname === '/api/data-core/library/files' && request.method === 'GET') return json(await listFiles(tree,
    await tree.resolve(text(url.searchParams.get('folderId')) || 'root'), url));
  if (url.pathname === '/api/data-core/library/files' && request.method === 'POST') {
    const form = await request.formData();
    let folder = await tree.resolve(text(form.get('recordId')));
    requireLibraryWrite(context, folder);
    folder = await materialize(tree, folder);
    form.set('recordId', folder.id); form.set('campusId', folder.campusId || ''); form.set('category', folder.category!);
    form.set('sourceApp', LIBRARY_SOURCE); form.set('ownerId', 'shared');
    const canonical = new Request(new URL('/api/data-core/files', url), { method: 'POST', headers: { origin: url.origin }, body: form });
    return json({ file: await uploadDataCoreFile(canonical, db, bucket, context) }, 201);
  }
  const match = /^\/api\/data-core\/library\/files\/([^/]+)(\/download)?$/.exec(url.pathname);
  if (match) {
    const { row, folder } = await fileRow(tree, decodeURIComponent(match[1]));
    if (request.method === 'DELETE' && !match[2]) {
      requireLibraryWrite(context, folder);
      if (!libraryCanDelete(context, folder, row.owner_user_id)) error(403, '이 파일은 삭제할 수 없습니다.');
      return json(await deleteDataCoreFile(db, bucket, context, row.id, undefined, true));
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await bucket.get(row.r2_key);
      if (!object) error(404, '원본 파일을 찾을 수 없습니다.');
      const preview = /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf|text\/plain)$/.test(row.mime_type);
      const disposition = match[2] || !preview ? 'attachment' : 'inline';
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
        'content-type': preview ? row.mime_type : 'application/octet-stream', 'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_file_name || 'file')}`,
      } });
    }
  }
  return json({ error: '지원하지 않는 자료보관함 요청입니다.' }, 405);
}

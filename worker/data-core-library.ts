import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError } from './data-core-access';
import { uploadDataCoreFile, deleteDataCoreFile } from './data-core-files';
import { THUMBNAIL_CATEGORY, thumbnailSource } from './data-core-derivative-policy';
import { createLibraryThumbnail, thumbnailUrls } from './data-core-thumbnails';
import { privateImageResponse } from './private-image-response';
import { instagramPreserveReason } from '../public/data-core/instagram-source-policy.js';
import { isSelectableCampus } from './campus-directory';
import { LibraryTree, LibraryFolder, LIBRARY_FOLDER, HQ_FOLDER, LIBRARY_SOURCE, LIBRARY_CATEGORIES, HQ_DEFAULTS,
  libraryMetadata, libraryCanWrite, libraryCanDelete, libraryCanDeleteFolder, libraryDefaultFolder, libraryFolderScope, requireLibraryWrite, libraryFileReadable } from './data-core-library-policy';
import { SIMPLE_UPLOAD_MAX_BYTES, startLibraryMultipartUpload, uploadLibraryMultipartPart,
  completeLibraryMultipartUpload, abortLibraryMultipartUpload, parseUploadedParts } from './data-core-library-multipart';

function error(status: number, message: string): never { throw new DataCoreAccessError(status, message); }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const OPAQUE_PREVIEW_EXTENSIONS = new Set(['ai','psd','psb','clip','eps','zip']);
const RECENT_UPLOAD_LIMIT = 50;
const RECENT_UPLOAD_SCAN_LIMIT = 200;
// Only categories a library folder can ever resolve to (see LibraryTree/fileFolder); keeps the
// recent-uploads scan from touching unrelated features' file_objects rows (admissions, kkumeum, etc).
const LIBRARY_FILE_CATEGORIES = [...LIBRARY_CATEGORIES.map(c => c[0]), 'hq-workspace'];
const fileExtension = (name: unknown) => { const value = text(name).toLowerCase(), index = value.lastIndexOf('.'); return index >= 0 ? value.slice(index + 1) : ''; };
const previewableFile = (row: Record<string, any>) => !OPAQUE_PREVIEW_EXTENSIONS.has(fileExtension(row.original_file_name)) &&
  /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf|text\/plain)$/.test(String(row.mime_type || ''));
const serialize = (tree: LibraryTree, f: LibraryFolder) => ({ id: f.id, title: f.title, parentId: f.parentId,
  campusId: f.campusId, category: f.category, group: f.group, navigationHidden: Boolean(f.navigationHidden), canWrite: libraryCanWrite(tree.context, f),
  systemManaged: Boolean(f.systemManaged), canDelete: libraryCanDeleteFolder(tree.context, f),
  canRename: libraryCanDeleteFolder(tree.context, f),
  defaultFolder: libraryDefaultFolder(f), archived: Boolean(f.archived),
  canRestore: Boolean(f.archived && libraryDefaultFolder(f) && libraryCanWrite(tree.context, { ...f, archived: false })),
  readOnly: !libraryCanWrite(tree.context, f) });

async function audit(tree: LibraryTree, action: string, folder: LibraryFolder) {
  await tree.db.prepare(`INSERT INTO audit_logs (id, organization_id, campus_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'data_record', ?, '{}', ?)`).bind(crypto.randomUUID(), ORG, folder.campusId,
    tree.context.user!.internalUserId, action, folder.id, new Date().toISOString()).run();
}

async function children(tree: LibraryTree, parent: LibraryFolder, includeArchived = false) {
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
      if (!isSelectableCampus(campus.id)) continue;
      output.push(await tree.resolve(`campus:${campus.id}`));
    }
  }
  if (parent.id.startsWith('campus:') || parent.id === 'organization') {
    // Batch absent projections, including malformed legacy rows so validation
    // still rejects them rather than silently replacing them with virtual roots.
    const missing=LIBRARY_CATEGORIES.map(([key])=>`category:${parent.campusId || 'organization'}:${key}`).filter(id=>!tree.rows.has(id));
    if(missing.length){
      const stored=(await tree.db.prepare(`SELECT * FROM data_records WHERE organization_id=? AND deleted_at IS NULL AND id IN (${missing.map(()=>'?').join(',')})`).bind(ORG,...missing).all<Record<string,unknown>>()).results||[];
      for(const id of missing)tree.rows.set(id,stored.find(row=>row.id===id)||null);
    }
    for (const [key] of LIBRARY_CATEGORIES) {
      try { output.unshift(await tree.resolve(`category:${parent.campusId || 'organization'}:${key}`)); }
      catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
    }
    const rank = (f: LibraryFolder) => f.virtual ? LIBRARY_CATEGORIES.findIndex(c => c[0] === f.category) : 99;
    output.sort((a,b) => rank(a) - rank(b));
  }
  return output.filter(f => includeArchived || !f.archived);
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
  let folder = await tree.resolve(id);
  requireLibraryWrite(tree.context, folder);
  if (!libraryCanDeleteFolder(tree.context, folder)) error(403, '이 폴더는 삭제할 수 없습니다.');
  const now = new Date().toISOString();
  if ((await children(tree, folder)).length) error(409, '하위 폴더를 먼저 정리해주세요. 원본 파일은 삭제되지 않습니다.');
  if (libraryDefaultFolder(folder)) {
    folder = await materialize(tree, folder);
    // Retain the canonical authorization anchor and every file link, including legacy/trash.
    const result = await tree.db.prepare(`UPDATE data_records SET metadata_json = json_set(metadata_json, '$.libraryArchived', json('true')), updated_at = ?
      WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM data_records child WHERE child.organization_id = ? AND child.deleted_at IS NULL
        AND CASE WHEN json_valid(child.metadata_json) THEN json_extract(child.metadata_json, '$.parentFolderId') END = ?)
      AND NOT EXISTS (SELECT 1 FROM data_records upload WHERE upload.organization_id = ? AND upload.record_type = 'library-upload-session'
        AND upload.status IN ('pending','uploading','failed') AND upload.deleted_at IS NULL
        AND CASE WHEN json_valid(upload.metadata_json) THEN json_extract(upload.metadata_json, '$.folderId') END = ?)`)
      .bind(now, id, ORG, ORG, id, ORG, id).run();
    if (Number(result.meta?.changes) !== 1) error(409, '하위 폴더 또는 진행 중인 업로드를 먼저 정리해주세요.');
    await audit(tree, 'archive', folder);
    return { ok: true, id, archived: true, destinationFolderId: folder.parentId };
  }
  const linked = await tree.db.prepare('SELECT COUNT(*) AS n FROM file_objects WHERE data_record_id = ? AND organization_id = ?').bind(id, ORG).first<{n:number}>();
  let destination: LibraryFolder | null = null;
  if (linked?.n) {
    const parent = await tree.resolve(folder.parentId!);
    destination = parent.category === folder.category ? parent : await tree.resolve(folder.category === 'hq-workspace' ? 'hq-default:resources' : `category:${folder.campusId || 'organization'}:${folder.category}`);
    if (destination.archived) error(409, '파일을 보존할 기본 폴더를 먼저 복원해주세요.');
    if (destination.shareMode !== folder.shareMode || destination.campusId !== folder.campusId || Boolean(destination.protected) !== Boolean(folder.protected)) error(409, '보호 범위가 같은 폴더로 파일을 먼저 이동해주세요.');
    destination = await materialize(tree, destination);
  }
  // Atomic soft-delete and relink, including trashed files so a later restore remains valid.
  const guard = `id = ? AND organization_id = ? AND deleted_at IS NULL AND NOT EXISTS
    (SELECT 1 FROM data_records child WHERE child.organization_id = ? AND child.deleted_at IS NULL
      AND CASE WHEN json_valid(child.metadata_json) THEN json_extract(child.metadata_json, '$.parentFolderId') END = ?)
    AND NOT EXISTS (SELECT 1 FROM data_records upload WHERE upload.organization_id = ? AND upload.record_type = 'library-upload-session'
      AND upload.status IN ('pending','uploading','failed') AND upload.deleted_at IS NULL
      AND CASE WHEN json_valid(upload.metadata_json) THEN json_extract(upload.metadata_json, '$.folderId') END = ?)`;
  const statements = [];
  if (destination) statements.push(tree.db.prepare(`UPDATE file_objects SET data_record_id = ? WHERE data_record_id = ? AND organization_id = ?
    AND EXISTS (SELECT 1 FROM data_records WHERE ${guard})
    AND EXISTS (SELECT 1 FROM data_records WHERE id = ? AND organization_id = ? AND deleted_at IS NULL)`)
    .bind(destination.id, id, ORG, id, ORG, ORG, id, ORG, id, destination.id, ORG));
  statements.push(tree.db.prepare(`UPDATE data_records SET deleted_at = ?, updated_at = ?, status = 'deleted'
    WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM file_objects WHERE data_record_id = ? AND organization_id = ?)`)
    .bind(now, now, id, ORG, ORG, id, ORG, id, id, ORG));
  const result = await tree.db.batch(statements);
  if (Number(result.at(-1)?.meta?.changes) !== 1) error(409, '폴더 상태가 변경되었습니다. 다시 확인해주세요.');
  await audit(tree, 'delete', folder);
  return { ok: true, id, deletedAt: now, destinationFolderId: destination?.id || folder.parentId };
}

async function renameFolder(tree: LibraryTree, id: string, input: Record<string, unknown>) {
  let folder = await tree.resolve(id);
  if (input.restore === true) {
    if (!folder.archived || !libraryDefaultFolder(folder)) error(400, '복원할 기본 폴더가 아닙니다.');
    requireLibraryWrite(tree.context, { ...folder, archived: false });
    if ((await children(tree, await tree.resolve(folder.parentId!))).some(f => f.id !== id && f.title.normalize('NFC') === folder.title.normalize('NFC'))) error(409, '같은 이름의 폴더가 있습니다. 해당 폴더 이름을 먼저 변경해주세요.');
    await tree.db.prepare(`UPDATE data_records SET metadata_json = json_remove(metadata_json, '$.libraryArchived'), updated_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`)
      .bind(new Date().toISOString(), id, ORG).run();
    await audit(tree, 'restore', folder);
    return { ok: true, id, restored: true };
  }
  requireLibraryWrite(tree.context, folder);
  if (!libraryCanDeleteFolder(tree.context, folder)) error(403, '기본 폴더의 이름은 변경할 수 없습니다.');
  const title = text(input.title);
  if (!title || [...title].length > 80 || [...title].some(c => c.charCodeAt(0) < 32)) error(400, '폴더 이름은 1~80자로 입력하세요.');
  if ((await children(tree, await tree.resolve(folder.parentId!))).some(f => f.id !== id && f.title.normalize('NFC') === title.normalize('NFC'))) error(409, '같은 이름의 폴더가 있습니다.');
  folder = await materialize(tree, folder);
  const result = await tree.db.prepare('UPDATE data_records SET title = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
    .bind(title, new Date().toISOString(), id, ORG).run();
  if (Number(result.meta?.changes) !== 1) error(409, '폴더 상태가 변경되었습니다.');
  await audit(tree, 'rename', folder);
  return { ok: true, id, title };
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
  const source = row.category === THUMBNAIL_CATEGORY ? await thumbnailSource(tree.db,row) : row;
  if (!source) error(403,'원본 파일을 확인할 수 없습니다.');
  const folder = await fileFolder(tree, source);
  if (!libraryFileReadable(tree.context, folder, source)) error(403, '이 파일을 볼 권한이 없습니다.');
  return { row, folder, source };
}

async function listFiles(tree: LibraryTree, folder: LibraryFolder, url: URL) {
  if (!folder.category) return { files: [], hasMore: false, navigationHidden: Boolean(folder.navigationHidden) };
  const q = text(url.searchParams.get('q')).slice(0,120), page = Math.max(1, Math.min(100000, Number(url.searchParams.get('page')) || 1));
  const legacy = folder.id.startsWith('category:');
  const files = [], visible:Record<string,any>[] = [];
  const skip=(Math.floor(page)-1)*50;let accepted=0,hasMore=false,cursor:{created_at:string;id:string}|null=null;
  while(!hasMore){
  const rows:Record<string,any>[] = (await tree.db.prepare(`SELECT fo.*, u.display_name AS owner_name FROM file_objects fo LEFT JOIN users u ON u.id = fo.owner_user_id
    WHERE fo.organization_id = ? AND fo.campus_id IS ? AND fo.category = ? AND fo.deleted_at IS NULL
    AND (fo.data_record_id = ? OR (? = 1 AND NOT EXISTS (SELECT 1 FROM data_records dr WHERE dr.id = fo.data_record_id AND dr.record_type IN (?, ?))))
    AND fo.original_file_name LIKE ? ESCAPE '\\' ${cursor?'AND (fo.created_at < ? OR (fo.created_at = ? AND fo.id > ?))':''} ORDER BY fo.created_at DESC, fo.id LIMIT 100`)
    .bind(ORG, folder.campusId, folder.category, folder.id, legacy ? 1 : 0, LIBRARY_FOLDER, HQ_FOLDER,
      `%${q.replace(/[\\%_]/g, '\\$&')}%`,...(cursor?[cursor.created_at,cursor.created_at,cursor.id]:[])).all<Record<string, any>>()).results || [];
  for (const row of rows) {
    try {
      const sourceFolder = await fileFolder(tree, row);
      if (sourceFolder.id !== folder.id || !libraryFileReadable(tree.context, sourceFolder, row)) continue;
      if(accepted++<skip)continue;
      if(files.length===50){hasMore=true;break;}
      visible.push(row);
      files.push({ id: row.id, fileName: row.original_file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes,
        instagramPreserveReason: instagramPreserveReason({...row, protected:sourceFolder.protected, shareMode:sourceFolder.shareMode}),
        createdAt: row.created_at, campusId: row.campus_id, ownerName: row.owner_name, recordId: row.data_record_id,
        canDelete: libraryCanDelete(tree.context, folder, row.owner_user_id),
        canMove: libraryCanWrite(tree.context, folder),
        previewUrl: `/api/data-core/library/files/${encodeURIComponent(row.id)}`,
        downloadUrl: `/api/data-core/library/files/${encodeURIComponent(row.id)}/download` });
    } catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
  }
  if(rows.length<100)break;
  const last=rows.at(-1)!;cursor={created_at:last.created_at,id:last.id};
  }
  const thumbnails = await thumbnailUrls(tree.db,visible,'/api/data-core/library/files/');
  return { files:files.map(file=>({...file,thumbnailUrl:thumbnails.get(file.id) || null})), hasMore, navigationHidden: Boolean(folder.navigationHidden) };
}

async function recentFiles(tree: LibraryTree, folder: LibraryFolder) {
  const placeholders = LIBRARY_FILE_CATEGORIES.map(() => '?').join(',');
  const campusNames = new Map(tree.campuses.map(c => [c.id, c.name]));
  const files: Record<string, unknown>[] = [];
  const visible:Record<string,unknown>[] = [];
  let cursor: {time:string; id:string} | null = null;
  // Keyset scan ensures protected rows cannot crowd eligible uploads out of the top 50.
  while (files.length < RECENT_UPLOAD_LIMIT) {
    const values:(string | number | null)[] = [ORG, ...LIBRARY_FILE_CATEGORIES];
    if (folder.campusId) values.push(folder.campusId);
    if (cursor) values.push(cursor.time, cursor.time, cursor.id);
    const rows:Record<string,unknown>[] = (await tree.db.prepare(`SELECT * FROM file_objects WHERE organization_id = ? AND deleted_at IS NULL
      AND category IN (${placeholders}) AND visibility IN ('campus','organization','public') AND area IN ('documents-private','academy-public')
      ${folder.campusId ? 'AND campus_id = ?' : ''} ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ${RECENT_UPLOAD_SCAN_LIMIT}`).bind(...values).all<Record<string,unknown>>()).results || [];
    for (const row of rows) {
    if (files.length >= RECENT_UPLOAD_LIMIT) break;
    try {
      const sourceFolder = await fileFolder(tree, row);
      if (sourceFolder.navigationHidden || sourceFolder.protected || sourceFolder.shareMode === 'restricted' || sourceFolder.category === 'student-artwork' || sourceFolder.category === 'counseling-material') continue;
      if (!libraryFileReadable(tree.context, sourceFolder, row)) continue;
      visible.push(row);
      files.push({ id: row.id, fileName: row.original_file_name, folderId: sourceFolder.id, folderTitle: sourceFolder.title,
        instagramPreserveReason: instagramPreserveReason(row),
        campusId: row.campus_id, campusName: row.campus_id ? campusNames.get(row.campus_id) || null : null,
        mimeType: row.mime_type, sizeBytes: row.size_bytes, createdAt: row.created_at,
        canDelete: libraryCanDelete(tree.context, sourceFolder, row.owner_user_id), canMove: libraryCanWrite(tree.context, sourceFolder),
        previewUrl: `/api/data-core/library/files/${encodeURIComponent(String(row.id))}`,
        downloadUrl: `/api/data-core/library/files/${encodeURIComponent(String(row.id))}/download` });
    } catch (e) { if (!(e instanceof DataCoreAccessError)) throw e; }
    }
    if (rows.length < RECENT_UPLOAD_SCAN_LIMIT) break;
    const last = rows.at(-1)!; cursor = {time:String(last.created_at), id:String(last.id)};
  }
  const thumbnails = await thumbnailUrls(tree.db, visible, '/api/data-core/library/files/');
  return { files: files.map(f => ({...f, thumbnailUrl:thumbnails.get(String(f.id)) || null})), limit: RECENT_UPLOAD_LIMIT };
}

async function moveFile(tree: LibraryTree, id: string, input: Record<string,unknown>) {
  const {row, folder, source} = await fileRow(tree, id);
  requireLibraryWrite(tree.context, folder);
  if (source.id !== row.id) error(403, '파생 파일은 원본과 함께 관리됩니다.');
  let target = await tree.resolve(text(input.folderId));
  requireLibraryWrite(tree.context, target);
  // Relocation never changes campus, visibility, owner or original R2 bytes.
  const general = (f:LibraryFolder) => !f.protected && Boolean(f.category) && !['student-artwork','counseling-material'].includes(f.category!) &&
    (f.shareMode === 'organization' || f.category === 'class-photo' && Boolean(f.campusId));
  const samePolicy = target.shareMode === folder.shareMode && target.category === folder.category && Boolean(target.protected) === Boolean(folder.protected);
  const generalMove = general(folder) && general(target) && ['campus','organization','public'].includes(row.visibility) && ['documents-private','academy-public'].includes(row.area);
  if (target.campusId !== folder.campusId || !samePolicy && !generalMove) error(400, '같은 캠퍼스와 보호 범위의 폴더를 선택해주세요.');
  target = await materialize(tree, target);
  const changed = await tree.db.prepare(`UPDATE file_objects SET data_record_id = ?, category = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
    AND data_record_id IS ? AND EXISTS (SELECT 1 FROM data_records WHERE id = ? AND organization_id = ? AND deleted_at IS NULL)`)
    .bind(target.id, target.category, id, ORG, row.data_record_id, target.id, ORG).run();
  if (Number(changed.meta?.changes) !== 1) error(409, '파일 또는 폴더 상태가 변경되었습니다.');
  await audit(tree, 'move-file', target);
  return {ok:true, id, folderId:target.id};
}

async function fileCounts(tree:LibraryTree, folders:LibraryFolder[]) {
  const counts = new Map<string,number>();
  if (!folders.length) return counts;
  // Count metadata groups, never list R2 objects or fetch file bytes.
  const ids=folders.map(f=>f.id), legacy=folders.filter(f=>f.id.startsWith('category:')).map(f=>f.category!);
  const linked = "dr.record_type IN ('library-folder','hq-library-folder')";
  const effective = `CASE WHEN ${linked} THEN fo.data_record_id END`;
  const rows = (await tree.db.prepare(`SELECT ${effective} AS data_record_id, fo.campus_id, fo.category, fo.source_app,
    fo.visibility, fo.area, fo.owner_user_id, fo.organization_id, COUNT(*) AS n
    FROM file_objects fo LEFT JOIN data_records dr ON dr.id = fo.data_record_id
    WHERE fo.organization_id = ? AND fo.campus_id IS ? AND fo.deleted_at IS NULL
    AND (fo.data_record_id IN (${ids.map(()=>'?').join(',')}) ${legacy.length ? `OR (fo.category IN (${legacy.map(()=>'?').join(',')}) AND (${linked}) IS NOT TRUE)` : ''})
    AND fo.source_app NOT LIKE '%family%' AND fo.source_app NOT LIKE '%kkumeum%' AND fo.r2_key NOT LIKE 'family/%' AND fo.r2_key NOT LIKE 'kkumeum/%'
    AND COALESCE(dr.record_type,'') NOT LIKE '%family%' AND COALESCE(dr.record_type,'') NOT LIKE '%kkumeum%'
    AND COALESCE(dr.source_app,'') NOT LIKE '%family%' AND COALESCE(dr.source_app,'') NOT LIKE '%kkumeum%'
    GROUP BY ${effective}, fo.campus_id, fo.category, fo.source_app, fo.visibility, fo.area, fo.owner_user_id`)
    .bind(ORG, folders[0].campusId, ...ids, ...legacy).all<Record<string,unknown>>()).results || [];
  const wanted = new Set(folders.map(f => f.id));
  for (const row of rows) {
    try { const f = await fileFolder(tree, row); if (wanted.has(f.id) && libraryFileReadable(tree.context,f,row)) counts.set(f.id,(counts.get(f.id)||0)+Number(row.n)); }
    catch(e) { if (!(e instanceof DataCoreAccessError)) throw e; }
  }
  return counts;
}

export async function handleLibraryApi(request: Request, db: D1Database, bucket: R2Bucket, context: DataCoreAccessContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/data-core/library/')) return null;
  if (!['GET','HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) error(403, '동일 출처 요청만 허용됩니다.');
  const tree = await new LibraryTree(db, context).init();
  if (url.pathname === '/api/data-core/library/folders' && request.method === 'GET') {
    const folder = await tree.resolve(text(url.searchParams.get('parentId')) || 'root');
    // Hide HQ entry points only; retain stored folders, files and authorized legacy deep links.
    const archived = url.searchParams.get('archived') === '1';
    if (archived) requireLibraryWrite(tree.context, folder);
    const folders = (await children(tree, folder, archived)).filter(f => (folder.id !== 'root' || !f.navigationHidden) && (!archived || f.archived));
    const includeCounts = url.searchParams.get('counts') !== '0';
    const counts = includeCounts ? await fileCounts(tree, folders.filter(f => f.category)) : new Map<string,number>();
    return json({ folder: serialize(tree, folder), breadcrumbs: await tree.breadcrumbs(folder), folders: folders.map(f => ({...serialize(tree, f), fileCount: f.category && includeCounts ? counts.get(f.id) || 0 : null})) });
  }
  if (url.pathname === '/api/data-core/library/folders' && request.method === 'POST') {
    let input; try { input = await request.json(); } catch { error(400, 'JSON 요청을 확인하세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '폴더 요청을 확인하세요.');
    return json({ folder: await createFolder(tree, input as Record<string, unknown>) }, 201);
  }
  const folderMatch = /^\/api\/data-core\/library\/folders\/([^/]+)$/.exec(url.pathname);
  if (folderMatch && request.method === 'DELETE') return json(await deleteFolder(tree, decodeURIComponent(folderMatch[1])));
  if (folderMatch && request.method === 'PATCH') {
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '폴더 요청을 확인하세요.');
    return json(await renameFolder(tree, decodeURIComponent(folderMatch[1]), input as Record<string,unknown>));
  }

  if (url.pathname === '/api/data-core/library/recent' && request.method === 'GET') {
    const folder = await tree.resolve(text(url.searchParams.get('folderId')) || 'root');
    return json(await recentFiles(tree, folder));
  }

  if (url.pathname === '/api/data-core/library/uploads' && request.method === 'POST') {
    let input; try { input = await request.json(); } catch { error(400, '업로드 요청을 확인하세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '업로드 요청을 확인하세요.');
    let folder = await tree.resolve(text((input as Record<string, unknown>).folderId));
    requireLibraryWrite(context, folder);
    folder = await materialize(tree, folder);
    return json(await startLibraryMultipartUpload(db, bucket, context, folder, input as Record<string, unknown>), 201);
  }
  const partMatch = /^\/api\/data-core\/library\/uploads\/([^/]+)\/parts\/([1-9][0-9]*)$/.exec(url.pathname);
  if (partMatch && request.method === 'PUT') return json(await uploadLibraryMultipartPart(request, db, bucket, tree, context,
    decodeURIComponent(partMatch[1]), Number(partMatch[2])));
  const completeMatch = /^\/api\/data-core\/library\/uploads\/([^/]+)\/complete$/.exec(url.pathname);
  if (completeMatch && request.method === 'POST') {
    let input; try { input = await request.json(); } catch { error(400, '업로드 완료 요청을 확인하세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '업로드 완료 요청을 확인하세요.');
    return json(await completeLibraryMultipartUpload(db, bucket, tree, context, decodeURIComponent(completeMatch[1]),
      parseUploadedParts((input as Record<string, unknown>).parts)));
  }
  const uploadMatch = /^\/api\/data-core\/library\/uploads\/([^/]+)$/.exec(url.pathname);
  if (uploadMatch && request.method === 'DELETE') return json(await abortLibraryMultipartUpload(db, bucket, tree, context,
    decodeURIComponent(uploadMatch[1])));

  if (url.pathname === '/api/data-core/library/files' && request.method === 'GET') return json(await listFiles(tree,
    await tree.resolve(text(url.searchParams.get('folderId')) || 'root'), url));
  if (url.pathname === '/api/data-core/library/files' && request.method === 'POST') {
    const declaredSize = Number(request.headers.get('x-data-core-file-size'));
    if (request.headers.has('x-data-core-file-size') && Number.isFinite(declaredSize) && declaredSize > SIMPLE_UPLOAD_MAX_BYTES) {
      error(413, '50MiB 초과 파일은 대용량 업로드로 전송해 주세요.');
    }
    const form = await request.formData();
    let folder = await tree.resolve(text(form.get('recordId')));
    requireLibraryWrite(context, folder);
    folder = await materialize(tree, folder);
    form.set('recordId', folder.id); form.set('campusId', folder.campusId || ''); form.set('category', folder.category!);
    form.set('sourceApp', LIBRARY_SOURCE); form.set('ownerId', 'shared');
    const canonical = new Request(new URL('/api/data-core/files', url), { method: 'POST', headers: { origin: url.origin } });
    return json({ file: await uploadDataCoreFile(canonical, db, bucket, context, form) }, 201);
  }
  const thumbnailMatch = /^\/api\/data-core\/library\/files\/([^/]+)\/thumbnail$/.exec(url.pathname);
  if (thumbnailMatch && request.method === 'POST') {
    const {row,folder}=await fileRow(tree,decodeURIComponent(thumbnailMatch[1]));
    requireLibraryWrite(context,folder);
    return json({file:await createLibraryThumbnail(request,db,bucket,context,row,async current=>{
      // Rebuild the ancestry after the R2 write; the request-local tree may be stale.
      const fresh=await new LibraryTree(db,context).init();
      try { const parent=await fileFolder(fresh,current); requireLibraryWrite(context,parent); return libraryFileReadable(context,parent,current); }
      catch(e) { if(e instanceof DataCoreAccessError)return false; throw e; }
    })},201);
  }
  const match = /^\/api\/data-core\/library\/files\/([^/]+)(\/download)?$/.exec(url.pathname);
  if (match) {
    if (request.method === 'PATCH' && !match[2]) {
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, '이동할 폴더를 확인하세요.');
      return json(await moveFile(tree, decodeURIComponent(match[1]), input as Record<string,unknown>));
    }
    const { row, folder, source } = await fileRow(tree, decodeURIComponent(match[1]));
    if (request.method === 'DELETE' && !match[2]) {
      requireLibraryWrite(context, folder);
      if (!libraryCanDelete(context, folder, row.owner_user_id)) error(403, '이 파일은 삭제할 수 없습니다.');
      return json(await deleteDataCoreFile(db, bucket, context, row.id, undefined, true));
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (row.category === THUMBNAIL_CATEGORY && !await bucket.head(source.r2_key)) error(404,'원본 파일을 찾을 수 없습니다.');
      const object = await bucket.get(row.r2_key);
      if (!object) error(404, '원본 파일을 찾을 수 없습니다.');
      const preview = previewableFile(row);
      const disposition = match[2] || !preview ? 'attachment' : 'inline';
      return privateImageResponse(request,object,new Headers({
        'content-type': preview ? row.mime_type : 'application/octet-stream', 'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.original_file_name || 'file')}`,
      }),row.mime_type,!match[2]);
    }
  }
  return json({ error: '지원하지 않는 자료보관함 요청입니다.' }, 405);
}

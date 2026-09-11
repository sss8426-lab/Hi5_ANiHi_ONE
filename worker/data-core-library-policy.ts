import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess, requireCampusAccess, managesCampus } from './data-core-access';
import { canReadBaseFile } from './data-core-derivative-policy';

export const LIBRARY_FOLDER = 'library-folder';
export const HQ_FOLDER = 'hq-library-folder';
export const LIBRARY_SOURCE = 'data-core-library';
export const LIBRARY_CATEGORIES = [
  ['class-photo', '수업사진'], ['student-artwork', '학생그림'], ['academy-photo', '학원사진'],
  ['competition-material', '공모전·실기대회'], ['admission-material', '입시자료'],
  ['counseling-material', '상담자료'], ['blog-source', '블로그소스'],
  ['instagram-source', '인스타소스'], ['promotion-material', '홍보자료'],
] as const;
export const HQ_DEFAULTS = [
  ['class-artwork', '수업그림'], ['director-only', '원장전용'], ['resources', '자료'], ['production', '제작물'],
] as const;
const PERSONAL_CATEGORIES = new Set(['student-artwork', 'class-photo', 'counseling-material']);
type Row = Record<string, any>;
export type LibraryFolder = {
  id: string; title: string; parentId: string | null; campusId: string | null;
  category: string | null; shareMode: 'organization' | 'campus' | 'restricted';
  virtual: boolean; depth: number; row?: Row; group?: string; systemManaged?: boolean;
};
function fail(status = 403, message = '이 자료보관함에 접근할 권한이 없습니다.'): never { throw new DataCoreAccessError(status, message); }
export function libraryMetadata(row: Row) {
  try { const m = JSON.parse(row.metadata_json || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; }
}
export function requireLibraryAccess(context: DataCoreAccessContext) { requireWriteAccess(context); }
export function libraryCanWrite(context: DataCoreAccessContext, folder: LibraryFolder) {
  return context.canWrite && (context.isSuperAdmin || Boolean(folder.campusId && context.campusIds.includes(folder.campusId)));
}
export function requireLibraryWrite(context: DataCoreAccessContext, folder: LibraryFolder) {
  requireLibraryAccess(context);
  if (!libraryCanWrite(context, folder)) fail();
  if (folder.campusId) requireCampusAccess(context, folder.campusId);
}
export function libraryCanDelete(context: DataCoreAccessContext, folder: LibraryFolder, owner: unknown) {
  return libraryCanWrite(context, folder) && (context.isSuperAdmin || managesCampus(context, folder.campusId) || context.user?.internalUserId === owner ||
    context.memberships.some(m => m.organizationId === ORG && m.campusId === folder.campusId && m.role === 'CAMPUS_DIRECTOR'));
}
export function libraryFolderScope(folder: LibraryFolder) {
  if (folder.campusId) return 'campus';
  return folder.id === 'root' || libraryMetadata(folder.row || {}).libraryScope === 'organization' ? 'organization' : 'hq';
}
export function libraryCanDeleteFolder(context: DataCoreAccessContext, folder: LibraryFolder) {
  return !folder.virtual && !folder.systemManaged && Boolean(folder.row) &&
    (folder.parentId !== 'root' || context.isSuperAdmin) && libraryCanDelete(context, folder, folder.row?.created_by_user_id);
}

/** Request-local cache; persisted metadata is checked through the entire ancestry. */
export class LibraryTree {
  rows = new Map<string, Row | null>();
  folders = new Map<string, LibraryFolder>();
  campuses: Row[] = [];
  constructor(public db: D1Database, public context: DataCoreAccessContext) {}
  async init() {
    requireLibraryAccess(this.context);
    this.campuses = (await this.db.prepare("SELECT id, code, name FROM campuses WHERE organization_id = ? AND status = 'active' ORDER BY name").bind(ORG).all<Row>()).results || [];
    return this;
  }
  async row(id: string) {
    if (!this.rows.has(id)) this.rows.set(id, await this.db.prepare('SELECT * FROM data_records WHERE id = ? AND organization_id = ? AND deleted_at IS NULL').bind(id, ORG).first<Row>());
    return this.rows.get(id);
  }
  async resolve(id = 'root', seen = new Set<string>()): Promise<LibraryFolder> {
    if (seen.has(id) || seen.size >= 16) fail(409, '폴더 경로가 올바르지 않습니다.');
    if (this.folders.has(id)) return this.folders.get(id)!;
    seen.add(id);
    let folder: LibraryFolder;
    const base = { campusId: null, category: null, shareMode: 'organization' as const, virtual: true, depth: 0, systemManaged: true };
    if (id === 'root') folder = { ...base, id, title: '자료보관함', parentId: null };
    else if (id === 'hq') folder = { ...base, id, title: '본원 작업물', parentId: 'root', depth: 1 };
    else if (id === 'organization') folder = { ...base, id, title: '조직 공통', parentId: 'root', depth: 1 };
    else if (id.startsWith('campus:')) {
      const campus = this.campuses.find(c => `campus:${c.id}` === id);
      if (!campus) fail(404, '캠퍼스를 찾을 수 없습니다.');
      folder = { ...base, id, title: campus.name, campusId: campus.id, parentId: 'root', depth: 1 };
    } else if (id.startsWith('category:')) {
      const match = /^category:([^:]+):([^:]+)$/.exec(id);
      const category = LIBRARY_CATEGORIES.find(c => c[0] === match?.[2]);
      if (!match || !category) fail(404, '폴더를 찾을 수 없습니다.');
      const campusId = match[1] === 'organization' ? null : match[1];
      const parent = await this.resolve(campusId ? `campus:${campusId}` : 'organization', seen);
      folder = { ...base, id, title: category[1], parentId: parent.id, campusId, category: category[0], depth: 2,
        shareMode: PERSONAL_CATEGORIES.has(category[0]) ? (campusId ? 'campus' : 'restricted') : 'organization' };
      const row = await this.row(id);
      if (row) {
        const m = libraryMetadata(row);
        if (row.record_type !== LIBRARY_FOLDER || row.source_app !== LIBRARY_SOURCE || row.campus_id !== campusId ||
          m.schemaVersion !== 1 || m.parentFolderId !== parent.id || m.category !== folder.category || m.rootProjection !== true ||
          m.campusId !== campusId || m.libraryScope !== (campusId ? 'campus' : 'hq') ||
          m.libraryShareMode !== folder.shareMode || row.visibility !== (campusId ? 'campus' : 'organization')) fail();
        folder.row = row;
      }
    } else if (id.startsWith('hq-default:')) {
      const item = HQ_DEFAULTS.find(d => `hq-default:${d[0]}` === id);
      if (!item) fail(404, '폴더를 찾을 수 없습니다.');
      const row = await this.row(id);
      if (row) return this.resolveRecord(row, seen, true);
      folder = { ...base, id, title: item[1], parentId: 'hq', category: 'hq-workspace', depth: 2,
        shareMode: item[0] === 'director-only' ? 'restricted' : 'organization' };
    } else {
      const row = await this.row(id);
      if (!row) fail(404, '폴더를 찾을 수 없습니다.');
      return this.resolveRecord(row, seen);
    }
    this.assertRead(folder);
    this.folders.set(id, folder);
    return folder;
  }
  async resolveRecord(row: Row, seen: Set<string>, virtual = false): Promise<LibraryFolder> {
    const m = libraryMetadata(row);
    if (row.source_app !== LIBRARY_SOURCE || ![LIBRARY_FOLDER, HQ_FOLDER].includes(row.record_type)) fail();
    let folder: LibraryFolder;
    if (row.record_type === HQ_FOLDER) {
      if (row.campus_id !== null || m.parentFolderId != null) fail();
      // Legacy HQ visibility (including director-only) is not broadened or rewritten.
      const shared = ['organization', 'public'].includes(row.visibility) && !['restricted', 'campus'].includes(m.libraryShareMode);
      folder = { id: row.id, title: row.title, parentId: 'hq', campusId: null, category: 'hq-workspace',
        virtual, depth: 2, row, shareMode: shared ? 'organization' : 'restricted',
        systemManaged: m.system === true || m.systemManaged === true || HQ_DEFAULTS.some(([key]) => key === m.folderKey) };
    } else if (m.parentFolderId === null) {
      // Only canonical, server-created organization roots are admitted here.
      if (m.schemaVersion !== 1 || m.libraryScope !== 'organization' || m.createdFrom !== 'library-root' ||
        m.systemManaged !== false || m.rootProjection || row.campus_id !== null || m.campusId !== null ||
        m.category !== 'library-material' || m.libraryShareMode !== 'organization' || row.visibility !== 'organization') fail();
      folder = { id: row.id, title: row.title, parentId: 'root', campusId: null, category: 'library-material',
        shareMode: 'organization', virtual: false, depth: 1, row, systemManaged: false, group: '사용자 정의 폴더' };
    } else {
      if (m.schemaVersion !== 1 || typeof m.parentFolderId !== 'string' || !m.parentFolderId || m.rootProjection) fail();
      const parent = await this.resolve(m.parentFolderId, seen);
      const category = parent.category || (parent.id === 'hq' ? 'hq-workspace' : 'library-material');
      if (parent.id === 'root' || row.campus_id !== parent.campusId || m.campusId !== parent.campusId || m.category !== category ||
        m.libraryScope !== libraryFolderScope(parent) || m.libraryShareMode !== parent.shareMode ||
        row.visibility !== (parent.campusId ? 'campus' : 'organization') || parent.depth >= 14) fail();
      folder = { id: row.id, title: row.title, parentId: parent.id, campusId: parent.campusId, category,
        shareMode: parent.shareMode, virtual: false, depth: parent.depth + 1, row, systemManaged: m.systemManaged === true };
    }
    this.assertRead(folder);
    this.folders.set(folder.id, folder);
    return folder;
  }
  assertRead(folder: LibraryFolder) {
    if (this.context.isSuperAdmin) return;
    if (folder.shareMode === 'campus' && (!folder.campusId || !this.context.campusIds.includes(folder.campusId))) fail();
    if (folder.shareMode === 'restricted' && folder.row?.created_by_user_id !== this.context.user?.internalUserId && !managesCampus(this.context, folder.campusId)) fail();
  }
  async breadcrumbs(folder: LibraryFolder) {
    const result = [folder];
    while (result[0].parentId) result.unshift(await this.resolve(result[0].parentId!));
    return result.map(f => ({ id: f.id, title: f.title }));
  }
}

export function libraryFileReadable(context: DataCoreAccessContext, folder: LibraryFolder, row: Row) {
  if (row.organization_id !== ORG || row.campus_id !== folder.campusId || row.deleted_at || row.category !== folder.category) return false;
  if (/family|kkumeum/i.test(String(row.source_app)) || row.area === 'family-private' || /^(family|kkumeum)\//i.test(String(row.r2_key))) return false;
  const ownScope = context.isSuperAdmin || !folder.campusId || context.campusIds.includes(folder.campusId);
  if (ownScope && canReadBaseFile(context, row)) return true;
  // Only reserved, server-created folder lineage grants the narrowly scoped sharing exception.
  return folder.row?.record_type === LIBRARY_FOLDER && row.data_record_id === folder.id && folder.shareMode === 'organization' &&
    row.source_app === LIBRARY_SOURCE && ['documents-private', 'academy-public'].includes(row.area) &&
    ['campus', 'organization', 'public'].includes(row.visibility) && !PERSONAL_CATEGORIES.has(row.category);
}

export async function libraryUploadTarget(db: D1Database, context: DataCoreAccessContext, recordId: string | null) {
  if (!recordId) return null;
  const tree = await new LibraryTree(db, context).init();
  const row = await tree.row(recordId);
  if (!row || ![LIBRARY_FOLDER, HQ_FOLDER].includes(row.record_type)) return null;
  const folder = await tree.resolve(recordId);
  requireLibraryWrite(context, folder);
  return folder;
}

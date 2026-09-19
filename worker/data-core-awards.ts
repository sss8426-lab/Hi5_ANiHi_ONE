import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DATA_CORE_ROLES, DataCoreAccessError, requireAuthenticatedAccess, requireCampusAccess, type DataCoreAccessContext } from './data-core-access';
import { campusDisplayName } from './campus-directory';

export const AWARD_FOLDER = 'competition-award-folder';
export const AWARD_DEPTH = 8;
type Row = Record<string, unknown>;
export function awardMetadata(row: Row): Row { try { const value=JSON.parse(String(row.metadata_json || '{}'));return value && typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; } }
export function isAwardFolder(row: Row) { return row.record_type === AWARD_FOLDER && row.source_app === 'competition'; }
export function awardMember(context: DataCoreAccessContext) {
  return Boolean(context.authenticated && context.user && !context.mustChangePassword &&
    (context.isSuperAdmin || context.memberships.some(m => m.organizationId === ORG && DATA_CORE_ROLES.includes(m.role))));
}
export function requireAwardMember(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!awardMember(context)) throw new DataCoreAccessError(403, '업무용 계정만 수상작 자료실을 사용할 수 있습니다.');
}
function collection(value: unknown) { return value === 'enrolled' || value === 'public' ? value : null; }
export async function awardRow(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM data_records WHERE id=? AND organization_id=? AND record_type=? AND source_app=?')
    .bind(id, ORG, AWARD_FOLDER, 'competition').first<Row>();
}
export async function awardPath(db: D1Database, context: DataCoreAccessContext, id: string, includeDeleted = false) {
  requireAwardMember(context);
  const rows: Row[] = [], seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor) {
    if (seen.has(cursor) || rows.length >= AWARD_DEPTH) throw new DataCoreAccessError(409, '폴더 계층을 확인해주세요.');
    seen.add(cursor);
    const row = await awardRow(db, cursor);
    if (!row || (!includeDeleted && row.deleted_at)) throw new DataCoreAccessError(404, '수상작 폴더를 찾을 수 없습니다.');
    if (row.visibility === 'private' && !context.isSuperAdmin && row.created_by_user_id !== context.user?.internalUserId) {
      throw new DataCoreAccessError(403, '비공개 폴더입니다.');
    }
    if (row.visibility === 'private' && row.campus_id) requireCampusAccess(context,String(row.campus_id));
    rows.unshift(row);
    const parent = awardMetadata(row).parentFolderId || null;
    if (parent !== null && typeof parent !== 'string') throw new DataCoreAccessError(409, '폴더 계층을 확인해주세요.');
    cursor = parent;
  }
  return rows;
}
export function presentAward(row: Row, type = collection(awardMetadata(row).collectionType)) {
  return { id: row.id, title: row.title, campusId: row.campus_id, recordType: AWARD_FOLDER, sourceApp: 'competition',
    visibility:row.visibility,summary:row.summary,createdByUserId:row.created_by_user_id,status:row.status,
    metadata: { ...awardMetadata(row), collectionType: type }, collectionType: type,
    parentFolderId: awardMetadata(row).parentFolderId || null, needsClassification: !type,
    createdAt: row.created_at, deletedAt: row.deleted_at, updatedAt: row.updated_at };
}
function safeDisplay(value: unknown, fallback: string) {
  const name = String(value || '').trim();
  return !name || name.includes('@') ? fallback : name.slice(0, 120);
}
export function awardAudit(db: D1Database, context: DataCoreAccessContext, action: string, target: Row, folder: Row, now = new Date().toISOString(), afterMutation = false) {
  const membership = context.memberships.find(m => m.campusId) || context.memberships[0];
  const campusId = context.isSuperAdmin ? null : membership?.campusId || null;
  const actor = { actorDisplayName: safeDisplay(context.user?.displayName, '학원 사용자'), actorCampusId: campusId,
    actorCampusName: context.isSuperAdmin ? 'MASTER' : campusDisplayName(campusId, membership?.campusName || '학원'),
    targetName: String(target.original_file_name || target.title || ''), folderId: folder.id,
    parentFolderId: awardMetadata(folder).parentFolderId || null, collectionType: collection(awardMetadata(folder).collectionType), schemaVersion: 1,
    restricted: Boolean(folder.auditRestricted || folder.visibility === 'private' || target.visibility === 'private' || target.area === 'student-private') };
  return db.prepare(`INSERT INTO audit_logs (id,organization_id,campus_id,actor_user_id,action,resource_type,resource_id,metadata_json,created_at)
    SELECT ?,?,?,?,?,'competition_award',?,?,? ${afterMutation ? 'WHERE changes()=1' : ''}`).bind(crypto.randomUUID(),ORG,campusId,context.user!.internalUserId,
      action,target.id,JSON.stringify(actor),now);
}
function ancestorPredicate(rows: Row[]) {
  return rows.length ? ` AND (SELECT count(*) FROM data_records WHERE id IN (${rows.map(()=>'?').join(',')}) AND deleted_at IS NULL)=${rows.length}` : '';
}
export async function createAwardFolder(db: D1Database, context: DataCoreAccessContext, input: Row) {
  requireAwardMember(context);
  const title = String(input.title || '').trim();
  if (!title || title.length > 240) throw new DataCoreAccessError(400, '폴더 이름을 1~240자로 입력해주세요.');
  const m = (input.metadata || input) as Row;
  const parentId = m.parentFolderId || null;
  if (parentId !== null && typeof parentId !== 'string') throw new DataCoreAccessError(400, '상위 폴더가 올바르지 않습니다.');
  const path = parentId ? await awardPath(db,context,parentId) : [];
  if (path.length >= AWARD_DEPTH) throw new DataCoreAccessError(400, `폴더는 최대 ${AWARD_DEPTH}단계까지 만들 수 있습니다.`);
  const type = path.length ? collection(awardMetadata(path[0]).collectionType) : collection(m.collectionType);
  if (m.collectionType && !collection(m.collectionType)) throw new DataCoreAccessError(400, '폴더 분류가 올바르지 않습니다.');
  if (path.length && collection(m.collectionType) && type !== m.collectionType) throw new DataCoreAccessError(400, '상위 폴더와 같은 모음을 선택해주세요.');
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const metadata = JSON.stringify({schemaVersion:1,collectionType:type,parentFolderId:parentId});
  const row = {id,title,metadata_json:metadata,auditRestricted:path.some(p=>p.visibility==='private')};
  // The folder and its append-only audit succeed together. A concurrently deleted parent cannot accept children.
  const result = await db.batch([
    db.prepare(`INSERT INTO data_records (id,organization_id,campus_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at)
      SELECT ?,?,NULL,?,?,'competition',?,'organization','active',?,?,? WHERE 1=1${ancestorPredicate(path)}`)
      .bind(id,ORG,context.user!.internalUserId,AWARD_FOLDER,title,metadata,now,now,...path.map(p=>p.id)),
    awardAudit(db,context,'folder.create',row,row,now,true),
  ]);
  if (result[0]?.meta?.changes !== 1) throw new DataCoreAccessError(409, '상위 폴더가 변경되었습니다. 새로고침해주세요.');
  return presentAward((await awardRow(db,id))!);
}
export async function updateAwardFolder(db: D1Database, context: DataCoreAccessContext, id: string, input: Row) {
  const path = await awardPath(db,context,id), row = path.at(-1)!;
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '폴더 분류 변경은 마스터 관리자만 가능합니다.');
  const m = (input.metadata || input) as Row;
  if (path.length !== 1 || !collection(m.collectionType) || Object.keys(input).some(k=>!['metadata','collectionType'].includes(k)) ||
    Object.keys(m).some(k=>k!=='collectionType')) throw new DataCoreAccessError(400, '최상위 폴더의 모음 분류만 변경할 수 있습니다.');
  const next = {...awardMetadata(row),collectionType:m.collectionType};
  const now = new Date().toISOString();
  await db.batch([db.prepare('UPDATE data_records SET metadata_json=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(JSON.stringify(next),now,id),
    awardAudit(db,context,'folder.classify',row,{...row,metadata_json:JSON.stringify(next)},now,true)]);
  return presentAward({...row,metadata_json:JSON.stringify(next),updated_at:now});
}
export async function deleteAwardFolder(db: D1Database, context: DataCoreAccessContext, id: string) {
  const path = await awardPath(db,context,id), row = path.at(-1)!, now = new Date().toISOString();
  await db.batch([db.prepare("UPDATE data_records SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(now,now,id),
    awardAudit(db,context,'folder.delete',row,{...row,auditRestricted:path.some(p=>p.visibility==='private'),metadata_json:JSON.stringify({...awardMetadata(row),collectionType:collection(awardMetadata(path[0]).collectionType)})},now,true)]);
  return {ok:true,id,deletedAt:now,recoverable:true};
}
export async function restoreAwardFolder(db: D1Database, context: DataCoreAccessContext, id: string) {
  requireAwardMember(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403,'마스터 관리자만 폴더를 복원할 수 있습니다.');
  const path = await awardPath(db,context,id,true), row = path.at(-1)!;
  if (!row.deleted_at) throw new DataCoreAccessError(409,'이미 복원된 폴더입니다.');
  if (path.slice(0,-1).some(r=>r.deleted_at)) throw new DataCoreAccessError(409,'상위 폴더부터 복원해주세요.');
  const now = new Date().toISOString();
  await db.batch([db.prepare("UPDATE data_records SET status='active',deleted_at=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL").bind(now,id),
    awardAudit(db,context,'folder.restore',row,{...row,auditRestricted:path.some(p=>p.visibility==='private')},now,true)]);
  return {ok:true,id};
}
export async function sharedAwardFileFolder(db: D1Database, context: DataCoreAccessContext, row: Row, readCache?: Map<string,Promise<Row[] | null>>): Promise<Row | null> {
  if (!row.data_record_id || !['competition-material','award-work'].includes(String(row.category))) return null;
  const id=String(row.data_record_id);
  const resolvePath=async()=>await awardRow(db,id)?awardPath(db,context,id):null;
  if(readCache&&!readCache.has(id))readCache.set(id,resolvePath());
  const path=await (readCache?.get(id)||resolvePath());
  if(!path)return null;
  const folder=path.at(-1)!;
  if (row.visibility === 'private' || row.area === 'student-private') {
    if (!context.isSuperAdmin && row.owner_user_id !== context.user?.internalUserId) throw new DataCoreAccessError(403,'비공개 파일입니다.');
    if(row.campus_id)requireCampusAccess(context,String(row.campus_id));
  }
  return {...folder,auditRestricted:path.some(p=>p.visibility==='private'),metadata_json:JSON.stringify({...awardMetadata(folder),collectionType:collection(awardMetadata(path[0]).collectionType)})};
}
function cursor(url: URL) {
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new DataCoreAccessError(400,'조회 위치가 올바르지 않습니다.');
  return offset;
}
export async function listAwardFolders(db: D1Database, context: DataCoreAccessContext, url: URL) {
  requireAwardMember(context);
  const parentId = url.searchParams.get('parentId'), type = collection(url.searchParams.get('collectionType'));
  const trash = url.searchParams.get('trash') === '1';
  if (trash && !context.isSuperAdmin) throw new DataCoreAccessError(403,'마스터 관리자만 폴더 휴지통을 볼 수 있습니다.');
  const path = parentId ? await awardPath(db,context,parentId) : [];
  const clauses = ['organization_id=?','record_type=?',"source_app='competition'",trash?'deleted_at IS NOT NULL':'deleted_at IS NULL'];
  const values: unknown[] = [ORG,AWARD_FOLDER];
  if (!context.isSuperAdmin) { clauses.push("(visibility<>'private' OR created_by_user_id=?)"); values.push(context.user!.internalUserId); }
  if (!trash) {
    clauses.push("COALESCE(json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.parentFolderId'),'')=?"); values.push(parentId || '');
    if (!parentId && type) {
      clauses.push(type === 'public' ? "json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.collectionType')='public'" :
        "COALESCE(json_extract(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,'$.collectionType'),'')<>'public'");
    }
  }
  const offset = cursor(url), limit = 100;
  const result = await db.prepare(`SELECT * FROM data_records WHERE ${clauses.join(' AND ')} ORDER BY created_at,id LIMIT ? OFFSET ?`).bind(...values,limit+1,offset).all<Row>();
  const rows = result.results || [];
  const inherited = path.length ? collection(awardMetadata(path[0]).collectionType) : undefined;
  return {folders:rows.slice(0,limit).map(r=>presentAward(r,inherited)), breadcrumbs:path.map(r=>presentAward(r,inherited)),
    nextOffset: rows.length>limit ? offset+limit : null, maxDepth:AWARD_DEPTH};
}
export async function listAwardActivity(db: D1Database, context: DataCoreAccessContext, url: URL) {
  requireAwardMember(context);
  const filter = url.searchParams.get('filter') || 'all';
  let before: string[] = [];
  if (url.searchParams.has('cursor')) {
    try { before=JSON.parse(url.searchParams.get('cursor')!); } catch { throw new DataCoreAccessError(400,'조회 위치가 올바르지 않습니다.'); }
    if (!Array.isArray(before) || before.length!==2 || before.some(v=>typeof v!=='string'||v.length>80)) throw new DataCoreAccessError(400,'조회 위치가 올바르지 않습니다.');
  }
  const actions: Record<string,string[]> = {folder:['folder.create','folder.delete','folder.classify','folder.restore'],upload:['file.upload'],download:['file.download']};
  if (filter !== 'all' && !actions[filter]) throw new DataCoreAccessError(400,'필터가 올바르지 않습니다.');
  const selected = actions[filter] || [];
  const result = await db.prepare(`SELECT id,action,metadata_json,created_at FROM audit_logs WHERE organization_id=? AND resource_type='competition_award'
    ${context.isSuperAdmin?'':"AND COALESCE(json_extract(metadata_json,'$.restricted'),0)=0"}
    ${selected.length?`AND action IN (${selected.map(()=>'?').join(',')})`:''}
    ${before.length?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 26`)
    .bind(ORG,...selected,...(before.length?[before[0],before[0],before[1]]:[])).all<Row>();
  const rows = result.results || [];
  return {events:rows.slice(0,25).map(r=>{const m=awardMetadata(r);return {eventId:r.id,action:r.action,createdAt:r.created_at,
    actorDisplayName:safeDisplay(m.actorDisplayName,'학원 사용자'),actorCampusName:m.actorCampusName || '학원',targetName:m.targetName || '',collectionType:m.collectionType};}),
    nextCursor:rows.length>25?JSON.stringify([rows[24].created_at,rows[24].id]):null};
}

export async function handleAwardApi(request: Request, db: D1Database, files: R2Bucket, context: DataCoreAccessContext) {
  requireAwardMember(context);
  const url = new URL(request.url), path = url.pathname.slice('/api/data-core/awards'.length);
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin) throw new DataCoreAccessError(403,'동일 출처 요청만 허용됩니다.');
  const json = (body: unknown, status=200) => Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
  if (path==='/activity' && request.method==='GET') return json(await listAwardActivity(db,context,url));
  if (path==='/folders' && request.method==='GET') return json(await listAwardFolders(db,context,url));
  if (path==='/folders' && request.method==='POST') {
    const input = await request.json() as Row;
    if (!input.parentFolderId && !collection(input.collectionType)) throw new DataCoreAccessError(400,'수상작 모음을 선택해주세요.');
    return json({record:await createAwardFolder(db,context,input)},201);
  }
  const folder = path.match(/^\/folders\/([^/]+)(\/restore)?$/);
  if (folder) {
    const id = decodeURIComponent(folder[1]);
    if (folder[2] && request.method==='POST') return json(await restoreAwardFolder(db,context,id));
    if (!folder[2] && request.method==='PATCH') return json({record:await updateAwardFolder(db,context,id,await request.json() as Row)});
    if (!folder[2] && request.method==='DELETE') return json(await deleteAwardFolder(db,context,id));
    if (!folder[2] && request.method==='GET') {
      const rows=await awardPath(db,context,id),type=collection(awardMetadata(rows[0]).collectionType);
      return json({record:presentAward(rows.at(-1)!,type),breadcrumbs:rows.map(r=>presentAward(r,type))});
    }
  }
  const download = path.match(/^\/files\/([^/]+)\/download$/);
  if (download && request.method==='POST') {
    const row = await db.prepare('SELECT * FROM file_objects WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(decodeURIComponent(download[1]),ORG).first<Row>();
    if (!row) throw new DataCoreAccessError(404,'파일을 찾을 수 없습니다.');
    const parent = await sharedAwardFileFolder(db,context,row);
    if (!parent) throw new DataCoreAccessError(403,'수상작 파일이 아닙니다.');
    const object=await files.get(String(row.r2_key));
    if (!object) throw new DataCoreAccessError(404,'원본 파일을 찾을 수 없습니다.');
    const name=Array.from(String(row.original_file_name || 'file')).map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c==='\\'?'_':c).join('');
    const encoded=encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
    await awardAudit(db,context,'file.download',row,parent).run();
    return new Response(object.body,{headers:{'content-type':String(row.mime_type),'content-length':String(object.size),
      'cache-control':'private, no-store','x-content-type-options':'nosniff',
      'content-disposition':`attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g,'_')}"; filename*=UTF-8''${encoded}`}});
  }
  return json({error:'허용되지 않은 요청입니다.'},405);
}

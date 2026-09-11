import { DataCoreAccessError, requireAuthenticatedAccess, requireCampusAccess, type DataCoreAccessContext } from './data-core-access';
import { CAMPUS_DIRECTORY, canonicalCampusId } from './campus-directory';

type Document = Record<string, unknown>;
type Scope = { id: string | null; revision: number | null; master: boolean; nextIdBase: number };
type ScopedDocument = Document & { _campus: Scope };
function records(doc: Document, key: string): Document[] { return Array.isArray(doc[key]) ? doc[key] as Document[] : []; }
const collections = ['students', 'cases', 'awardFolders', 'changeLogs'] as const;
const shared = ['universities', 'admissionGradeRules', 'settings'] as const;
const schemaReady = new WeakMap<D1Database, Promise<void>>();
export async function ensureCampusAdmissions(db: D1Database) {
  if (!schemaReady.has(db)) schemaReady.set(db, db.prepare(`CREATE TABLE IF NOT EXISTS campus_admissions_state (
    campus_id TEXT PRIMARY KEY NOT NULL REFERENCES campuses(id), payload_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run().then(() => {}).catch(e => { schemaReady.delete(db); throw e; }));
  return schemaReady.get(db)!;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => same(v,b[i]));
  const x = a as Document, y = b as Document;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y,k) && same(x[k],y[k]));
}
function campusOf(row: Document) { return canonicalCampusId(row?.campusId ?? row?.campus_id); }
function selectedCampus(context: DataCoreAccessContext, url: URL) {
  const requested = canonicalCampusId(url.searchParams.get('campusId'));
  if (context.isSuperAdmin) return requested;
  if (context.campusIds.length !== 1) throw new DataCoreAccessError(403, '하나의 캠퍼스 권한을 확인하세요.');
  if (requested) requireCampusAccess(context, requested);
  return context.campusIds[0];
}
export async function readCampusAdmissions(db: D1Database, context: DataCoreAccessContext, url: URL, legacy: Document) {
  requireAuthenticatedAccess(context);
  await ensureCampusAdmissions(db);
  const campusId = selectedCampus(context,url);
  if (campusId) requireCampusAccess(context,campusId);
  const rows = (await (campusId ? db.prepare('SELECT campus_id, payload_json, revision FROM campus_admissions_state WHERE campus_id = ?').bind(campusId) : db.prepare('SELECT campus_id, payload_json, revision FROM campus_admissions_state')).all<{campus_id:string;payload_json:string;revision:number}>()).results || [];
  const result = (campusId ? { version: legacy.version || 1 } : { ...legacy }) as ScopedDocument;
  for (const key of shared) result[key] = legacy[key] ?? (key === 'settings' ? {} : []);
  if (campusId) {
    const row = rows.find(r => r.campus_id === campusId);
    const saved = row ? JSON.parse(row.payload_json) : null;
    for (const key of collections) result[key] = saved?.[key] || records(legacy,key).filter(r => campusOf(r) === campusId);
    const index = CAMPUS_DIRECTORY.findIndex(c => c.id === campusId);
    result._campus = { id: campusId, revision: row?.revision ?? 0, master: context.isSuperAdmin, nextIdBase: (Math.max(0,index) + 1) * 100_000_000_000 };
  } else {
    const replaced = new Set(rows.map(r => r.campus_id));
    for (const key of collections) result[key] = [
      ...records(legacy,key).filter(r => !replaced.has(campusOf(r)!)),
      ...rows.flatMap(row => JSON.parse(row.payload_json)[key] || []),
    ];
    result._campus = { id: null, master: true, revision: null, nextIdBase: 0 };
  }
  return result;
}

export async function saveCampusAdmissions(db: D1Database, context: DataCoreAccessContext, url: URL, legacy: Document, input: Document) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DataCoreAccessError(400,'데이터 형식이 올바르지 않습니다.');
  const current = await readCampusAdmissions(db,context,url,legacy);
  const campusId = current._campus.id as string | null;
  if (!campusId) {
    // A master edits campus-owned records only in the explicitly selected campus.
    const rows = (await db.prepare('SELECT campus_id FROM campus_admissions_state').all<{campus_id:string}>()).results || [];
    const scoped = new Set(rows.map(r => r.campus_id));
    const result = { ...legacy, ...input };
    delete result._campus;
    for (const key of collections) {
      if (!Array.isArray(input[key])) throw new DataCoreAccessError(400,'데이터 형식이 올바르지 않습니다.');
      if (!same(records(input,key).filter(r => scoped.has(campusOf(r)!)),records(current,key).filter(r => scoped.has(campusOf(r)!)))) throw new DataCoreAccessError(409,'수정할 캠퍼스를 먼저 선택하세요.');
      // Preserve old shadowed rows in the legacy snapshot; campus overlays never rewrite them.
      result[key] = [...records(input,key).filter(r => !scoped.has(campusOf(r)!)), ...records(legacy,key).filter(r => scoped.has(campusOf(r)!))];
    }
    return { legacy: result };
  }
  const scope = input._campus as Partial<Scope> | undefined;
  if (!Number.isInteger(scope?.revision) || scope?.revision !== current._campus.revision) throw new DataCoreAccessError(409,'다른 변경사항이 있습니다. 새로고침 후 다시 저장하세요.');
  for (const key of shared) if (!same(input[key],current[key])) throw new DataCoreAccessError(403,'공용 입시정보는 전체 캠퍼스 화면에서 마스터만 수정할 수 있습니다.');
  const now = new Date().toISOString();
  const payload: Document = {};
  for (const key of collections) {
    if (!Array.isArray(input[key])) throw new DataCoreAccessError(400,'데이터 형식이 올바르지 않습니다.');
    const old = new Map(records(current,key).map(r => [String(r.id),r]));
    const used = new Set<string>();
    payload[key] = records(input,key).map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new DataCoreAccessError(400,'데이터 형식이 올바르지 않습니다.');
      if (campusOf(row) && campusOf(row) !== campusId) throw new DataCoreAccessError(403,'다른 캠퍼스 데이터는 변경할 수 없습니다.');
      const id = String(row.id ?? '');
      if (!id || used.has(id)) throw new DataCoreAccessError(400,'중복되거나 누락된 ID입니다.');
      used.add(id);
      const previous = old.get(id) as Document | undefined;
      if (!previous && key !== 'changeLogs' && (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < current._campus.nextIdBase || row.id >= current._campus.nextIdBase + 100_000_000_000)) throw new DataCoreAccessError(400,'현재 캠퍼스의 새 ID를 사용하세요.');
      return { ...row, campusId, createdBy: previous?.createdBy || context.user!.internalUserId,
        createdAt: previous?.createdAt || now, updatedBy: context.user!.internalUserId, updatedAt: now };
    });
  }
  const revision = current._campus.revision as number;
  const json = JSON.stringify(payload);
  const result = revision === 0
    ? await db.prepare(`INSERT INTO campus_admissions_state (campus_id,payload_json,revision,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,1,?,?,?,?) ON CONFLICT(campus_id) DO NOTHING`).bind(campusId,json,context.user!.internalUserId,context.user!.internalUserId,now,now).run()
    : await db.prepare(`UPDATE campus_admissions_state SET payload_json=?, revision=revision+1, updated_by=?, updated_at=? WHERE campus_id=? AND revision=?`)
      .bind(json,context.user!.internalUserId,now,campusId,revision).run();
  if (result.meta?.changes !== 1) throw new DataCoreAccessError(409,'다른 변경사항이 있습니다. 새로고침 후 다시 저장하세요.');
  return { revision: revision + 1 };
}

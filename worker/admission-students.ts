import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DATA_CORE_ROLES, DataCoreAccessError, requireAuthenticatedAccess, requireWriteAccess, type DataCoreAccessContext } from './data-core-access';

// 학생 관리 (대학 합격 로드맵): every academy teacher sees and edits the same student list, one row per student.
// Students used to live inside the whole-document admissions state (legacy R2 doc + campus overlays). They are
// copied here once — the old copies are never changed — and whole-document saves no longer carry students, so
// two teachers editing different students can no longer overwrite each other.
// 삭제와 합격자 데이터로 넘기기 (studentType current → result) are for campus administrators and MASTER only.
type Row = Record<string, unknown>;
const MANAGER_ROLES = ['MASTER', 'SUPER_ADMIN', 'CAMPUS_ADMIN', 'CAMPUS_DIRECTOR'];
const STUDENT_BYTES = 256 * 1024, BULK_LIMIT = 500;
const SERVER_FIELDS = ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', '_revision'];

export function studentMember(context: DataCoreAccessContext) {
  return Boolean(context.authenticated && (context.isSuperAdmin || context.memberships.some(m => m.organizationId === ORG && (DATA_CORE_ROLES as readonly string[]).includes(m.role))));
}
export function studentManager(context: DataCoreAccessContext) {
  return Boolean(context.isSuperAdmin || context.memberships.some(m => m.organizationId === ORG && MANAGER_ROLES.includes(m.role)));
}
export function requireStudentMember(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!studentMember(context)) throw new DataCoreAccessError(403, '학원 선생님 계정만 학생 관리를 볼 수 있습니다.');
}

const ready = new WeakMap<D1Database, Promise<void>>();
export function ensureAdmissionStudents(db: D1Database) {
  if (!ready.has(db)) ready.set(db, db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admission_students (id INTEGER PRIMARY KEY, payload_json TEXT NOT NULL, campus_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1, created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admission_students_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
  ]).then(() => {}).catch(error => { ready.delete(db); throw error; }));
  return ready.get(db)!;
}

// One-time copy of the students the old whole-document state held (legacy + campus overlays). Idempotent.
export async function importStudentsOnce(db: D1Database, source: () => Promise<Row[]>) {
  await ensureAdmissionStudents(db);
  if (await db.prepare(`SELECT value FROM admission_students_meta WHERE key='imported'`).first()) return;
  const students = (await source()).filter(s => s && typeof s === 'object' && Number.isSafeInteger(Number(s.id)));
  const now = new Date().toISOString();
  const statements = students.map(s => db.prepare(`INSERT OR IGNORE INTO admission_students (id,payload_json,campus_id,revision,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,?,1,?,?,?,?)`).bind(Number(s.id), JSON.stringify(s), typeof s.campusId === 'string' ? s.campusId : null,
      typeof s.createdBy === 'string' ? s.createdBy : null, typeof s.updatedBy === 'string' ? s.updatedBy : null,
      typeof s.createdAt === 'string' ? s.createdAt : now, typeof s.updatedAt === 'string' ? s.updatedAt : now));
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  await db.prepare(`INSERT OR IGNORE INTO admission_students_meta (key,value) VALUES ('imported',?)`).bind(JSON.stringify({ at: now, count: students.length })).run();
}

function present(row: Row) {
  let payload: Row = {};
  try { payload = JSON.parse(String(row.payload_json)); } catch { payload = {}; }
  return { ...payload, id: Number(row.id), campusId: row.campus_id ?? payload.campusId ?? null, createdAt: row.created_at, updatedAt: row.updated_at, _revision: Number(row.revision) };
}
export async function listStudents(db: D1Database) {
  await ensureAdmissionStudents(db);
  const rows = (await db.prepare('SELECT * FROM admission_students WHERE deleted_at IS NULL ORDER BY id').all<Row>()).results || [];
  return rows.map(present);
}
export async function studentById(db: D1Database, id: string) {
  await ensureAdmissionStudents(db);
  if (!/^\d{1,16}$/.test(id)) return null;
  const row = await db.prepare('SELECT * FROM admission_students WHERE id=? AND deleted_at IS NULL').bind(Number(id)).first<Row>();
  return row ? present(row) : null;
}

function clean(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DataCoreAccessError(400, '학생 정보 형식이 올바르지 않습니다.');
  const student: Row = { ...(input as Row) };
  for (const key of SERVER_FIELDS) delete student[key];
  const name = String(student.name || '').trim();
  if (!name || name.length > 60) throw new DataCoreAccessError(400, '학생 이름을 1~60자로 입력해주세요.');
  student.name = name;
  if (student.entryYear !== undefined && student.entryYear !== null && student.entryYear !== '') {
    const year = Number(student.entryYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DataCoreAccessError(400, '고1 연도를 확인해주세요.');
    student.entryYear = year;
  } else delete student.entryYear;
  if (JSON.stringify(student).length > STUDENT_BYTES) throw new DataCoreAccessError(413, '학생 정보가 너무 큽니다.');
  return student;
}
const finalized = (s: Row) => s.studentType === 'result';
function campusFor(context: DataCoreAccessContext) {
  return context.isSuperAdmin ? null : context.memberships.find(m => m.campusId)?.campusId || null;
}

export async function createStudents(db: D1Database, context: DataCoreAccessContext, inputs: unknown[]) {
  requireStudentMember(context); requireWriteAccess(context);
  if (!inputs.length || inputs.length > BULK_LIMIT) throw new DataCoreAccessError(400, `학생은 한 번에 1~${BULK_LIMIT}명까지 올릴 수 있습니다.`);
  await ensureAdmissionStudents(db);
  const students = inputs.map(clean);
  if (!studentManager(context) && students.some(finalized)) throw new DataCoreAccessError(403, '합격자 데이터는 캠퍼스 관리자나 마스터만 추가할 수 있습니다.');
  const now = new Date().toISOString(), campusId = campusFor(context), user = context.user!.internalUserId;
  const top = await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM admission_students').first<{ id: number }>();
  let id = Number(top?.id || 0);
  const created = students.map(s => ({ ...s, id: ++id, campusId: s.campusId ?? campusId }));
  const statements = created.map(s => db.prepare(`INSERT INTO admission_students (id,payload_json,campus_id,revision,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,?,1,?,?,?,?)`).bind(s.id, JSON.stringify({ ...s, createdBy: user }), s.campusId || null, user, user, now, now));
  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  return Promise.all(created.map(s => studentById(db, String(s.id))));
}

export async function updateStudent(db: D1Database, context: DataCoreAccessContext, id: string, input: unknown) {
  requireStudentMember(context); requireWriteAccess(context);
  const current = await studentById(db, id);
  if (!current) throw new DataCoreAccessError(404, '학생을 찾을 수 없습니다.');
  const revision = (input as Row)?._revision;
  if (revision !== undefined && Number(revision) !== current._revision) throw new DataCoreAccessError(409, '다른 선생님이 먼저 수정했습니다. 새로고침 후 다시 저장하세요.');
  const next = clean({ ...current, ...(input as Row) });
  if (!studentManager(context) && finalized(next) !== finalized(current)) throw new DataCoreAccessError(403, '합격자 데이터로 넘기기는 캠퍼스 관리자나 마스터만 할 수 있습니다.');
  const now = new Date().toISOString(), user = context.user!.internalUserId;
  const result = await db.prepare(`UPDATE admission_students SET payload_json=?, revision=revision+1, updated_by=?, updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL`)
    .bind(JSON.stringify({ ...next, campusId: current.campusId, updatedBy: user }), user, now, Number(id), current._revision).run();
  if (result.meta?.changes !== 1) throw new DataCoreAccessError(409, '다른 선생님이 먼저 수정했습니다. 새로고침 후 다시 저장하세요.');
  return studentById(db, id);
}

export async function deleteStudent(db: D1Database, context: DataCoreAccessContext, id: string) {
  requireStudentMember(context); requireWriteAccess(context);
  if (!studentManager(context)) throw new DataCoreAccessError(403, '학생 삭제는 캠퍼스 관리자나 마스터만 할 수 있습니다.');
  const current = await studentById(db, id);
  if (!current) throw new DataCoreAccessError(404, '학생을 찾을 수 없습니다.');
  const now = new Date().toISOString();
  await db.prepare('UPDATE admission_students SET deleted_at=?, updated_by=?, updated_at=? WHERE id=? AND deleted_at IS NULL').bind(now, context.user!.internalUserId, now, Number(id)).run();
  return { ok: true, id: Number(id) };
}

// 희망 계열 (실기 유형): the basic list lives in the page; teachers can add more, shared with everyone.
const TRACK_LIMIT = 60;
export async function trackOptions(db: D1Database) {
  await ensureAdmissionStudents(db);
  const row = await db.prepare(`SELECT value FROM admission_students_meta WHERE key='trackOptions'`).first<{ value: string }>();
  try { const list = JSON.parse(row?.value || '[]'); return Array.isArray(list) ? list.filter(v => typeof v === 'string') : []; } catch { return []; }
}
export async function addTrackOption(db: D1Database, context: DataCoreAccessContext, input: unknown) {
  requireStudentMember(context); requireWriteAccess(context);
  const label = String((input as Row)?.label || '').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 20) throw new DataCoreAccessError(400, '희망 계열 이름을 1~20자로 입력해주세요.');
  const list = await trackOptions(db);
  if (!list.includes(label)) {
    if (list.length >= TRACK_LIMIT) throw new DataCoreAccessError(400, `희망 계열은 ${TRACK_LIMIT}개까지 추가할 수 있습니다.`);
    list.push(label);
    await db.prepare(`INSERT INTO admission_students_meta (key,value) VALUES ('trackOptions',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(list)).run();
  }
  return list;
}

export async function handleAdmissionStudentsApi(request: Request, db: D1Database, context: DataCoreAccessContext, source: () => Promise<Row[]>) {
  const url = new URL(request.url), match = url.pathname.match(/^\/api\/admissions\/students(?:\/(\d{1,16}|track-options))?$/);
  if (!match) return null;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  try {
    requireStudentMember(context);
    if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site'))
      throw new DataCoreAccessError(403, '같은 사이트에서만 요청할 수 있습니다.');
    await importStudentsOnce(db, source);
    const id = match[1];
    if (!id && request.method === 'GET') return json({ students: await listStudents(db), canManage: studentManager(context), trackOptions: await trackOptions(db) });
    if (id === 'track-options') {
      if (request.method === 'GET') return json({ trackOptions: await trackOptions(db) });
      if (request.method === 'POST') { let body: unknown = {}; try { body = await request.json(); } catch { body = {}; } return json({ trackOptions: await addTrackOption(db, context, body) }, 201); }
      return json({ error: '허용되지 않은 요청입니다.' }, 405);
    }
    let body: Row = {};
    if (['POST', 'PATCH'].includes(request.method)) { try { body = await request.json() as Row; } catch { throw new DataCoreAccessError(400, '학생 정보 형식이 올바르지 않습니다.'); } }
    if (!id && request.method === 'POST') return json({ students: await createStudents(db, context, Array.isArray(body.students) ? body.students : [body.student]) }, 201);
    if (id && request.method === 'PATCH') return json({ student: await updateStudent(db, context, id, body.student) });
    if (id && request.method === 'DELETE') return json(await deleteStudent(db, context, id));
    return json({ error: '허용되지 않은 요청입니다.' }, 405);
  } catch (error) {
    if (error instanceof DataCoreAccessError) return json({ error: error.message }, error.status);
    throw error;
  }
}

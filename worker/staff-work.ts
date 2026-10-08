// 월간 업무보고 (staff monthly reports shared with every staff member, replacing the Naver Band posts)
// and 고정 업무 (fixed tasks shown on 학원 공통 일정, e.g. the 업무보고 deadline).
// Every rule is checked here on the server; hidden buttons on the screens are only a convenience.
import { DEFAULT_ORGANIZATION_ID as ORG } from './data-core';
import { DataCoreAccessContext, DataCoreAccessError, requireWriteAccess, isCampusAdmin, managesCampus } from './data-core-access';
import { ruleDates, reportDeadline, shiftMonth } from '../public/data-core/fixed-task-rules.js';
import { campusDisplayName } from './campus-directory';

const fail = (status: number, message: string): never => { throw new DataCoreAccessError(status, message); };
const now = () => new Date().toISOString();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const REPORT_CATEGORIES = ['행사', '홍보', '수업', '상담', '운영'] as const;
export const REPORT_GRADES = ['초', '중1', '중2', '중3', '고1', '고2', '고3'] as const;
const RULES = ['first-saturday', 'month-end', 'month-day', 'weekday'];
const PHOTO_LIMIT = 20, PHOTO_BYTES = 4 * 1024 * 1024;
const MONTHLY_REPORT_TASK = 'fixed-monthly-report';

const ready = new WeakMap<D1Database, Promise<unknown>>();
function ensureTables(db: D1Database) {
  if (!ready.has(db)) ready.set(db, db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS staff_reports (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, campus_id TEXT, author_user_id TEXT NOT NULL,
      author_name TEXT NOT NULL, report_month TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS staff_reports_month_idx ON staff_reports(organization_id, report_month, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS staff_report_reads (report_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (report_id, user_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS staff_report_reactions (report_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (report_id, user_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS staff_report_comments (id TEXT PRIMARY KEY NOT NULL, report_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS calendar_fixed_tasks (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, campus_id TEXT, title TEXT NOT NULL,
      rule TEXT NOT NULL, rule_value INTEGER, kind TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`),
    // The one fixed task every staff member has from day one: the 월간 업무보고 deadline (MASTER can change it).
    db.prepare(`INSERT OR IGNORE INTO calendar_fixed_tasks (id, organization_id, campus_id, title, rule, rule_value, kind, created_by, created_at, updated_at)
      VALUES (?, ?, NULL, '월간 업무보고 마감', 'first-saturday', NULL, 'monthly-report', NULL, ?, ?)`).bind(MONTHLY_REPORT_TASK, ORG, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
  ]).catch(error => { ready.delete(db); throw error; }));
  return ready.get(db)!;
}

const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
// Photo paths use a file-safe form of the user id (ids may contain ':').
const photoOwner = (context: DataCoreAccessContext) => context.user!.internalUserId.replace(/[^\w-]/g, '_');
const author = (context: DataCoreAccessContext) => context.user!.displayName || context.user!.loginId || '직원';
async function campusNames(db: D1Database) {
  const rows = (await db.prepare('SELECT id, name FROM campuses WHERE organization_id=?').bind(ORG).all<{ id: string; name: string }>()).results || [];
  return new Map(rows.map(row => [row.id, campusDisplayName(row.id, row.name) || row.name]));
}

// ---------- 월간 업무보고 ----------
function reportBody(input: any, uploader: string) { // uploader: photoOwner()
  const lines = (list: unknown, withCategory: boolean) => (Array.isArray(list) ? list : []).slice(0, 60).map((item: any) => {
    const t = text(withCategory ? item?.text : item?.text ?? item, 300);
    if (!t) return null;
    if (!withCategory) return { text: t };
    const category = REPORT_CATEGORIES.includes(item?.category) ? item.category : '운영';
    return { category, text: t };
  }).filter(Boolean);
  const counts = (value: any) => Object.fromEntries(REPORT_GRADES.map(g => {
    const n = Number(value?.[g] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 999) fail(400, '신입·퇴원 인원은 0~999 사이의 숫자로 적어 주세요.');
    return [g, n];
  }));
  const awards = (Array.isArray(input?.awards) ? input.awards : []).slice(0, 40).map((a: any) => ({ contest: text(a?.contest, 120), prize: text(a?.prize, 60), count: Math.max(0, Math.min(999, Number.parseInt(a?.count, 10) || 0)) })).filter((a: any) => a.contest);
  const photos = (Array.isArray(input?.photos) ? input.photos : []).slice(0, PHOTO_LIMIT).map((key: unknown) => String(key));
  // A report may only point at photos its own author uploaded.
  if (photos.some((key: string) => !key.startsWith(`staff-reports/${uploader}/`) || !/^staff-reports\/[\w-]+\/[\w-]+\.(webp|jpg|png)$/.test(key))) fail(400, '사진 정보를 확인하세요.');
  return { done: lines(input?.done, true), planned: lines(input?.planned, true), classes: lines(input?.classes, false), joins: counts(input?.joins), leaves: counts(input?.leaves), awards, photos };
}

export function canonicalReportCampus(context: DataCoreAccessContext, value: unknown) {
  const id = typeof value === 'string' && value ? value : context.campusIds[0] || null;
  if (!id) return null;
  if (!context.isSuperAdmin && !context.campusIds.includes(id)) fail(403, '본인 캠퍼스로만 업무보고를 쓸 수 있습니다.');
  return id;
}

async function listReports(db: D1Database, context: DataCoreAccessContext, url: URL) {
  const month = url.searchParams.get('month') || '';
  if (!MONTH.test(month)) fail(400, '월을 확인하세요.');
  const campusId = url.searchParams.get('campusId') || '';
  const rows = (await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM staff_report_reads x WHERE x.report_id=r.id AND x.user_id<>r.author_user_id) AS read_count,
      (SELECT COUNT(*) FROM staff_report_reactions x WHERE x.report_id=r.id) AS reaction_count,
      (SELECT COUNT(*) FROM staff_report_reactions x WHERE x.report_id=r.id AND x.user_id=?) AS reacted,
      (SELECT COUNT(*) FROM staff_report_comments x WHERE x.report_id=r.id AND x.deleted_at IS NULL) AS comment_count,
      (SELECT COUNT(*) FROM staff_report_reads x WHERE x.report_id=r.id AND x.user_id=?) AS read_by_me
    FROM staff_reports r WHERE r.organization_id=? AND r.report_month=? AND r.deleted_at IS NULL AND (?='' OR r.campus_id=?) ORDER BY r.created_at DESC LIMIT 200`)
    .bind(context.user!.internalUserId, context.user!.internalUserId, ORG, month, campusId, campusId).all<any>()).results || [];
  const names = await campusNames(db);
  const staff = await db.prepare(`SELECT COUNT(DISTINCT m.user_id) AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND u.status='active'`).bind(ORG).first<{ n: number }>();
  const submitted = await db.prepare(`SELECT COUNT(DISTINCT author_user_id) AS n FROM staff_reports WHERE organization_id=? AND report_month=? AND deleted_at IS NULL`).bind(ORG, month).first<{ n: number }>();
  return {
    month, deadline: reportDeadline(month), submittedCount: submitted?.n || 0, staffCount: staff?.n || 0,
    reports: rows.map(row => presentReport(row, context, names)),
  };
}

function presentReport(row: any, context: DataCoreAccessContext, names: Map<string, string>) {
  let body: any = {};
  try { body = JSON.parse(row.body_json); } catch { body = {}; }
  return {
    id: row.id, month: row.report_month, campusId: row.campus_id, campusName: names.get(row.campus_id) || '', authorName: row.author_name,
    mine: row.author_user_id === context.user!.internalUserId, canManage: row.author_user_id === context.user!.internalUserId || context.isSuperAdmin,
    createdAt: row.created_at, updatedAt: row.updated_at, body,
    readCount: Number(row.read_count || 0), reactionCount: Number(row.reaction_count || 0), reacted: Number(row.reacted || 0) > 0,
    commentCount: Number(row.comment_count || 0), readByMe: Number(row.read_by_me || 0) > 0,
  };
}

async function reportRow(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM staff_reports WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(id, ORG).first<any>();
  return row || fail(404, '업무보고를 찾을 수 없습니다.');
}

async function reportDetail(db: D1Database, context: DataCoreAccessContext, id: string, markRead: boolean) {
  const row = await reportRow(db, id);
  if (markRead && row.author_user_id !== context.user!.internalUserId) {
    await db.prepare('INSERT OR IGNORE INTO staff_report_reads (report_id, user_id, user_name, read_at) VALUES (?, ?, ?, ?)').bind(id, context.user!.internalUserId, author(context), now()).run();
  }
  const listed = await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM staff_report_reads x WHERE x.report_id=r.id AND x.user_id<>r.author_user_id) AS read_count,
      (SELECT COUNT(*) FROM staff_report_reactions x WHERE x.report_id=r.id) AS reaction_count,
      (SELECT COUNT(*) FROM staff_report_reactions x WHERE x.report_id=r.id AND x.user_id=?) AS reacted,
      (SELECT COUNT(*) FROM staff_report_comments x WHERE x.report_id=r.id AND x.deleted_at IS NULL) AS comment_count, 1 AS read_by_me
    FROM staff_reports r WHERE r.id=?`).bind(context.user!.internalUserId, id).first<any>();
  const comments = (await db.prepare('SELECT id, user_id, user_name, body, created_at FROM staff_report_comments WHERE report_id=? AND deleted_at IS NULL ORDER BY created_at').bind(id).all<any>()).results || [];
  const readers = (await db.prepare('SELECT user_name, read_at FROM staff_report_reads WHERE report_id=? AND user_id<>? ORDER BY read_at').bind(id, row.author_user_id).all<any>()).results || [];
  return {
    report: presentReport(listed, context, await campusNames(db)),
    comments: comments.map(c => ({ id: c.id, authorName: c.user_name, body: c.body, createdAt: c.created_at, canDelete: c.user_id === context.user!.internalUserId || context.isSuperAdmin })),
    readers: readers.map(r => ({ name: r.user_name, readAt: r.read_at })),
  };
}

async function saveReport(db: D1Database, context: DataCoreAccessContext, input: any, id?: string) {
  const month = String(input?.month || '');
  if (!MONTH.test(month)) fail(400, '보고할 달을 확인하세요.');
  const body = reportBody(input, photoOwner(context));
  if (!body.done.length && !body.planned.length && !body.classes.length && !body.awards.length) fail(400, '진행업무·예정업무·수업내용 중 하나 이상을 적어 주세요.');
  const at = now(), json = JSON.stringify(body);
  if (id) {
    const row = await reportRow(db, id);
    if (row.author_user_id !== context.user!.internalUserId && !context.isSuperAdmin) fail(403, '본인이 쓴 업무보고만 고칠 수 있습니다.');
    await db.prepare('UPDATE staff_reports SET report_month=?, body_json=?, updated_at=? WHERE id=?').bind(month, json, at, id).run();
    return id;
  }
  const campusId = canonicalReportCampus(context, input?.campusId);
  const exists = await db.prepare('SELECT id FROM staff_reports WHERE organization_id=? AND author_user_id=? AND report_month=? AND deleted_at IS NULL').bind(ORG, context.user!.internalUserId, month).first<{ id: string }>();
  if (exists) fail(409, '이 달의 업무보고를 이미 썼습니다. 기존 보고서를 고쳐 주세요.');
  const newId = crypto.randomUUID();
  await db.prepare('INSERT INTO staff_reports (id, organization_id, campus_id, author_user_id, author_name, report_month, body_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId, ORG, campusId, context.user!.internalUserId, author(context), month, json, at, at).run();
  return newId;
}

async function handleReports(request: Request, url: URL, db: D1Database, bucket: R2Bucket | undefined, context: DataCoreAccessContext) {
  const path = url.pathname.slice('/api/data-core/staff-reports'.length);
  const json = async () => { try { return await request.json(); } catch { return fail(400, '요청 내용을 확인하세요.'); } };
  if (path === '' && request.method === 'GET') return listReports(db, context, url);
  if (path === '' && request.method === 'POST') return reportDetail(db, context, await saveReport(db, context, await json()), false);
  if (path === '/photos' && request.method === 'POST') {
    if (!bucket) fail(503, '사진 보관소가 연결되지 않았습니다.');
    const form = await request.formData().catch(() => fail(400, '사진을 확인하세요.'));
    const file = (form as FormData).get('file');
    if (!(file instanceof File) || !['image/webp', 'image/jpeg', 'image/png'].includes(file.type) || file.size > PHOTO_BYTES || !file.size) fail(400, '사진은 4MB 이하의 JPG·PNG·WEBP만 올릴 수 있습니다.');
    const ext = (file as File).type === 'image/png' ? 'png' : (file as File).type === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `staff-reports/${photoOwner(context)}/${crypto.randomUUID()}.${ext}`;
    await bucket!.put(key, await (file as File).arrayBuffer(), { httpMetadata: { contentType: (file as File).type } });
    return { key };
  }
  const photo = path.match(/^\/photos\/([\w-]+)\/([\w-]+\.(?:webp|jpg|png))$/);
  if (photo && request.method === 'GET') {
    if (!bucket) fail(503, '사진 보관소가 연결되지 않았습니다.');
    const object = await bucket!.get(`staff-reports/${photo[1]}/${photo[2]}`);
    if (!object) fail(404, '사진을 찾을 수 없습니다.');
    return new Response(object!.body, { headers: { 'content-type': object!.httpMetadata?.contentType || 'image/webp', 'cache-control': 'private, max-age=86400' } });
  }
  const one = path.match(/^\/([\w-]{8,64})(\/reactions|\/comments(?:\/([\w-]{8,64}))?)?$/);
  if (!one) return null;
  const [, id, sub, commentId] = one;
  if (!sub && request.method === 'GET') return reportDetail(db, context, id, url.searchParams.get('read') === '1');
  if (!sub && request.method === 'PATCH') return reportDetail(db, context, await saveReport(db, context, await json(), id), false);
  if (!sub && request.method === 'DELETE') {
    const row = await reportRow(db, id);
    if (row.author_user_id !== context.user!.internalUserId && !context.isSuperAdmin) fail(403, '본인이 쓴 업무보고만 지울 수 있습니다.');
    await db.prepare('UPDATE staff_reports SET deleted_at=? WHERE id=?').bind(now(), id).run();
    return { ok: true };
  }
  if (sub === '/reactions' && request.method === 'POST') {
    await reportRow(db, id);
    const mine = await db.prepare('SELECT 1 FROM staff_report_reactions WHERE report_id=? AND user_id=?').bind(id, context.user!.internalUserId).first();
    await (mine ? db.prepare('DELETE FROM staff_report_reactions WHERE report_id=? AND user_id=?').bind(id, context.user!.internalUserId)
      : db.prepare('INSERT INTO staff_report_reactions (report_id, user_id, created_at) VALUES (?, ?, ?)').bind(id, context.user!.internalUserId, now())).run();
    return reportDetail(db, context, id, false);
  }
  if (sub === '/comments' && request.method === 'POST') {
    await reportRow(db, id);
    const body = String((await json())?.body ?? '').trim().slice(0, 1000);
    if (!body) fail(400, '댓글을 적어 주세요.');
    await db.prepare('INSERT INTO staff_report_comments (id, report_id, user_id, user_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, context.user!.internalUserId, author(context), body, now()).run();
    return reportDetail(db, context, id, false);
  }
  if (sub?.startsWith('/comments/') && request.method === 'DELETE') {
    const comment = await db.prepare('SELECT user_id FROM staff_report_comments WHERE id=? AND report_id=? AND deleted_at IS NULL').bind(commentId, id).first<{ user_id: string }>();
    if (!comment) fail(404, '댓글을 찾을 수 없습니다.');
    if (comment!.user_id !== context.user!.internalUserId && !context.isSuperAdmin) fail(403, '본인 댓글만 지울 수 있습니다.');
    await db.prepare('UPDATE staff_report_comments SET deleted_at=? WHERE id=?').bind(now(), commentId).run();
    return reportDetail(db, context, id, false);
  }
  return null;
}

// ---------- 고정 업무 ----------
// 전체 캠퍼스 tasks (campus_id NULL) are managed by MASTER; a campus task by that campus's 캠퍼스 관리자 (or MASTER).
const canManageTask = (context: DataCoreAccessContext, campusId: string | null) => context.isSuperAdmin || (campusId !== null && managesCampus(context, campusId));
const visibleTask = (context: DataCoreAccessContext, campusId: string | null) => campusId === null || context.isSuperAdmin || context.campusIds.includes(campusId);

async function listFixedTasks(db: D1Database, context: DataCoreAccessContext, url: URL) {
  const month = url.searchParams.get('month') || '';
  if (!MONTH.test(month)) fail(400, '월을 확인하세요.');
  const [y, m] = month.split('-').map(Number);
  const rows = (await db.prepare('SELECT * FROM calendar_fixed_tasks WHERE organization_id=? AND deleted_at IS NULL ORDER BY created_at').bind(ORG).all<any>()).results || [];
  const names = await campusNames(db);
  const tasks = [];
  for (const row of rows.filter(r => visibleTask(context, r.campus_id))) {
    const task: any = { id: row.id, title: row.title, campusId: row.campus_id, campusName: row.campus_id ? names.get(row.campus_id) || '' : '전체 캠퍼스', rule: row.rule, ruleValue: row.rule_value, kind: row.kind || null,
      dates: ruleDates(row.rule, row.rule_value, y, m), canManage: canManageTask(context, row.campus_id) };
    if (row.kind === 'monthly-report') {
      // The deadline shown in this month is for the previous month's 업무보고.
      task.reportMonth = shiftMonth(month, -1);
      task.title = `${Number(task.reportMonth.slice(5))}월 ${row.title}`;
      const submitted = await db.prepare('SELECT COUNT(DISTINCT author_user_id) AS n FROM staff_reports WHERE organization_id=? AND report_month=? AND deleted_at IS NULL').bind(ORG, task.reportMonth).first<{ n: number }>();
      const staff = await db.prepare(`SELECT COUNT(DISTINCT m.user_id) AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND u.status='active'`).bind(ORG).first<{ n: number }>();
      task.submittedCount = submitted?.n || 0; task.staffCount = staff?.n || 0;
    }
    tasks.push(task);
  }
  const manageable = context.isSuperAdmin ? [null, ...names.keys()] : context.memberships.filter(x => x.role === 'CAMPUS_ADMIN' && x.campusId).map(x => x.campusId);
  return { month, tasks, canCreate: context.isSuperAdmin || isCampusAdmin(context),
    manageableCampuses: manageable.map(id => ({ id, name: id ? names.get(id) || id : '전체 캠퍼스' })) };
}

function taskInput(input: any) {
  const title = text(input?.title, 60);
  if (!title) fail(400, '업무 이름을 적어 주세요.');
  const rule = String(input?.rule || '');
  if (!RULES.includes(rule)) fail(400, '날짜 규칙을 골라 주세요.');
  let value: number | null = null;
  if (rule === 'month-day') { value = Number(input?.ruleValue); if (!Number.isInteger(value) || value < 1 || value > 31) fail(400, '날짜는 1~31 사이로 골라 주세요.'); }
  if (rule === 'weekday') { value = Number(input?.ruleValue); if (!Number.isInteger(value) || value < 0 || value > 6) fail(400, '요일을 골라 주세요.'); }
  const campusId = typeof input?.campusId === 'string' && input.campusId ? input.campusId : null;
  return { title, rule, value, campusId };
}

async function handleFixedTasks(request: Request, url: URL, db: D1Database, context: DataCoreAccessContext) {
  const path = url.pathname.slice('/api/data-core/calendar/fixed-tasks'.length);
  const json = async () => { try { return await request.json(); } catch { return fail(400, '요청 내용을 확인하세요.'); } };
  if (path === '' && request.method === 'GET') return listFixedTasks(db, context, url);
  if (path === '' && request.method === 'POST') {
    const t = taskInput(await json());
    if (!canManageTask(context, t.campusId)) fail(403, t.campusId ? '자기 캠퍼스의 고정 업무만 등록할 수 있습니다.' : '전체 캠퍼스 고정 업무는 MASTER만 등록할 수 있습니다.');
    const at = now();
    await db.prepare('INSERT INTO calendar_fixed_tasks (id, organization_id, campus_id, title, rule, rule_value, kind, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .bind(crypto.randomUUID(), ORG, t.campusId, t.title, t.rule, t.value, context.user!.internalUserId, at, at).run();
    return listFixedTasks(db, context, url);
  }
  const one = path.match(/^\/([\w-]{8,64})$/);
  if (!one || !['PATCH', 'DELETE'].includes(request.method)) return null;
  const row = await db.prepare('SELECT * FROM calendar_fixed_tasks WHERE id=? AND organization_id=? AND deleted_at IS NULL').bind(one[1], ORG).first<any>();
  if (!row) fail(404, '고정 업무를 찾을 수 없습니다.');
  if (!canManageTask(context, row.campus_id)) fail(403, row.campus_id ? '자기 캠퍼스의 고정 업무만 고칠 수 있습니다.' : '전체 캠퍼스 고정 업무는 MASTER만 고칠 수 있습니다.');
  if (request.method === 'DELETE') {
    if (row.kind === 'monthly-report') fail(400, '월간 업무보고 마감은 지울 수 없습니다. 날짜 규칙만 바꿀 수 있습니다.');
    await db.prepare('UPDATE calendar_fixed_tasks SET deleted_at=? WHERE id=?').bind(now(), row.id).run();
    return listFixedTasks(db, context, url);
  }
  const t = taskInput(await json());
  if (row.kind === 'monthly-report' && t.campusId !== null) fail(400, '월간 업무보고 마감은 전체 캠퍼스 업무입니다.');
  if (!canManageTask(context, t.campusId)) fail(403, '이 캠퍼스로 옮길 권한이 없습니다.');
  await db.prepare('UPDATE calendar_fixed_tasks SET title=?, rule=?, rule_value=?, campus_id=?, updated_at=? WHERE id=?').bind(t.title, t.rule, t.value, t.campusId, now(), row.id).run();
  return listFixedTasks(db, context, url);
}

export async function handleStaffWorkApi(request: Request, db: D1Database, bucket: R2Bucket | undefined, context: DataCoreAccessContext) {
  const url = new URL(request.url);
  const reports = url.pathname === '/api/data-core/staff-reports' || url.pathname.startsWith('/api/data-core/staff-reports/');
  const tasks = url.pathname === '/api/data-core/calendar/fixed-tasks' || url.pathname.startsWith('/api/data-core/calendar/fixed-tasks/');
  if (!reports && !tasks) return null;
  requireWriteAccess(context);
  if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) fail(403, '같은 사이트에서만 요청할 수 있습니다.');
  await ensureTables(db);
  const result = reports ? await handleReports(request, url, db, bucket, context) : await handleFixedTasks(request, url, db, context);
  if (result === null) return null;
  return result instanceof Response ? result : Response.json(result, { headers: { 'cache-control': 'no-store' } });
}

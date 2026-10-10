import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// 출석부 ↔ 출석체크 연동. Synthetic people and numbers only.
const ADMIN = { id: 'kk-roster-admin', email: 'kk-roster-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-roster-teacher', email: 'kk-roster-teacher@example.test', name: '배정 강사' };
const CAMPUS_A = 'campus-anihi-admission';

const auth = user => ({
  'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
});

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-roster', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body } = {}) {
    const headers = new Headers(user ? auth(user) : undefined);
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('origin', 'http://localhost'); }
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  return { mf, env, request };
}

// Today in Korean time and its weekday, the way the worker decides "today".
const kst = new Date(Date.now() + 9 * 3600_000);
const today = kst.toISOString().slice(0, 10), month = today.slice(0, 7);
const WD = '일월화수목금토', wd = WD[kst.getUTCDay()], notToday = WD[(kst.getUTCDay() + 2) % 7];

test('출석부 연동: the month roster lists today\'s students by 수업요일 with phone numbers, links existing students, registers missing ones', async () => {
  const h = await harness();
  try {
    const cls = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS_A, name: '기초반' } });
    const existing = await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS_A, name: '가상학생가', classId: cls.body.class.id, status: 'active' } });
    const roster = { campusId: CAMPUS_A, month, sourceName: '종합.xlsx', classes: [
      { name: '기초반', students: [
        { no: 1, name: '가상학생가', studentPhone: '010-0000-0001', parentPhone: '010-0000-0002', slots: [`${wd}1`, `${notToday}1`] },
        { no: 2, name: '가상학생나', parentPhone: '010-0000-0003', slots: [`${notToday}1`] } ] },
      { name: '입시반', students: [
        { no: 1, name: '가상학생다', studentPhone: '010 0000 0004', parentPhone: '010-0000-0005', slots: [`${wd}1`, `${wd}2`, '휴9'] },
        { no: 2, name: '가상학생가', parentPhone: '010-0000-0002', slots: [`${wd}3`] } ] } ] };

    assert.equal((await h.request('/api/kkumeum/attendance/roster', { user: TEACHER, method: 'PUT', body: roster })).status, 403, 'only 원장·관리자 save the roster');
    const saved = await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: roster });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.created, { classes: 1, students: 2 }, 'existing 가상학생가 is linked, 나·다 and 입시반 are new');
    assert.deepEqual((await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: roster })).body.created, { classes: 0, students: 0 }, 'saving again is idempotent');
    const sameChild = await h.env.FAMILY_DB.prepare("SELECT COUNT(*) AS n FROM family_students WHERE name = '가상학생가'").first('n');
    assert.equal(sameChild, 1, 'one child in two classes stays one student');

    const day = await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS_A}`);
    assert.equal(day.status, 200);
    const s = day.body.schedule;
    assert.deepEqual([s.month, s.exact, s.weekday, s.todayCount], [month, true, wd, 3]);
    const rows = s.classes.flatMap(c => c.students.map(e => ({ ...e, cls: c.name })));
    assert.deepEqual(rows.filter(e => e.today).map(e => `${e.cls}:${e.name}:${e.times.join('.')}`).sort(), ['기초반:가상학생가:1', '입시반:가상학생가:3', '입시반:가상학생다:1.2'].sort());
    const da = rows.find(e => e.name === '가상학생다');
    assert.deepEqual([da.studentPhone, da.parentPhone, da.slots], ['010 0000 0004', '010-0000-0005', [`${wd}1`, `${wd}2`]]);
    assert.equal(rows.find(e => e.cls === '기초반' && e.name === '가상학생가').studentId, existing.body.student.id);

    const mark = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS_A, status: 'arrive', studentIds: [da.studentId] } });
    assert.equal(mark.status, 201, JSON.stringify(mark.body));
    const after = (await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS_A}`)).body.schedule.classes.flatMap(c => c.students);
    assert.deepEqual(after.find(e => e.name === '가상학생다').events.map(e => e.status), ['arrive']);

    const status = await h.request(`/api/kkumeum/attendance/roster?campusId=${CAMPUS_A}`);
    assert.deepEqual(status.body.rosters.map(r => [r.month, r.students]), [[month, 4]]);
    assert.equal((await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: { ...roster, month: '2026-13' } })).status, 400);
  } finally { await h.mf.dispose(); }
});

test('출석부 연동: without a roster the day view says so; a teacher without classes sees no roster rows or numbers', async () => {
  const h = await harness();
  try {
    const empty = await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS_A}`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.schedule, null);
    await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: { campusId: CAMPUS_A, month, classes: [{ name: '기초반', students: [{ name: '가상학생가', parentPhone: '010-0000-0002', slots: [`${wd}1`] }] }] } });
    const teacher = await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS_A}`, { user: TEACHER });
    assert.ok(teacher.status === 403 || (teacher.body.schedule?.classes || []).length === 0, 'no roster rows or phone numbers for an unassigned teacher');
  } finally { await h.mf.dispose(); }
});

test('출석부 연동 UI: 출석부 page saves the roster; 출석체크 shows 오늘 수업, 미등원 and tel: call buttons', () => {
  const page = fs.readFileSync('public/data-core/work/attendance-roster.js', 'utf8');
  assert.match(page, /\/api\/kkumeum\/attendance\/roster/);
  assert.match(page, /method:'PUT'/);
  assert.match(page, /slots:s\.schedule\?\.slots\|\|\[\]/);
  assert.match(page, /Excel 출석부는 정상적으로 만들어졌습니다/, 'a link failure never hides the generated Excel');
  const att = fs.readFileSync('public/data-core/work/kkumeum-attendance.js', 'utf8');
  for (const text of ['오늘 수업', '이 달 명단 전체', '미등원', '학부모', 'tel:', '출석부가 아직 연동되지 않았습니다']) assert.ok(att.includes(text), text);
  assert.match(att, /fetchMonthHolidays/, 'days off come from the same calendar as the 출석부');
  assert.match(fs.readFileSync('public/data-core/work/kkumeum.html', 'utf8'), /kkumeum-attendance\.js\?v=20261010-roster/);
});

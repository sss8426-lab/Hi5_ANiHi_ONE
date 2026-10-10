import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { unzipSync, strFromU8 } from '../public/data-core/vendor/fflate-0.8.3.js';
import { buildRosterWorkbook, MARKS } from '../public/data-core/work/attendance-roster-export.js';
import { sheetRoster } from '../public/data-core/work/kkumeum-attendance-sheet.js';

// Synthetic people only.
const ADMIN = { id: 'kk-review-admin', email: 'kk-review-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-review-teacher', email: 'kk-review-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const kstNow = () => new Date(Date.now() + 9 * 3600_000);
const WEEKDAY = '일월화수목금토'[kstNow().getUTCDay()];
const TODAY = kstNow().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-review', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body } = {}) {
    const headers = new Headers(auth(user));
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('origin', 'http://localhost'); }
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  return { mf, env, request };
}

test('명단 정리: 동명이인 연결, 출석부에 없는 재원생 퇴원, 반 이동·수업요일·휴원, and 출결 반영 출석부 marks', async () => {
  const h = await harness();
  try {
    const classOf = async name => (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name } })).body.class.id;
    const basic = await classOf('기초반'), deep = await classOf('심화반');
    const add = async (name, classId) => (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId, status: 'active' } })).body.student.id;
    const ga = await add('가상학생가', basic), naBasic = await add('가상학생나', basic), naDeep = await add('가상학생나', deep), ma = await add('가상학생마', basic);
    const saved = await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: { campusId: CAMPUS, month: MONTH, sourceName: 'synthetic.xlsx', classes: [
      { name: '기초반', students: [{ no: 1, name: '가상학생가', parentPhone: '010-0000-0001', slots: [`${WEEKDAY}1`], registered: { serial: 46000, text: '' } }] },
      { name: '드로잉반', students: [{ no: 2, name: '가상학생나', parentPhone: '010-0000-0002', slots: [`${WEEKDAY}1`] }] }] } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.unmatched.map(u => [u.name, u.reason]), [['가상학생나', 'ambiguous']]);

    let review = (await h.request(`/api/kkumeum/attendance/roster-review?campusId=${CAMPUS}`)).body;
    assert.equal(review.month, MONTH);
    const naRow = review.rows.find(r => r.name === '가상학생나');
    assert.equal(naRow.reason, 'ambiguous');
    assert.deepEqual(naRow.candidates.map(c => c.id).sort(), [naBasic, naDeep].sort());
    assert.deepEqual(review.notInRoster.map(s => s.id).sort(), [naBasic, naDeep, ma].sort(), 'active students the 출석부 does not list');
    assert.equal((await h.request(`/api/kkumeum/attendance/roster-review?campusId=${CAMPUS}`, { user: TEACHER })).status, 403, '명단 정리 is for 원장·관리자');

    const post = body => h.request('/api/kkumeum/attendance/roster-review', { method: 'POST', body: { campusId: CAMPUS, month: MONTH, updatedAt: review.updatedAt, ...body } });
    // 동명이인: this 가상학생나 is the 심화반 one.
    const before = review.updatedAt;
    let r = await post({ action: 'link', key: naRow.key, name: naRow.name, studentId: naDeep });
    assert.equal(r.status, 200, JSON.stringify(r.body)); review = r.body;
    assert.deepEqual(review.rows.find(x => x.name === '가상학생나').reason, 'matched');
    assert.equal((await post({ action: 'link', key: naRow.key, name: naRow.name, studentId: naBasic, updatedAt: before })).status, 409, 'a stale screen cannot overwrite');
    assert.equal((await h.request('/api/kkumeum/attendance/roster-review', { method: 'POST', body: { campusId: CAMPUS, month: MONTH, updatedAt: review.updatedAt, action: 'link', key: naRow.key, name: '다른이름', studentId: naBasic } })).status, 409, 'the row name must still match');

    // 출석부에 없는 재원생: 퇴원 → gone from 등하원 번호 and 출석체크; 재원으로 되돌리면 다시.
    r = await post({ action: 'status', studentId: ma, status: 'withdrawn' }); assert.equal(r.status, 200); review = r.body;
    assert.ok(!review.notInRoster.some(s => s.id === ma));
    let codes = (await h.request(`/api/kkumeum/attendance/students?campusId=${CAMPUS}`)).body.students;
    assert.ok(!codes.some(s => s.id === ma), '퇴원생 has no 등하원 번호 row');
    assert.equal((await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS, studentIds: [ma], status: 'arrive' } })).status, 409, '퇴원생 cannot be marked');
    assert.equal((await post({ action: 'status', studentId: ma, status: 'graduated' })).status, 400);

    // 반 이동 · 수업요일 · 휴원 on one row.
    const gaRow = review.rows.find(x => x.name === '가상학생가');
    r = await post({ action: 'edit', key: gaRow.key, name: gaRow.name, className: '심화반', slots: [`${WEEKDAY}2`, '월1', 'x9'], status: 'leave' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); review = r.body;
    const moved = review.rows.find(x => x.name === '가상학생가');
    assert.equal(moved.className, '심화반'); assert.equal(moved.status, 'leave');
    assert.ok(moved.slots.includes('월1') && moved.slots.includes(`${WEEKDAY}2`) && !moved.slots.includes('x9'));
    const student = (await h.request(`/api/kkumeum/students/${ga}?campusId=${CAMPUS}`)).body.student;
    assert.equal(student.current_class_id || student.currentClassId, deep, '꿈이음 반 moved too');
    const day = (await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`)).body;
    assert.ok(!day.schedule.classes.some(c => c.students.some(s => s.studentId === ga)), '휴원생 leaves 출석체크');

    // 출결 반영 출석부: 가상학생나 지각 today → 'late' in that date.
    assert.equal((await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS, studentIds: [naDeep], status: 'late' } })).status, 201);
    const sheet = (await h.request(`/api/kkumeum/attendance/sheet?campusId=${CAMPUS}&month=${MONTH}`)).body;
    const rows = sheet.classes.flatMap(c => c.students);
    assert.equal(rows.find(s => s.name === '가상학생나').marks[TODAY], 'late');
    assert.equal(rows.find(s => s.name === '가상학생가').status, 'leave');
    assert.deepEqual(rows.find(s => s.name === '가상학생가').registered, { serial: 46000, text: '' }, '등록일 kept from the 출석부');
    assert.equal((await h.request(`/api/kkumeum/attendance/sheet?campusId=${CAMPUS}&month=2001-01`)).status, 404);
  } finally { await h.mf.dispose(); }
});

test('출결 반영 출석부 Excel: symbols over the planned blue keep 일수, extra days in green, title and legend', () => {
  const [y, m] = [2026, 10];
  const roster = sheetRoster({ classes: [{ name: '기초반', students: [
    { no: 1, name: '가상학생가', school: '', grade: '', studentPhone: '', parentPhone: '', registered: null, slots: ['화1'], status: 'active',
      marks: { '2026-10-06': 'present', '2026-10-13': 'late', '2026-10-20': 'absent', '2026-10-08': 'makeup' } },
    { no: 2, name: '가상학생나', school: '', grade: '', studentPhone: '', parentPhone: '', registered: null, slots: ['화1'], status: 'withdrawn', marks: {} }] }] }, '가상캠퍼스');
  assert.equal(roster.classes[0].students[1].name, '가상학생나 (퇴원)');
  const out = buildRosterWorkbook(roster, { year: y, month: m, attendance: { asOf: '10/21' } });
  assert.equal(out.filename, '가상캠퍼스_2026년10월_반별출석부_출결반영.xlsx');
  const files = unzipSync(out.bytes), sheet = strFromU8(files['xl/worksheets/sheet1.xml']), styles = strFromU8(files['xl/styles.xml']);
  assert.match(sheet, /2026년 10월 기초반 출석부 \(출결 반영\)/); assert.match(sheet, /꿈이음 출석체크 10\/21 기준/);
  for (const mark of [MARKS.present, MARKS.late, MARKS.absent, MARKS.makeup]) assert.ok(styles.includes(`formatCode="&quot;${mark.text}&quot;;;;"`), mark.label);
  assert.match(sheet, /출결: ○ 출석 · 지 지각 · 조 조퇴 · 결 결석 · 보 보강/);
  assert.equal((sheet.match(/<c r="[A-Z]+5" s="\d+"><v>2<\/v>/g) || []).length, 1, '보강 on a non-lesson day is one extra (uncounted) cell');
  // The plain 출석부 is unchanged: only the two original number formats.
  const plain = strFromU8(unzipSync(buildRosterWorkbook(roster, { year: y, month: m }).bytes)['xl/styles.xml']);
  assert.match(plain, /<numFmts count="2"><numFmt numFmtId="176" formatCode="yy\\-mm\\-dd"\/><numFmt numFmtId="177" formatCode=";;;"\/><\/numFmts>/);
});

test('명단 정리 · 출결 반영 출석부 UI is wired to the server and the 출석부 writer', () => {
  const admin = fs.readFileSync('public/data-core/work/kkumeum-attendance-admin.js', 'utf8');
  for (const piece of ['/api/kkumeum/attendance/roster-review', 'data-ka-link', 'data-ka-create', 'data-ka-left', 'data-ka-edit-save', 'data-ka-sheet', 'kkumeum-attendance-sheet.js']) assert.ok(admin.includes(piece), piece);
  const staff = fs.readFileSync('public/data-core/work/kkumeum-attendance.js', 'utf8');
  assert.match(staff, /data-att-sheet/); assert.match(staff, /kkumeum-attendance-sheet\.js/);
  assert.match(fs.readFileSync('public/data-core/work/attendance-roster.js', 'utf8'), /registered:s\.registered/);
});

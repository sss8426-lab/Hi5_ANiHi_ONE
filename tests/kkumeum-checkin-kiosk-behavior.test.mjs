import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic people only.
const ADMIN = { id: 'kk-kiosk-admin', email: 'kk-kiosk-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-kiosk-teacher', email: 'kk-kiosk-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const kstNow = () => new Date(Date.now() + 9 * 3600_000);
const WEEKDAY = '일월화수목금토'[kstNow().getUTCDay()];
const MONTH = kstNow().toISOString().slice(0, 7);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-kiosk', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, cookie, ip = '203.0.113.20' } = {}) {
    const headers = new Headers(user ? auth(user) : undefined);
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('origin', 'http://localhost'); }
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', ip);
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  }
  return { mf, env, request };
}

async function seed(h) {
  const cls = (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name: '기초반' } })).body.class.id;
  const ids = [];
  for (const name of ['가상학생가', '가상학생나', '가상학생다']) ids.push((await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId: cls, status: 'active' } })).body.student.id);
  const roster = await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: { campusId: CAMPUS, month: MONTH, sourceName: 'synthetic.xlsx', classes: [{ name: '기초반', students: [
    { no: 1, name: '가상학생가', parentPhone: '010-0000-0001', slots: [`${WEEKDAY}1`] },
    { no: 2, name: '가상학생나', parentPhone: '010-0000-0002', slots: [`${WEEKDAY}1`] },
    { no: 3, name: '가상학생라', parentPhone: '', slots: [`${WEEKDAY}2`] }] }] } });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  return { cls, ids, roster: roster.body };
}

test('출결기: pair with a 연결번호, check in by 등하원 번호, double press ignored, auto 지각, revoke', async () => {
  const h = await harness();
  try {
    const { roster } = await seed(h);
    assert.equal(roster.codesAssigned, 4, '3 existing + 1 roster-created student got numbers');
    const list = (await h.request(`/api/kkumeum/attendance/students?campusId=${CAMPUS}`)).body.students;
    const ga = list.find(s => s.name === '가상학생가'), na = list.find(s => s.name === '가상학생나');
    assert.match(ga.code, /^\d{4}$/); assert.equal(new Set(list.map(s => s.code)).size, list.length, 'numbers are unique');
    assert.equal(ga.parentPhone, '010-0000-0001', 'parent phone from the 출석부 for 문자 보내기');

    assert.equal((await h.request(`/api/kkumeum/attendance/students/${ga.id}/code`, { method: 'PUT', body: { campusId: CAMPUS, code: na.code } })).status, 409);
    assert.equal((await h.request(`/api/kkumeum/attendance/students/${ga.id}/code`, { method: 'PUT', body: { campusId: CAMPUS, code: '12a' } })).status, 400);
    assert.equal((await h.request(`/api/kkumeum/attendance/students/${ga.id}/code`, { method: 'PUT', body: { campusId: CAMPUS, code: '7777' } })).status, 200);

    // 1타임 starts at 00:00 with 0 minutes grace: any 등원 now is late. 가상학생나's 출결기 등원 → 지각.
    const saved = await h.request('/api/kkumeum/attendance/settings', { method: 'PUT', body: { campusId: CAMPUS, settings: { weekday: { 1: '00:00' }, weekend: { 1: '00:00' }, lateMinutes: 0 } } });
    assert.equal(saved.status, 200); assert.equal(saved.body.settings.weekday['1'], '00:00');

    assert.equal((await h.request('/api/kiosk/checkin', { user: null, method: 'POST', body: { code: '7777', action: 'arrive' } })).status, 401, 'an unpaired tablet cannot check in');
    const pairing = await h.request('/api/kkumeum/attendance/kiosks', { method: 'POST', body: { campusId: CAMPUS, label: '입시반 출결기' } });
    assert.equal(pairing.status, 201); assert.match(pairing.body.pairingCode, /^\d{3} \d{3}$/);
    assert.equal((await h.request('/api/kiosk/pair', { user: null, method: 'POST', body: { code: '000000' } })).status, 401);
    const paired = await h.request('/api/kiosk/pair', { user: null, method: 'POST', body: { code: pairing.body.pairingCode } });
    assert.equal(paired.status, 200); assert.equal(paired.body.label, '입시반 출결기'); assert.match(paired.cookie, /^kkumeum_kiosk=/);
    assert.equal((await h.request('/api/kiosk/pair', { user: null, method: 'POST', body: { code: pairing.body.pairingCode } })).status, 401, 'a 연결번호 works once');
    const kiosk = paired.cookie;
    assert.equal((await h.request('/api/kiosk/session', { user: null, cookie: kiosk })).body.campusName, '부천 애니 입시본원');

    const arrive = await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: na.code, action: 'arrive' } });
    assert.equal(arrive.status, 200, JSON.stringify(arrive.body));
    assert.deepEqual([arrive.body.name, arrive.body.status, arrive.body.duplicate, arrive.body.slot, arrive.body.slotStart], ['가상학생나', 'late', false, '1', '00:00']);
    const again = await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: na.code, action: 'arrive' } });
    assert.equal(again.body.duplicate, true, 'the same 등원 again is not recorded twice');
    const leave = await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: na.code, action: 'leave' } });
    assert.deepEqual([leave.body.status, leave.body.duplicate], ['leave', false]);
    assert.equal((await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: '0000', action: 'arrive' } })).status, 404);

    const day = (await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`)).body;
    const row = day.students.find(s => s.id === na.id);
    assert.deepEqual(row.events.map(e => [e.status, e.source]), [['late', 'kiosk'], ['leave', 'kiosk']]);
    assert.equal(day.contacts[ga.id].code, '7777'); assert.equal(day.contacts[ga.id].guardians, 0);
    assert.equal(day.slotStarts['1'], '00:00'); assert.equal(day.canManage, true);

    const kiosks = (await h.request(`/api/kkumeum/attendance/kiosks?campusId=${CAMPUS}`)).body.kiosks;
    assert.equal(kiosks[0].todayCount, 2);
    assert.equal((await h.request(`/api/kkumeum/attendance/kiosks/${kiosks[0].id}`, { method: 'DELETE', body: { campusId: CAMPUS } })).status, 200);
    assert.equal((await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: '7777', action: 'arrive' } })).status, 401, '연결 끊기 stops the tablet at once');

    // 한 번 눌러 등원 from the staff screen uses the same 지각 rule.
    const quick = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS, status: 'arrive', auto: true, studentIds: [ga.id] } });
    assert.equal(quick.body.marked[0].status, 'late');
  } finally { await h.mf.dispose(); }
});

test('출결기: too many wrong numbers pause the tablet; a queued offline press keeps its time', async () => {
  const h = await harness();
  try {
    await seed(h);
    const code = (await h.request('/api/kkumeum/attendance/kiosks', { method: 'POST', body: { campusId: CAMPUS, label: '예비반' } })).body.pairingCode;
    const kiosk = (await h.request('/api/kiosk/pair', { user: null, method: 'POST', body: { code } })).cookie;
    const list = (await h.request(`/api/kkumeum/attendance/students?campusId=${CAMPUS}`)).body.students;
    const at = new Date(Date.now() - 20 * 60_000).toISOString();
    const queued = await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: list[0].code, action: 'leave', at } });
    const ev = (await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`)).body.students.find(s => s.id === list[0].id).events[0];
    assert.equal(ev.occurredAt, at, 'the press time from the tablet is kept');
    assert.equal(queued.status, 200);
    for (let i = 0; i < 20; i++) await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: '0001', action: 'arrive' } });
    assert.equal((await h.request('/api/kiosk/checkin', { user: null, cookie: kiosk, method: 'POST', body: { code: list[1].code, action: 'arrive' } })).status, 429);
  } finally { await h.mf.dispose(); }
});

test('담당 선생님 배정 opens 출석체크 to a teacher; settings stay with 원장·관리자; 인증키 한꺼번에 for unlinked students', async () => {
  const h = await harness();
  try {
    const { cls, ids } = await seed(h);
    await h.request('/api/data-core/context', { user: TEACHER });
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
      .bind('m-kiosk-teacher', CAMPUS, `oai:${TEACHER.id}`, new Date().toISOString(), new Date().toISOString()).run();
    assert.equal((await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`, { user: TEACHER })).body.students.length, 0, 'no class yet');
    const teachers = (await h.request(`/api/kkumeum/attendance/teachers?campusId=${CAMPUS}`)).body;
    const me = teachers.staff.find(s => s.id === `oai:${TEACHER.id}`);
    assert.ok(me, JSON.stringify(teachers.staff));
    assert.equal((await h.request('/api/kkumeum/attendance/teachers', { method: 'PUT', body: { campusId: CAMPUS, classId: cls, teacherIds: [me.id] } })).status, 200);
    const mine = (await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS}`, { user: TEACHER })).body;
    assert.equal(mine.students.length, 4, 'the assigned class (3 students + 1 added by the 출석부) shows up for the teacher');
    assert.ok(ids.every(id => mine.students.some(s => s.id === id)));
    assert.deepEqual(mine.teachers['기초반'], ['가상 강사']);
    assert.equal(mine.canManage, false);
    assert.equal((await h.request('/api/kkumeum/attendance/settings', { user: TEACHER, method: 'PUT', body: { campusId: CAMPUS, settings: {} } })).status, 403);
    assert.equal((await h.request(`/api/kkumeum/attendance/students?campusId=${CAMPUS}`, { user: TEACHER })).status, 403);

    const bulk = await h.request('/api/kkumeum/attendance/invites', { method: 'POST', body: { campusId: CAMPUS } });
    assert.equal(bulk.status, 201); assert.equal(bulk.body.issued.length, 4);
    const first = bulk.body.issued.find(i => i.name === '가상학생가');
    assert.equal(first.parentPhone, '010-0000-0001'); assert.match(first.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal((await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: first.code, relationship: '어머니' } })).status, 200);
    const again = await h.request('/api/kkumeum/attendance/invites', { method: 'POST', body: { campusId: CAMPUS } });
    assert.equal(again.body.issued.length, 3, 'a connected student is not reissued');
  } finally { await h.mf.dispose(); }
});

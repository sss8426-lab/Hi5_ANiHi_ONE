import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic people only.
const ADMIN = { id: 'kk-att-admin', email: 'kk-att-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-att-teacher', email: 'kk-att-teacher@example.test', name: '배정 강사' };
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-design-admission';

const auth = user => ({
  'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
});

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-att', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, cookie, ip = '203.0.113.7' } = {}) {
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
  const cls = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS_A, name: '기초반' } });
  assert.equal(cls.status, 201, JSON.stringify(cls.body));
  const mk = async (name, campusId = CAMPUS_A, classId = cls.body.class.id) => {
    const r = await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId, name, classId, status: 'active' } });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.student.id;
  };
  const other = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS_B, name: '디자인반' } });
  return { classId: cls.body.class.id, s1: await mk('가상학생가'), s2: await mk('가상학생나'), foreign: await mk('다른캠퍼스학생', CAMPUS_B, other.body.class.id) };
}

test('인증키: issue once, parent starts with it, adds a second child, wrong codes are throttled, reissue retires the old code', async () => {
  const h = await harness();
  try {
    const { s1, s2 } = await seed(h);
    const issued = await h.request(`/api/kkumeum/students/${s1}/invite-code`, { method: 'POST', body: { campusId: CAMPUS_A } });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.match(issued.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const stored = await h.env.FAMILY_DB.prepare('SELECT code_hash FROM family_invite_codes WHERE student_id = ?').bind(s1).first();
    assert.ok(!stored.code_hash.includes(issued.body.code.replace('-', '')), 'only a hash is stored');

    const start = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: issued.body.code.toLowerCase(), relationship: '어머니' } });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.added, false); assert.equal(start.body.childName, '가상학생가');
    assert.match(start.cookie, /^kkumeum_family_session=/);
    const children = await h.request('/api/family/children', { user: null, cookie: start.cookie });
    assert.deepEqual(children.body.children.map(c => c.studentId), [s1]);

    const second = await h.request(`/api/kkumeum/students/${s2}/invite-code`, { method: 'POST', body: { campusId: CAMPUS_A } });
    const add = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: second.body.code }, cookie: start.cookie });
    assert.equal(add.body.added, true);
    assert.deepEqual((await h.request('/api/family/children', { user: null, cookie: start.cookie })).body.children.map(c => c.studentId).sort(), [s1, s2].sort());

    const status = await h.request(`/api/kkumeum/students/${s1}/invite-code?campusId=${CAMPUS_A}`);
    assert.deepEqual([status.body.active, status.body.redeemedCount, status.body.connectedGuardians], [true, 1, 1]);

    const reissued = await h.request(`/api/kkumeum/students/${s1}/invite-code`, { method: 'POST', body: { campusId: CAMPUS_A } });
    const old = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: issued.body.code }, ip: '198.51.100.1' });
    assert.equal(old.status, 401, 'the previous code no longer works');
    assert.equal((await h.request('/api/family/children', { user: null, cookie: start.cookie })).status, 200, 'connected phones stay connected');
    assert.equal((await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: reissued.body.code }, ip: '198.51.100.2' })).status, 200);

    for (let i = 0; i < 10; i++) assert.equal((await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: 'AAAA-AAAA' }, ip: '192.0.2.9' })).status, 401);
    const throttled = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: reissued.body.code }, ip: '192.0.2.9' });
    assert.equal(throttled.status, 429, 'even a right code waits after 10 misses from one place');

    const teacherIssue = await h.request(`/api/kkumeum/students/${s1}/invite-code`, { user: TEACHER, method: 'POST', body: { campusId: CAMPUS_A } });
    assert.equal(teacherIssue.status, 403);
  } finally { await h.mf.dispose(); }
});

test('출석체크: marks reach only the linked parent, day/month views, same-day undo, campus scope enforced', async () => {
  const h = await harness();
  try {
    const { s1, s2, foreign } = await seed(h);
    const code = (await h.request(`/api/kkumeum/students/${s1}/invite-code`, { method: 'POST', body: { campusId: CAMPUS_A } })).body.code;
    const parent = (await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '아버지' } })).cookie;

    const mark = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS_A, status: 'arrive', studentIds: [s1, s2] } });
    assert.equal(mark.status, 201, JSON.stringify(mark.body));
    assert.equal(mark.body.marked.length, 2);
    assert.equal(mark.body.marked.find(m => m.studentId === s1).guardians, 1);
    assert.equal(mark.body.push.sent, 0, 'no push keys in tests; the mark itself is saved');
    const late = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS_A, status: 'leave', studentIds: [s1], message: '오늘 작품 완성!' } });
    assert.equal(late.status, 201);

    const day = await h.request(`/api/kkumeum/attendance?campusId=${CAMPUS_A}`);
    const row = day.body.students.find(s => s.id === s1);
    assert.deepEqual(row.events.map(e => e.status), ['arrive', 'leave']);
    assert.equal(row.events[1].message, '오늘 작품 완성!');

    const month = await h.request(`/api/kkumeum/attendance/monthly?campusId=${CAMPUS_A}&month=${day.body.date.slice(0, 7)}`);
    assert.equal(month.body.students.find(s => s.id === s1).counts.arrive, 1);

    const mine = await h.request(`/api/family/children/${s1}/attendance`, { user: null, cookie: parent });
    assert.deepEqual(mine.body.events.map(e => e.label), ['등원', '하원']);
    assert.equal((await h.request(`/api/family/children/${s2}/attendance`, { user: null, cookie: parent })).status, 403, 'not this parent\'s child');

    const undo = await h.request(`/api/kkumeum/attendance/${row.events[1].id}`, { method: 'DELETE', body: {} });
    assert.equal(undo.status, 200);
    assert.deepEqual((await h.request(`/api/family/children/${s1}/attendance`, { user: null, cookie: parent })).body.events.map(e => e.label), ['등원']);

    const cross = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS_A, status: 'absent', studentIds: [foreign] } });
    assert.equal(cross.status, 403, 'a student of another campus cannot be marked through campus A');
    const teacher = await h.request('/api/kkumeum/attendance', { user: TEACHER, method: 'POST', body: { campusId: CAMPUS_A, status: 'absent', studentIds: [s1] } });
    assert.equal(teacher.status, 403, 'unassigned accounts cannot mark');
    const bad = await h.request('/api/kkumeum/attendance', { method: 'POST', body: { campusId: CAMPUS_A, status: 'party', studentIds: [s1] } });
    assert.equal(bad.status, 400);
  } finally { await h.mf.dispose(); }
});

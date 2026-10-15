import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// 출석부 → 꿈이음 반영. Synthetic people only.
const ADMIN = { id: 'kk-sync-admin', email: 'kk-sync-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-sync-teacher', email: 'kk-sync-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-sync', `${process.pid}-${Math.random()}`);
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

test('출석부 → 꿈이음 반영: 새 학생 · 반 이동 · 재원 · 휴원 · 반 숨기기를 학생마다 체크해서 적용, 적용 안 함은 다시 묻지 않음', async () => {
  const h = await harness();
  try {
    const old = (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name: '예고예비반' } })).body.class.id;
    const add = async (name, status = 'active') => (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId: old, status } })).body.student.id;
    const a = await add('가상학생가'), b = await add('가상학생나'), c = await add('가상학생다', 'leave');
    const roster = { campusId: CAMPUS, month, autoCreate: false, classes: [
      { name: '토1 기초반', students: [
        { no: 1, name: '가상학생가', parentPhone: '010-0000-0001', slots: ['토1'] },
        { no: 2, name: '가상학생다', parentPhone: '010-0000-0002', slots: ['토1'] },
        { no: 3, name: '가상학생라', parentPhone: '010-0000-0003', slots: ['토1'] } ] },
      { name: '토2 심화반', students: [{ no: 1, name: '가상학생라', parentPhone: '010-0000-0003', slots: ['토2'] }] } ] };

    const saved = await h.request('/api/kkumeum/attendance/roster', { method: 'PUT', body: roster });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.created, { classes: 0, students: 0 }, 'autoCreate:false creates nothing before the review');
    assert.equal(saved.body.sync.pending, 5);
    assert.equal((await h.env.FAMILY_DB.prepare("SELECT COUNT(*) AS n FROM family_students WHERE name = '가상학생라'").first('n')), 0);

    const plan = (await h.request(`/api/kkumeum/attendance/roster-sync?campusId=${CAMPUS}`)).body;
    const by = type => plan.items.filter(i => i.type === type);
    assert.deepEqual(plan.items.map(i => i.type), ['new', 'reactivate', 'move', 'leave', 'hide']);
    assert.equal(by('new')[0].name, '가상학생라'); assert.equal(by('new')[0].rows, 2, '두 반에 있는 같은 아이는 한 명');
    assert.deepEqual([by('move')[0].studentId, by('move')[0].fromClass, by('move')[0].toClass], [a, '예고예비반', '토1 기초반']);
    assert.equal(by('reactivate')[0].studentId, c);
    assert.equal(by('leave')[0].studentId, b); assert.equal(by('leave')[0].checked, false, '휴원은 기본으로 체크하지 않음');
    assert.equal(by('hide')[0].name, '예고예비반');
    assert.equal((await h.request(`/api/kkumeum/attendance/roster-sync?campusId=${CAMPUS}`, { user: TEACHER })).status, 403);
    assert.equal((await h.request('/api/kkumeum/attendance/roster-sync', { method: 'POST', body: { campusId: CAMPUS, month, updatedAt: 'old', apply: [by('new')[0].key] } })).status, 409);

    // 새 학생 · 재원 · 반 이동 · 반 숨기기 적용, 휴원은 적용 안 함.
    const keys = ['new', 'reactivate', 'move', 'hide'].map(t => by(t)[0].key);
    const applied = await h.request('/api/kkumeum/attendance/roster-sync', { method: 'POST', body: { campusId: CAMPUS, month, updatedAt: plan.updatedAt, apply: keys, skip: [by('leave')[0].key] } });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.deepEqual(applied.body.result.applied, { new: 1, reactivate: 1, move: 1, leave: 0, hide: 0 });
    assert.deepEqual(applied.body.result.notHidden, ['예고예비반'], '재원생(가상학생나)이 남아 있어 숨기지 않음');
    const row = async id => h.env.FAMILY_DB.prepare('SELECT s.status, c.name AS class_name FROM family_students s LEFT JOIN family_classes c ON c.id = s.current_class_id WHERE s.id = ?').bind(id).first();
    assert.deepEqual(await row(a), { status: 'active', class_name: '토1 기초반' });
    assert.deepEqual(await row(c), { status: 'active', class_name: '토1 기초반' });
    const ra = await h.env.FAMILY_DB.prepare("SELECT id, status FROM family_students WHERE name = '가상학생라'").all();
    assert.equal(ra.results.length, 1); assert.equal(ra.results[0].status, 'active');
    const saved2 = JSON.parse(await h.env.FAMILY_DB.prepare('SELECT roster_json FROM family_attendance_rosters WHERE campus_id = ? AND year_month = ?').bind(CAMPUS, month).first('roster_json'));
    assert.ok(saved2.classes.every(g => g.students.filter(s => s.name === '가상학생라').every(s => s.studentId === ra.results[0].id)), '출석부 두 줄 모두 새 학생과 연결');
    assert.equal(applied.body.pending, 1, '남은 것은 숨기지 못한 반 하나 (휴원은 적용 안 함)');
    assert.equal(applied.body.items.find(i => i.type === 'leave').skipped, true);

    // 적용 안 함 → 다시 보기 → 휴원 적용하면 빈 반도 숨겨진다.
    const back = await h.request('/api/kkumeum/attendance/roster-sync', { method: 'POST', body: { campusId: CAMPUS, month, updatedAt: applied.body.updatedAt, unskip: [by('leave')[0].key] } });
    assert.equal(back.body.items.find(i => i.type === 'leave').skipped, false);
    const finish = await h.request('/api/kkumeum/attendance/roster-sync', { method: 'POST', body: { campusId: CAMPUS, month, updatedAt: back.body.updatedAt, apply: back.body.items.map(i => i.key) } });
    assert.deepEqual(finish.body.result.applied, { new: 0, reactivate: 0, move: 0, leave: 1, hide: 1 });
    assert.equal(finish.body.pending, 0);
    assert.equal((await row(b)).status, 'leave');
    const classes = (await h.request(`/api/kkumeum/classes?campusId=${CAMPUS}`)).body.classes.filter(x => x.active).map(x => x.name).sort();
    assert.deepEqual(classes, ['토1 기초반', '토2 심화반'].sort());
    const audit = await h.env.FAMILY_DB.prepare("SELECT COUNT(*) AS n FROM family_audit_logs WHERE action = 'attendance_roster.sync'").first('n');
    assert.ok(audit >= 2);
  } finally { await h.mf.dispose(); }
});

test('UI: 출석부 화면은 만든 뒤 반영 표를 열고, 꿈이음 아이소식 맨 위에 다른 곳 알림 줄', () => {
  const read = p => fs.readFileSync(p, 'utf8');
  const sync = read('public/data-core/work/roster-sync.js');
  for (const piece of ['/api/kkumeum/attendance/roster-sync', 'data-rs-key', 'data-rs-all', 'data-rs-apply', 'data-rs-skip', 'data-rs-unskip', '적용 안 함']) assert.ok(sync.includes(piece), piece);
  const page = read('public/data-core/work/attendance-roster.js');
  assert.match(page, /autoCreate:false/); assert.match(page, /RosterSync\.mount/);
  const mobile = read('public/data-core/work/kkumeum-mobile.js');
  assert.match(mobile, /km-sync-banner/); assert.match(mobile, /view==='roster-sync'/); assert.match(mobile, /roster-sync\?\$\{q\}&summary=1/);
  const html = read('public/data-core/work/kkumeum.html');
  assert.ok(html.indexOf('roster-sync.js') > 0 && html.indexOf('roster-sync.js') < html.indexOf('kkumeum-mobile.js'));
});

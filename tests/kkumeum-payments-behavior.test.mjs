import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic people only.
const ADMIN = { id: 'kk-pay-admin', email: 'kk-pay-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-pay-teacher', email: 'kk-pay-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-pay', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, cookie, origin = 'http://localhost' } = {}) {
    const headers = new Headers(user ? auth(user) : undefined);
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('origin', origin); }
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', '203.0.113.42');
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  }
  return { mf, env, worker, request };
}
async function seed(h) {
  const cls = async name => (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name } })).body.class.id;
  const basic = await cls('기초반'), deep = await cls('심화반');
  const add = async (name, classId) => (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId, status: 'active' } })).body.student.id;
  const s1 = await add('가상학생가', basic), s2 = await add('가상학생나', deep);
  const login = async studentId => {
    const code = (await h.request(`/api/kkumeum/students/${studentId}/invite-code`, { method: 'POST', body: { campusId: CAMPUS } })).body.code;
    return (await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '어머니' } })).cookie;
  };
  return { basic, deep, s1, s2, p1: await login(s1), p2: await login(s2) };
}
async function addTeacher(h, classId) {
  await h.request('/api/data-core/context', { user: TEACHER });
  const now = new Date().toISOString();
  await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
    .bind('m-pay-teacher', CAMPUS, `oai:${TEACHER.id}`, now, now).run();
  await h.env.FAMILY_DB.prepare('INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('a-pay', classId, `oai:${TEACHER.id}`, 'TEACHER', now, now, now).run();
}

test('수납관리: 청구 · 수납 처리 · 되돌리기 · 취소 · 일일 결산 · 보호자 조회, 원장·관리자만', async () => {
  const h = await harness();
  try {
    const { basic, s1, s2, p1, p2 } = await seed(h);
    const month = kstDay().slice(0, 7);
    // 잘못된 입력.
    assert.equal((await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '', dueDate: kstDay(5), items: [{ studentId: s1, amount: 1 }] } })).status, 400);
    assert.equal((await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '수강료', dueDate: kstDay(5), items: [{ studentId: s1, amount: -5 }] } })).status, 400);
    assert.equal((await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '수강료', dueDate: kstDay(5), items: [{ studentId: 'nope', amount: 1 }] } })).status, 400);
    assert.equal((await h.request('/api/kkumeum/bills', { method: 'POST', origin: 'https://evil.example', body: { campusId: CAMPUS, month, title: '수강료', dueDate: kstDay(5), items: [{ studentId: s1, amount: 1 }] } })).status, 403);

    const made = await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '가상 수강료', dueDate: kstDay(5), items: [{ studentId: s1, amount: '250,000' }, { studentId: s2, amount: 300000 }] } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.created, 2);
    assert.deepEqual([made.body.totals.billed, made.body.totals.unpaid, made.body.totals.paid], [550000, 550000, 0]);
    const again = await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '가상 수강료', dueDate: kstDay(5), items: [{ studentId: s1, amount: 1 }] } });
    assert.equal(again.body.created, 0); assert.equal(again.body.skipped, 1, '같은 달·같은 항목은 한 번만');

    // 선생님은 수납을 볼 수 없다.
    await addTeacher(h, basic);
    assert.equal((await h.request(`/api/kkumeum/bills?campusId=${CAMPUS}&month=${month}`, { user: TEACHER })).status, 403);

    // 보호자: 자기 자녀 청구만.
    const g1 = (await h.request('/api/family/bills', { user: null, cookie: p1 })).body;
    assert.equal(g1.bills.length, 1); assert.equal(g1.bills[0].amount, 250000); assert.equal(g1.unpaidCount, 1);
    assert.equal((await h.request('/api/family/bills', { user: null })).status, 401);

    // 수납 처리 → 일일 결산.
    const b1 = made.body.bills.find(b => b.studentId === s1), b2 = made.body.bills.find(b => b.studentId === s2);
    assert.equal((await h.request(`/api/kkumeum/bills/${b1.id}`, { method: 'PATCH', body: { action: 'pay', method: 'bitcoin' } })).status, 400);
    const paid = await h.request(`/api/kkumeum/bills/${b1.id}`, { method: 'PATCH', body: { action: 'pay', method: 'card', paidAt: kstDay() } });
    assert.equal(paid.body.bill.status, 'paid'); assert.equal(paid.body.bill.paidAmount, 250000);
    assert.equal((await h.request(`/api/kkumeum/bills/${b1.id}`, { user: TEACHER, method: 'PATCH', body: { action: 'unpay' } })).status, 403);
    const daily = (await h.request(`/api/kkumeum/payments/daily?campusId=${CAMPUS}&date=${kstDay()}`)).body;
    assert.equal(daily.total, 250000); assert.equal(daily.byMethod.card, 250000); assert.equal(daily.count, 1);
    assert.equal((await h.request('/api/family/bills', { user: null, cookie: p1 })).body.bills[0].paid, true);
    // 수납된 청구는 바로 취소할 수 없고, 되돌린 뒤 취소.
    assert.equal((await h.request(`/api/kkumeum/bills/${b1.id}`, { method: 'PATCH', body: { action: 'cancel' } })).status, 409);
    assert.equal((await h.request(`/api/kkumeum/bills/${b1.id}`, { method: 'PATCH', body: { action: 'unpay' } })).body.bill.status, 'unpaid');
    const edited = await h.request(`/api/kkumeum/bills/${b2.id}`, { method: 'PATCH', body: { action: 'edit', amount: 280000, memo: '형제 할인' } });
    assert.equal(edited.body.bill.amount, 280000); assert.equal(edited.body.bill.memo, '형제 할인');
    assert.equal((await h.request(`/api/kkumeum/bills/${b2.id}`, { method: 'PATCH', body: { action: 'cancel' } })).body.bill.status, 'canceled');
    const list = (await h.request(`/api/kkumeum/bills?campusId=${CAMPUS}&month=${month}`)).body;
    assert.equal(list.bills.length, 1, '취소한 청구는 목록에서 빠진다');
    assert.equal((await h.request('/api/family/bills', { user: null, cookie: p2 })).body.bills.length, 0);
    const audits = (await h.env.FAMILY_DB.prepare("SELECT action FROM family_audit_logs WHERE resource_type = 'bill' ORDER BY created_at").all()).results.map(r => r.action);
    for (const a of ['bill.create', 'bill.pay', 'bill.unpay', 'bill.edit', 'bill.cancel']) assert.ok(audits.includes(a), a);

    // 납부 안내 문구와 자동 알림 설정.
    const saved = await h.request('/api/kkumeum/payment-settings', { method: 'PUT', body: { campusId: CAMPUS, settings: { autoRemind: true, guide: '가상은행 000-00-0000 (가상학원)' } } });
    assert.equal(saved.body.settings.autoRemind, true);
    assert.equal((await h.request('/api/family/bills', { user: null, cookie: p1 })).body.guides[CAMPUS], '가상은행 000-00-0000 (가상학원)');

    // 미납 알림 (하루에 한 번만).
    const r1 = (await h.request('/api/kkumeum/bills/remind', { method: 'POST', body: { campusId: CAMPUS, month } })).body;
    assert.equal(r1.bills, 1); assert.equal(r1.guardians, 1);
    assert.equal((await h.request('/api/kkumeum/bills/remind', { method: 'POST', body: { campusId: CAMPUS, month } })).body.bills, 0);
  } finally { await h.mf.dispose(); }
});

test('수납 자동 알림 cron: 납부일 하루 전과 3일 뒤 미납만, 자동 알림 켠 캠퍼스만', async () => {
  const h = await harness();
  try {
    const { s1, s2 } = await seed(h);
    const month = kstDay().slice(0, 7);
    await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '내일 납부', dueDate: kstDay(1), items: [{ studentId: s1, amount: 1000 }] } });
    await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '사흘 지남', dueDate: kstDay(-3), items: [{ studentId: s2, amount: 1000 }] } });
    await h.request('/api/kkumeum/bills', { method: 'POST', body: { campusId: CAMPUS, month, title: '다음 주', dueDate: kstDay(7), items: [{ studentId: s1, amount: 1000 }] } });
    const run = async () => { const waits = []; await h.worker.scheduled({ cron: '0 1 * * *', scheduledTime: Date.now() }, h.env, { waitUntil: p => waits.push(p), passThroughOnException() {} }); await Promise.all(waits); };
    const reminded = async () => (await h.env.FAMILY_DB.prepare('SELECT title FROM family_bills WHERE remind_count > 0 ORDER BY title').all()).results.map(r => r.title);
    await run();
    assert.deepEqual(await reminded(), [], '자동 알림이 꺼져 있으면 보내지 않는다');
    await h.request('/api/kkumeum/payment-settings', { method: 'PUT', body: { campusId: CAMPUS, settings: { autoRemind: true } } });
    await run();
    assert.deepEqual(await reminded(), ['내일 납부', '사흘 지남']);
    await run();
    const counts = (await h.env.FAMILY_DB.prepare('SELECT remind_count FROM family_bills WHERE remind_count > 0').all()).results.map(r => r.remind_count);
    assert.deepEqual(counts, [1, 1], '같은 날 두 번 보내지 않는다');
  } finally { await h.mf.dispose(); }
});

test('개인별 일괄 전송: %이름% · %값%을 학생마다 채워 그 보호자에게만, 선생님은 담당 반만', async () => {
  const h = await harness();
  try {
    const { basic, s1, s2, p1, p2 } = await seed(h);
    const body = { campusId: CAMPUS, title: '%이름% 실기 점수 안내', body: '%이름% 학생의 이번 달 실기 점수는 %값%점입니다.', rows: [{ studentId: s1, value: '92' }, { studentId: s2, value: '88' }] };
    assert.equal((await h.request('/api/kkumeum/bulk-messages', { method: 'POST', body: { ...body, rows: [{ studentId: s1, value: '' }] } })).status, 400, '%값% 비어 있음');
    const sent = await h.request('/api/kkumeum/bulk-messages', { method: 'POST', body });
    assert.equal(sent.status, 201, JSON.stringify(sent.body)); assert.equal(sent.body.count, 2);
    const n1 = (await h.request('/api/family/notices', { user: null, cookie: p1 })).body.notices;
    const n2 = (await h.request('/api/family/notices', { user: null, cookie: p2 })).body.notices;
    assert.equal(n1.length, 1); assert.equal(n1[0].title, '가상학생가 실기 점수 안내'); assert.match(n1[0].body, /가상학생가 학생의 이번 달 실기 점수는 92점/);
    assert.equal(n2.length, 1); assert.match(n2[0].body, /88점/);
    await addTeacher(h, basic);
    const denied = await h.request('/api/kkumeum/bulk-messages', { user: TEACHER, method: 'POST', body });
    assert.equal(denied.status, 403);
    assert.equal((await h.request('/api/family/notices', { user: null, cookie: p1 })).body.notices.length, 1, '권한 없는 학생이 섞이면 아무것도 보내지 않는다');
    const own = await h.request('/api/kkumeum/bulk-messages', { user: TEACHER, method: 'POST', body: { ...body, rows: [{ studentId: s1, value: '95' }] } });
    assert.equal(own.status, 201);
  } finally { await h.mf.dispose(); }
});

test('UI: 수납관리 · 개인별 전송 화면, 보호자 수납 안내, 알림 열기', () => {
  const read = p => fs.readFileSync(p, 'utf8');
  const staff = read('public/data-core/work/kkumeum-payments.js');
  for (const piece of ['/api/kkumeum/bills', '/api/kkumeum/payments/daily', '/api/kkumeum/payment-settings', '/api/kkumeum/bulk-messages', '%이름%', '%값%', 'data-kp-pay']) assert.ok(staff.includes(piece), piece);
  assert.match(read('public/data-core/work/kkumeum-mobile.js'), /\['payments','bulk'\]\.includes\(view\)/);
  const family = read('public/family/family-forms.js');
  for (const piece of ['/api/family/bills', 'openBills']) assert.ok(family.includes(piece), piece);
  assert.doesNotMatch(family, /\/api\/kkumeum|\/api\/data-core/);
  assert.match(read('public/family/sw.js'), /payload\?\.kind === 'bill'/);
  const page = read('public/data-core/work/kkumeum.html');
  assert.ok(page.indexOf('kkumeum-payments.js') < page.indexOf('kkumeum-mobile.js'));
  assert.match(read('wrangler.jsonc'), /"0 1 \* \* \*"/);
});

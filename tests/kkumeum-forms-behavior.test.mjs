import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic people only.
const ADMIN = { id: 'kk-form-admin', email: 'kk-form-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-form-teacher', email: 'kk-form-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-form', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, cookie, origin = 'http://localhost' } = {}) {
    const headers = new Headers(user ? auth(user) : undefined);
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('origin', origin); }
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', '203.0.113.41');
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  }
  return { mf, env, request };
}

test('신청/동의서: 대상 학생의 보호자만 받고, 자녀별 제출·수정, 마감, 선생님은 담당 반만, 제출 현황 집계', async () => {
  const h = await harness();
  try {
    const classOf = async name => (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name } })).body.class.id;
    const basic = await classOf('기초반'), deep = await classOf('심화반');
    const add = async (name, classId) => (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId, status: 'active' } })).body.student.id;
    const s1 = await add('가상학생가', basic), s2 = await add('가상학생나', deep), s3 = await add('가상학생다', basic);
    const login = async studentId => {
      const code = (await h.request(`/api/kkumeum/students/${studentId}/invite-code`, { method: 'POST', body: { campusId: CAMPUS } })).body.code;
      return (await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '어머니' } })).cookie;
    };
    const p1 = await login(s1), p2 = await login(s2);

    // 잘못된 양식은 거절.
    assert.equal((await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'application', title: '가상 신청', questions: [], targets: [{ targetType: 'class', targetId: basic }] } })).status, 400, '신청서에는 질문이 필요');
    assert.equal((await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: '가상 동의', targets: [] } })).status, 400, '대상 필요');
    assert.equal((await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'application', title: 'x', questions: [{ type: 'choice', label: '참가', options: ['예'] }], targets: [{ targetType: 'class', targetId: basic }] } })).status, 400, '보기 2개 이상');
    assert.equal((await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: 'x', deadline: kstDay(-1), targets: [{ targetType: 'class', targetId: basic }] } })).status, 400, '지난 마감일');
    assert.equal((await h.request('/api/kkumeum/forms', { method: 'POST', origin: 'https://evil.example', body: { campusId: CAMPUS, kind: 'consent', title: 'x', targets: [{ targetType: 'class', targetId: basic }] } })).status, 403);

    // 기초반 신청서.
    const questions = [
      { type: 'choice', label: '특강 참가', options: ['참가', '불참'] },
      { type: 'multi', label: '희망 요일', options: ['토', '일'], required: false },
      { type: 'text', label: '하고 싶은 말', required: false },
    ];
    const created = await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'application', title: '가상 겨울 특강 신청', body: '가상 안내', deadline: kstDay(3), questions, targets: [{ targetType: 'class', targetId: basic }] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const formId = created.body.form.id;
    assert.equal(created.body.summary.targetCount, 2);
    assert.deepEqual(created.body.form.questions.map(q => q.id), ['q1', 'q2', 'q3']);

    // 보호자: 대상 자녀가 있으면 보이고, 아니면 안 보인다.
    const list1 = (await h.request('/api/family/forms', { user: null, cookie: p1 })).body;
    assert.equal(list1.forms.length, 1); assert.equal(list1.waiting, 1); assert.equal(list1.forms[0].children[0].submitted, false);
    assert.equal((await h.request('/api/family/forms', { user: null, cookie: p2 })).body.forms.length, 0);
    assert.equal((await h.request(`/api/family/forms/${formId}`, { user: null, cookie: p2 })).status, 404);
    assert.equal((await h.request('/api/family/forms')).status, 401);

    // 제출: 보기에 없는 답 · 남의 아이 · 다른 출처는 거절, 정상 제출 후 수정 가능.
    const submit = (cookie, body, origin) => h.request(`/api/family/forms/${formId}/responses`, { user: null, cookie, method: 'POST', body, origin });
    assert.equal((await submit(p1, { studentId: s1, answers: { q1: '모름' } })).status, 400);
    assert.equal((await submit(p1, { studentId: s1, answers: {} })).status, 400, '필수 답 없음');
    assert.equal((await submit(p1, { studentId: s2, answers: { q1: '참가' } })).status, 403);
    assert.equal((await submit(p1, { studentId: s1, answers: { q1: '참가' } }, 'https://evil.example')).status, 403);
    const sent = await submit(p1, { studentId: s1, answers: { q1: '참가', q2: ['일', '토'], q3: '가상 메모' } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(sent.body.children[0].answers, { q1: '참가', q2: ['토', '일'], q3: '가상 메모' });
    const fixed = await submit(p1, { studentId: s1, answers: { q1: '불참' } });
    assert.deepEqual(fixed.body.children[0].answers, { q1: '불참' }, '마감 전에는 고칠 수 있다');
    assert.equal((await h.request('/api/family/forms', { user: null, cookie: p1 })).body.waiting, 0);

    // 제출 현황.
    const detail = (await h.request(`/api/kkumeum/forms/${formId}`)).body;
    assert.equal(detail.summary.submittedCount, 1);
    assert.deepEqual(detail.tally.find(t => t.id === 'q1').counts, [{ option: '참가', count: 0 }, { option: '불참', count: 1 }]);
    const listed = (await h.request(`/api/kkumeum/forms?campusId=${CAMPUS}`)).body.forms[0];
    assert.equal(listed.targetCount, 2); assert.equal(listed.submittedCount, 1);
    const remind = await h.request(`/api/kkumeum/forms/${formId}/remind`, { method: 'POST', body: {} });
    assert.equal(remind.status, 200); assert.equal(remind.body.students, 1, '미제출 학생 1명');

    // 선생님: 담당 반(심화반)만. 기초반 양식은 보이지 않고, 캠퍼스 전체 대상도 못 만든다.
    await h.request('/api/data-core/context', { user: TEACHER });
    const now = new Date().toISOString();
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
      .bind('m-form-teacher', CAMPUS, `oai:${TEACHER.id}`, now, now).run();
    await h.env.FAMILY_DB.prepare('INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('a-form', deep, `oai:${TEACHER.id}`, 'TEACHER', now, now, now).run();
    assert.equal((await h.request(`/api/kkumeum/forms?campusId=${CAMPUS}`, { user: TEACHER })).body.forms.length, 0);
    assert.equal((await h.request(`/api/kkumeum/forms/${formId}`, { user: TEACHER })).status, 403);
    assert.equal((await h.request('/api/kkumeum/forms', { user: TEACHER, method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: 'x', targets: [{ targetType: 'campus', targetId: CAMPUS }] } })).status, 403);
    assert.equal((await h.request('/api/kkumeum/forms', { user: TEACHER, method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: 'x', targets: [{ targetType: 'class', targetId: basic }] } })).status, 403);
    const consent = await h.request('/api/kkumeum/forms', { user: TEACHER, method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: '가상 야외 수업 동의', targets: [{ targetType: 'student', targetId: s2 }] } });
    assert.equal(consent.status, 201, JSON.stringify(consent.body));
    const consentId = consent.body.form.id;
    assert.equal((await h.request(`/api/family/forms/${consentId}/responses`, { user: null, cookie: p2, method: 'POST', body: { studentId: s2, answers: {} } })).status, 400, '동의 여부 필수');
    const agreed = await h.request(`/api/family/forms/${consentId}/responses`, { user: null, cookie: p2, method: 'POST', body: { studentId: s2, answers: {}, consent: 'agree' } });
    assert.equal(agreed.status, 201); assert.equal(agreed.body.children[0].consent, 'agree');
    const teacherView = (await h.request(`/api/kkumeum/forms/${consentId}`, { user: TEACHER })).body;
    assert.equal(teacherView.summary.agreeCount, 1); assert.equal(teacherView.canChange, true);
    assert.equal((await h.request(`/api/kkumeum/forms/${consentId}`, { user: TEACHER, method: 'DELETE', body: {} })).status, 409, '제출이 있으면 지울 수 없다');

    // 마감: 만든 사람·원장만, 마감 후 제출 불가, 제출한 기록은 보호자 목록에 남는다.
    assert.equal((await h.request(`/api/kkumeum/forms/${formId}`, { user: TEACHER, method: 'PATCH', body: { status: 'closed' } })).status, 403);
    const closed = await h.request(`/api/kkumeum/forms/${formId}`, { method: 'PATCH', body: { status: 'closed' } });
    assert.equal(closed.body.form.open, false);
    assert.equal((await submit(p1, { studentId: s1, answers: { q1: '참가' } })).status, 409);
    const after = (await h.request('/api/family/forms', { user: null, cookie: p1 })).body.forms;
    assert.equal(after.length, 1); assert.equal(after[0].open, false);
    assert.equal(s3.length > 0, true);

    // 아무도 제출하지 않은 양식은 지울 수 있다.
    const empty = await h.request('/api/kkumeum/forms', { method: 'POST', body: { campusId: CAMPUS, kind: 'consent', title: '가상 삭제용', targets: [{ targetType: 'campus', targetId: CAMPUS }] } });
    assert.equal(empty.body.summary.targetCount, 3, '캠퍼스 전체 = 재원생 모두');
    assert.equal((await h.request(`/api/kkumeum/forms/${empty.body.form.id}`, { method: 'DELETE', body: {} })).status, 200);
  } finally { await h.mf.dispose(); }
});

test('학부모 일정: 휴일과 "학부모에게도 보이기" 일정만, 자녀 캠퍼스만', async () => {
  const h = await harness();
  try {
    const cls = (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name: '기초반' } })).body.class.id;
    const student = (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name: '가상학생가', classId: cls, status: 'active' } })).body.student.id;
    const code = (await h.request(`/api/kkumeum/students/${student}/invite-code`, { method: 'POST', body: { campusId: CAMPUS } })).body.code;
    const parent = (await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '아버지' } })).cookie;
    const month = kstDay().slice(0, 7), day = `${month}-15`;
    const event = (title, metadata, extra = {}) => h.request('/api/data-core/calendar', { method: 'POST', body: { title, campusId: CAMPUS, visibility: 'campus', metadata: { schemaVersion: 1, startDate: day, allDay: true, ...metadata }, ...extra } });
    assert.equal((await event('가상 휴원', { eventType: 'holiday' })).status, 201);
    assert.equal((await event('가상 작품 전시회', { eventType: 'other', familyVisible: true })).status, 201);
    assert.equal((await event('가상 교직원 회의', { eventType: 'meeting' })).status, 201);
    assert.equal((await h.request('/api/data-core/calendar', { method: 'POST', body: { title: '가상 다른 캠퍼스 행사', campusId: 'campus-design-admission', visibility: 'campus', metadata: { schemaVersion: 1, startDate: day, allDay: true, eventType: 'other', familyVisible: true } } })).status, 201);
    assert.equal((await h.request('/api/data-core/calendar', { method: 'POST', body: { title: 'x', campusId: CAMPUS, visibility: 'campus', metadata: { schemaVersion: 1, startDate: day, eventType: 'other', familyVisible: 'yes' } } })).status, 400);

    assert.equal((await h.request(`/api/family/schedule?month=${month}`, { user: null })).status, 401);
    const schedule = (await h.request(`/api/family/schedule?month=${month}`, { user: null, cookie: parent })).body;
    const titles = schedule.events.map(e => e.title);
    assert.ok(titles.includes('가상 휴원') && titles.includes('가상 작품 전시회'), JSON.stringify(titles));
    assert.ok(!titles.includes('가상 교직원 회의'), '내부 일정은 보이지 않는다');
    assert.ok(!titles.includes('가상 다른 캠퍼스 행사'), '다른 캠퍼스 일정은 보이지 않는다');
    assert.equal(schedule.events.find(e => e.title === '가상 휴원').kind, 'holiday');
    assert.deepEqual(Object.keys(schedule.events[0]).sort(), ['campusName', 'endDate', 'endTime', 'kind', 'location', 'startDate', 'startTime', 'title']);
  } finally { await h.mf.dispose(); }
});

test('UI: 보호자 앱 신청/동의서·일정, 알림 열기, 교직원 신청/동의서 화면, 일정 공개 체크', () => {
  const read = p => fs.readFileSync(p, 'utf8');
  const family = read('public/family/family-forms.js');
  for (const piece of ['/api/family/forms', '/api/family/schedule', 'openForm', '동의하지 않음', '제출하기']) assert.ok(family.includes(piece), piece);
  assert.doesNotMatch(family, /\/api\/kkumeum|\/api\/data-core/, 'the guardian app never calls staff APIs');
  assert.match(read('public/family/family-mobile.js'), /window\.FamilyForms\.open\(key,extra\)/);
  const sw = read('public/family/sw.js');
  assert.match(sw, /'\/family\/family-forms\.js'/); assert.match(sw, /payload\?\.kind === 'form'/);
  const staff = read('public/data-core/work/kkumeum-forms.js');
  for (const piece of ['/api/kkumeum/forms', 'data-kf-add-question', 'data-kf-remind', '제출 현황']) assert.ok(staff.includes(piece), piece);
  assert.match(read('public/data-core/work/kkumeum-mobile.js'), /\['consents','form','form-new'\]\.includes\(view\)/);
  assert.match(read('public/data-core/work/kkumeum-mobile.js'), /familyVisible/);
  assert.match(read('public/data-core/calendar.js'), /familyVisible/);
  const page = read('public/data-core/work/kkumeum.html');
  assert.ok(page.indexOf('kkumeum-forms.js') < page.indexOf('kkumeum-mobile.js'));
});

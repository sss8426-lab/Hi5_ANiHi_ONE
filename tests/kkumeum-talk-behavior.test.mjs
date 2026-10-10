import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

// Synthetic people only.
const ADMIN = { id: 'kk-talk-admin', email: 'kk-talk-admin@example.test', name: '꿈이음 관리자' };
const TEACHER = { id: 'kk-talk-teacher', email: 'kk-talk-teacher@example.test', name: '가상 강사' };
const CAMPUS = 'campus-anihi-admission';
const auth = user => ({ 'oai-authenticated-user-id': user.id, 'oai-authenticated-user-email': user.email,
  'oai-authenticated-user-full-name': encodeURIComponent(user.name), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
// 1×1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('kk-talk', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, form, cookie, origin = 'http://localhost', raw = false } = {}) {
    const headers = new Headers(user ? auth(user) : undefined);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (body !== undefined || form) headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', '203.0.113.40');
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) }), env, { waitUntil() {}, passThroughOnException() {} });
    if (raw) return r;
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  }
  return { mf, env, request };
}
const formOf = (fields, files = []) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); files.forEach((b, i) => f.append('files', new Blob([b.bytes], { type: b.type }), `p${i}.png`)); return f; };

test('소식 답변 · 답변모음 · 1:1 문의 · 사진 · 운영시간 자동 안내 · 자주 쓰는 글, each guardian sees only their own', async () => {
  const h = await harness();
  try {
    const classOf = async name => (await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name } })).body.class.id;
    const basic = await classOf('기초반'), deep = await classOf('심화반');
    const add = async (name, classId) => (await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name, classId, status: 'active' } })).body.student.id;
    const s1 = await add('가상학생가', basic), s2 = await add('가상학생나', deep);
    const login = async studentId => {
      const code = (await h.request(`/api/kkumeum/students/${studentId}/invite-code`, { method: 'POST', body: { campusId: CAMPUS } })).body.code;
      return (await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '어머니' } })).cookie;
    };
    const p1 = await login(s1), p2 = await login(s2);
    assert.match(p1, /^kkumeum_family_session=/);

    const created = await h.request('/api/kkumeum/announcements', { method: 'POST', body: { campusId: CAMPUS, announcementType: 'campus-news', title: '가상 공지', body: '다음 주 가상 일정 안내', targets: [{ targetType: 'campus', targetId: CAMPUS }] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, { method: 'POST', body: {} })).status, 200);
    const noticeId = (await h.request('/api/family/notices', { user: null, cookie: p1 })).body.notices[0].announcementId;

    // 소식 답변: one private thread per guardian.
    assert.equal((await h.request(`/api/family/notices/${noticeId}/replies`, { user: null, method: 'POST', body: { body: '감사합니다' } })).status, 401);
    assert.equal((await h.request(`/api/family/notices/${noticeId}/replies`, { user: null, cookie: p1, method: 'POST', body: { body: '감사합니다' }, origin: 'https://evil.example' })).status, 403);
    const r1 = await h.request(`/api/family/notices/${noticeId}/replies`, { user: null, cookie: p1, method: 'POST', body: { body: '감사합니다' } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.thread.kind, 'reply'); assert.equal(r1.body.messages.length, 1);
    const again = await h.request(`/api/family/notices/${noticeId}/replies`, { user: null, cookie: p1, method: 'POST', body: { body: '한 가지 더요' } });
    assert.equal(again.body.thread.id, r1.body.thread.id, 'a second answer continues the same thread');
    await h.request(`/api/family/notices/${noticeId}/replies`, { user: null, cookie: p2, method: 'POST', body: { body: '확인했습니다' } });
    const mine = (await h.request('/api/family/threads?kind=reply', { user: null, cookie: p1 })).body.threads;
    assert.deepEqual(mine.map(t => t.id), [r1.body.thread.id], 'other parents never see each other');
    assert.equal((await h.request(`/api/family/threads/${(await h.request('/api/family/threads?kind=reply', { user: null, cookie: p2 })).body.threads[0].id}`, { user: null, cookie: p1 })).status, 404);

    // 답변모음 for staff: 원장 sees both, 선생님 only their class.
    const staffList = (await h.request(`/api/kkumeum/threads?campusId=${CAMPUS}&kind=reply&filter=open`)).body.threads;
    assert.equal(staffList.length, 2); assert.ok(staffList.every(t => t.unread));
    assert.deepEqual((await h.request(`/api/kkumeum/threads/summary?campusId=${CAMPUS}`)).body, { answers: 2, inquiries: 0 });
    await h.request('/api/data-core/context', { user: TEACHER });
    const now = new Date().toISOString();
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
      .bind('m-talk-teacher', CAMPUS, `oai:${TEACHER.id}`, now, now).run();
    await h.env.FAMILY_DB.prepare('INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('a-talk', basic, `oai:${TEACHER.id}`, 'TEACHER', now, now, now).run();
    const teacherList = (await h.request(`/api/kkumeum/threads?campusId=${CAMPUS}&kind=reply`, { user: TEACHER })).body.threads;
    assert.deepEqual(teacherList.map(t => t.studentId), [s1], '선생님 sees only 담당 반 students');
    const p2Thread = staffList.find(t => t.studentId === s2).id;
    assert.equal((await h.request(`/api/kkumeum/threads/${p2Thread}`, { user: TEACHER })).status, 403);

    // Staff answer with a photo → guardian unread, file private to that guardian.
    const answered = await h.request(`/api/kkumeum/threads/${r1.body.thread.id}/messages`, { method: 'POST', form: formOf({ body: '네, 가상 답장입니다.' }, [{ bytes: PNG, type: 'image/png' }]) });
    assert.equal(answered.status, 201, JSON.stringify(answered.body));
    assert.equal(answered.body.thread.status, 'answered');
    const fileId = answered.body.messages.at(-1).files[0].id;
    assert.equal((await h.request('/api/family/threads?kind=reply', { user: null, cookie: p1 })).body.unread.reply, 1);
    const seen = await h.request(`/api/family/threads/${r1.body.thread.id}`, { user: null, cookie: p1 });
    assert.deepEqual(seen.body.messages.map(m => m.author), ['guardian', 'guardian', 'staff']);
    const img = await h.request(`/api/family/talk-files/${fileId}`, { user: null, cookie: p1, raw: true });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(img.headers.get('cache-control'), 'private, no-store');
    assert.equal((await h.request(`/api/family/talk-files/${fileId}`, { user: null, cookie: p2, raw: true })).status, 403);
    assert.equal((await h.request(`/api/kkumeum/talk-files/${fileId}`, { raw: true })).status, 200);

    // 1:1 문의 outside 운영시간 → 자동 안내; only own children; photos checked.
    const saved = await h.request('/api/kkumeum/talk-settings', { method: 'PUT', body: { campusId: CAMPUS, settings: { enabled: true, weekday: { start: '', end: '' }, saturday: {}, sunday: {}, autoReply: '가상 자동 안내' } } });
    assert.equal(saved.status, 200); assert.equal(saved.body.openNow, false);
    assert.equal((await h.request('/api/kkumeum/talk-settings', { user: TEACHER, method: 'PUT', body: { campusId: CAMPUS, settings: {} } })).status, 403);
    assert.equal((await h.request('/api/family/threads', { user: null, cookie: p1, method: 'POST', form: formOf({ studentId: s2, body: '남의 아이' }) })).status, 403);
    assert.equal((await h.request('/api/family/threads', { user: null, cookie: p1, method: 'POST', form: formOf({ studentId: s1, body: 'x' }, [{ bytes: new TextEncoder().encode('<svg/>'), type: 'image/png' }]) })).status, 400, 'not really an image');
    assert.equal((await h.request('/api/family/threads', { user: null, cookie: p1, method: 'POST', form: formOf({ studentId: s1, body: 'x' }, Array(4).fill({ bytes: PNG, type: 'image/png' })) })).status, 400);
    const ask = await h.request('/api/family/threads', { user: null, cookie: p1, method: 'POST', form: formOf({ studentId: s1, title: '보강 문의', body: '가상 보강 문의입니다' }, [{ bytes: PNG, type: 'image/png' }]) });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.deepEqual(ask.body.messages.map(m => m.author), ['guardian', 'auto']);
    assert.match(ask.body.messages[1].body, /가상 자동 안내/);
    const hours = (await h.request('/api/family/threads?kind=inquiry', { user: null, cookie: p1 })).body.hours[CAMPUS];
    assert.equal(hours.enabled, true); assert.match(hours.label, /평일 휴무/);
    assert.equal((await h.request(`/api/kkumeum/threads/summary?campusId=${CAMPUS}`)).body.inquiries, 1);
    const closed = await h.request(`/api/kkumeum/threads/${ask.body.thread.id}`, { method: 'PATCH', body: { status: 'closed' } });
    assert.equal(closed.body.thread.status, 'closed');
    const follow = await h.request(`/api/family/threads/${ask.body.thread.id}/messages`, { user: null, cookie: p1, method: 'POST', body: { body: '하나 더 여쭤봐요' } });
    assert.equal(follow.body.thread.status, 'open', 'a new guardian message reopens the 문의');

    // 자주 쓰는 글: shared in the campus; only the writer or 원장 deletes.
    const snip = await h.request('/api/kkumeum/snippets', { method: 'POST', body: { campusId: CAMPUS, title: '보강 안내', body: '가상 보강 안내 문구' } });
    assert.equal(snip.status, 201);
    const listed = (await h.request(`/api/kkumeum/snippets?campusId=${CAMPUS}`, { user: TEACHER })).body.snippets;
    assert.equal(listed.length, 1); assert.equal(listed[0].canDelete, false);
    assert.equal((await h.request(`/api/kkumeum/snippets/${listed[0].id}`, { user: TEACHER, method: 'DELETE', body: {} })).status, 403);
    assert.equal((await h.request(`/api/kkumeum/snippets/${listed[0].id}`, { method: 'DELETE', body: {} })).body.snippets.length, 0);
  } finally { await h.mf.dispose(); }
});

test('UI: 보호자 앱 답변·문의 화면, 소식 아래 답변, 답장 알림 열기, 교직원 답변모음·문의모음', () => {
  const read = p => fs.readFileSync(p, 'utf8');
  const family = read('public/family/family-talk.js');
  for (const piece of ['/api/family/threads', '/api/family/notices/', '/api/family/talk-files/', 'openThread', 'mountNoticeReply', '새 문의 쓰기']) assert.ok(family.includes(piece), piece);
  assert.doesNotMatch(family, /\/api\/kkumeum|\/api\/data-core/, 'the guardian app never calls staff APIs');
  assert.match(read('public/family/family-mobile.js'), /window\.FamilyTalk\.open\(key,extra\)/);
  assert.match(read('public/family/family-news.js'), /mountNoticeReply/);
  const sw = read('public/family/sw.js');
  assert.match(sw, /'\/family\/family-talk\.js'/); assert.match(sw, /payload\?\.kind === 'talk'/);
  const staff = read('public/data-core/work/kkumeum-talk.js');
  for (const piece of ['/api/kkumeum/threads', '/api/kkumeum/snippets', '/api/kkumeum/talk-settings', 'data-kt-save-snippet', 'kt-badge']) assert.ok(staff.includes(piece), piece);
  assert.match(read('public/data-core/work/kkumeum-mobile.js'), /\['answers','inquiries','thread','talk-settings'\]\.includes\(view\)/);
  const page = read('public/data-core/work/kkumeum.html');
  assert.ok(page.indexOf('kkumeum-talk.js') < page.indexOf('kkumeum-mobile.js'));
});

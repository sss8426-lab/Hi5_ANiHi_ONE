import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { libraryHarness, users, A } from './support/library-harness.mjs';

// 권한 보강 (2026-10-15). Synthetic people and files only.
const { master, campusAdmin, teacher, staff, foreign } = users;

async function generalFolder(h, user = teacher) {
  const folders = (await h.browse(`campus:${A}`, user)).body.folders;
  return folders.find(f => f.category === 'academy-photo');
}

test('자료보관함: 본인이 올린 파일만 지우고 옮김, 원장·마스터는 모두; 원장이 지운 직원 파일은 원장 휴지통에서 되살림', async () => {
  const h = await libraryHarness();
  try {
    const target = await generalFolder(h);
    assert.ok(target?.canWrite, 'teacher can write the campus 학원사진 folder');
    const mine = await h.upload(target.id, teacher, { name: '선생님 자료.txt' });
    const theirs = await h.upload(target.id, staff, { name: '직원 자료.txt' });
    assert.equal(mine.status, 201, JSON.stringify(mine.body)); assert.equal(theirs.status, 201);
    const mineId = mine.body.file?.id || mine.body.id, theirsId = theirs.body.file?.id || theirs.body.id;

    const listed = (await h.list(target.id, teacher)).body.files;
    assert.equal(listed.find(f => f.id === mineId).canDelete, true);
    assert.equal(listed.find(f => f.id === theirsId).canDelete, false, '다른 사람 파일은 지우기 버튼이 없다');
    assert.equal(listed.find(f => f.id === theirsId).canMove, false, '이동 버튼도 없다');
    assert.equal(listed.find(f => f.id === mineId).canMove, true);

    const sub = await h.folder(target.id, '선생님 폴더', teacher);
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const subId = sub.body.folder?.id || sub.body.id;
    assert.equal((await h.request('PATCH', `/api/data-core/library/files/${theirsId}`, teacher, { folderId: subId })).status, 403, '남의 파일은 옮기지 못한다');
    assert.equal((await h.request('DELETE', `/api/data-core/library/files/${theirsId}`, teacher)).status, 403, '남의 파일은 지우지 못한다');
    assert.equal((await h.request('DELETE', `/api/data-core/library/files/${mineId}`, teacher)).status, 200, '내 파일은 지운다');

    // 기본 분류 폴더(학원사진)는 선생님이 숨기지 못하고 원장은 가능.
    assert.equal(target.canDelete, false);
    assert.equal((await generalFolder(h, campusAdmin)).canDelete, true);
    assert.equal((await h.request('DELETE', `/api/data-core/library/folders/${encodeURIComponent(target.id)}`, teacher)).status, 403);

    // 원장은 직원 파일을 지우고, 자기 휴지통에서 보고 되살린다.
    assert.equal((await h.request('DELETE', `/api/data-core/library/files/${theirsId}`, campusAdmin)).status, 200);
    const trash = await h.request('GET', '/api/data-core/trash/files', campusAdmin);
    assert.ok(trash.body.files.some(f => f.id === theirsId), '원장 휴지통에 보인다');
    assert.equal((await h.request('GET', '/api/data-core/trash/files', teacher)).body.files.some(f => f.id === theirsId), false, '선생님 휴지통에는 본인 것만');
    assert.equal((await h.request('POST', `/api/data-core/trash/files/${theirsId}/restore`, campusAdmin)).status, 200);
    assert.equal((await h.request('DELETE', `/api/data-core/library/files/${theirsId}`, master)).status, 200, '마스터는 모두 지운다');
  } finally { await h.mf.dispose(); }
});

test('일정은 일정 API로만: 일반 자료 API로 만들기·고치기·지우기 금지, 전체 공개는 마스터만', async () => {
  const h = await libraryHarness();
  try {
    const event = await h.request('POST', '/api/data-core/calendar', master, { title: '본사 일정', visibility: 'organization', startDate: '2026-10-20', eventType: 'other' });
    assert.equal(event.status, 201, JSON.stringify(event.body));
    const id = event.body.event?.id || event.body.record?.id || event.body.id;
    assert.equal((await h.request('PATCH', `/api/data-core/records/${id}`, campusAdmin, { title: '바꿈' })).status, 403);
    assert.equal((await h.request('DELETE', `/api/data-core/records/${id}`, campusAdmin)).status, 403);
    assert.equal((await h.request('POST', '/api/data-core/records', teacher, { recordType: 'academy-calendar-event', sourceApp: 'data-core-calendar', campusId: A, title: '몰래', visibility: 'public', metadata: { startDate: '2026-10-21' } })).status, 403);
    const note = await h.request('POST', '/api/data-core/records', teacher, { recordType: 'blog-draft', sourceApp: 'content', campusId: A, title: '초안', visibility: 'public' });
    assert.equal(note.status, 201, JSON.stringify(note.body));
    assert.equal(note.body.record.visibility, 'campus', '선생님이 정한 전체 공개는 캠퍼스 공유로 낮춘다');
  } finally { await h.mf.dispose(); }
});

test('수상작: 폴더는 만든 사람(다른 사람 자료가 없을 때)·마스터만 지움, 최상위 모음은 마스터만', async () => {
  const h = await libraryHarness();
  try {
    const top = await h.request('POST', '/api/data-core/awards/folders', master, { title: '2026 공모전', collectionType: 'enrolled' });
    assert.equal(top.status, 201, JSON.stringify(top.body));
    const child = await h.request('POST', '/api/data-core/awards/folders', teacher, { title: '선생님 폴더', parentFolderId: top.body.record.id });
    assert.equal(child.status, 201, JSON.stringify(child.body));
    const childId = child.body.record.id;
    assert.equal((await h.request('DELETE', `/api/data-core/awards/folders/${top.body.record.id}`, teacher)).status, 403, '최상위 모음은 못 지운다');
    assert.equal((await h.request('DELETE', `/api/data-core/awards/folders/${childId}`, staff)).status, 403, '남이 만든 폴더는 못 지운다');
    assert.equal((await h.request('DELETE', `/api/data-core/records/${childId}`, staff)).status, 403, '일반 자료 API로도 못 지운다');
    const other = await h.request('POST', '/api/data-core/awards/folders', staff, { title: '직원 하위', parentFolderId: childId });
    assert.equal(other.status, 201);
    assert.equal((await h.request('DELETE', `/api/data-core/awards/folders/${childId}`, teacher)).status, 409, '안에 다른 사람 자료가 있으면 마스터에게');
    assert.equal((await h.request('DELETE', `/api/data-core/awards/folders/${other.body.record.id}`, staff)).status, 200);
    assert.equal((await h.request('DELETE', `/api/data-core/awards/folders/${childId}`, teacher)).status, 200, '비면 만든 사람이 지운다');
  } finally { await h.mf.dispose(); }
});

test('월간 업무보고: 모든 캠퍼스가 보고, 달을 바꿔도 한 달에 한 개', async () => {
  const h = await libraryHarness();
  try {
    const body = month => ({ month, campusId: A, done: [{ category: '수업', text: '진행' }] });
    const sep = await h.request('POST', '/api/data-core/staff-reports', teacher, body('2026-09'));
    const oct = await h.request('POST', '/api/data-core/staff-reports', teacher, body('2026-10'));
    assert.equal(sep.status, 200, JSON.stringify(sep.body)); assert.equal(oct.status, 200);
    const id = oct.body.report.id;
    assert.equal((await h.request('PATCH', `/api/data-core/staff-reports/${id}`, teacher, body('2026-09'))).status, 409);
    const seen = await h.request('GET', '/api/data-core/staff-reports?month=2026-10', foreign);
    assert.equal(seen.status, 200); assert.equal(seen.body.reports.length, 1, '다른 캠퍼스도 본다');
  } finally { await h.mf.dispose(); }
});

const ADMIN = { id: 'perm-kk-admin', email: 'perm-kk-admin@example.test' };
async function kkHarness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true,
    d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const url = new URL('../dist/server/index.js', import.meta.url); url.searchParams.set('perm', `${process.pid}-${Math.random()}`);
  const worker = (await import(url.href)).default;
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body, origin = 'http://localhost', ip = '203.0.113.9', cookie, headers: extra = {} } = {}) {
    const headers = new Headers(extra);
    if (user) { headers.set('oai-authenticated-user-id', user.id); headers.set('oai-authenticated-user-email', user.email); }
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (origin) headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    headers.set('cf-connecting-ip', ip);
    const r = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  }
  return { mf, request };
}

test('꿈이음: 다른 사이트에서 온 변경 요청은 거절; 인증키는 보호자 4명까지', async () => {
  const h = await kkHarness();
  try {
    const campusId = 'campus-anihi-admission';
    assert.equal((await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId, name: '외부' }, origin: 'https://evil.example' })).status, 403);
    const headers = { 'sec-fetch-site': 'cross-site' };
    assert.equal((await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId, name: '다른 사이트' }, origin: null, headers })).status, 403);
    const cls = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId, name: '기초반' } });
    assert.equal(cls.status, 201, JSON.stringify(cls.body));
    const student = await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId, name: '가상학생', classId: cls.body.class.id, status: 'active' } });
    const code = (await h.request(`/api/kkumeum/students/${student.body.student.id}/invite-code`, { method: 'POST', body: { campusId } })).body.code;
    for (let i = 0; i < 4; i++) {
      const r = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code, relationship: '보호자' }, ip: `198.51.100.${i + 1}` });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const fifth = await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code }, ip: '198.51.100.9' });
    assert.equal(fifth.status, 409); assert.match(fifth.body.error, /새 인증키/);
    const fresh = (await h.request(`/api/kkumeum/students/${student.body.student.id}/invite-code`, { method: 'POST', body: { campusId } })).body.code;
    assert.equal((await h.request('/api/family/auth/code', { user: null, method: 'POST', body: { code: fresh }, ip: '198.51.100.10' })).status, 200, '새로 발급하면 다시 연결된다');
  } finally { await h.mf.dispose(); }
});

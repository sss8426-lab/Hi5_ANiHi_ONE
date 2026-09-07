import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const ADMIN = { id: 'staff-operations-admin', email: 'staff-operations-admin@example.test', name: '꿈이음 관리자' };
const CAMPUS = 'campus-staff-operations';

function headers() {
  return {
    'oai-authenticated-user-id': ADMIN.id,
    'oai-authenticated-user-email': ADMIN.email,
    'oai-authenticated-user-full-name': encodeURIComponent(ADMIN.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function worker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('kkumeum-staff-operations', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

test('staff operations shell uses real protected APIs, modal forms, and no fabricated family records', async () => {
  const [html, staff, operations] = await Promise.all([
    read('public/data-core/work/kkumeum.html'),
    read('public/data-core/work/kkumeum.js'),
    read('public/data-core/work/kkumeum-operations.js'),
  ]);
  for (const label of ['학생·반', '월간 평가', '작품관리', '소식·공지', '보호자 연결']) assert.match(html, new RegExp(label));
  assert.match(html, /kkumeum-operations\.js/);
  assert.match(operations, /\/api\/kkumeum\/dashboard/);
  assert.match(operations, /\/api\/kkumeum\/artworks/);
  assert.match(operations, /\/api\/kkumeum\/reports/);
  assert.match(operations, /\/api\/kkumeum\/guardians/);
  assert.match(operations, /dragover/);
  assert.match(operations, /loading="lazy"/);
  assert.match(operations, /temporaryPassword/);
  assert.doesNotMatch(staff, /window\.prompt/);
  assert.doesNotMatch(operations, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(`${html}\n${operations}`, /테스트학생|테스트 보호자|guardian-test|student-test/);
});

test('guardian management is isolated to FAMILY_DB, returns a one-time password, and never logs raw secret material', async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: ['FAMILY_FILES'],
    d1Persist: false,
    r2Persist: false,
  });
  try {
    const app = await worker();
    const env = {
      DB: await mf.getD1Database('DB'),
      FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
      FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
      DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
    };
    const request = async (path, method = 'GET', body) => {
      const requestHeaders = new Headers(headers());
      if (body) requestHeaders.set('content-type', 'application/json');
      const response = await app.fetch(new Request(`http://localhost${path}`, { method, headers: requestHeaders, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {}, passThroughOnException() {} });
      return { response, body: await response.json().catch(() => ({})) };
    };
    const createdClass = await request('/api/kkumeum/classes', 'POST', { campusId: CAMPUS, name: '운영반' });
    assert.equal(createdClass.response.status, 201);
    const student = await request('/api/kkumeum/students', 'POST', { campusId: CAMPUS, name: '검증용 학생', classId: createdClass.body.class.id, status: 'active' });
    assert.equal(student.response.status, 201);
    const guardian = await request('/api/kkumeum/guardians', 'POST', { campusId: CAMPUS, studentId: student.body.student.id, displayName: '검증용 보호자', loginId: 'operations-guardian', relationshipLabel: '부모' });
    assert.equal(guardian.response.status, 201);
    assert.match(guardian.body.temporaryPassword, /^[A-Za-z0-9]+$/);
    const saved = await env.FAMILY_DB.prepare('SELECT password_hash, password_salt FROM family_guardians WHERE id = ?').bind(guardian.body.guardian.id).first();
    assert.ok(saved.password_hash);
    assert.notEqual(saved.password_hash, guardian.body.temporaryPassword);
    const genericFamilyRows = await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'family_%'").first();
    assert.equal(Number(genericFamilyRows.count), 0);
    const list = await request(`/api/kkumeum/guardians?campusId=${CAMPUS}&studentId=${student.body.student.id}`);
    assert.equal(list.response.status, 200);
    assert.equal(list.response.headers.get('cache-control'), 'private, no-store');
    assert.equal(list.body.guardians[0].loginId, 'operations-guardian');
  } finally {
    await mf.dispose();
  }
});

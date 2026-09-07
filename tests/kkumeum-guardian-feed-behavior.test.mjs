import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN_ID = 'guardian-a';
const OTHER_GUARDIAN_ID = 'guardian-b';
const CHILD_A = 'student-a';
const CHILD_SIBLING = 'student-a2';
const CHILD_B = 'student-b';
const CLASS_A = 'class-a';
const CAMPUS_A = 'campus-anihi-admission';
const RAW_TOKEN = 'guardian-feed-test-session-token';

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-guardian-feed', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64');
}

async function makeHarness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: ['FAMILY_FILES'],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
  };

  async function request(path, { cookie, headers: extraHeaders } = {}) {
    const headers = new Headers(extraHeaders);
    if (cookie) headers.set('cookie', cookie);
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { headers }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get('content-type') || '';
    return {
      status: response.status,
      body: type.includes('application/json') ? await response.json() : await response.text(),
      headers: response.headers,
    };
  }

  // Initialize the isolated guardian schema without creating any production identity.
  await request('/api/family/auth/session');
  return { mf, env, request };
}

async function seedFixture(env) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const db = env.FAMILY_DB;

  await db.prepare(
    `INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, '기초반', '기초', 1, 1, ?, ?)`,
  ).bind(CLASS_A, CAMPUS_A, now, now).run();

  for (const [id, name, displayName, school, birthYear] of [
    [CHILD_A, '학생A실명', '꿈학생A', '비공개학교A', 2013],
    [CHILD_SIBLING, '학생형제실명', '꿈학생형제', '비공개학교형제', 2015],
    [CHILD_B, '학생B실명', '꿈학생B', '비공개학교B', 2014],
  ]) {
    await db.prepare(
      `INSERT INTO family_students (
         id, campus_id, name, display_name, birth_year, school_name, grade, status,
         current_class_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '중1', 'active', ?, ?, ?)`,
    ).bind(id, CAMPUS_A, name, displayName, birthYear, school, CLASS_A, now, now).run();
  }

  for (const [id, loginId, displayName] of [
    [GUARDIAN_ID, 'guardian-a', '보호자A'],
    [OTHER_GUARDIAN_ID, 'guardian-b', '보호자B'],
  ]) {
    await db.prepare(
      `INSERT INTO family_guardians (
         id, login_id, display_name, status, must_change_password,
         failed_login_count, created_at, updated_at
       ) VALUES (?, ?, ?, 'active', 0, 0, ?, ?)`,
    ).bind(id, loginId, displayName, now, now).run();
  }

  await db.prepare(
    `INSERT INTO guardian_sessions (
       id, guardian_id, token_hash, created_at, expires_at, last_seen_at
     ) VALUES ('session-a', ?, ?, ?, ?, ?)`,
  ).bind(GUARDIAN_ID, await sha256Base64(RAW_TOKEN), now, expiresAt, now).run();

  await db.prepare(
    `INSERT INTO student_guardians
       (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
     VALUES
       ('link-a', ?, ?, '부모', 1, 1, ?),
       ('link-a2', ?, ?, '부모', 1, 1, ?),
       ('link-b', ?, ?, '부모', 1, 1, ?)`,
  ).bind(CHILD_A, GUARDIAN_ID, now, CHILD_SIBLING, GUARDIAN_ID, now, CHILD_B, OTHER_GUARDIAN_ID, now).run();

  await db.prepare(
    `INSERT INTO monthly_reports (
       id, student_id, campus_id, year_month, teacher_user_id,
       title, summary, evaluation_text, teacher_note, growth_points_json,
       next_month_focus, status, sent_at, created_at, updated_at
     ) VALUES
       ('report-sent', ?, ?, '2026-09', 'teacher-private', '9월 평가', '성장 요약',
        '보호자 공개 평가', '내부 교사 메모', '{"drawing":"up"}', '인체 집중', 'sent', ?, ?, ?),
       ('report-draft', ?, ?, '2026-10', 'teacher-private', '10월 임시', '임시요약',
        '임시평가', '비공개 초안 메모', '{}', '미정', 'draft', NULL, ?, ?)`,
  ).bind(CHILD_A, CAMPUS_A, now, now, now, CHILD_A, CAMPUS_A, now, now).run();

  await db.prepare(
    `INSERT INTO family_files (
       id, campus_id, student_id, owner_user_id, purpose, r2_key,
       file_name, mime_type, size_bytes, created_at
     ) VALUES
       ('file-a', ?, ?, 'teacher-private', 'artwork', 'family/test/file-a', '작품A.jpg', 'image/jpeg', 7, ?),
       ('file-b', ?, ?, 'teacher-private', 'artwork', 'family/test/file-b', '작품B.jpg', 'image/jpeg', 7, ?)`,
  ).bind(CAMPUS_A, CHILD_A, now, CAMPUS_A, CHILD_B, now).run();

  await db.prepare(
    `INSERT INTO student_artworks (
       id, student_id, campus_id, class_id, family_file_id,
       title, lesson_date, teacher_note, sort_order, created_at
     ) VALUES
       ('art-a', ?, ?, ?, 'file-a', '공개 작품', '2026-09-01', '작품 내부 메모', 1, ?),
       ('art-b', ?, ?, ?, 'file-b', '타학생 작품', '2026-09-02', '타학생 내부 메모', 1, ?)`,
  ).bind(CHILD_A, CAMPUS_A, CLASS_A, now, CHILD_B, CAMPUS_A, CLASS_A, now).run();

  await env.FAMILY_FILES.put('family/test/file-a', new Uint8Array([1, 2, 3, 4, 5, 6, 7]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await env.FAMILY_FILES.put('family/test/file-b', new Uint8Array([7, 6, 5, 4, 3, 2, 1]), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
}

const cookie = `kkumeum_family_session=${RAW_TOKEN}`;

function assertNoPrivateFields(value) {
  const json = JSON.stringify(value);
  for (const forbidden of [
    'school_name', 'schoolName', 'birth_year', 'birthYear', 'teacher_note', 'teacherNote',
    'teacher_user_id', 'teacherUserId', 'r2_key', 'r2Key', 'owner_user_id', 'ownerUserId',
    'phone', 'email', '비공개학교', '내부 교사 메모', '작품 내부 메모',
  ]) {
    assert.equal(json.includes(forbidden), false, `private field leaked: ${forbidden}`);
  }
}

test('보호자는 연결된 자녀만 보고 최소 필드만 받는다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const response = await request('/api/family/children', { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(response.body.children.map((child) => child.studentId).sort(), [CHILD_A, CHILD_SIBLING].sort());
    assert.deepEqual(Object.keys(response.body.children[0]).sort(), ['className', 'displayName', 'grade', 'status', 'studentId']);
    assertNoPrivateFields(response.body);

    const own = await request(`/api/family/children/${CHILD_A}`, { cookie });
    assert.equal(own.status, 200);
    assert.equal(own.body.child.displayName, '꿈학생A');

    const other = await request(`/api/family/children/${CHILD_B}`, { cookie });
    assert.equal(other.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('보호자 성장평가는 sent만 노출하고 교사용 메모/교사ID/초안을 숨긴다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const response = await request(`/api/family/children/${CHILD_A}/reports`, { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.body.reports.length, 1);
    assert.equal(response.body.reports[0].reportId, 'report-sent');
    assert.equal(response.body.reports[0].evaluationText, '보호자 공개 평가');
    assertNoPrivateFields(response.body);
    assert.equal(JSON.stringify(response.body).includes('10월 임시'), false);

    await env.FAMILY_DB.prepare(
      'UPDATE student_guardians SET can_view_reports = 0 WHERE guardian_id = ? AND student_id = ?',
    ).bind(GUARDIAN_ID, CHILD_A).run();
    const denied = await request(`/api/family/children/${CHILD_A}/reports`, { cookie });
    assert.equal(denied.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('보호자 작품 목록/파일은 own-child + can_view_photos 경계를 지킨다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const gallery = await request(`/api/family/children/${CHILD_A}/artworks`, { cookie });
    assert.equal(gallery.status, 200);
    assert.equal(gallery.body.artworks.length, 1);
    assert.equal(gallery.body.artworks[0].fileUrl, '/api/family/files/file-a');
    assertNoPrivateFields(gallery.body);

    const ownFile = await request('/api/family/files/file-a', { cookie });
    assert.equal(ownFile.status, 200);
    assert.equal(ownFile.headers.get('cache-control'), 'private, no-store');
    assert.match(ownFile.headers.get('content-type') || '', /image\/jpeg/);

    const otherFile = await request('/api/family/files/file-b', { cookie });
    assert.equal(otherFile.status, 403);

    await env.FAMILY_DB.prepare(
      'UPDATE student_guardians SET can_view_photos = 0 WHERE guardian_id = ? AND student_id = ?',
    ).bind(GUARDIAN_ID, CHILD_A).run();
    const deniedGallery = await request(`/api/family/children/${CHILD_A}/artworks`, { cookie });
    assert.equal(deniedGallery.status, 403);
    const deniedFile = await request('/api/family/files/file-a', { cookie });
    assert.equal(deniedFile.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('보호자 feed는 guardian 세션만 인정하고 비밀번호 변경 필요 상태를 fail-closed 한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const unauth = await request('/api/family/children');
    assert.equal(unauth.status, 401);

    const staffOnly = await request('/api/family/children', {
      headers: {
        'oai-authenticated-user-id': 'staff-a',
        'oai-authenticated-user-email': 'staff-a@example.test',
      },
    });
    assert.equal(staffOnly.status, 401);

    await env.FAMILY_DB.prepare(
      'UPDATE family_guardians SET must_change_password = 1 WHERE id = ?',
    ).bind(GUARDIAN_ID).run();
    const mustChange = await request('/api/family/children', { cookie });
    assert.equal(mustChange.status, 403);

    const genericFamilyTables = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type='table' AND name IN ('family_guardians','guardian_sessions','student_guardians','monthly_reports','family_files')`,
    ).first();
    assert.equal(Number(genericFamilyTables?.count || 0), 0);
  } finally {
    await mf.dispose();
  }
});

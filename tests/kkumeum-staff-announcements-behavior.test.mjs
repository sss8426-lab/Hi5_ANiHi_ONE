import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'notice-admin', email: 'notice-admin@example.test', name: '소식 관리자' };
const DIRECTOR = { id: 'notice-director', email: 'notice-director@example.test', name: '소식 원장' };
const TEACHER = { id: 'notice-teacher', email: 'notice-teacher@example.test', name: '소식 선생님' };
const STAFF = { id: 'notice-staff', email: 'notice-staff@example.test', name: '소식 직원' };
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-design-admission';
const ORGANIZATION_ID = 'org-hi5-anihi';
const CLASS_A = 'notice-class-a';
const STUDENT_A = 'notice-student-a';

function authHeaders(user) {
  return {
    'oai-authenticated-user-id': user.id,
    'oai-authenticated-user-email': user.email,
    'oai-authenticated-user-full-name': encodeURIComponent(user.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-staff-notices', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function makeHarness({ family = true } = {}) {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: family ? ['DB', 'FAMILY_DB'] : ['DB'],
    d1Persist: false,
  });
  const worker = await loadWorker();
  const DB = await mf.getD1Database('DB');
  const env = { DB, DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  if (family) env.FAMILY_DB = await mf.getD1Database('FAMILY_DB');

  async function request(path, { user = ADMIN, method = 'GET', body, origin = 'http://localhost' } = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (method !== 'GET' && origin) headers.set('origin', origin);
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
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

  return { mf, env, DB, request };
}

async function addMembership(env, request, user, role, campusId) {
  await request('/api/data-core/context', { user });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `membership:${user.id}:${role}:${campusId || 'org'}`,
    ORGANIZATION_ID,
    campusId,
    `oai:${user.id}`,
    role,
    now,
    now,
  ).run();
}

async function seedFamily(env) {
  const db = env.FAMILY_DB;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, '테스트반', '기초', 1, 1, ?, ?)`,
  ).bind(CLASS_A, CAMPUS_A, now, now).run();
  await db.prepare(
    `INSERT INTO family_students (
       id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
     ) VALUES (?, ?, '테스트학생', '테스트학생', '중1', 'active', ?, ?, ?)`,
  ).bind(STUDENT_A, CAMPUS_A, CLASS_A, now, now).run();
  await db.prepare(
    `INSERT INTO class_staff_assignments (
       id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks,
       started_at, ended_at, created_at, updated_at
     ) VALUES ('notice-teacher-assignment', ?, ?, 'TEACHER', 1, 1, ?, NULL, ?, ?)`,
  ).bind(CLASS_A, `oai:${TEACHER.id}`, now, now, now).run();
}

function noticeBody({ campusId, announcementType, targetType, targetId }) {
  const body = {
    announcementType,
    title: `${announcementType} 테스트`,
    body: '보호자에게 전달될 테스트 소식입니다.',
    targets: [{ targetType, ...(targetId ? { targetId } : {}) }],
  };
  if (campusId) body.campusId = campusId;
  return body;
}

test('staff notice routes use FAMILY_DB without requiring FAMILY_FILES and super admin can publish organization notice', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    const created = await request('/api/kkumeum/announcements', {
      method: 'POST',
      body: noticeBody({ announcementType: 'organization-notice', targetType: 'organization' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'private, no-store');
    assert.equal(created.body.announcement.status, 'draft');

    const id = created.body.announcement.id;
    const published = await request(`/api/kkumeum/announcements/${id}/publish`, { method: 'POST' });
    assert.equal(published.status, 200);
    assert.equal(published.body.announcement.status, 'published');

    const row = await env.FAMILY_DB.prepare('SELECT status, published_at FROM announcements WHERE id = ?').bind(id).first();
    assert.equal(row.status, 'published');
    assert.ok(row.published_at);
  } finally {
    await mf.dispose();
  }
});

test('director is own-campus only and teacher is assignment-scoped with no campus-wide publish', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    // Initialize all FAMILY_DB schemas through the real route before direct fixture inserts.
    await request('/api/kkumeum/announcements', {
      method: 'POST',
      body: noticeBody({ announcementType: 'organization-notice', targetType: 'organization' }),
    });
    await addMembership(env, request, DIRECTOR, 'CAMPUS_DIRECTOR', CAMPUS_A);
    await addMembership(env, request, TEACHER, 'TEACHER', CAMPUS_A);
    await seedFamily(env);

    const ownCampus = await request('/api/kkumeum/announcements', {
      user: DIRECTOR,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'campus-news', targetType: 'campus', targetId: CAMPUS_A }),
    });
    assert.equal(ownCampus.status, 201);

    const otherCampus = await request('/api/kkumeum/announcements', {
      user: DIRECTOR,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_B, announcementType: 'campus-news', targetType: 'campus', targetId: CAMPUS_B }),
    });
    assert.equal(otherCampus.status, 403);

    const classNotice = await request('/api/kkumeum/announcements', {
      user: TEACHER,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'class-news', targetType: 'class', targetId: CLASS_A }),
    });
    assert.equal(classNotice.status, 201);

    const studentNotice = await request('/api/kkumeum/announcements', {
      user: TEACHER,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'child-message', targetType: 'student', targetId: STUDENT_A }),
    });
    assert.equal(studentNotice.status, 201);

    const teacherCampus = await request('/api/kkumeum/announcements', {
      user: TEACHER,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'campus-news', targetType: 'campus', targetId: CAMPUS_A }),
    });
    assert.equal(teacherCampus.status, 403);

    const unscoped = await request('/api/kkumeum/announcements', {
      user: TEACHER,
      method: 'POST',
      body: noticeBody({ announcementType: 'selected-delivery', targetType: 'student', targetId: STUDENT_A }),
    });
    assert.equal(unscoped.status, 400);
  } finally {
    await mf.dispose();
  }
});

test('STAFF campus publish is deny-by-default and works only after explicit FAMILY_DB permission', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await request('/api/kkumeum/announcements', {
      method: 'POST',
      body: noticeBody({ announcementType: 'organization-notice', targetType: 'organization' }),
    });
    await addMembership(env, request, STAFF, 'STAFF', CAMPUS_A);

    const denied = await request('/api/kkumeum/announcements', {
      user: STAFF,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'campus-news', targetType: 'campus', targetId: CAMPUS_A }),
    });
    assert.equal(denied.status, 403);

    const now = new Date().toISOString();
    await env.FAMILY_DB.prepare(
      `INSERT INTO family_staff_notice_permissions (
         id, campus_id, staff_user_id, can_publish_campus, created_at, updated_at
       ) VALUES ('notice-staff-permission', ?, ?, 1, ?, ?)`,
    ).bind(CAMPUS_A, `oai:${STAFF.id}`, now, now).run();

    const allowed = await request('/api/kkumeum/announcements', {
      user: STAFF,
      method: 'POST',
      body: noticeBody({ campusId: CAMPUS_A, announcementType: 'campus-news', targetType: 'campus', targetId: CAMPUS_A }),
    });
    assert.equal(allowed.status, 201);
  } finally {
    await mf.dispose();
  }
});

test('mutations reject cross-origin and missing FAMILY_DB fails closed without generic DATA CORE fallback', async () => {
  const withFamily = await makeHarness();
  try {
    const crossOrigin = await withFamily.request('/api/kkumeum/announcements', {
      method: 'POST',
      origin: 'https://evil.example',
      body: noticeBody({ announcementType: 'organization-notice', targetType: 'organization' }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await withFamily.mf.dispose();
  }

  const withoutFamily = await makeHarness({ family: false });
  try {
    const response = await withoutFamily.request('/api/kkumeum/announcements');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally {
    await withoutFamily.mf.dispose();
  }
});

test('audit metadata records lifecycle without storing full notice body', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    const secretText = '이 문장은 감사로그 metadata에 저장되면 안 됩니다.';
    const created = await request('/api/kkumeum/announcements', {
      method: 'POST',
      body: {
        announcementType: 'organization-notice',
        title: '감사로그 테스트',
        body: secretText,
        targets: [{ targetType: 'organization' }],
      },
    });
    assert.equal(created.status, 201);
    const id = created.body.announcement.id;
    await request(`/api/kkumeum/announcements/${id}/publish`, { method: 'POST' });

    const result = await env.FAMILY_DB.prepare(
      `SELECT action, metadata_json FROM family_audit_logs
       WHERE resource_type = 'announcement' AND resource_id = ? ORDER BY created_at`,
    ).bind(id).all();
    assert.deepEqual(result.results.map((row) => row.action), ['announcement.create', 'announcement.publish']);
    assert.equal(JSON.stringify(result.results).includes(secretText), false);
  } finally {
    await mf.dispose();
  }
});

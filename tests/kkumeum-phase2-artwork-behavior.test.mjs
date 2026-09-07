import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = {
  id: 'kkumeum-art-admin',
  email: 'kkumeum-art-admin@example.test',
  name: '꿈이음 작품 관리자',
};
const TEACHER = {
  id: 'kkumeum-art-teacher',
  email: 'kkumeum-art-teacher@example.test',
  name: '꿈이음 작품 교사',
};
const OTHER = {
  id: 'kkumeum-art-other',
  email: 'kkumeum-art-other@example.test',
  name: '다른 캠퍼스 원장',
};
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-design-admission';
const ORGANIZATION_ID = 'org-hi5-anihi';

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
  workerUrl.searchParams.set('kkumeum-artwork', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
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
  const DB = await mf.getD1Database('DB');
  const FAMILY_DB = await mf.getD1Database('FAMILY_DB');
  const env = {
    DB,
    FAMILY_DB,
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };

  async function request(path, { user = ADMIN, method = 'GET', body, form } = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    let requestBody;
    if (form) {
      requestBody = form;
    } else if (body !== undefined) {
      headers.set('content-type', 'application/json');
      requestBody = JSON.stringify(body);
    }
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { method, headers, body: requestBody }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get('content-type') || '';
    return {
      status: response.status,
      headers: response.headers,
      body: type.includes('application/json') ? await response.json() : await response.arrayBuffer(),
    };
  }

  return { mf, env, request };
}

function artworkForm({ campusId, studentId, classId, reportId, title = '테스트작품' }) {
  const form = new FormData();
  form.set('campusId', campusId);
  form.set('studentId', studentId);
  if (classId) form.set('classId', classId);
  if (reportId) form.set('reportId', reportId);
  form.set('title', title);
  form.set('lessonDate', '2026-09-08');
  form.set('teacherNote', '내부 작품 메모');
  form.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'student-art.png', { type: 'image/png' }));
  return form;
}

async function addMembership(db, user, campusId, role) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `membership:${user.id}:${campusId}:${role}`,
    ORGANIZATION_ID,
    campusId,
    `oai:${user.id}`,
    role,
    now,
    now,
  ).run();
}

test('꿈이음 작품은 FAMILY_FILES에서만 저장·권한확인·휴지통·복원된다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    const classResult = await request('/api/kkumeum/classes', {
      method: 'POST',
      body: { campusId: CAMPUS_A, name: '작품테스트반', stage: '기초' },
    });
    assert.equal(classResult.status, 201);
    const classId = classResult.body.class.id;

    const studentResult = await request('/api/kkumeum/students', {
      method: 'POST',
      body: { campusId: CAMPUS_A, name: '작품학생', classId, grade: '중1' },
    });
    assert.equal(studentResult.status, 201);
    const studentId = studentResult.body.student.id;

    const otherStudentResult = await request('/api/kkumeum/students', {
      method: 'POST',
      body: { campusId: CAMPUS_A, name: '다른학생', classId, grade: '중1' },
    });
    assert.equal(otherStudentResult.status, 201);
    const otherStudentId = otherStudentResult.body.student.id;

    const otherReport = await request('/api/kkumeum/reports', {
      method: 'POST',
      body: {
        campusId: CAMPUS_A,
        studentId: otherStudentId,
        yearMonth: '2026-09',
        evaluationText: '다른 학생 평가',
      },
    });
    assert.equal(otherReport.status, 201);

    await request('/api/data-core/context', { user: TEACHER });
    await addMembership(env.DB, TEACHER, CAMPUS_A, 'TEACHER');
    const now = new Date().toISOString();
    await env.FAMILY_DB.prepare(
      `INSERT INTO class_staff_assignments (
         id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks,
         started_at, ended_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'TEACHER', 1, 0, ?, NULL, ?, ?)`,
    ).bind('assignment:art-teacher', classId, `oai:${TEACHER.id}`, now, now, now).run();

    const deniedUpload = await request('/api/kkumeum/artworks', {
      user: TEACHER,
      method: 'POST',
      form: artworkForm({ campusId: CAMPUS_A, studentId, classId }),
    });
    assert.equal(deniedUpload.status, 403);

    await env.FAMILY_DB.prepare(
      'UPDATE class_staff_assignments SET can_manage_artworks = 1, updated_at = ? WHERE id = ?',
    ).bind(new Date().toISOString(), 'assignment:art-teacher').run();

    const upload = await request('/api/kkumeum/artworks', {
      user: TEACHER,
      method: 'POST',
      form: artworkForm({ campusId: CAMPUS_A, studentId, classId }),
    });
    assert.equal(upload.status, 201);
    assert.equal(upload.headers.get('cache-control'), 'private, no-store');
    assert.ok(upload.body.artwork.id);
    assert.ok(upload.body.artwork.fileId);
    assert.match(upload.body.artwork.fileUrl, /^\/api\/kkumeum\/files\//);
    assert.equal('r2Key' in upload.body.artwork, false);
    assert.equal('r2_key' in upload.body.artwork, false);
    const artworkId = upload.body.artwork.id;
    const fileId = upload.body.artwork.fileId;

    const fileRead = await request(`/api/kkumeum/files/${fileId}`, { user: TEACHER });
    assert.equal(fileRead.status, 200);
    assert.equal(fileRead.headers.get('cache-control'), 'private, no-store');
    assert.equal(fileRead.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(new Uint8Array(fileRead.body)[0], 137);

    const unauthRead = await request(`/api/kkumeum/files/${fileId}`, { user: null });
    assert.equal(unauthRead.status, 401);

    await request('/api/data-core/context', { user: OTHER });
    await addMembership(env.DB, OTHER, CAMPUS_B, 'CAMPUS_DIRECTOR');
    const crossCampusRead = await request(`/api/kkumeum/files/${fileId}`, { user: OTHER });
    assert.equal(crossCampusRead.status, 403);

    const wrongReport = await request(`/api/kkumeum/artworks/${artworkId}`, {
      user: TEACHER,
      method: 'PATCH',
      body: { reportId: otherReport.body.report.id },
    });
    assert.equal(wrongReport.status, 400);

    const gallery = await request(`/api/kkumeum/artworks?campusId=${CAMPUS_A}&studentId=${studentId}`, {
      user: TEACHER,
    });
    assert.equal(gallery.status, 200);
    assert.equal(gallery.body.artworks.length, 1);

    const trashed = await request(`/api/kkumeum/artworks/${artworkId}`, {
      user: TEACHER,
      method: 'DELETE',
    });
    assert.equal(trashed.status, 200);
    assert.equal(trashed.body.recoverable, true);

    const afterTrash = await request(`/api/kkumeum/files/${fileId}`, { user: TEACHER });
    assert.equal(afterTrash.status, 404);
    const emptyGallery = await request(`/api/kkumeum/artworks?campusId=${CAMPUS_A}&studentId=${studentId}`, {
      user: TEACHER,
    });
    assert.equal(emptyGallery.status, 200);
    assert.equal(emptyGallery.body.artworks.length, 0);

    const restored = await request(`/api/kkumeum/artworks/${artworkId}/restore`, {
      user: TEACHER,
      method: 'POST',
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.restored, true);

    const restoredFile = await request(`/api/kkumeum/files/${fileId}`, { user: TEACHER });
    assert.equal(restoredFile.status, 200);

    const genericTable = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'family_files'")
      .first();
    assert.equal(genericTable, null);
  } finally {
    await mf.dispose();
  }
});

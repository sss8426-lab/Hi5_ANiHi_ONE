import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = {
  id: 'kkumeum-admin',
  email: 'kkumeum-admin@example.test',
  name: '꿈이음 관리자',
};
const DIRECTOR = {
  id: 'kkumeum-director',
  email: 'kkumeum-director@example.test',
  name: '꿈이음 원장',
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
  workerUrl.searchParams.set('kkumeum-phase1', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function makeHarness({ family = false } = {}) {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: family ? ['DB', 'FAMILY_DB'] : ['DB'],
    r2Buckets: family ? ['FAMILY_FILES'] : [],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const DB = await mf.getD1Database('DB');
  const env = {
    DB,
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };
  if (family) {
    env.FAMILY_DB = await mf.getD1Database('FAMILY_DB');
    env.FAMILY_FILES = await mf.getR2Bucket('FAMILY_FILES');
  }

  async function request(path, { user = ADMIN, method = 'GET', body } = {}) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  return { mf, env, DB, request };
}

async function familyTableCount(db) {
  const result = await db
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'family_%'")
    .first();
  return Number(result?.count || 0);
}

test('꿈이음 staff API requires auth and missing FAMILY bindings fail closed without touching generic DB', async () => {
  const { mf, DB, request } = await makeHarness();
  try {
    const unauthenticated = await request('/api/kkumeum/health', { user: null });
    assert.equal(unauthenticated.status, 401);

    const health = await request('/api/kkumeum/health');
    assert.equal(health.status, 503);
    assert.equal(health.body.status.database, false);
    assert.equal(health.body.status.files, false);

    const classes = await request(`/api/kkumeum/classes?campusId=${CAMPUS_A}`);
    assert.equal(classes.status, 503);
    assert.match(classes.body.error, /FAMILY_DB\/FAMILY_FILES/);
    assert.equal(await familyTableCount(DB), 0);
  } finally {
    await mf.dispose();
  }
});

test('꿈이음 classes/students initialize and persist only in isolated FAMILY_DB when both bindings exist', async () => {
  const { mf, env, DB, request } = await makeHarness({ family: true });
  try {
    const health = await request('/api/kkumeum/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status.ok, true);

    const newClass = await request('/api/kkumeum/classes', {
      method: 'POST',
      body: { campusId: CAMPUS_A, name: '기초반', stage: '기초' },
    });
    assert.equal(newClass.status, 201);
    assert.ok(newClass.body.class.id);

    const newStudent = await request('/api/kkumeum/students', {
      method: 'POST',
      body: {
        campusId: CAMPUS_A,
        name: '테스트학생',
        grade: '중1',
        classId: newClass.body.class.id,
        status: 'active',
      },
    });
    assert.equal(newStudent.status, 201);
    assert.ok(newStudent.body.student.id);

    const students = await request(`/api/kkumeum/students?campusId=${CAMPUS_A}&status=active`);
    assert.equal(students.status, 200);
    assert.equal(students.body.students.length, 1);

    assert.ok(await familyTableCount(env.FAMILY_DB) >= 3);
    assert.equal(await familyTableCount(DB), 0);
  } finally {
    await mf.dispose();
  }
});

test('꿈이음 campus manager permissions do not leak into another campus', async () => {
  const { mf, env, request } = await makeHarness({ family: true });
  try {
    await request('/api/data-core/context', { user: DIRECTOR });
    const directorInternalId = `oai:${DIRECTOR.id}`;
    await env.DB.prepare(
      `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'CAMPUS_DIRECTOR', ?, ?)`,
    ).bind(
      'membership:kkumeum-director:a',
      ORGANIZATION_ID,
      CAMPUS_A,
      directorInternalId,
      new Date().toISOString(),
      new Date().toISOString(),
    ).run();

    const ownCampus = await request('/api/kkumeum/classes', {
      user: DIRECTOR,
      method: 'POST',
      body: { campusId: CAMPUS_A, name: '원장반' },
    });
    assert.equal(ownCampus.status, 201);

    const otherCampus = await request('/api/kkumeum/classes', {
      user: DIRECTOR,
      method: 'POST',
      body: { campusId: CAMPUS_B, name: '다른캠퍼스반' },
    });
    assert.equal(otherCampus.status, 403);
  } finally {
    await mf.dispose();
  }
});

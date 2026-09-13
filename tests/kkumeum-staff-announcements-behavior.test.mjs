import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'notice-admin', email: 'notice-admin@example.test', name: '소식 관리자' };
const DIRECTOR = { id: 'notice-director', email: 'notice-director@example.test', name: '소식 원장' };
const TEACHER = { id: 'notice-teacher', email: 'notice-teacher@example.test', name: '소식 선생님' };
const STAFF = { id: 'notice-staff', email: 'notice-staff@example.test', name: '소식 직원' };
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-design-admission';
const ORG = 'org-hi5-anihi';
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

async function harness({ family = true } = {}) {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: family ? ['DB', 'FAMILY_DB'] : ['DB'],
    d1Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };
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

  return { mf, env, request };
}

async function membership(env, request, user, role, campusId) {
  await request('/api/data-core/context', { user });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(`m:${user.id}:${role}`, ORG, campusId, `oai:${user.id}`, role, now, now).run();
}

async function initializeAndSeed({ env, request }) {
  await request('/api/kkumeum/announcements', {
    method: 'POST',
    body: {
      announcementType: 'organization-notice',
      title: '초기화',
      body: '스키마 초기화',
      targets: [{ targetType: 'organization' }],
    },
  });
  const now = new Date().toISOString();
  await env.FAMILY_DB.prepare(
    `INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, '테스트반', '기초', 1, 1, ?, ?)`,
  ).bind(CLASS_A, CAMPUS_A, now, now).run();
  await env.FAMILY_DB.prepare(
    `INSERT INTO family_students (
       id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
     ) VALUES (?, ?, '테스트학생', '테스트학생', '중1', 'active', ?, ?, ?)`,
  ).bind(STUDENT_A, CAMPUS_A, CLASS_A, now, now).run();
  await env.FAMILY_DB.prepare(
    `INSERT INTO class_staff_assignments (
       id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks,
       started_at, ended_at, created_at, updated_at
     ) VALUES ('notice-teacher-assignment', ?, ?, 'TEACHER', 1, 1, ?, NULL, ?, ?)`,
  ).bind(CLASS_A, `oai:${TEACHER.id}`, now, now, now).run();
}

function notice(campusId, announcementType, targetType, targetId) {
  return {
    ...(campusId ? { campusId } : {}),
    announcementType,
    title: `${announcementType} 테스트`,
    body: '보호자에게 전달될 테스트 소식입니다.',
    targets: [{ targetType, ...(targetId ? { targetId } : {}) }],
  };
}

test('mobile notice detail/targets and soft archive keep author, campus, origin and private boundaries', async () => {
  const h = await harness();
  try {
    await initializeAndSeed(h);
    await membership(h.env, h.request, TEACHER, 'TEACHER', CAMPUS_A);
    await membership(h.env, h.request, DIRECTOR, 'CAMPUS_DIRECTOR', CAMPUS_B);
    const created = await h.request('/api/kkumeum/announcements', {user:TEACHER,method:'POST',body:notice(CAMPUS_A,'selected-delivery','student',STUDENT_A)});
    assert.equal(created.status,201);
    const id=created.body.announcement.id, url=`/api/kkumeum/announcements/${id}`;
    const detail=await h.request(url,{user:TEACHER});
    assert.equal(detail.status,200);assert.equal(detail.body.announcement.canEdit,true);
    assert.equal(detail.body.announcement.readCount,0);assert.equal(detail.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(detail.body.announcement.targets,[{targetType:'student',targetId:STUDENT_A}]);
    await h.env.FAMILY_DB.prepare("UPDATE class_staff_assignments SET ended_at = ? WHERE id = 'notice-teacher-assignment'").bind(new Date().toISOString()).run();
    assert.equal((await h.request(`/api/kkumeum/announcements?campusId=${CAMPUS_A}`,{user:TEACHER})).body.announcements.length,0);
    assert.equal((await h.request(url,{user:TEACHER})).status,403);
    await h.env.FAMILY_DB.prepare("UPDATE class_staff_assignments SET ended_at = NULL WHERE id = 'notice-teacher-assignment'").run();
    assert.equal((await h.request(url,{user:DIRECTOR})).status,403);
    assert.equal((await h.request(url,{user:null})).status,401);
    assert.equal((await h.request(url,{user:DIRECTOR,method:'DELETE'})).status,403);
    assert.equal((await h.request(url,{user:TEACHER,method:'DELETE',origin:'https://evil.example'})).status,403);
    const listed=await h.request(`/api/kkumeum/announcements?campusId=${CAMPUS_A}`,{user:TEACHER});
    assert.deepEqual(listed.body.announcements[0].targets,detail.body.announcement.targets);
    assert.equal((await h.request(url,{user:TEACHER,method:'DELETE'})).status,200);
    assert.equal((await h.request(url,{user:TEACHER})).status,404);
    assert.equal((await h.request(`${url}/publish`,{user:TEACHER,method:'POST'})).status,409);
    const row=await h.env.FAMILY_DB.prepare('SELECT status, body FROM announcements WHERE id = ?').bind(id).first();
    assert.equal(row.status,'archived');assert.ok(row.body);
    assert.equal((await h.request(`/api/kkumeum/announcements?campusId=${CAMPUS_A}`,{user:TEACHER})).body.announcements.length,0);
  } finally { await h.mf.dispose(); }
});

test('super admin publishes organization notice with FAMILY_DB only and audit excludes full body', async () => {
  const h = await harness();
  try {
    const secret = '감사로그에 들어가면 안 되는 본문';
    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST',
      body: { announcementType: 'organization-notice', title: '전체공지', body: secret, targets: [{ targetType: 'organization' }] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'private, no-store');
    const id = created.body.announcement.id;
    const published = await h.request(`/api/kkumeum/announcements/${id}/publish`, { method: 'POST' });
    assert.equal(published.status, 200);
    assert.equal(published.body.announcement.status, 'published');

    const audit = await h.env.FAMILY_DB.prepare(
      `SELECT action, metadata_json FROM family_audit_logs
       WHERE resource_type = 'announcement' AND resource_id = ? ORDER BY created_at`,
    ).bind(id).all();
    assert.deepEqual(audit.results.map((row) => row.action), ['announcement.create', 'announcement.publish']);
    assert.equal(JSON.stringify(audit.results).includes(secret), false);
  } finally {
    await h.mf.dispose();
  }
});

test('director/teacher/STAFF publishing obeys campus, assignment and explicit permission boundaries', async () => {
  const h = await harness();
  try {
    await initializeAndSeed(h);
    await membership(h.env, h.request, DIRECTOR, 'CAMPUS_DIRECTOR', CAMPUS_A);
    await membership(h.env, h.request, TEACHER, 'TEACHER', CAMPUS_A);
    await membership(h.env, h.request, STAFF, 'STAFF', CAMPUS_A);
    assert.equal((await h.request(`/api/kkumeum/announcement-capabilities?campusId=${CAMPUS_A}`, {user:TEACHER})).body.canPublishCampus,false);
    assert.equal((await h.request(`/api/kkumeum/announcement-capabilities?campusId=${CAMPUS_B}`, {user:TEACHER})).status,403);

    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: DIRECTOR, method: 'POST', body: notice(CAMPUS_A, 'campus-news', 'campus', CAMPUS_A),
    })).status, 201);
    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: DIRECTOR, method: 'POST', body: notice(CAMPUS_B, 'campus-news', 'campus', CAMPUS_B),
    })).status, 403);

    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: TEACHER, method: 'POST', body: notice(CAMPUS_A, 'class-news', 'class', CLASS_A),
    })).status, 201);
    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: TEACHER, method: 'POST', body: notice(CAMPUS_A, 'child-message', 'student', STUDENT_A),
    })).status, 201);
    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: TEACHER, method: 'POST', body: notice(CAMPUS_A, 'campus-news', 'campus', CAMPUS_A),
    })).status, 403);
    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: TEACHER, method: 'POST', body: notice(null, 'selected-delivery', 'student', STUDENT_A),
    })).status, 400);

    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: STAFF, method: 'POST', body: notice(CAMPUS_A, 'campus-news', 'campus', CAMPUS_A),
    })).status, 403);
    const now = new Date().toISOString();
    await h.env.FAMILY_DB.prepare(
      `INSERT INTO family_staff_notice_permissions (
         id, campus_id, staff_user_id, can_publish_campus, created_at, updated_at
       ) VALUES ('notice-staff-permission', ?, ?, 1, ?, ?)`,
    ).bind(CAMPUS_A, `oai:${STAFF.id}`, now, now).run();
    assert.equal((await h.request(`/api/kkumeum/announcement-capabilities?campusId=${CAMPUS_A}`, {user:STAFF})).body.canPublishCampus,true);
    assert.equal((await h.request('/api/kkumeum/announcements', {
      user: STAFF, method: 'POST', body: notice(CAMPUS_A, 'campus-news', 'campus', CAMPUS_A),
    })).status, 201);
  } finally {
    await h.mf.dispose();
  }
});

test('published organization notices are readable but not editable by organization staff', async () => {
  const h=await harness();
  try {
    await initializeAndSeed(h);await membership(h.env,h.request,TEACHER,'TEACHER',CAMPUS_A);
    const n=await h.request('/api/kkumeum/announcements',{method:'POST',body:notice(null,'organization-notice','organization')});
    const url=`/api/kkumeum/announcements/${n.body.announcement.id}`;
    assert.equal((await h.request(url,{user:TEACHER})).status,403);
    await h.request(`${url}/publish`,{method:'POST'});
    const read=await h.request(url,{user:TEACHER});assert.equal(read.status,200);assert.equal(read.body.announcement.canEdit,false);
    assert.equal((await h.request(`${url}`,{user:TEACHER,method:'DELETE'})).status,403);
    const list=await h.request(`/api/kkumeum/announcements?campusId=${CAMPUS_A}`,{user:TEACHER});
    assert.ok(list.body.announcements.some(a=>a.id===n.body.announcement.id));
    const outsider={id:'outsider',email:'outsider@example.test',name:'Synthetic outsider'};
    assert.equal((await h.request(url,{user:outsider})).status,403);
    assert.equal((await h.request('/api/kkumeum/announcements',{user:outsider})).status,403);
  } finally {await h.mf.dispose();}
});

test('staff notice mutations reject cross-origin and missing FAMILY_DB fails closed', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/api/kkumeum/announcements', {
      method: 'POST',
      origin: 'https://evil.example',
      body: notice(null, 'organization-notice', 'organization'),
    })).status, 403);
  } finally {
    await h.mf.dispose();
  }

  const missing = await harness({ family: false });
  try {
    const response = await missing.request('/api/kkumeum/announcements');
    assert.equal(response.status, 503);
    assert.match(String(response.body.error || ''), /FAMILY_DB/);
  } finally {
    await missing.mf.dispose();
  }
});

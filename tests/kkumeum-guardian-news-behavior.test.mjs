import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN_A = 'guardian-news-a';
const GUARDIAN_B = 'guardian-news-b';
const STUDENT_A = 'student-news-a';
const STUDENT_B = 'student-news-b';
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-gwangjin';
const CLASS_A = 'class-news-a';
const CLASS_B = 'class-news-b';
const RAW_TOKEN = 'guardian-news-session-token';
const cookie = `kkumeum_family_session=${RAW_TOKEN}`;

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-guardian-news', `${process.pid}-${Date.now()}-${Math.random()}`);
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
    d1Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
  };

  async function request(path, { method = 'GET', cookie: requestCookie, origin } = {}) {
    const headers = new Headers();
    if (requestCookie) headers.set('cookie', requestCookie);
    if (origin) headers.set('origin', origin);
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { method, headers }),
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

  // Initialize guardian + notice schemas through the real route.
  const unauthenticated = await request('/api/family/notices');
  assert.equal(unauthenticated.status, 401);
  return { mf, env, request };
}

async function seedFixture(env) {
  const db = env.FAMILY_DB;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (const [id, campusId, name] of [
    [CLASS_A, CAMPUS_A, '부천 기초반'],
    [CLASS_B, CAMPUS_B, '광진 기초반'],
  ]) {
    await db.prepare(
      `INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, '기초', 1, 1, ?, ?)`,
    ).bind(id, campusId, name, now, now).run();
  }

  for (const [id, campusId, classId, name] of [
    [STUDENT_A, CAMPUS_A, CLASS_A, '꿈학생A'],
    [STUDENT_B, CAMPUS_B, CLASS_B, '꿈학생B'],
  ]) {
    await db.prepare(
      `INSERT INTO family_students (
         id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '중1', 'active', ?, ?, ?)`,
    ).bind(id, campusId, name, name, classId, now, now).run();
  }

  for (const [id, loginId, displayName] of [
    [GUARDIAN_A, 'guardian-news-a', '보호자A'],
    [GUARDIAN_B, 'guardian-news-b', '보호자B'],
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
     ) VALUES ('session-news-a', ?, ?, ?, ?, ?)`,
  ).bind(GUARDIAN_A, await sha256Base64(RAW_TOKEN), now, expiresAt, now).run();

  await db.prepare(
    `INSERT INTO student_guardians
       (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
     VALUES
       ('link-news-a', ?, ?, '부모', 1, 1, ?),
       ('link-news-b', ?, ?, '부모', 1, 1, ?)`,
  ).bind(STUDENT_A, GUARDIAN_A, now, STUDENT_B, GUARDIAN_B, now).run();

  const notices = [
    ['notice-org', null, 'organization-notice', '전체공지', '전체 보호자 공개', 'published'],
    ['notice-campus', CAMPUS_A, 'campus-news', '부천 공지', '부천 보호자 공개', 'published'],
    ['notice-class', CAMPUS_A, 'class-news', '반소식', '기초반 보호자 공개', 'published'],
    ['notice-student', CAMPUS_A, 'child-message', '개별소식', '학생A 보호자 공개', 'published'],
    ['notice-guardian', CAMPUS_A, 'selected-delivery', '선택전달', '보호자A 직접 공개', 'published'],
    ['notice-multi', CAMPUS_A, 'selected-delivery', '중복 타깃', '한 번만 표시', 'published'],
    ['notice-other-campus', CAMPUS_B, 'campus-news', '광진 비공개', '보호자A에게 숨김', 'published'],
    ['notice-draft', CAMPUS_A, 'campus-news', '임시 공지', 'draft는 숨김', 'draft'],
  ];
  for (const [id, campusId, type, title, body, status] of notices) {
    await db.prepare(
      `INSERT INTO announcements (
         id, campus_id, author_user_id, announcement_type, title, body,
         status, published_at, created_at, updated_at
       ) VALUES (?, ?, 'staff-test', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, campusId, type, title, body, status, status === 'published' ? now : null, now, now).run();
  }

  const targets = [
    ['target-org', 'notice-org', 'organization', null],
    ['target-campus', 'notice-campus', 'campus', CAMPUS_A],
    ['target-class', 'notice-class', 'class', CLASS_A],
    ['target-student', 'notice-student', 'student', STUDENT_A],
    ['target-guardian', 'notice-guardian', 'guardian', GUARDIAN_A],
    ['target-multi-campus', 'notice-multi', 'campus', CAMPUS_A],
    ['target-multi-class', 'notice-multi', 'class', CLASS_A],
    ['target-other-campus', 'notice-other-campus', 'campus', CAMPUS_B],
    ['target-draft', 'notice-draft', 'campus', CAMPUS_A],
  ];
  for (const [id, announcementId, targetType, targetId] of targets) {
    await db.prepare(
      `INSERT INTO announcement_targets (id, announcement_id, target_type, target_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, announcementId, targetType, targetId, now).run();
  }
}

test('보호자 소식 feed는 연결 자녀 범위의 published target만 중복 없이 보여준다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const response = await request('/api/family/notices', { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.body.unreadCount, 6);
    assert.deepEqual(
      response.body.notices.map((notice) => notice.announcementId).sort(),
      ['notice-org', 'notice-campus', 'notice-class', 'notice-student', 'notice-guardian', 'notice-multi'].sort(),
    );
    assert.equal(response.body.notices.filter((notice) => notice.announcementId === 'notice-multi').length, 1);
    assert.equal(JSON.stringify(response.body).includes('광진 비공개'), false);
    assert.equal(JSON.stringify(response.body).includes('임시 공지'), false);
  } finally {
    await mf.dispose();
  }
});

test('읽음 처리는 명시적 POST에서만 idempotent하게 저장되고 unread count가 감소한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const first = await request('/api/family/notices/notice-campus/read', {
      method: 'POST', cookie, origin: 'http://localhost',
    });
    assert.equal(first.status, 200);
    const second = await request('/api/family/notices/notice-campus/read', {
      method: 'POST', cookie, origin: 'http://localhost',
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.readAt, first.body.readAt);

    const feed = await request('/api/family/notices', { cookie });
    assert.equal(feed.body.unreadCount, 5);
    assert.equal(feed.body.notices.find((notice) => notice.announcementId === 'notice-campus').unread, false);

    const count = await env.FAMILY_DB.prepare(
      `SELECT COUNT(*) AS count FROM read_receipts
       WHERE guardian_id = ? AND resource_type = 'announcement' AND resource_id = 'notice-campus'`,
    ).bind(GUARDIAN_A).first();
    assert.equal(Number(count.count), 1);
  } finally {
    await mf.dispose();
  }
});

test('보이지 않는 소식 읽음과 cross-origin mutation은 거부한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env);
    const hidden = await request('/api/family/notices/notice-other-campus/read', {
      method: 'POST', cookie, origin: 'http://localhost',
    });
    assert.equal(hidden.status, 403);

    const crossOrigin = await request('/api/family/notices/notice-campus/read', {
      method: 'POST', cookie, origin: 'https://evil.example',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('FAMILY_DB가 없으면 소식 API도 generic DATA CORE로 fallback하지 않고 503을 반환한다', async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB'],
    d1Persist: false,
  });
  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request('http://localhost/api/family/notices', { headers: { cookie } }),
      { DB: await mf.getD1Database('DB') },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally {
    await mf.dispose();
  }
});

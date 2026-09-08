import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const CAMPUS = 'campus-anihi-admission';
const OTHER_CAMPUS = 'campus-design-admission';
const MONTH = '2026-09';
const PRIVATE_MARKERS = [
  '비밀학생이름',
  '비밀학교',
  '보호자01012345678',
  '평가본문-절대복사금지',
  '교사메모-절대복사금지',
  'private-r2-key',
];

function headers(id, email, name) {
  return {
    'oai-authenticated-user-id': id,
    'oai-authenticated-user-email': email,
    'oai-authenticated-user-full-name': encodeURIComponent(name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

const ADMIN_HEADERS = headers('analytics-admin', 'analytics-admin@example.test', '통계 관리자');
const DIRECTOR_HEADERS = headers('analytics-director', 'analytics-director@example.test', '통계 원장');
const TEACHER_HEADERS = headers('analytics-teacher', 'analytics-teacher@example.test', '통계 교사');

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('kkumeum-analytics', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness() {
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
    DATA_CORE_SUPER_ADMIN_EMAILS: 'analytics-admin@example.test',
  };
  async function request(path, { method = 'GET', actor = 'admin', body, origin = 'http://localhost' } = {}) {
    const actorHeaders = actor === 'director' ? DIRECTOR_HEADERS : actor === 'teacher' ? TEACHER_HEADERS : ADMIN_HEADERS;
    const requestHeaders = new Headers(actorHeaders);
    if (origin) requestHeaders.set('origin', origin);
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json() };
  }
  return { mf, worker, env, request };
}

async function bootstrapFamily(h) {
  await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
  const now = new Date().toISOString();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
    VALUES ('analytics-class-a', ?, '기초반', '기초', 0, 1, ?, ?),
           ('analytics-class-b', ?, '심화반', '심화', 1, 1, ?, ?)`)
    .bind(CAMPUS, now, now, CAMPUS, now, now).run();

  for (let index = 1; index <= 6; index += 1) {
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (
      id, campus_id, name, display_name, school_name, grade, status, current_class_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '고1', 'active', 'analytics-class-a', ?, ?)`)
      .bind(
        `analytics-student-${index}`,
        CAMPUS,
        `${PRIVATE_MARKERS[0]}-${index}`,
        `${PRIVATE_MARKERS[0]}-${index}`,
        PRIVATE_MARKERS[1],
        now,
        now,
      ).run();
  }
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (
    id, campus_id, name, display_name, status, current_class_id, created_at, updated_at
  ) VALUES ('analytics-inactive', ?, '휴원학생', '휴원학생', 'leave', 'analytics-class-a', ?, ?)`)
    .bind(CAMPUS, now, now).run();

  const statuses = ['sent', 'sent', 'ready', 'draft'];
  for (let index = 0; index < statuses.length; index += 1) {
    const studentId = `analytics-student-${index + 1}`;
    await h.env.FAMILY_DB.prepare(`INSERT INTO monthly_reports (
      id, student_id, campus_id, year_month, teacher_user_id,
      title, summary, evaluation_text, teacher_note, growth_points_json,
      next_month_focus, status, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'teacher-private', '월간평가', ?, ?, ?, ?, '다음달 비밀목표', ?, ?, ?, ?)`)
      .bind(
        `analytics-report-${index + 1}`,
        studentId,
        CAMPUS,
        MONTH,
        PRIVATE_MARKERS[2],
        PRIVATE_MARKERS[3],
        PRIVATE_MARKERS[4],
        JSON.stringify({ privateTag: '개별성장태그-복사금지' }),
        statuses[index],
        statuses[index] === 'sent' ? now : null,
        now,
        now,
      ).run();
  }

  for (let index = 1; index <= 3; index += 1) {
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_files (
      id, campus_id, student_id, owner_user_id, purpose, r2_key, file_name, mime_type, size_bytes, created_at, deleted_at
    ) VALUES (?, ?, ?, 'teacher-private', 'artwork', ?, '비밀작품.png', 'image/png', 123, ?, NULL)`)
      .bind(`analytics-file-${index}`, CAMPUS, `analytics-student-${index}`, `${PRIVATE_MARKERS[5]}-${index}`, now).run();
    await h.env.FAMILY_DB.prepare(`INSERT INTO student_artworks (
      id, student_id, campus_id, class_id, report_id, family_file_id, title, lesson_date, teacher_note, sort_order, created_at
    ) VALUES (?, ?, ?, 'analytics-class-a', NULL, ?, '비밀작품제목', ?, ?, ?, ?)`)
      .bind(`analytics-artwork-${index}`, `analytics-student-${index}`, CAMPUS, `analytics-file-${index}`, `${MONTH}-0${index}`, PRIVATE_MARKERS[4], index, now).run();
  }
}

async function grantCampusRole(h, actor, role, campusId = CAMPUS) {
  await h.request(`/api/kkumeum/analytics/preview?campusId=${campusId}&yearMonth=${MONTH}`, { actor });
  const email = actor === 'director' ? 'analytics-director@example.test' : 'analytics-teacher@example.test';
  const user = await h.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  assert.ok(user?.id);
  const now = new Date().toISOString();
  await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
    VALUES (?, 'org-hi5-anihi', ?, ?, ?, ?, ?)`)
    .bind(`analytics-membership-${actor}`, campusId, user.id, role, now, now).run();
}

function assertNoPrivateMarkers(value) {
  const serialized = JSON.stringify(value);
  for (const marker of PRIVATE_MARKERS) assert.doesNotMatch(serialized, new RegExp(marker));
  assert.doesNotMatch(serialized, /analytics-student-|analytics-report-|analytics-file-|teacher-private|개별성장태그-복사금지|비밀작품제목|다음달 비밀목표/);
}

test('aggregate preview is accurate, private/no-store by contract, and excludes FAMILY private strings', async () => {
  const h = await harness();
  try {
    await bootstrapFamily(h);
    const response = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const data = response.body.analytics;
    assert.equal(data.activeStudentCount, 6);
    assert.deepEqual(data.reports, { missing: 2, draft: 1, ready: 1, sent: 2, completionRate: 66.7 });
    assert.deepEqual(data.artworks, { count: 3, averagePerActiveStudent: 0.5 });
    assert.equal(data.stageBreakdown.suppressed, false);
    assert.deepEqual(data.stageBreakdown.buckets, [{ stage: '기초', studentCount: 6 }]);
    assert.equal(response.body.syncEnabled, false);
    assertNoPrivateMarkers(response.body);
  } finally { await h.mf.dispose(); }
});

test('small stage cohort suppresses the entire stage breakdown instead of leaking a small count', async () => {
  const h = await harness();
  try {
    await bootstrapFamily(h);
    await h.env.FAMILY_DB.prepare("UPDATE family_students SET current_class_id = 'analytics-class-b' WHERE id = 'analytics-student-6'").run();
    const response = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.analytics.stageBreakdown.suppressed, true);
    assert.deepEqual(response.body.analytics.stageBreakdown.buckets, []);
    assertNoPrivateMarkers(response.body);
  } finally { await h.mf.dispose(); }
});

test('campus director can preview own campus, while cross-campus director and teacher are denied', async () => {
  const h = await harness();
  try {
    await bootstrapFamily(h);
    await grantCampusRole(h, 'director', 'CAMPUS_DIRECTOR', CAMPUS);
    const own = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`, { actor: 'director' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const cross = await h.request(`/api/kkumeum/analytics/preview?campusId=${OTHER_CAMPUS}&yearMonth=${MONTH}`, { actor: 'director' });
    assert.equal(cross.status, 403);

    await grantCampusRole(h, 'teacher', 'TEACHER', CAMPUS);
    const teacher = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`, { actor: 'teacher' });
    assert.equal(teacher.status, 403);
  } finally { await h.mf.dispose(); }
});

test('DATA CORE sync is disabled by default, then upserts only aggregate metadata when explicitly enabled', async () => {
  const h = await harness();
  try {
    await bootstrapFamily(h);
    const disabled = await h.request('/api/kkumeum/analytics/sync', {
      method: 'POST',
      body: { campusId: CAMPUS, yearMonth: MONTH },
    });
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, 'analytics_sync_disabled');
    assert.equal((await h.env.DB.prepare("SELECT COUNT(*) AS count FROM data_records WHERE source_app = 'kkumeum-analytics'").first()).count, 0);

    h.env.KKUMEUM_ANALYTICS_SYNC_ENABLED = 'true';
    const first = await h.request('/api/kkumeum/analytics/sync', {
      method: 'POST',
      body: { campusId: CAMPUS, yearMonth: MONTH },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assertNoPrivateMarkers(first.body);
    const row = await h.env.DB.prepare(`SELECT id, campus_id, record_type, source_app, summary, visibility, metadata_json
      FROM data_records WHERE source_app = 'kkumeum-analytics'`).first();
    assert.equal(row.record_type, 'kkumeum-growth-aggregate');
    assert.equal(row.campus_id, CAMPUS);
    assert.equal(row.visibility, 'campus');
    assert.equal(row.summary, null);
    assertNoPrivateMarkers(row);

    await h.env.FAMILY_DB.prepare(`INSERT INTO family_files (
      id, campus_id, student_id, purpose, r2_key, file_name, mime_type, size_bytes, created_at
    ) VALUES ('analytics-file-4', ?, 'analytics-student-4', 'artwork', 'private-r2-extra', 'private.png', 'image/png', 100, ?)`)
      .bind(CAMPUS, new Date().toISOString()).run();
    await h.env.FAMILY_DB.prepare(`INSERT INTO student_artworks (
      id, student_id, campus_id, class_id, family_file_id, title, lesson_date, sort_order, created_at
    ) VALUES ('analytics-artwork-4', 'analytics-student-4', ?, 'analytics-class-a', 'analytics-file-4', 'private title', '2026-09-20', 0, ?)`)
      .bind(CAMPUS, new Date().toISOString()).run();

    const second = await h.request('/api/kkumeum/analytics/sync', {
      method: 'POST',
      body: { campusId: CAMPUS, yearMonth: MONTH },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.recordId, first.body.recordId);
    assert.equal((await h.env.DB.prepare("SELECT COUNT(*) AS count FROM data_records WHERE source_app = 'kkumeum-analytics'").first()).count, 1);
    const updated = await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE source_app = 'kkumeum-analytics'").first();
    assert.equal(JSON.parse(updated.metadata_json).artworks.count, 4);
    assertNoPrivateMarkers(updated);

    const audit = await h.env.FAMILY_DB.prepare("SELECT metadata_json FROM family_audit_logs WHERE action = 'analytics.sync' ORDER BY created_at DESC LIMIT 1").first();
    assert.ok(audit?.metadata_json);
    assertNoPrivateMarkers(audit);
  } finally { await h.mf.dispose(); }
});

test('analytics sync mutation rejects cross-origin requests', async () => {
  const h = await harness();
  try {
    await bootstrapFamily(h);
    h.env.KKUMEUM_ANALYTICS_SYNC_ENABLED = 'true';
    const response = await h.request('/api/kkumeum/analytics/sync', {
      method: 'POST',
      origin: 'https://evil.example',
      body: { campusId: CAMPUS, yearMonth: MONTH },
    });
    assert.equal(response.status, 403);
  } finally { await h.mf.dispose(); }
});

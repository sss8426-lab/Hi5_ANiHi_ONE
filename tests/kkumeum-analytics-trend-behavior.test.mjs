import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const CAMPUS = 'campus-anihi-admission';
const OTHER_CAMPUS = 'campus-design-admission';
const TAXONOMY = 'kkumeum-growth-skill-v1';

function headers(id, email, name) {
  return {
    'oai-authenticated-user-id': id,
    'oai-authenticated-user-email': email,
    'oai-authenticated-user-full-name': encodeURIComponent(name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

const ADMIN_HEADERS = headers('trend-admin', 'trend-admin@example.test', '흐름 관리자');
const DIRECTOR_HEADERS = headers('trend-director', 'trend-director@example.test', '흐름 원장');
const TEACHER_HEADERS = headers('trend-teacher', 'trend-teacher@example.test', '흐름 교사');

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('kkumeum-trend', `${process.pid}-${Date.now()}-${Math.random()}`);
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
    DATA_CORE_SUPER_ADMIN_EMAILS: 'trend-admin@example.test',
  };
  async function request(path, { actor = 'admin' } = {}) {
    const actorHeaders = actor === 'director' ? DIRECTOR_HEADERS : actor === 'teacher' ? TEACHER_HEADERS : ADMIN_HEADERS;
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      headers: actorHeaders,
    }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { mf, env, request };
}

async function bootstrap(h) {
  await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-03`);
  const now = new Date().toISOString();
  for (let index = 1; index <= 6; index += 1) {
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (
      id, campus_id, name, display_name, school_name, grade, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '비밀학교', '고1', 'active', ?, ?)`)
      .bind(`trend-student-${index}`, CAMPUS, `비밀학생-${index}`, `비밀학생-${index}`, now, now).run();
  }

  for (const month of ['2026-01', '2026-02', '2026-03']) {
    for (let index = 1; index <= 6; index += 1) {
      let version = TAXONOMY;
      let codes = ['form_observation'];
      if (month === '2026-02' && index === 6) codes = ['form_observation', 'line_control'];
      if (month === '2026-03') version = 'kkumeum-growth-skill-v0';
      await h.env.FAMILY_DB.prepare(`INSERT INTO monthly_reports (
        id, student_id, campus_id, year_month, teacher_user_id,
        title, summary, evaluation_text, teacher_note, growth_points_json,
        next_month_focus, status, growth_skill_taxonomy_version, growth_skill_codes_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'private-teacher', '월간평가', '비밀요약', '비밀평가본문', '비밀교사메모', '{}', '비밀다음목표', 'sent', ?, ?, ?, ?)`)
        .bind(
          `trend-report-${month}-${index}`,
          `trend-student-${index}`,
          CAMPUS,
          month,
          version,
          JSON.stringify(codes),
          now,
          now,
        ).run();
    }
  }
}

async function grantRole(h, actor, role) {
  await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-02`, { actor });
  const email = actor === 'director' ? 'trend-director@example.test' : 'trend-teacher@example.test';
  const user = await h.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  assert.ok(user?.id);
  const now = new Date().toISOString();
  await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
    VALUES (?, 'org-hi5-anihi', ?, ?, ?, ?, ?)`)
    .bind(`trend-membership-${actor}`, CAMPUS, user.id, role, now, now).run();
}

function assertPrivacy(value) {
  const serialized = JSON.stringify(value);
  for (const marker of ['비밀학생', '비밀학교', '비밀요약', '비밀평가본문', '비밀교사메모', '비밀다음목표', 'private-teacher']) {
    assert.doesNotMatch(serialized, new RegExp(marker));
  }
  assert.doesNotMatch(serialized, /trend-student-|trend-report-|studentId|reportId|teacherUserId|delta|changeCount|ranking|percentile/i);
}

test('trend returns chronological aggregate-only months and applies per-month growth-skill suppression', async () => {
  const h = await harness();
  try {
    await bootstrap(h);
    const response = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-03`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const trend = response.body.trend;
    assert.equal(trend.schemaVersion, 'kkumeum-growth-trend-v1');
    assert.deepEqual(trend.months.map((month) => month.yearMonth), ['2026-01', '2026-02', '2026-03']);
    assert.equal(trend.months[0].activeStudentCount, 6);
    assert.equal(trend.months[0].reportCompletionRate, 100);
    assert.equal(trend.months[0].artworkAveragePerActiveStudent, 0);
    assert.equal(trend.months[0].growthSkills.suppressed, false);
    assert.deepEqual(trend.months[0].growthSkills.buckets.map((bucket) => [bucket.code, bucket.reportCount]), [['form_observation', 6]]);
    assert.equal(trend.months[1].growthSkills.suppressed, true);
    assert.deepEqual(trend.months[1].growthSkills.buckets, []);
    assert.equal(trend.months[2].growthSkills.suppressed, true);
    assert.equal(trend.months[2].growthSkills.eligibleReportCount, null);
    assertPrivacy(response.body);
    assert.equal((await h.env.DB.prepare("SELECT COUNT(*) AS count FROM data_records WHERE source_app = 'kkumeum-analytics'").first()).count, 0);
  } finally { await h.mf.dispose(); }
});

test('trend validates chronological range and enforces the 12-month maximum', async () => {
  const h = await harness();
  try {
    const reversed = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-03&toYearMonth=2026-02`);
    assert.equal(reversed.status, 400);
    const tooLong = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2025-01&toYearMonth=2026-01`);
    assert.equal(tooLong.status, 400);
    const twelve = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2025-02&toYearMonth=2026-01`);
    assert.equal(twelve.status, 200, JSON.stringify(twelve.body));
    assert.equal(twelve.body.trend.months.length, 12);
  } finally { await h.mf.dispose(); }
});

test('campus director can read own trend while cross-campus director and teacher are denied', async () => {
  const h = await harness();
  try {
    await bootstrap(h);
    await grantRole(h, 'director', 'CAMPUS_DIRECTOR');
    const own = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-02`, { actor: 'director' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const cross = await h.request(`/api/kkumeum/analytics/trend?campusId=${OTHER_CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-02`, { actor: 'director' });
    assert.equal(cross.status, 403);

    await grantRole(h, 'teacher', 'TEACHER');
    const teacher = await h.request(`/api/kkumeum/analytics/trend?campusId=${CAMPUS}&fromYearMonth=2026-01&toYearMonth=2026-02`, { actor: 'teacher' });
    assert.equal(teacher.status, 403);
  } finally { await h.mf.dispose(); }
});

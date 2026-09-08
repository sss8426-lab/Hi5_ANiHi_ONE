import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const CAMPUS = 'campus-anihi-admission';
const MONTH = '2026-09';
const taxonomy = JSON.parse(readFileSync(new URL('../docs/KKUMEUM_GROWTH_SKILL_TAXONOMY_V1.json', import.meta.url), 'utf8'));
const VERSION = taxonomy.schemaVersion;
const SKILLS = taxonomy.categories.flatMap((category) => category.skills.map((skill) => ({
  code: skill.code,
  label: skill.labelKo,
  categoryCode: category.code,
  categoryLabel: category.labelKo,
})));
const [SKILL_A, SKILL_B, SKILL_C] = SKILLS;
const PRIVATE_MARKER = 'legacy-freeform-secret-never-return';

function headers() {
  return {
    'oai-authenticated-user-id': 'growth-analytics-admin',
    'oai-authenticated-user-email': 'growth-analytics-admin@example.test',
    'oai-authenticated-user-full-name': encodeURIComponent('성장 통계 관리자'),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('kkumeum-growth-analytics', `${process.pid}-${Date.now()}-${Math.random()}`);
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
    DATA_CORE_SUPER_ADMIN_EMAILS: 'growth-analytics-admin@example.test',
  };
  async function request(path, { method = 'GET', body } = {}) {
    const requestHeaders = new Headers(headers());
    requestHeaders.set('origin', 'http://localhost');
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json() };
  }
  return { mf, env, request };
}

async function seedCurrentTaxonomyReports(h) {
  await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
  const now = new Date().toISOString();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
    VALUES ('growth-analytics-class', ?, '통계반', '통합', 0, 1, ?, ?)`)
    .bind(CAMPUS, now, now).run();

  for (let index = 1; index <= 10; index += 1) {
    const studentId = `growth-analytics-student-${index}`;
    const reportId = `growth-analytics-report-${index}`;
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (
      id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '고1', 'active', 'growth-analytics-class', ?, ?)`)
      .bind(studentId, CAMPUS, `비공개학생-${index}`, `비공개학생-${index}`, now, now).run();

    const codes = [SKILL_A.code, SKILL_A.code];
    if (index <= 5) codes.push(SKILL_B.code);
    if (index === 10) codes.push('unknown_code_should_not_escape');
    await h.env.FAMILY_DB.prepare(`INSERT INTO monthly_reports (
      id, student_id, campus_id, year_month, teacher_user_id,
      title, summary, evaluation_text, teacher_note, growth_points_json,
      growth_skill_taxonomy_version, growth_skill_codes_json,
      next_month_focus, status, sent_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'private-teacher', '월간평가', 'private-summary', 'private-evaluation', 'private-note', ?, ?, ?, 'private-focus', 'sent', ?, ?, ?)`)
      .bind(
        reportId,
        studentId,
        CAMPUS,
        MONTH,
        JSON.stringify({ secret: PRIVATE_MARKER }),
        VERSION,
        JSON.stringify(codes),
        now,
        now,
        now,
      ).run();
  }
}

function assertNoPrivateValues(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /growth-analytics-student-|growth-analytics-report-|private-teacher|private-summary|private-evaluation|private-note|private-focus/);
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_MARKER));
  assert.doesNotMatch(serialized, /unknown_code_should_not_escape/);
}

test('current taxonomy codes aggregate by report, dedupe per report, and ignore unknown/legacy values', async () => {
  const h = await harness();
  try {
    await seedCurrentTaxonomyReports(h);
    const response = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const growth = response.body.analytics.growthSkills;
    assert.equal(growth.taxonomyVersion, VERSION);
    assert.equal(growth.eligibleReportCount, 10);
    assert.equal(growth.suppressed, false);
    assert.deepEqual(growth.buckets, [
      {
        code: SKILL_A.code,
        label: SKILL_A.label,
        categoryCode: SKILL_A.categoryCode,
        categoryLabel: SKILL_A.categoryLabel,
        reportCount: 10,
      },
      {
        code: SKILL_B.code,
        label: SKILL_B.label,
        categoryCode: SKILL_B.categoryCode,
        categoryLabel: SKILL_B.categoryLabel,
        reportCount: 5,
      },
    ]);
    assertNoPrivateValues(response.body);
  } finally {
    await h.mf.dispose();
  }
});

test('one non-zero growth-skill bucket below the minimum suppresses the entire skill breakdown', async () => {
  const h = await harness();
  try {
    await seedCurrentTaxonomyReports(h);
    await h.env.FAMILY_DB.prepare(`UPDATE monthly_reports
      SET growth_skill_codes_json = ?
      WHERE id = 'growth-analytics-report-10'`)
      .bind(JSON.stringify([SKILL_A.code, SKILL_C.code])).run();
    const response = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
    assert.equal(response.status, 200);
    const growth = response.body.analytics.growthSkills;
    assert.equal(growth.eligibleReportCount, 10);
    assert.equal(growth.suppressed, true);
    assert.equal(growth.reason, 'minimum_cohort');
    assert.deepEqual(growth.buckets, []);
    assertNoPrivateValues(response.body);
  } finally {
    await h.mf.dispose();
  }
});

test('stale taxonomy reports are excluded and a 1-4 eligible cohort count is not exposed', async () => {
  const h = await harness();
  try {
    await seedCurrentTaxonomyReports(h);
    await h.env.FAMILY_DB.prepare(`UPDATE monthly_reports
      SET growth_skill_taxonomy_version = 'stale-taxonomy-version'
      WHERE id IN (
        'growth-analytics-report-5','growth-analytics-report-6','growth-analytics-report-7',
        'growth-analytics-report-8','growth-analytics-report-9','growth-analytics-report-10'
      )`).run();
    const response = await h.request(`/api/kkumeum/analytics/preview?campusId=${CAMPUS}&yearMonth=${MONTH}`);
    assert.equal(response.status, 200);
    const growth = response.body.analytics.growthSkills;
    assert.equal(growth.suppressed, true);
    assert.equal(growth.eligibleReportCount, null);
    assert.deepEqual(growth.buckets, []);
    assert.doesNotMatch(JSON.stringify(growth), /stale-taxonomy-version/);
    assertNoPrivateValues(response.body);
  } finally {
    await h.mf.dispose();
  }
});

test('explicit aggregate sync still excludes growth-skill buckets from generic DATA CORE metadata', async () => {
  const h = await harness();
  try {
    await seedCurrentTaxonomyReports(h);
    h.env.KKUMEUM_ANALYTICS_SYNC_ENABLED = 'true';
    const response = await h.request('/api/kkumeum/analytics/sync', {
      method: 'POST',
      body: { campusId: CAMPUS, yearMonth: MONTH },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE source_app = 'kkumeum-analytics'").first();
    assert.ok(row?.metadata_json);
    const metadata = JSON.parse(row.metadata_json);
    assert.equal(Object.hasOwn(metadata, 'growthSkills'), false);
    assertNoPrivateValues(metadata);
  } finally {
    await h.mf.dispose();
  }
});

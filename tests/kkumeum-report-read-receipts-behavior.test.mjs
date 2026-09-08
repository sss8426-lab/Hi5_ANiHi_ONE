import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN = 'guardian-report-read';
const STUDENT = 'student-report-read';
const OTHER_STUDENT = 'student-report-other';
const CAMPUS = 'campus-anihi-admission';
const RAW_TOKEN = 'guardian-report-read-token';
const cookie = `kkumeum_family_session=${RAW_TOKEN}`;

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-report-read', `${process.pid}-${Date.now()}-${Math.random()}`);
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
  async function request(path, { method = 'GET', origin, requestCookie = cookie } = {}) {
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
  await request('/api/family/auth/session', { requestCookie: null });
  return { mf, env, request };
}

async function seedFixture(env, request) {
  const db = env.FAMILY_DB;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO family_classes (id, campus_id, name, active, created_at, updated_at)
     VALUES ('class-report-read', ?, '기초반', 1, ?, ?)`,
  ).bind(CAMPUS, now, now).run();
  for (const [id, name] of [[STUDENT, '합성학생A'], [OTHER_STUDENT, '합성학생B']]) {
    await db.prepare(
      `INSERT INTO family_students (
         id, campus_id, name, display_name, status, current_class_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', 'class-report-read', ?, ?)`,
    ).bind(id, CAMPUS, name, name, now, now).run();
  }
  await db.prepare(
    `INSERT INTO family_guardians (
       id, login_id, display_name, status, must_change_password,
       failed_login_count, created_at, updated_at
     ) VALUES (?, 'guardian-report-read', '합성보호자', 'active', 0, 0, ?, ?)`,
  ).bind(GUARDIAN, now, now).run();
  await db.prepare(
    `INSERT INTO guardian_sessions (
       id, guardian_id, token_hash, created_at, expires_at, last_seen_at
     ) VALUES ('session-report-read', ?, ?, ?, ?, ?)`,
  ).bind(GUARDIAN, await sha256Base64(RAW_TOKEN), now, expiresAt, now).run();
  await db.prepare(
    `INSERT INTO student_guardians (
       id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at
     ) VALUES ('link-report-read', ?, ?, '부모', 1, 1, ?)`,
  ).bind(STUDENT, GUARDIAN, now).run();

  const initialized = await request(`/api/family/children/${STUDENT}/reports`);
  assert.equal(initialized.status, 200);
  assert.deepEqual(initialized.body.reports, []);

  await db.prepare(
    `INSERT INTO monthly_reports (
       id, student_id, campus_id, year_month, teacher_user_id,
       title, evaluation_text, growth_points_json, status, sent_at, created_at, updated_at
     ) VALUES
       ('report-read-sent', ?, ?, '2026-09', 'teacher-synthetic', '9월 평가', '공개 평가', '{}', 'sent', ?, ?, ?),
       ('report-read-draft', ?, ?, '2026-10', 'teacher-synthetic', '10월 임시', '임시 평가', '{}', 'draft', NULL, ?, ?),
       ('report-read-other', ?, ?, '2026-09', 'teacher-synthetic', '타학생 평가', '타학생 평가', '{}', 'sent', ?, ?, ?)`,
  ).bind(
    STUDENT, CAMPUS, now, now, now,
    STUDENT, CAMPUS, now, now,
    OTHER_STUDENT, CAMPUS, now, now, now,
  ).run();
}

test('보호자는 sent 월간평가를 명시적으로 확인하고 첫 확인 시각을 idempotent하게 보존한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env, request);
    const before = await request(`/api/family/children/${STUDENT}/reports`);
    assert.equal(before.status, 200);
    assert.equal(before.body.reports[0].readAt, null);

    const first = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(first.status, 200);
    const second = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.readAt, first.body.readAt);

    const after = await request(`/api/family/children/${STUDENT}/reports`);
    assert.equal(after.body.reports[0].readAt, first.body.readAt);
    const count = await env.FAMILY_DB.prepare(
      `SELECT COUNT(*) AS count FROM read_receipts
       WHERE guardian_id = ? AND resource_type = 'monthly_report' AND resource_id = 'report-read-sent'`,
    ).bind(GUARDIAN).first();
    assert.equal(Number(count.count), 1);
  } finally {
    await mf.dispose();
  }
});

test('draft·다른 학생 평가와 cross-origin 확인 요청은 거부한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env, request);
    const draft = await request(`/api/family/children/${STUDENT}/reports/report-read-draft/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(draft.status, 403);
    const other = await request(`/api/family/children/${OTHER_STUDENT}/reports/report-read-other/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(other.status, 403);
    const crossOrigin = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'https://evil.example',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('can_view_reports 권한과 보호자 동의 정책을 그대로 적용한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env, request);
    await env.FAMILY_DB.prepare(
      `UPDATE student_guardians SET can_view_reports = 0
       WHERE guardian_id = ? AND student_id = ?`,
    ).bind(GUARDIAN, STUDENT).run();
    const deniedByLink = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(deniedByLink.status, 403);

    await env.FAMILY_DB.prepare(
      `UPDATE student_guardians SET can_view_reports = 1
       WHERE guardian_id = ? AND student_id = ?`,
    ).bind(GUARDIAN, STUDENT).run();
    const policyNow = new Date().toISOString();
    await env.FAMILY_DB.prepare(
      `INSERT INTO family_consent_policy (
         id, consent_type, required_version, enforcement_enabled, updated_at
       ) VALUES (1, 'family-report', 'v1', 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         consent_type='family-report', required_version='v1', enforcement_enabled=1, updated_at=excluded.updated_at`,
    ).bind(policyNow).run();
    const deniedByConsent = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(deniedByConsent.status, 403);

    await env.FAMILY_DB.prepare(
      `INSERT INTO consents (
         id, student_id, guardian_id, consent_type, version, source,
         granted_at, created_at, updated_at
       ) VALUES ('consent-report-read', ?, ?, 'family-report', 'v1', 'synthetic-test', ?, ?, ?)`,
    ).bind(STUDENT, GUARDIAN, policyNow, policyNow, policyNow).run();
    const allowed = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(allowed.status, 200);

    await env.FAMILY_DB.prepare(
      `UPDATE consents SET revoked_at = ?, updated_at = ? WHERE id = 'consent-report-read'`,
    ).bind(new Date().toISOString(), new Date().toISOString()).run();
    const revoked = await request(`/api/family/children/${STUDENT}/reports`);
    assert.equal(revoked.status, 403);
  } finally {
    await mf.dispose();
  }
});

test('보고서 확인 기록은 FAMILY_DB에만 남고 generic DATA CORE로 fallback하지 않는다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedFixture(env, request);
    const marked = await request(`/api/family/children/${STUDENT}/reports/report-read-sent/read`, {
      method: 'POST', origin: 'http://localhost',
    });
    assert.equal(marked.status, 200);
    const generic = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type='table' AND name='read_receipts'`,
    ).first();
    assert.equal(Number(generic?.count || 0), 0);
  } finally {
    await mf.dispose();
  }
});

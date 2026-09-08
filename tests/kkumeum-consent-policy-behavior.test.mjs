import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'consent-policy-admin', email: 'consent-policy-admin@example.test', name: '동의정책 관리자' };
const STAFF = { id: 'consent-policy-staff', email: 'consent-policy-staff@example.test', name: '일반 직원' };
const CAMPUS = 'campus-consent-policy';
const CLASS_ID = 'class-consent-policy';
const CHILD = 'student-consent-policy';
const SIBLING = 'student-consent-sibling';
const GUARDIAN = 'guardian-consent-policy';
const RAW_TOKEN = 'guardian-consent-policy-session-token';
const cookie = `kkumeum_family_session=${RAW_TOKEN}`;

async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64');
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-consent-policy', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function staffHeaders(identity = ADMIN) {
  return {
    'oai-authenticated-user-id': identity.id,
    'oai-authenticated-user-email': identity.email,
    'oai-authenticated-user-full-name': encodeURIComponent(identity.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function harness({ files = true } = {}) {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: files ? ['FAMILY_FILES'] : [],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };
  if (files) env.FAMILY_FILES = await mf.getR2Bucket('FAMILY_FILES');

  async function request(path, { method = 'GET', body, cookie: sessionCookie, identity, staff = false, origin = 'http://localhost' } = {}) {
    const headers = new Headers();
    if (staff) {
      for (const [key, value] of Object.entries(staffHeaders(identity || ADMIN))) headers.set(key, value);
    }
    if (sessionCookie) headers.set('cookie', sessionCookie);
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

async function seed(h) {
  // Initialize canonical FAMILY schemas through real routes before inserting synthetic rows.
  const initialClasses = await h.request(`/api/kkumeum/classes?campusId=${encodeURIComponent(CAMPUS)}`, { staff: true });
  assert.equal(initialClasses.status, 200);
  await h.request('/api/family/auth/session');

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const db = h.env.FAMILY_DB;
  await db.prepare(`INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
    VALUES (?, ?, '동의정책반', '기초', 1, 1, ?, ?)`).bind(CLASS_ID, CAMPUS, now, now).run();
  for (const [id, name] of [[CHILD, '동의정책학생'], [SIBLING, '동의정책형제']]) {
    await db.prepare(`INSERT INTO family_students (
      id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '중1', 'active', ?, ?, ?)`).bind(id, CAMPUS, name, name, CLASS_ID, now, now).run();
  }
  await db.prepare(`INSERT INTO family_guardians (
    id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at
  ) VALUES (?, 'consent-policy-guardian', '동의정책보호자', 'active', 0, 0, ?, ?)`).bind(GUARDIAN, now, now).run();
  await db.prepare(`INSERT INTO guardian_sessions (
    id, guardian_id, token_hash, created_at, expires_at, last_seen_at
  ) VALUES ('consent-policy-session', ?, ?, ?, ?, ?)`).bind(GUARDIAN, await sha256Base64(RAW_TOKEN), now, expiresAt, now).run();
  await db.prepare(`INSERT INTO student_guardians (
    id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at
  ) VALUES
    ('consent-policy-link', ?, ?, '보호자', 1, 1, ?),
    ('consent-policy-link-sibling', ?, ?, '보호자', 1, 1, ?)`).bind(CHILD, GUARDIAN, now, SIBLING, GUARDIAN, now).run();

  const initReports = await h.request(`/api/family/children/${CHILD}/reports`, { cookie });
  assert.equal(initReports.status, 200);
  await db.prepare(`INSERT INTO monthly_reports (
    id, student_id, campus_id, year_month, teacher_user_id, title, summary,
    evaluation_text, teacher_note, growth_points_json, next_month_focus,
    status, sent_at, created_at, updated_at
  ) VALUES ('consent-policy-report', ?, ?, '2026-09', 'teacher', '9월 평가', '요약',
    '보호자 공개 평가', '내부메모', '{}', '다음달 목표', 'sent', ?, ?, ?)`).bind(CHILD, CAMPUS, now, now, now).run();
  await db.prepare(`INSERT INTO family_files (
    id, campus_id, student_id, owner_user_id, purpose, r2_key, file_name, mime_type, size_bytes, created_at
  ) VALUES ('consent-policy-file', ?, ?, 'teacher', 'artwork', 'family/consent-policy/file', '작품.jpg', 'image/jpeg', 3, ?)`).bind(CAMPUS, CHILD, now).run();
  await db.prepare(`INSERT INTO student_artworks (
    id, student_id, campus_id, class_id, family_file_id, title, lesson_date, sort_order, created_at
  ) VALUES ('consent-policy-artwork', ?, ?, ?, 'consent-policy-file', '작품', '2026-09-01', 1, ?)`).bind(CHILD, CAMPUS, CLASS_ID, now).run();
  await h.env.FAMILY_FILES.put('family/consent-policy/file', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/jpeg' } });
}

test('guardian consent policy defaults disabled and only explicit approved type/version enables enforcement', async () => {
  const h = await harness();
  try {
    await seed(h);
    const before = await h.request(`/api/family/children/${CHILD}/reports`, { cookie });
    assert.equal(before.status, 200);

    const defaultPolicy = await h.request('/api/kkumeum/consent-policy', { staff: true });
    assert.equal(defaultPolicy.status, 200);
    assert.deepEqual(defaultPolicy.body.policy, {
      consentType: null,
      requiredVersion: null,
      enforcementEnabled: false,
      updatedAt: null,
    });
    assert.equal(defaultPolicy.headers.get('cache-control'), 'private, no-store');

    const incomplete = await h.request('/api/kkumeum/consent-policy', {
      method: 'PUT', staff: true, body: { enforcementEnabled: true },
    });
    assert.equal(incomplete.status, 400);

    const deniedStaff = await h.request('/api/kkumeum/consent-policy', {
      method: 'PUT', staff: true, identity: STAFF,
      body: { consentType: 'privacy-collection', requiredVersion: 'v1', enforcementEnabled: true },
    });
    assert.equal(deniedStaff.status, 403);

    const crossOrigin = await h.request('/api/kkumeum/consent-policy', {
      method: 'PUT', staff: true, origin: 'https://example.invalid',
      body: { consentType: 'privacy-collection', requiredVersion: 'v1', enforcementEnabled: true },
    });
    assert.equal(crossOrigin.status, 403);

    const enabled = await h.request('/api/kkumeum/consent-policy', {
      method: 'PUT', staff: true,
      body: { consentType: 'privacy-collection', requiredVersion: 'v1', enforcementEnabled: true },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.policy.enforcementEnabled, true);
    assert.equal(enabled.body.policy.consentType, 'privacy-collection');
    assert.equal(enabled.body.policy.requiredVersion, 'v1');

    const blockedReport = await h.request(`/api/family/children/${CHILD}/reports`, { cookie });
    const blockedArtwork = await h.request(`/api/family/children/${CHILD}/artworks`, { cookie });
    const blockedFile = await h.request('/api/family/files/consent-policy-file', { cookie });
    assert.equal(blockedReport.status, 403);
    assert.equal(blockedArtwork.status, 403);
    assert.equal(blockedFile.status, 403);
    assert.match(String(blockedReport.body.error || ''), /동의/);

    const grant = await h.request('/api/kkumeum/consents', {
      method: 'POST', staff: true,
      body: {
        campusId: CAMPUS, studentId: CHILD, guardianId: GUARDIAN,
        consentType: 'privacy-collection', version: 'v1', source: 'staff-admin',
      },
    });
    assert.equal(grant.status, 201);

    const allowedReport = await h.request(`/api/family/children/${CHILD}/reports`, { cookie });
    const allowedArtwork = await h.request(`/api/family/children/${CHILD}/artworks`, { cookie });
    const allowedFile = await h.request('/api/family/files/consent-policy-file', { cookie });
    assert.equal(allowedReport.status, 200);
    assert.equal(allowedArtwork.status, 200);
    assert.equal(allowedFile.status, 200);

    const siblingBlocked = await h.request(`/api/family/children/${SIBLING}/artworks`, { cookie });
    assert.equal(siblingBlocked.status, 403);

    const revoke = await h.request(`/api/kkumeum/consents/${grant.body.consent.id}/revoke`, {
      method: 'POST', staff: true,
      body: { campusId: CAMPUS, studentId: CHILD, guardianId: GUARDIAN },
    });
    assert.equal(revoke.status, 200);
    const revokedBlocked = await h.request(`/api/family/children/${CHILD}/reports`, { cookie });
    assert.equal(revokedBlocked.status, 403);

    const genericPolicy = await h.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='family_consent_policy'",
    ).first();
    assert.equal(Number(genericPolicy.count), 0);
  } finally {
    await h.mf.dispose();
  }
});

test('consent policy endpoint fails closed when FAMILY_FILES is missing', async () => {
  const h = await harness({ files: false });
  try {
    const result = await h.request('/api/kkumeum/consent-policy', { staff: true });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  } finally {
    await h.mf.dispose();
  }
});

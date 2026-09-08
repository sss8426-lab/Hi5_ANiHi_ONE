import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN = 'guardian-notice-consent';
const STUDENT = 'student-notice-consent';
const CAMPUS = 'campus-notice-consent';
const CLASS_ID = 'class-notice-consent';
const RAW_TOKEN = 'guardian-notice-consent-session-token';
const cookie = `kkumeum_family_session=${RAW_TOKEN}`;

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-notice-consent', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64');
}

async function harness() {
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
  async function request(path, { method = 'GET', origin = 'http://localhost' } = {}) {
    const headers = new Headers({ cookie });
    if (method !== 'GET' && origin) headers.set('origin', origin);
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { method, headers }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }
  // Initialize canonical guardian/announcement schema without a valid guardian session.
  const init = await worker.fetch(
    new Request('http://localhost/api/family/notices'),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(init.status, 401);
  return { mf, env, request };
}

async function seed(h) {
  const db = h.env.FAMILY_DB;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO family_classes (
    id, campus_id, name, stage, sort_order, active, created_at, updated_at
  ) VALUES (?, ?, '동의 반', '기초', 1, 1, ?, ?)`).bind(CLASS_ID, CAMPUS, now, now).run();
  await db.prepare(`INSERT INTO family_students (
    id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
  ) VALUES (?, ?, '동의학생', '동의학생', '중1', 'active', ?, ?, ?)`).bind(STUDENT, CAMPUS, CLASS_ID, now, now).run();
  await db.prepare(`INSERT INTO family_guardians (
    id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at
  ) VALUES (?, 'notice-consent-guardian', '동의보호자', 'active', 0, 0, ?, ?)`).bind(GUARDIAN, now, now).run();
  await db.prepare(`INSERT INTO guardian_sessions (
    id, guardian_id, token_hash, created_at, expires_at, last_seen_at
  ) VALUES ('notice-consent-session', ?, ?, ?, ?, ?)`).bind(
    GUARDIAN,
    await sha256Base64(RAW_TOKEN),
    now,
    expiresAt,
    now,
  ).run();
  await db.prepare(`INSERT INTO student_guardians (
    id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at
  ) VALUES ('notice-consent-link', ?, ?, '보호자', 1, 1, ?)`).bind(STUDENT, GUARDIAN, now).run();

  for (const [id, type, title] of [
    ['notice-consent-org', 'organization-notice', '전체공지'],
    ['notice-consent-campus', 'campus-news', '캠퍼스공지'],
    ['notice-consent-class', 'class-news', '반소식'],
    ['notice-consent-student', 'child-message', '개별소식'],
    ['notice-consent-guardian', 'selected-delivery', '보호자선택'],
  ]) {
    await db.prepare(`INSERT INTO announcements (
      id, campus_id, author_user_id, announcement_type, title, body,
      status, published_at, created_at, updated_at
    ) VALUES (?, ?, 'staff', ?, ?, ?, 'published', ?, ?, ?)`).bind(
      id,
      id.endsWith('-org') ? null : CAMPUS,
      type,
      title,
      `${title} 내용`,
      now,
      now,
      now,
    ).run();
  }
  for (const [id, announcementId, targetType, targetId] of [
    ['target-consent-org', 'notice-consent-org', 'organization', null],
    ['target-consent-campus', 'notice-consent-campus', 'campus', CAMPUS],
    ['target-consent-class', 'notice-consent-class', 'class', CLASS_ID],
    ['target-consent-student', 'notice-consent-student', 'student', STUDENT],
    ['target-consent-guardian', 'notice-consent-guardian', 'guardian', GUARDIAN],
  ]) {
    await db.prepare(`INSERT INTO announcement_targets (
      id, announcement_id, target_type, target_id, created_at
    ) VALUES (?, ?, ?, ?, ?)`).bind(id, announcementId, targetType, targetId, now).run();
  }

  // First authenticated feed initializes the consent policy table with enforcement disabled.
  const initial = await h.request('/api/family/notices');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.notices.length, 5);
}

function ids(feed) {
  return feed.body.notices.map((notice) => notice.announcementId).sort();
}

test('enabled consent policy keeps org notice but gates campus/class/student/guardian targets and mark-read', async () => {
  const h = await harness();
  try {
    await seed(h);
    const db = h.env.FAMILY_DB;
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO family_consent_policy (
      id, consent_type, required_version, enforcement_enabled, updated_at, updated_by_user_id
    ) VALUES (1, 'privacy-collection', 'v1', 1, ?, 'admin')
    ON CONFLICT(id) DO UPDATE SET consent_type='privacy-collection', required_version='v1', enforcement_enabled=1, updated_at=excluded.updated_at`).bind(now).run();

    const withoutConsent = await h.request('/api/family/notices');
    assert.equal(withoutConsent.status, 200);
    assert.deepEqual(ids(withoutConsent), ['notice-consent-org']);
    assert.equal(withoutConsent.body.unreadCount, 1);
    assert.equal(withoutConsent.headers.get('cache-control'), 'private, no-store');

    const hiddenRead = await h.request('/api/family/notices/notice-consent-student/read', { method: 'POST' });
    assert.equal(hiddenRead.status, 403);

    await db.prepare(`INSERT INTO consents (
      id, student_id, guardian_id, consent_type, version, source,
      granted_at, revoked_at, created_at, updated_at
    ) VALUES ('notice-consent-v1', ?, ?, 'privacy-collection', 'v1', 'staff-admin', ?, NULL, ?, ?)`).bind(
      STUDENT, GUARDIAN, now, now, now,
    ).run();

    const withConsent = await h.request('/api/family/notices');
    assert.equal(withConsent.status, 200);
    assert.deepEqual(ids(withConsent), [
      'notice-consent-campus',
      'notice-consent-class',
      'notice-consent-guardian',
      'notice-consent-org',
      'notice-consent-student',
    ].sort());
    assert.equal(withConsent.body.unreadCount, 5);

    const allowedRead = await h.request('/api/family/notices/notice-consent-student/read', { method: 'POST' });
    assert.equal(allowedRead.status, 200);

    await db.prepare("UPDATE consents SET revoked_at = ?, updated_at = ? WHERE id = 'notice-consent-v1'").bind(now, now).run();
    const afterRevoke = await h.request('/api/family/notices');
    assert.deepEqual(ids(afterRevoke), ['notice-consent-org']);
    const revokedRead = await h.request('/api/family/notices/notice-consent-campus/read', { method: 'POST' });
    assert.equal(revokedRead.status, 403);

    await db.prepare("UPDATE family_consent_policy SET required_version = 'v2', updated_at = ? WHERE id = 1").bind(now).run();
    await db.prepare(`INSERT INTO consents (
      id, student_id, guardian_id, consent_type, version, source,
      granted_at, revoked_at, created_at, updated_at
    ) VALUES ('notice-consent-stale-v1', ?, ?, 'privacy-collection', 'v1', 'staff-admin', ?, NULL, ?, ?)`).bind(
      STUDENT, GUARDIAN, now, now, now,
    ).run();
    const staleVersion = await h.request('/api/family/notices');
    assert.deepEqual(ids(staleVersion), ['notice-consent-org']);
  } finally {
    await h.mf.dispose();
  }
});

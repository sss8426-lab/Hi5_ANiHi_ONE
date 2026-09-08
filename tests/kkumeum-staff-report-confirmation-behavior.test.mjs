import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'report-confirm-admin', email: 'report-confirm-admin@example.test', name: 'Synthetic Admin' };
const STAFF = { id: 'report-confirm-staff', email: 'report-confirm-staff@example.test', name: 'Synthetic Staff' };
const OTHER_CAMPUS_STAFF = { id: 'report-confirm-other', email: 'report-confirm-other@example.test', name: 'Synthetic Other' };
const CAMPUS = 'campus-anihi-admission';
const OTHER_CAMPUS = 'campus-design-admission';

function headers(user) {
  return {
    'oai-authenticated-user-id': user.id,
    'oai-authenticated-user-email': user.email,
    'oai-authenticated-user-full-name': encodeURIComponent(user.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function workerModule() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('staff-report-confirmation', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true, d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
  const worker = await workerModule();
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  async function request(path, { user = ADMIN, method = 'GET', body } = {}) {
    const requestHeaders = new Headers(headers(user));
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  }
  return { mf, env, request };
}

test('staff monthly report delivery history exposes only sent guardian confirmation summary', async () => {
  const h = await harness();
  try {
    const now = new Date().toISOString();
    const classResult = await h.request('/api/kkumeum/classes', { method: 'POST', body: { campusId: CAMPUS, name: 'Synthetic Class' } });
    const classId = classResult.body.class.id;
    const studentResult = await h.request('/api/kkumeum/students', { method: 'POST', body: { campusId: CAMPUS, name: 'Synthetic Student', classId } });
    const studentId = studentResult.body.student.id;
    const created = await h.request('/api/kkumeum/reports', { method: 'POST', body: { campusId: CAMPUS, studentId, yearMonth: '2026-09', evaluationText: 'Synthetic sent report' } });
    const sentId = created.body.report.id;
    await h.request(`/api/kkumeum/reports/${sentId}/ready`, { method: 'POST' });
    await h.request(`/api/kkumeum/reports/${sentId}/send`, { method: 'POST' });

    await h.env.FAMILY_DB.prepare(`INSERT INTO monthly_reports (id, student_id, campus_id, year_month, teacher_user_id, evaluation_text, growth_points_json, status, sent_at, created_at, updated_at) VALUES
      ('report-confirm-draft', ?, ?, '2026-10', 'synthetic-teacher', 'draft', '{}', 'draft', NULL, ?, ?),
      ('report-confirm-ready', ?, ?, '2026-11', 'synthetic-teacher', 'ready', '{}', 'ready', NULL, ?, ?)`)
      .bind(studentId, CAMPUS, now, now, studentId, CAMPUS, now, now).run();

    await h.request(`/api/kkumeum/reports?campusId=${CAMPUS}&studentId=${studentId}`);
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_guardians (id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at) VALUES
      ('guardian-confirm-a', 'guardian-confirm-a', 'Synthetic Guardian A', 'active', 0, 0, ?, ?),
      ('guardian-confirm-b', 'guardian-confirm-b', 'Synthetic Guardian B', 'active', 0, 0, ?, ?),
      ('guardian-confirm-c', 'guardian-confirm-c', 'Synthetic Guardian C', 'active', 0, 0, ?, ?),
      ('guardian-confirm-other', 'guardian-confirm-other', 'Synthetic Guardian Other', 'active', 0, 0, ?, ?)`)
      .bind(now, now, now, now, now, now, now, now).run();
    await h.env.FAMILY_DB.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at) VALUES
      ('guardian-confirm-link-a', ?, 'guardian-confirm-a', 'synthetic', 1, 1, ?),
      ('guardian-confirm-link-b', ?, 'guardian-confirm-b', 'synthetic', 1, 1, ?),
      ('guardian-confirm-link-c', ?, 'guardian-confirm-c', 'synthetic', 1, 1, ?)`)
      .bind(studentId, now, studentId, now, studentId, now).run();
    await h.env.FAMILY_DB.prepare(`INSERT INTO read_receipts (id, guardian_id, resource_type, resource_id, read_at) VALUES
      ('receipt-confirm-late', 'guardian-confirm-a', 'monthly_report', ?, '2026-09-12T00:00:00.000Z'),
      ('receipt-confirm-early', 'guardian-confirm-b', 'monthly_report', ?, '2026-09-03T00:00:00.000Z'),
      ('receipt-confirm-malformed', 'guardian-confirm-c', 'monthly_report', ?, 'not-a-timestamp'),
      ('receipt-confirm-other', 'guardian-confirm-other', 'monthly_report', ?, '2026-09-01T00:00:00.000Z'),
      ('receipt-confirm-draft', 'guardian-confirm-a', 'monthly_report', 'report-confirm-draft', '2026-09-01T00:00:00.000Z'),
      ('receipt-confirm-ready', 'guardian-confirm-a', 'monthly_report', 'report-confirm-ready', '2026-09-01T00:00:00.000Z')`)
      .bind(sentId, sentId, sentId, sentId).run();

    await h.request('/api/data-core/context', { user: STAFF });
    const staffUserId = `oai:${STAFF.id}`;
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
      .bind('membership-report-confirm', CAMPUS, staffUserId, now, now).run();
    await h.env.FAMILY_DB.prepare(`INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks, started_at, ended_at, created_at, updated_at) VALUES (?, ?, ?, 'TEACHER', 1, 0, ?, NULL, ?, ?)`)
      .bind('assignment-report-confirm', classId, staffUserId, now, now, now).run();
    await h.request('/api/data-core/context', { user: OTHER_CAMPUS_STAFF });
    await h.env.DB.prepare(`INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at) VALUES (?, 'org-hi5-anihi', ?, ?, 'TEACHER', ?, ?)`)
      .bind('membership-report-confirm-other', OTHER_CAMPUS, `oai:${OTHER_CAMPUS_STAFF.id}`, now, now).run();

    const sameCampus = await h.request(`/api/kkumeum/reports?campusId=${CAMPUS}&studentId=${studentId}`, { user: STAFF });
    assert.equal(sameCampus.status, 200);
    assert.equal(sameCampus.headers.get('cache-control'), 'private, no-store');
    const reports = Object.fromEntries(sameCampus.body.reports.map((report) => [report.id, report]));
    assert.deepEqual({ confirmed: reports[sentId].guardianConfirmed, firstReadAt: reports[sentId].guardianFirstReadAt }, { confirmed: true, firstReadAt: '2026-09-03T00:00:00.000Z' });
    assert.deepEqual({ confirmed: reports['report-confirm-draft'].guardianConfirmed, firstReadAt: reports['report-confirm-draft'].guardianFirstReadAt }, { confirmed: false, firstReadAt: null });
    assert.deepEqual({ confirmed: reports['report-confirm-ready'].guardianConfirmed, firstReadAt: reports['report-confirm-ready'].guardianFirstReadAt }, { confirmed: false, firstReadAt: null });
    const serialized = JSON.stringify(sameCampus.body);
    for (const forbidden of ['guardian-confirm-a', 'guardian-confirm-b', 'guardian-confirm-other', 'Synthetic Guardian', 'relationship_label', 'read_receipts', 'phone', 'email']) assert.equal(serialized.includes(forbidden), false);

    const otherCampus = await h.request(`/api/kkumeum/reports?campusId=${CAMPUS}&studentId=${studentId}`, { user: OTHER_CAMPUS_STAFF });
    assert.equal(otherCampus.status, 403);
    const genericFamilyWrites = await h.env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('read_receipts', 'monthly_reports')").first();
    assert.equal(Number(genericFamilyWrites?.count || 0), 0);
  } finally { await h.mf.dispose(); }
});

test('staff delivery history renders confirmation state without guardian identity or analytics semantics', async () => {
  const ui = await readFile(new URL('../public/data-core/work/kkumeum-operations.js', import.meta.url), 'utf8');
  const deliveryHistory = ui.slice(ui.indexOf('function guardianConfirmationLabel'), ui.indexOf('function payload'));
  assert.match(ui, /보호자 확인 전/);
  assert.match(ui, /보호자 확인 \$\{String\(report\.guardianFirstReadAt\)\.slice\(0, 10\)\}/);
  assert.doesNotMatch(deliveryHistory, /guardianName|guardianId|relationshipLabel|guardianCount|percentile|ranking|점수|순위|백분율/i);
});

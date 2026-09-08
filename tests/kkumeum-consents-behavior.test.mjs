import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'consent-admin', email: 'consent-admin@example.test', name: '동의 관리자' };
const CAMPUS = 'campus-consent-test';

function authHeaders() {
  return {
    'oai-authenticated-user-id': ADMIN.id,
    'oai-authenticated-user-email': ADMIN.email,
    'oai-authenticated-user-full-name': encodeURIComponent(ADMIN.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-consents', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
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

  async function request(path, method = 'GET', body, origin = 'http://localhost') {
    const headers = new Headers(authHeaders());
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

async function seedLinkedGuardian(h) {
  const createdClass = await h.request('/api/kkumeum/classes', 'POST', { campusId: CAMPUS, name: '동의 검증반' });
  assert.equal(createdClass.status, 201);
  const student = await h.request('/api/kkumeum/students', 'POST', {
    campusId: CAMPUS,
    name: '동의 검증 학생',
    classId: createdClass.body.class.id,
    status: 'active',
  });
  assert.equal(student.status, 201);
  const guardian = await h.request('/api/kkumeum/guardians', 'POST', {
    campusId: CAMPUS,
    studentId: student.body.student.id,
    displayName: '동의 검증 보호자',
    loginId: 'consent-guardian',
  });
  assert.equal(guardian.status, 201);
  return { studentId: student.body.student.id, guardianId: guardian.body.guardian.id };
}

test('꿈이음 consent grant/list/revoke is FAMILY_DB-only, versioned and idempotent', async () => {
  const h = await harness();
  try {
    const { studentId, guardianId } = await seedLinkedGuardian(h);
    const secretLegalText = '이 문구는 감사로그나 동의 row에 저장하면 안 됩니다';
    const payload = {
      campusId: CAMPUS,
      studentId,
      guardianId,
      consentType: 'privacy-collection',
      version: 'v1',
      source: 'staff-admin',
      legalText: secretLegalText,
    };

    const granted = await h.request('/api/kkumeum/consents', 'POST', payload);
    assert.equal(granted.status, 201);
    assert.equal(granted.body.created, true);
    assert.equal(granted.body.consent.active, true);
    assert.equal(granted.body.consent.version, 'v1');
    assert.equal(granted.headers.get('cache-control'), 'private, no-store');

    const repeated = await h.request('/api/kkumeum/consents', 'POST', payload);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.created, false);
    assert.equal(repeated.body.consent.id, granted.body.consent.id);

    const activeCount = await h.env.FAMILY_DB.prepare(
      'SELECT COUNT(*) AS count FROM consents WHERE student_id = ? AND guardian_id = ? AND revoked_at IS NULL',
    ).bind(studentId, guardianId).first();
    assert.equal(Number(activeCount.count), 1);

    const listed = await h.request(`/api/kkumeum/consents?campusId=${encodeURIComponent(CAMPUS)}&studentId=${encodeURIComponent(studentId)}&guardianId=${encodeURIComponent(guardianId)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.consents.length, 1);
    assert.equal(listed.body.consents[0].consentType, 'privacy-collection');
    assert.equal(listed.body.consents[0].active, true);

    const revoked = await h.request(`/api/kkumeum/consents/${granted.body.consent.id}/revoke`, 'POST', {
      campusId: CAMPUS,
      studentId,
      guardianId,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.changed, true);
    assert.equal(revoked.body.consent.active, false);

    const repeatedRevoke = await h.request(`/api/kkumeum/consents/${granted.body.consent.id}/revoke`, 'POST', {
      campusId: CAMPUS,
      studentId,
      guardianId,
    });
    assert.equal(repeatedRevoke.status, 200);
    assert.equal(repeatedRevoke.body.changed, false);

    const regranted = await h.request('/api/kkumeum/consents', 'POST', payload);
    assert.equal(regranted.status, 201);
    assert.notEqual(regranted.body.consent.id, granted.body.consent.id);

    const genericTable = await h.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'consents'",
    ).first();
    assert.equal(Number(genericTable.count), 0);

    const audits = await h.env.FAMILY_DB.prepare(
      "SELECT metadata_json FROM family_audit_logs WHERE resource_type = 'consent' ORDER BY created_at",
    ).all();
    assert.equal(JSON.stringify(audits.results).includes(secretLegalText), false);
  } finally {
    await h.mf.dispose();
  }
});

test('꿈이음 consent mutations reject cross-origin and missing FAMILY_FILES stays fail-closed', async () => {
  const h = await harness();
  try {
    const { studentId, guardianId } = await seedLinkedGuardian(h);
    const crossOrigin = await h.request('/api/kkumeum/consents', 'POST', {
      campusId: CAMPUS,
      studentId,
      guardianId,
      consentType: 'privacy-collection',
      version: 'v1',
      source: 'staff-admin',
    }, 'https://example.invalid');
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('cache-control'), 'private, no-store');
  } finally {
    await h.mf.dispose();
  }

  const noFiles = await harness({ files: false });
  try {
    const result = await noFiles.request('/api/kkumeum/consents?campusId=x&studentId=y&guardianId=z');
    assert.equal(result.status, 503);
    assert.match(String(result.body.error || ''), /FAMILY_DB\/FAMILY_FILES/);
    const genericTable = await noFiles.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'consents'",
    ).first();
    assert.equal(Number(genericTable.count), 0);
  } finally {
    await noFiles.mf.dispose();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'retention-admin', email: 'retention-admin@example.test', name: '보존정책 관리자' };
const DIRECTOR = { id: 'retention-director', email: 'retention-director@example.test', name: '보존정책 원장' };
const CAMPUS = 'campus-wonjong';
const OTHER_CAMPUS = 'campus-paju';

function identityHeaders(identity) {
  return {
    'oai-authenticated-user-id': identity.id,
    'oai-authenticated-user-email': identity.email,
    'oai-authenticated-user-full-name': encodeURIComponent(identity.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-retention', `${process.pid}-${Date.now()}-${Math.random()}`);
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

  async function request(path, method = 'GET', body, { origin = 'http://localhost', identity = ADMIN } = {}) {
    const headers = new Headers(identityHeaders(identity));
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

async function makeDirector(h, campusId) {
  const initial = await h.request(`/api/kkumeum/retention?campusId=${encodeURIComponent(campusId)}`, 'GET', undefined, { identity: DIRECTOR });
  assert.equal(initial.status, 403);
  const user = await h.env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1').bind(DIRECTOR.email).first();
  assert.ok(user?.id);
  const campus = await h.env.DB.prepare('SELECT organization_id FROM campuses WHERE id = ? LIMIT 1').bind(campusId).first();
  assert.ok(campus?.organization_id);
  const now = new Date().toISOString();
  await h.env.DB.prepare(
    `INSERT INTO memberships (id, organization_id, campus_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'CAMPUS_DIRECTOR', ?, ?)`,
  ).bind(`membership:${user.id}:${campusId}:retention`, campus.organization_id, campusId, user.id, now, now).run();
}

test('꿈이음 retention policy stores nullable approved windows only and never enables destructive purge', async () => {
  const h = await harness();
  try {
    const created = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v1',
      leaveDays: null,
      movedDays: null,
      graduatedDays: null,
      guardianDisabledDays: null,
      softDeleteGraceDays: null,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.created, true);
    assert.equal(created.body.policy.leaveDays, null);
    assert.equal(created.body.policy.graduatedDays, null);
    assert.equal(created.body.policy.destructivePurgeEnabled, false);
    assert.equal(created.headers.get('cache-control'), 'private, no-store');

    const updated = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v2',
      leaveDays: 90,
      movedDays: 180,
      graduatedDays: 365,
      softDeleteGraceDays: 30,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.created, false);
    assert.equal(updated.body.policy.leaveDays, 90);
    assert.equal(updated.body.policy.guardianDisabledDays, null);
    assert.equal(updated.body.policy.destructivePurgeEnabled, false);

    const listed = await h.request(`/api/kkumeum/retention?campusId=${encodeURIComponent(CAMPUS)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.policy.policyVersion, 'draft-v2');
    assert.equal(listed.body.policy.graduatedDays, 365);

    const purgeEnable = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v3',
      destructivePurgeEnabled: true,
    });
    assert.equal(purgeEnable.status, 409);
    assert.match(String(purgeEnable.body.error || ''), /purge/);

    const invalidDays = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v3',
      leaveDays: 3651,
    });
    assert.equal(invalidDays.status, 400);

    const row = await h.env.FAMILY_DB.prepare(
      'SELECT destructive_purge_enabled FROM family_retention_policies WHERE campus_id = ?',
    ).bind(CAMPUS).first();
    assert.equal(Number(row.destructive_purge_enabled), 0);

    const audits = await h.env.FAMILY_DB.prepare(
      "SELECT action, resource_type FROM family_audit_logs WHERE resource_type = 'retention_policy'",
    ).all();
    assert.ok(audits.results.length >= 2);
    assert.ok(audits.results.every((item) => item.action === 'retention.policy.upsert'));
  } finally {
    await h.mf.dispose();
  }
});

test('campus director can read own retention policy but cannot mutate or read another campus', async () => {
  const h = await harness();
  try {
    const seeded = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v1',
    });
    assert.equal(seeded.status, 200);
    await makeDirector(h, CAMPUS);

    const own = await h.request(`/api/kkumeum/retention?campusId=${encodeURIComponent(CAMPUS)}`, 'GET', undefined, { identity: DIRECTOR });
    assert.equal(own.status, 200);
    assert.equal(own.body.policy.campusId, CAMPUS);

    const write = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'director-write',
    }, { identity: DIRECTOR });
    assert.equal(write.status, 403);

    const other = await h.request(`/api/kkumeum/retention?campusId=${encodeURIComponent(OTHER_CAMPUS)}`, 'GET', undefined, { identity: DIRECTOR });
    assert.equal(other.status, 403);
  } finally {
    await h.mf.dispose();
  }
});

test('retention mutation is same-origin and missing FAMILY_FILES fails closed without generic DB fallback', async () => {
  const h = await harness();
  try {
    const crossOrigin = await h.request('/api/kkumeum/retention', 'PUT', {
      campusId: CAMPUS,
      policyVersion: 'draft-v1',
    }, { origin: 'https://example.invalid' });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('cache-control'), 'private, no-store');
  } finally {
    await h.mf.dispose();
  }

  const noFiles = await harness({ files: false });
  try {
    const result = await noFiles.request(`/api/kkumeum/retention?campusId=${encodeURIComponent(CAMPUS)}`);
    assert.equal(result.status, 503);
    assert.match(String(result.body.error || ''), /FAMILY_DB\/FAMILY_FILES/);
    const genericTable = await noFiles.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'family_retention_policies'",
    ).first();
    assert.equal(Number(genericTable.count), 0);
  } finally {
    await noFiles.mf.dispose();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { runKkumeumSyntheticRestoreDrill } from '../scripts/kkumeum-synthetic-restore-drill.mjs';

const ADMIN = { id: 'family-safety-admin', email: 'family-safety-admin@example.test', name: '안전 관리자' };
const CAMPUS = 'campus-wonjong';
const OTHER_CAMPUS = 'campus-paju';

function headers(identity = ADMIN) {
  return {
    'oai-authenticated-user-id': identity.id,
    'oai-authenticated-user-email': identity.email,
    'oai-authenticated-user-full-name': encodeURIComponent(identity.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('family-safety', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness({ files = true } = {}) {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true, d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: files ? ['FAMILY_FILES'] : [], d1Persist: false, r2Persist: false });
  const worker = await loadWorker();
  const env = { DB: await mf.getD1Database('DB'), FAMILY_DB: await mf.getD1Database('FAMILY_DB'), DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email };
  if (files) env.FAMILY_FILES = await mf.getR2Bucket('FAMILY_FILES');
  async function request(path, method = 'GET', body, origin = 'http://localhost') {
    const requestHeaders = new Headers(headers());
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    if (method !== 'GET' && origin) requestHeaders.set('origin', origin);
    const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { mf, env, request };
}

test('FAMILY backup manifest records only isolated inventory and has no production restore endpoint', async () => {
  const h = await harness();
  try {
    await h.env.FAMILY_FILES.put('synthetic/drill-artwork.txt', 'synthetic-artwork');
    const created = await h.request('/api/kkumeum/admin/family-backups', 'POST', {});
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'private, no-store');
    assert.equal(created.body.manifest.syntheticOnly, true);
    assert.equal(created.body.manifest.files[0].key, 'synthetic/drill-artwork.txt');
    assert.equal(created.body.manifest.tableCounts.family_guardians, 0);
    assert.doesNotMatch(JSON.stringify(created.body), /password_hash|token_hash|temporaryPassword/);
    const listed = await h.request('/api/kkumeum/admin/family-backups');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.manifests.length, 1);
    const noRestore = await h.request('/api/kkumeum/admin/family-backups/restore', 'POST', {});
    assert.equal(noRestore.status, 405);
  } finally { await h.mf.dispose(); }
});

test('pilot defaults remain disabled, allow exactly one selected campus, and never fall back without FAMILY files', async () => {
  const h = await harness();
  try {
    const defaultSettings = await h.request('/api/kkumeum/admin/pilot-settings');
    assert.equal(defaultSettings.status, 200);
    assert.equal(defaultSettings.body.settings.closedBetaEnabled, false);
    const missingCampus = await h.request('/api/kkumeum/admin/pilot-settings', 'PUT', { closedBetaEnabled: true });
    assert.equal(missingCampus.status, 400);
    const enabled = await h.request('/api/kkumeum/admin/pilot-settings', 'PUT', { pilotCampusId: CAMPUS, closedBetaEnabled: true, internalGuardianBetaEnabled: true });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.settings.pilotCampusId, CAMPUS);
    const denied = await h.request(`/api/kkumeum/classes?campusId=${OTHER_CAMPUS}`);
    assert.equal(denied.status, 403);
    const allowed = await h.request(`/api/kkumeum/classes?campusId=${CAMPUS}`);
    assert.equal(allowed.status, 200);
  } finally { await h.mf.dispose(); }
  const noFiles = await harness({ files: false });
  try {
    const response = await noFiles.request('/api/kkumeum/admin/family-backups');
    assert.equal(response.status, 503);
    const generic = await noFiles.env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='family_backup_manifests'").first();
    assert.equal(Number(generic.count), 0);
  } finally { await noFiles.mf.dispose(); }
});

test('synthetic restore drill copies only isolated test relations and refuses a production target', async () => {
  const source = await harness();
  const target = await harness();
  try {
    const result = await runKkumeumSyntheticRestoreDrill({ sourceDb: source.env.FAMILY_DB, sourceFiles: source.env.FAMILY_FILES, targetDb: target.env.FAMILY_DB, targetFiles: target.env.FAMILY_FILES, target: { marker: 'KKUMEUM_SYNTHETIC_RESTORE_ONLY' } });
    assert.equal(result.rows, 8);
    assert.equal(result.filesCleaned, true);
    await assert.rejects(
      () => runKkumeumSyntheticRestoreDrill({ sourceDb: source.env.FAMILY_DB, sourceFiles: source.env.FAMILY_FILES, targetDb: target.env.FAMILY_DB, targetFiles: target.env.FAMILY_FILES, target: { marker: 'KKUMEUM_SYNTHETIC_RESTORE_ONLY', production: true } }),
      /isolated target marker/,
    );
  } finally { await source.mf.dispose(); await target.mf.dispose(); }
});

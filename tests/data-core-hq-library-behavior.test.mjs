import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ORGANIZATION_ID = 'org-hi5-anihi';
const CAMPUS_ID = 'campus-anihi-admission';
const users = {
  admin: { id: 'hq-admin', email: 'hq-admin@example.test', name: 'HQ Admin' },
  campus: { id: 'hq-campus', email: 'hq-campus@example.test', name: 'Campus User' },
};

function authHeaders(user) {
  return {
    'oai-authenticated-user-id': user.id,
    'oai-authenticated-user-email': user.email,
    'oai-authenticated-user-full-name': encodeURIComponent(user.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('hq-library-behavior', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB'],
    d1Persist: false,
    r2Buckets: ['FILES'],
    r2Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    FILES: await mf.getR2Bucket('FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: users.admin.email,
  };

  async function request(method, path, user, body) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    let requestBody;
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      requestBody = JSON.stringify(body);
    }
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { method, headers, body: requestBody }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    const type = response.headers.get('content-type') || '';
    return {
      status: response.status,
      body: type.includes('application/json') ? await response.json() : await response.text(),
    };
  }

  async function upload(user, { folderId = '', campusId = '', category = 'hq-workspace' } = {}) {
    const form = new FormData();
    form.append('file', new File(['synthetic-hq-file'], 'hq-test.txt', { type: 'text/plain' }));
    form.append('campusId', campusId);
    form.append('category', category);
    form.append('sourceApp', 'malicious-client-value');
    form.append('recordId', folderId);
    form.append('ownerId', 'shared');
    form.append('year', '2026');
    const response = await worker.fetch(
      new Request('http://localhost/api/data-core/files', {
        method: 'POST',
        headers: new Headers(authHeaders(user)),
        body: form,
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  await request('GET', '/api/data-core/context', users.admin);
  await request('GET', '/api/data-core/context', users.campus);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO memberships (
    id, organization_id, campus_id, user_id, role, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'TEACHER', ?, ?)`).bind(
    'hq-campus-membership', ORGANIZATION_ID, CAMPUS_ID, `oai:${users.campus.id}`, now, now,
  ).run();

  return { mf, env, request, upload };
}

async function createHqFolder(h) {
  const result = await h.request('POST', '/api/data-core/records', users.admin, {
    campusId: null,
    recordType: 'hq-library-folder',
    sourceApp: 'data-core-library',
    title: '수업그림',
    summary: 'synthetic folder',
    visibility: 'organization',
    metadata: { folderKey: 'synthetic-hq', sortOrder: 10, system: false },
    tags: ['본원 작업물'],
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.record;
}

test('hq-workspace upload is master-only, folder-bound, organization-readable, and audited', async () => {
  const h = await harness();
  try {
    const folder = await createHqFolder(h);

    const denied = await h.upload(users.campus, { folderId: folder.id, campusId: CAMPUS_ID });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));

    const missingFolder = await h.upload(users.admin);
    assert.equal(missingFolder.status, 400, JSON.stringify(missingFolder.body));

    const wrongRecord = await h.request('POST', '/api/data-core/records', users.admin, {
      campusId: null,
      recordType: 'other-record',
      sourceApp: 'data-core-library',
      title: 'Not an HQ folder',
      visibility: 'organization',
    });
    assert.equal(wrongRecord.status, 201, JSON.stringify(wrongRecord.body));
    const invalid = await h.upload(users.admin, { folderId: wrongRecord.body.record.id });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));

    const uploaded = await h.upload(users.admin, { folderId: folder.id });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.file.category, 'hq-workspace');
    assert.equal(uploaded.body.file.sourceApp, 'hq-library');
    assert.equal(uploaded.body.file.visibility, 'organization');
    assert.equal(uploaded.body.file.campusId, null);
    assert.equal(uploaded.body.file.recordId, folder.id);

    const row = await h.env.DB.prepare(`SELECT category, source_app, visibility, campus_id, data_record_id
      FROM file_objects WHERE id = ?`).bind(uploaded.body.file.id).first();
    assert.deepEqual(row, {
      category: 'hq-workspace',
      source_app: 'hq-library',
      visibility: 'organization',
      campus_id: null,
      data_record_id: folder.id,
    });

    const memberList = await h.request(
      'GET',
      `/api/data-core/files?recordId=${encodeURIComponent(folder.id)}&category=hq-workspace`,
      users.campus,
    );
    assert.equal(memberList.status, 200, JSON.stringify(memberList.body));
    assert.equal(memberList.body.files.length, 1);
    assert.equal(memberList.body.files[0].id, uploaded.body.file.id);

    const audit = await h.env.DB.prepare(`SELECT action, metadata_json FROM audit_logs
      WHERE resource_type = 'file_object' AND resource_id = ?`).bind(uploaded.body.file.id).first();
    assert.equal(audit.action, 'upload');
    const metadata = JSON.parse(audit.metadata_json);
    assert.equal(metadata.category, 'hq-workspace');
    assert.equal(metadata.sourceApp, 'hq-library');
    assert.equal(metadata.recordId, folder.id);
  } finally {
    await h.mf.dispose();
  }
});

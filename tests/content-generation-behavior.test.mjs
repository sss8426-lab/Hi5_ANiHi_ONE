import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = {
  id: 'generation-admin',
  email: 'generation-admin@example.test',
  name: 'Generation Admin',
};
const CAMPUS_A = 'campus-anihi-admission';
const CAMPUS_B = 'campus-design-admission';
const ORGANIZATION_ID = 'org-hi5-anihi';

function authHeaders(user) {
  return {
    'oai-authenticated-user-id': user.id,
    'oai-authenticated-user-email': user.email,
    'oai-authenticated-user-full-name': encodeURIComponent(user.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('generation-behavior', `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

async function harness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB'],
    d1Persist: false,
  });
  const worker = await loadWorker();
  const env = {
    DB: await mf.getD1Database('DB'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
  };

  async function post(user, body) {
    const headers = new Headers(user ? authHeaders(user) : undefined);
    headers.set('content-type', 'application/json');
    headers.set('origin', 'http://localhost');
    const response = await worker.fetch(
      new Request('http://localhost/api/data-core/content/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return { status: response.status, body: await response.json() };
  }

  return { mf, env, post };
}

test('content generation requires authentication and rejects unsupported channels', async () => {
  const { mf, post } = await harness();
  try {
    const unauth = await post(null, { sourceApp: 'blog' });
    assert.equal(unauth.status, 401);

    const invalid = await post(ADMIN, { sourceApp: 'youtube' });
    assert.equal(invalid.status, 400);
  } finally {
    await mf.dispose();
  }
});

test('provider absence returns explicit 503 instead of fabricated generated content', async () => {
  const { mf, post } = await harness();
  try {
    const result = await post(ADMIN, {
      sourceApp: 'instagram',
      contentPurpose: 'class-story',
      coreMessage: '수업 성장 기록',
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.available, false);
    assert.equal(result.body.code, 'provider_not_configured');
    assert.match(result.body.message, /AI 생성 연결 준비 중/);
    assert.equal('generated' in result.body, false);
  } finally {
    await mf.dispose();
  }
});

test('selected DATA CORE files cannot be mixed across campuses', async () => {
  const { mf, env, post } = await harness();
  try {
    await post(ADMIN, { sourceApp: 'blog' });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO file_objects (
         id, organization_id, campus_id, data_record_id, owner_user_id,
         area, category, source_app, r2_key, original_file_name, mime_type,
         size_bytes, visibility, created_at, deleted_at
       ) VALUES (?, ?, ?, NULL, NULL, 'academy-public', 'blog-source', 'blog', ?, ?, 'image/png', 10, 'campus', ?, NULL)`,
    ).bind(
      'generation-cross-campus-file',
      ORGANIZATION_ID,
      CAMPUS_B,
      'data-core/test/generation-cross-campus-file.png',
      'cross-campus.png',
      now,
    ).run();

    const result = await post(ADMIN, {
      sourceApp: 'blog',
      campusId: CAMPUS_A,
      selectedFileIds: ['generation-cross-campus-file'],
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /다른 캠퍼스/);
  } finally {
    await mf.dispose();
  }
});

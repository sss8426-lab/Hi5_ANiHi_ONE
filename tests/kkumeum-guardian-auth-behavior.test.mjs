import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const PASSWORD = 'guardian-test-password-123';
const GUARDIAN_ID = 'guardian-test-1';
const LOGIN_ID = 'guardian-test';

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-guardian-auth', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function passwordHash(password, salt, iterations = 100_000) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return Buffer.from(new Uint8Array(bits)).toString('base64');
}

async function makeHarness({ family = true } = {}) {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: family ? ['DB', 'FAMILY_DB'] : ['DB'],
    d1Persist: false,
  });
  const worker = await loadWorker();
  const DB = await mf.getD1Database('DB');
  const env = { DB };
  if (family) env.FAMILY_DB = await mf.getD1Database('FAMILY_DB');

  async function request(path, { method = 'GET', body, cookie, headers: extraHeaders } = {}) {
    const headers = new Headers(extraHeaders);
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      headers.set('origin', 'http://localhost');
    }
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
      headers: response.headers,
    };
  }

  return { mf, env, DB, request };
}

async function seedGuardian(familyDb, { status = 'active' } = {}) {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const now = new Date().toISOString();
  await familyDb.prepare(
    `INSERT INTO family_guardians (
       id, login_id, display_name, status, password_hash, password_salt,
       password_iterations, must_change_password, failed_login_count,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 100000, 1, 0, ?, ?)`,
  ).bind(
    GUARDIAN_ID,
    LOGIN_ID,
    '테스트 보호자',
    status,
    await passwordHash(PASSWORD, salt),
    Buffer.from(salt).toString('base64'),
    now,
    now,
  ).run();
}

async function genericFamilyTableCount(db) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM sqlite_master
     WHERE type = 'table'
       AND name IN ('family_guardians', 'guardian_sessions', 'student_guardians')`,
  ).first();
  return Number(row?.count || 0);
}

test('보호자 인증은 FAMILY_DB가 없으면 503으로 닫히고 generic DB를 건드리지 않는다', async () => {
  const { mf, DB, request } = await makeHarness({ family: false });
  try {
    const response = await request('/api/family/auth/session');
    assert.equal(response.status, 503);
    assert.match(response.body.error, /FAMILY_DB/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await genericFamilyTableCount(DB), 0);
  } finally {
    await mf.dispose();
  }
});

test('보호자 로그인 세션은 별도 쿠키와 token hash만 사용하고 DATA CORE 권한이 되지 않는다', async () => {
  const { mf, env, DB, request } = await makeHarness();
  try {
    const initial = await request('/api/family/auth/session');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { authenticated: false });
    await seedGuardian(env.FAMILY_DB);

    const login = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.authenticated, true);
    assert.equal(login.body.guardianId, GUARDIAN_ID);
    assert.equal(login.body.displayName, '테스트 보호자');
    assert.equal(login.body.mustChangePassword, true);
    assert.equal(login.headers.get('cache-control'), 'private, no-store');
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /^kkumeum_family_session=/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const rawToken = cookie.slice(cookie.indexOf('=') + 1);

    const session = await request('/api/family/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.deepEqual(Object.keys(session.body).sort(), [
      'authenticated',
      'displayName',
      'guardianId',
      'mustChangePassword',
    ]);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.guardianId, GUARDIAN_ID);
    assert.equal(session.headers.get('cache-control'), 'private, no-store');

    const stored = await env.FAMILY_DB.prepare(
      'SELECT token_hash FROM guardian_sessions WHERE guardian_id = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(GUARDIAN_ID).first();
    assert.ok(stored?.token_hash);
    assert.notEqual(stored.token_hash, rawToken);
    assert.equal(String(stored.token_hash).includes(rawToken), false);

    const genericApi = await request('/api/data-core/files', { cookie });
    assert.equal(genericApi.status, 401);
    assert.equal(await genericFamilyTableCount(DB), 0);
  } finally {
    await mf.dispose();
  }
});

test('staff 인증만으로 보호자 세션이 되지 않고 logout은 세션을 revoke한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await request('/api/family/auth/session');
    await seedGuardian(env.FAMILY_DB);

    const staffOnly = await request('/api/family/auth/session', {
      headers: {
        'oai-authenticated-user-id': 'staff-1',
        'oai-authenticated-user-email': 'staff@example.test',
      },
    });
    assert.deepEqual(staffOnly.body, { authenticated: false });

    const login = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: PASSWORD },
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const logout = await request('/api/family/auth/logout', {
      method: 'POST',
      body: {},
      cookie,
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.ok, true);
    assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);

    const after = await request('/api/family/auth/session', { cookie });
    assert.deepEqual(after.body, { authenticated: false });
    const revoked = await env.FAMILY_DB.prepare(
      'SELECT revoked_at FROM guardian_sessions WHERE guardian_id = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(GUARDIAN_ID).first();
    assert.ok(revoked?.revoked_at);
  } finally {
    await mf.dispose();
  }
});

test('보호자 로그인 5회 실패 후 잠기며 비활성 계정도 거부한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await request('/api/family/auth/session');
    await seedGuardian(env.FAMILY_DB);

    for (let index = 0; index < 5; index += 1) {
      const failed = await request('/api/family/auth/login', {
        method: 'POST',
        body: { loginId: LOGIN_ID, password: 'wrong-password' },
      });
      assert.equal(failed.status, 401);
    }
    const locked = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: PASSWORD },
    });
    assert.equal(locked.status, 423);

    await env.FAMILY_DB.prepare(
      "UPDATE family_guardians SET status = 'disabled', locked_until = NULL, failed_login_count = 0 WHERE id = ?",
    ).bind(GUARDIAN_ID).run();
    const disabled = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: PASSWORD },
    });
    assert.equal(disabled.status, 401);
  } finally {
    await mf.dispose();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const GUARDIAN_ID = 'guardian-password-test';
const LOGIN_ID = 'guardian-password-test';
const OLD_PASSWORD = 'guardian-old-password-123';
const NEW_PASSWORD = 'guardian-new-password-456';
const OLD_RAW_TOKEN = 'guardian-old-session-token';
const CHILD_ID = 'guardian-password-child';
const CAMPUS_ID = 'campus-anihi-admission';
const CLASS_ID = 'guardian-password-class';

async function loadWorker() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('kkumeum-guardian-password-change', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function sha256Base64(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString('base64');
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

  async function request(path, { method = 'GET', body, cookie, origin = 'http://localhost' } = {}) {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      if (origin !== null) headers.set('origin', origin);
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

async function seedGuardian(env, request, { status = 'active', lockedUntil = null } = {}) {
  await request('/api/family/auth/session');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 31);
  const db = env.FAMILY_DB;

  await db.prepare(
    `INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
     VALUES (?, ?, '기초반', '기초', 1, 1, ?, ?)`,
  ).bind(CLASS_ID, CAMPUS_ID, now, now).run();
  await db.prepare(
    `INSERT INTO family_students (
       id, campus_id, name, display_name, grade, status, current_class_id, created_at, updated_at
     ) VALUES (?, ?, '학생실명', '꿈학생', '중1', 'active', ?, ?, ?)`,
  ).bind(CHILD_ID, CAMPUS_ID, CLASS_ID, now, now).run();
  await db.prepare(
    `INSERT INTO family_guardians (
       id, login_id, display_name, status, password_hash, password_salt,
       password_iterations, must_change_password, failed_login_count, locked_until,
       created_at, updated_at
     ) VALUES (?, ?, '보호자', ?, ?, ?, 100000, 1, 0, ?, ?, ?)`,
  ).bind(
    GUARDIAN_ID,
    LOGIN_ID,
    status,
    await passwordHash(OLD_PASSWORD, salt),
    Buffer.from(salt).toString('base64'),
    lockedUntil,
    now,
    now,
  ).run();
  await db.prepare(
    `INSERT INTO student_guardians
       (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
     VALUES ('guardian-password-link', ?, ?, '부모', 1, 1, ?)`,
  ).bind(CHILD_ID, GUARDIAN_ID, now).run();
  await db.prepare(
    `INSERT INTO guardian_sessions (
       id, guardian_id, token_hash, created_at, expires_at, last_seen_at
     ) VALUES ('guardian-password-old-session', ?, ?, ?, ?, ?)`,
  ).bind(GUARDIAN_ID, await sha256Base64(OLD_RAW_TOKEN), now, expiresAt, now).run();
}

const oldCookie = `kkumeum_family_session=${OLD_RAW_TOKEN}`;

function cookiePair(setCookie) {
  return String(setCookie || '').split(';')[0];
}

function assertNoSecrets(value) {
  const json = JSON.stringify(value);
  for (const forbidden of ['passwordHash', 'password_hash', 'passwordSalt', 'password_salt', 'tokenHash', 'token_hash', 'phone', 'email', OLD_PASSWORD, NEW_PASSWORD, OLD_RAW_TOKEN]) {
    assert.equal(json.includes(forbidden), false, `secret leaked: ${forbidden}`);
  }
}

test('보호자 최초 비밀번호 변경은 세션을 회전하고 old password/session을 폐기한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedGuardian(env, request);

    const feedBefore = await request('/api/family/children', { cookie: oldCookie });
    assert.equal(feedBefore.status, 403);

    const changed = await request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      cookie: oldCookie,
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body, { ok: true, authenticated: true, mustChangePassword: false });
    assert.equal(changed.headers.get('cache-control'), 'private, no-store');
    const setCookie = changed.headers.get('set-cookie') || '';
    assert.match(setCookie, /^kkumeum_family_session=/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const newCookie = cookiePair(setCookie);
    assert.notEqual(newCookie, oldCookie);
    assertNoSecrets(changed.body);

    const oldSession = await request('/api/family/auth/session', { cookie: oldCookie });
    assert.deepEqual(oldSession.body, { authenticated: false });
    const newSession = await request('/api/family/auth/session', { cookie: newCookie });
    assert.equal(newSession.status, 200);
    assert.equal(newSession.body.authenticated, true);
    assert.equal(newSession.body.mustChangePassword, false);

    const feedAfter = await request('/api/family/children', { cookie: newCookie });
    assert.equal(feedAfter.status, 200);
    assert.equal(feedAfter.body.children.length, 1);
    assert.equal(feedAfter.body.children[0].studentId, CHILD_ID);

    const oldLogin = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: OLD_PASSWORD },
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request('/api/family/auth/login', {
      method: 'POST',
      body: { loginId: LOGIN_ID, password: NEW_PASSWORD },
    });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.mustChangePassword, false);

    const sessions = await env.FAMILY_DB.prepare(
      `SELECT token_hash, revoked_at FROM guardian_sessions
       WHERE guardian_id = ? ORDER BY created_at`,
    ).bind(GUARDIAN_ID).all();
    assert.ok((sessions.results || []).length >= 3);
    assert.ok((sessions.results || []).some((row) => row.revoked_at));
    assert.equal(JSON.stringify(sessions.results).includes(OLD_RAW_TOKEN), false);
  } finally {
    await mf.dispose();
  }
});

test('현재 비밀번호가 틀리면 계정과 기존 세션 상태를 바꾸지 않는다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedGuardian(env, request);
    const before = await env.FAMILY_DB.prepare(
      `SELECT password_hash, password_salt, must_change_password, failed_login_count, locked_until
       FROM family_guardians WHERE id = ?`,
    ).bind(GUARDIAN_ID).first();

    const failed = await request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'wrong-current-password', newPassword: NEW_PASSWORD },
      cookie: oldCookie,
    });
    assert.equal(failed.status, 401);
    const after = await env.FAMILY_DB.prepare(
      `SELECT password_hash, password_salt, must_change_password, failed_login_count, locked_until
       FROM family_guardians WHERE id = ?`,
    ).bind(GUARDIAN_ID).first();
    assert.deepEqual(after, before);

    const session = await request('/api/family/auth/session', { cookie: oldCookie });
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.mustChangePassword, true);
  } finally {
    await mf.dispose();
  }
});

test('보호자 비밀번호 변경은 same-origin, 비밀번호 정책, 계정 상태를 fail-closed 한다', async () => {
  const { mf, env, request } = await makeHarness();
  try {
    await seedGuardian(env, request);

    const crossOrigin = await request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      cookie: oldCookie,
      origin: 'https://attacker.example',
    });
    assert.equal(crossOrigin.status, 403);

    const shortPassword = await request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: 'short' },
      cookie: oldCookie,
    });
    assert.equal(shortPassword.status, 400);

    await env.FAMILY_DB.prepare("UPDATE family_guardians SET status = 'disabled' WHERE id = ?")
      .bind(GUARDIAN_ID).run();
    const disabled = await request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      cookie: oldCookie,
    });
    assert.equal(disabled.status, 401);
  } finally {
    await mf.dispose();
  }
});

test('잠긴 보호자와 FAMILY_DB 미연결 환경은 비밀번호 변경을 허용하지 않는다', async () => {
  const lockedHarness = await makeHarness();
  try {
    await seedGuardian(lockedHarness.env, lockedHarness.request, {
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const locked = await lockedHarness.request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      cookie: oldCookie,
    });
    assert.equal(locked.status, 423);
  } finally {
    await lockedHarness.mf.dispose();
  }

  const noFamilyHarness = await makeHarness({ family: false });
  try {
    const missing = await noFamilyHarness.request('/api/family/auth/change-password', {
      method: 'POST',
      body: { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      cookie: oldCookie,
    });
    assert.equal(missing.status, 503);
    const genericTables = await noFamilyHarness.DB.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type='table' AND name IN ('family_guardians','guardian_sessions','student_guardians')`,
    ).first();
    assert.equal(Number(genericTables?.count || 0), 0);
  } finally {
    await noFamilyHarness.mf.dispose();
  }
});

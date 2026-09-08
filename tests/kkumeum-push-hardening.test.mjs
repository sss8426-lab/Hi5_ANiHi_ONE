import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'push-hardening-admin', email: 'push-hardening-admin@example.test', name: 'Push Hardening 관리자' };
const GUARDIAN = 'push-hardening-guardian';
const TOKEN = 'push-hardening-session-token';
const auth = Buffer.alloc(16, 12).toString('base64url');

function adminHeaders() {
  return {
    'oai-authenticated-user-id': ADMIN.id,
    'oai-authenticated-user-email': ADMIN.email,
    'oai-authenticated-user-full-name': encodeURIComponent(ADMIN.name),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  };
}

async function digest(value) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64');
}

async function vapidPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(publicJwk.x, 'base64url'),
      Buffer.from(publicJwk.y, 'base64url'),
    ]).toString('base64url'),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  };
}

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('push-hardening', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness() {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: ['DB', 'FAMILY_DB'],
    r2Buckets: ['FAMILY_FILES'],
    d1Persist: false,
    r2Persist: false,
  });
  const worker = await loadWorker();
  const pair = await vapidPair();
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
    PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    PUSH_VAPID_PRIVATE_JWK: pair.privateJwk,
    PUSH_VAPID_SUBJECT: 'https://push-hardening.example.test',
    PUSH_SUBSCRIPTION_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString('base64url'),
  };
  async function request(path, { method = 'GET', cookie, origin, body, admin = false } = {}) {
    const headers = new Headers(admin ? adminHeaders() : undefined);
    if (cookie) headers.set('cookie', cookie);
    if (origin) headers.set('origin', origin);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { mf, env, request };
}

async function seedGuardian(h) {
  // Initializes only FAMILY_DB push/guardian schema. No DATA CORE family fallback is allowed.
  await h.request('/api/family/push/status');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_guardians (
    id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at
  ) VALUES (?, 'push-hardening-login', '내부 보호자', 'active', 0, 0, ?, ?)`)
    .bind(GUARDIAN, now, now).run();
  await h.env.FAMILY_DB.prepare(`INSERT INTO guardian_sessions (
    id, guardian_id, token_hash, created_at, expires_at, last_seen_at
  ) VALUES ('push-hardening-session', ?, ?, ?, ?, ?)`)
    .bind(GUARDIAN, await digest(TOKEN), now, expires, now).run();
}

async function validSubscription(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    endpoint,
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
      auth,
    },
    platform: 'push-hardening-browser',
  };
}

const cookie = `kkumeum_family_session=${TOKEN}`;

test('Web Push config requires a matching importable P-256 VAPID pair and valid subject', async () => {
  const h = await harness();
  try {
    await seedGuardian(h);
    let status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.status, 200);
    assert.equal(status.body.subscriptionReady, true);
    assert.equal(status.body.configured, true);
    assert.equal(status.body.code, null);

    const other = await vapidPair();
    h.env.PUSH_VAPID_PUBLIC_KEY = other.publicKey;
    status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.body.configured, false);
    assert.equal(status.body.code, 'vapid_key_mismatch');

    h.env.PUSH_VAPID_PUBLIC_KEY = (JSON.parse(h.env.PUSH_VAPID_PRIVATE_JWK).x && other.publicKey);
    h.env.PUSH_VAPID_PRIVATE_JWK = JSON.stringify({ kty: 'EC', crv: 'P-384', d: 'x', x: 'x', y: 'x' });
    status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.body.configured, false);
    assert.equal(status.body.code, 'vapid_invalid');

    const restored = await vapidPair();
    h.env.PUSH_VAPID_PUBLIC_KEY = restored.publicKey;
    h.env.PUSH_VAPID_PRIVATE_JWK = restored.privateJwk;
    h.env.PUSH_VAPID_SUBJECT = 'ftp://invalid.example.test';
    status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.body.configured, false);
    assert.equal(status.body.code, 'vapid_subject_invalid');

    h.env.PUSH_VAPID_SUBJECT = 'mailto:push@example.test';
    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64url');
    status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.body.subscriptionReady, false);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.code, 'subscription_encryption_key_invalid');
  } finally {
    await h.mf.dispose();
  }
});

test('new subscriptions store only a non-secret encryption key identifier', async () => {
  const h = await harness();
  try {
    await seedGuardian(h);
    const rawKey = h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY;
    const response = await h.request('/api/family/push/subscribe', {
      method: 'POST',
      cookie,
      origin: 'http://localhost',
      body: await validSubscription('https://push-hardening.example.test/subscription'),
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const stored = await h.env.FAMILY_DB.prepare(`SELECT encryption_key_id, endpoint_encrypted, p256dh_encrypted, auth_encrypted
      FROM push_subscriptions WHERE guardian_id = ?`).bind(GUARDIAN).first();
    assert.match(String(stored.encryption_key_id), /^[A-Za-z0-9_-]{16}$/);
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(rawKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(JSON.stringify(stored), /push-hardening\.example\.test\/subscription/);
  } finally {
    await h.mf.dispose();
  }
});

test('encryption-key rotation mismatch fails deterministically without decrypting or disabling the subscription', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(null, { status: 201 });
  };
  try {
    await seedGuardian(h);
    assert.equal((await h.request('/api/family/push/subscribe', {
      method: 'POST', cookie, origin: 'http://localhost',
      body: await validSubscription('https://push-hardening.example.test/rotation'),
    })).status, 200);

    const originalRow = await h.env.FAMILY_DB.prepare('SELECT encryption_key_id FROM push_subscriptions WHERE guardian_id = ?')
      .bind(GUARDIAN).first();
    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(32, 22).toString('base64url');

    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST', admin: true, origin: 'http://localhost',
      body: {
        announcementType: 'organization-notice',
        title: '전체 공지',
        body: 'Push key rotation hardening synthetic check.',
        targets: [{ targetType: 'organization' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const published = await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, {
      method: 'POST', admin: true, origin: 'http://localhost',
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.announcement.status, 'published');
    assert.deepEqual(published.body.push, { sent: 0, failed: 1, code: null });
    assert.equal(fetchCount, 0);

    const delivery = await h.env.FAMILY_DB.prepare('SELECT status, error_code FROM push_delivery_attempts').first();
    assert.deepEqual(delivery, { status: 'failed', error_code: 'subscription_key_mismatch' });
    const after = await h.env.FAMILY_DB.prepare('SELECT active, revoked_at, encryption_key_id FROM push_subscriptions WHERE guardian_id = ?')
      .bind(GUARDIAN).first();
    assert.equal(after.active, 1);
    assert.equal(after.revoked_at, null);
    assert.equal(after.encryption_key_id, originalRow.encryption_key_id);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

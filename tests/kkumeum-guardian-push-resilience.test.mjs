import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'push-resilience-admin', email: 'push-resilience-admin@example.test', name: 'Push 복원력 관리자' };
const GUARDIAN = 'push-resilience-guardian';
const STUDENT = 'push-resilience-student';
const TOKEN = 'push-resilience-session';
const encryptionKey = Buffer.alloc(32, 17).toString('base64url');
const auth = Buffer.alloc(16, 18).toString('base64url');

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

async function loadWorker() {
  const url = new URL('../dist/server/index.js', import.meta.url);
  url.searchParams.set('guardian-push-resilience', `${process.pid}-${Date.now()}-${Math.random()}`);
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
  const env = {
    DB: await mf.getD1Database('DB'),
    FAMILY_DB: await mf.getD1Database('FAMILY_DB'),
    FAMILY_FILES: await mf.getR2Bucket('FAMILY_FILES'),
    DATA_CORE_SUPER_ADMIN_EMAILS: ADMIN.email,
    PUSH_SUBSCRIPTION_ENCRYPTION_KEY: encryptionKey,
  };
  async function request(path, { method = 'GET', cookie, origin, body, admin = false } = {}) {
    const headers = new Headers(admin ? adminHeaders() : undefined);
    if (cookie) headers.set('cookie', cookie);
    if (origin) headers.set('origin', origin);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, body: await response.json() };
  }
  return { mf, env, request };
}

async function seed(h) {
  await h.request('/api/family/push/status');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (id, campus_id, name, display_name, status, created_at, updated_at)
    VALUES (?, 'campus-push-resilience', '합성학생', '합성학생', 'active', ?, ?)`)
    .bind(STUDENT, now, now).run();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_guardians (id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at)
    VALUES (?, 'push-resilience', '합성보호자', 'active', 0, 0, ?, ?)`)
    .bind(GUARDIAN, now, now).run();
  await h.env.FAMILY_DB.prepare(`INSERT INTO guardian_sessions (id, guardian_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES ('push-resilience-session-row', ?, ?, ?, ?, ?)`)
    .bind(GUARDIAN, await digest(TOKEN), now, expires, now).run();
  await h.env.FAMILY_DB.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
    VALUES ('push-resilience-link', ?, ?, '보호자', 1, 1, ?)`)
    .bind(STUDENT, GUARDIAN, now).run();
}

async function enableProvider(h) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  h.env.PUSH_VAPID_PUBLIC_KEY = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(publicJwk.x, 'base64url'),
    Buffer.from(publicJwk.y, 'base64url'),
  ]).toString('base64url');
  h.env.PUSH_VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  h.env.PUSH_VAPID_SUBJECT = 'mailto:push-resilience@example.test';
}

async function deliverableSubscription(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    endpoint,
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
      auth,
    },
    platform: 'synthetic-resilience-browser',
  };
}

async function subscribe(h, endpoint) {
  const cookie = `kkumeum_family_session=${TOKEN}`;
  const response = await h.request('/api/family/push/subscribe', {
    method: 'POST',
    cookie,
    origin: 'http://localhost',
    body: await deliverableSubscription(endpoint),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

async function publish(h, suffix) {
  const created = await h.request('/api/kkumeum/announcements', {
    method: 'POST',
    admin: true,
    origin: 'http://localhost',
    body: {
      campusId: 'campus-push-resilience',
      announcementType: 'child-message',
      title: `합성 점검 ${suffix}`,
      body: '이 본문은 푸시 payload에 포함되지 않습니다.',
      targets: [{ targetType: 'student', targetId: STUDENT }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, {
    method: 'POST',
    admin: true,
    origin: 'http://localhost',
  });
}

test('family feed does not wait for service-worker readiness just to render push status', async () => {
  const source = await readFile(new URL('../public/family/family.js', import.meta.url), 'utf8');
  assert.match(source, /navigator\.serviceWorker\.getRegistration\('\/family\/'\)/);
  assert.match(source, /void loadPushStatus\(\);[\s\S]*api\('\/api\/family\/children'\)/);
  assert.match(source, /serviceWorker\.register\('\/family\/sw\.js'[\s\S]*if \(state\.session\) void loadPushStatus\(\)/);
  const currentDeviceBlock = source.match(/async function currentDevicePushSubscription\(\)[\s\S]*?\n}\n/);
  assert.ok(currentDeviceBlock);
  assert.doesNotMatch(currentDeviceBlock[0], /serviceWorker\.ready/);
  assert.match(source, /async function togglePush\(\)[\s\S]*serviceWorker\.ready/);
});

test('legacy subscription decrypt failure is explicit, never fetches, and does not touch active or last_used_at', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(null, { status: 201 });
  };
  try {
    await seed(h);
    await enableProvider(h);
    await subscribe(h, 'https://synthetic.push.example/decrypt-failure');
    const sentinel = '2000-01-01T00:00:00.000Z';
    await h.env.FAMILY_DB.prepare('UPDATE push_subscriptions SET encryption_key_id = NULL, last_used_at = ?').bind(sentinel).run();
    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString('base64url');

    const published = await publish(h, 'decrypt');
    assert.equal(published.status, 200);
    assert.equal(published.body.push.failed, 1);
    assert.equal(providerCalls, 0);
    const delivery = await h.env.FAMILY_DB.prepare('SELECT error_code FROM push_delivery_attempts').first();
    assert.equal(delivery.error_code, 'subscription_decrypt_failed');
    const row = await h.env.FAMILY_DB.prepare('SELECT active, encryption_key_id, last_used_at FROM push_subscriptions').first();
    assert.equal(row.active, 1);
    assert.equal(row.encryption_key_id, null);
    assert.equal(row.last_used_at, sentinel);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

test('legacy decrypt success followed by provider failure stays provider_error and is not backfilled', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error('synthetic provider outage');
  };
  try {
    await seed(h);
    await enableProvider(h);
    await subscribe(h, 'https://synthetic.push.example/provider-failure');
    const sentinel = '2000-01-01T00:00:00.000Z';
    await h.env.FAMILY_DB.prepare('UPDATE push_subscriptions SET encryption_key_id = NULL, last_used_at = ?').bind(sentinel).run();

    const published = await publish(h, 'provider');
    assert.equal(published.status, 200);
    assert.equal(published.body.announcement.status, 'published');
    assert.equal(published.body.push.failed, 1);
    assert.equal(providerCalls, 1);
    const delivery = await h.env.FAMILY_DB.prepare('SELECT error_code FROM push_delivery_attempts').first();
    assert.equal(delivery.error_code, 'provider_error');
    const row = await h.env.FAMILY_DB.prepare('SELECT active, encryption_key_id, last_used_at FROM push_subscriptions').first();
    assert.equal(row.active, 1);
    assert.equal(row.encryption_key_id, null);
    assert.notEqual(row.last_used_at, sentinel);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

test('known encryption key mismatch never fetches and leaves last_used_at unchanged', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(null, { status: 201 });
  };
  try {
    await seed(h);
    await enableProvider(h);
    await subscribe(h, 'https://synthetic.push.example/key-mismatch');
    const sentinel = '2000-01-01T00:00:00.000Z';
    await h.env.FAMILY_DB.prepare('UPDATE push_subscriptions SET last_used_at = ?').bind(sentinel).run();
    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(32, 88).toString('base64url');

    const published = await publish(h, 'known-mismatch');
    assert.equal(published.status, 200);
    assert.equal(providerCalls, 0);
    const delivery = await h.env.FAMILY_DB.prepare('SELECT error_code FROM push_delivery_attempts').first();
    assert.equal(delivery.error_code, 'subscription_key_mismatch');
    const row = await h.env.FAMILY_DB.prepare('SELECT active, last_used_at FROM push_subscriptions').first();
    assert.equal(row.active, 1);
    assert.equal(row.last_used_at, sentinel);
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

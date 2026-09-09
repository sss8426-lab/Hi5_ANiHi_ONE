import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ADMIN = { id: 'push-admin', email: 'push-admin@example.test', name: 'Push 관리자' };
const GUARDIAN_A = 'push-guardian-a';
const GUARDIAN_B = 'push-guardian-b';
const STUDENT_A = 'push-student-a';
const TOKEN_A = 'push-session-a';
const TOKEN_B = 'push-session-b';
const encryptionKey = Buffer.alloc(32, 7).toString('base64url');
const p256dh = Buffer.alloc(65, 9).toString('base64url');
const auth = Buffer.alloc(16, 10).toString('base64url');

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
  url.searchParams.set('guardian-push', `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function harness() {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true, d1Databases: ['DB', 'FAMILY_DB'], r2Buckets: ['FAMILY_FILES'], d1Persist: false, r2Persist: false });
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
    const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { mf, env, request };
}

async function seed(h) {
  await h.request('/api/family/push/status');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await h.env.FAMILY_DB.prepare(`INSERT INTO family_students (id, campus_id, name, display_name, status, created_at, updated_at)
    VALUES (?, 'campus-push', '테스트학생', '테스트학생', 'active', ?, ?)`)
    .bind(STUDENT_A, now, now).run();
  for (const [id, loginId] of [[GUARDIAN_A, 'push-a'], [GUARDIAN_B, 'push-b']]) {
    await h.env.FAMILY_DB.prepare(`INSERT INTO family_guardians (id, login_id, display_name, status, must_change_password, failed_login_count, created_at, updated_at)
      VALUES (?, ?, '보호자', 'active', 0, 0, ?, ?)`).bind(id, loginId, now, now).run();
  }
  for (const [id, guardianId, raw] of [['push-session-a', GUARDIAN_A, TOKEN_A], ['push-session-b', GUARDIAN_B, TOKEN_B]]) {
    await h.env.FAMILY_DB.prepare(`INSERT INTO guardian_sessions (id, guardian_id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, guardianId, await digest(raw), now, expires, now).run();
  }
  await h.env.FAMILY_DB.prepare(`INSERT INTO student_guardians (id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at)
    VALUES ('push-link-a', ?, ?, '부모', 1, 1, ?), ('push-link-b', ?, ?, '부모', 1, 1, ?)`)
    .bind(STUDENT_A, GUARDIAN_A, now, STUDENT_A, GUARDIAN_B, now).run();
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
  h.env.PUSH_VAPID_SUBJECT = 'mailto:push@example.test';
}

function subscription(endpoint) {
  return { endpoint, keys: { p256dh, auth }, platform: 'test-browser' };
}

async function deliverableSubscription(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    endpoint,
    keys: {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
      auth,
    },
    platform: 'synthetic-provider-smoke',
  };
}

test('guardian push APIs are private, authenticated, same-origin, and encrypt subscription material', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/api/family/push/status')).status, 401);
    await seed(h);
    const cookie = `kkumeum_family_session=${TOKEN_A}`;
    const status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'private, no-store');
    assert.equal(status.body.subscriptionReady, false);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.code, 'vapid_invalid');

    const crossOrigin = await h.request('/api/family/push/subscribe', { method: 'POST', cookie, origin: 'https://evil.example', body: subscription('https://push.example/a') });
    assert.equal(crossOrigin.status, 403);
    const unavailable = await h.request('/api/family/push/subscribe', { method: 'POST', cookie, origin: 'http://localhost', body: subscription('https://push.example/a') });
    assert.equal(unavailable.status, 503);
    await enableProvider(h);
    const subscribed = await h.request('/api/family/push/subscribe', { method: 'POST', cookie, origin: 'http://localhost', body: subscription('https://push.example/a') });
    assert.equal(subscribed.status, 200, JSON.stringify(subscribed.body));
    assert.equal(subscribed.body.subscribed, true);
    assert.equal(subscribed.body.code, null);
    const stored = await h.env.FAMILY_DB.prepare('SELECT endpoint_encrypted, p256dh_encrypted, auth_encrypted FROM push_subscriptions').first();
    assert.ok(stored.endpoint_encrypted);
    assert.doesNotMatch(JSON.stringify(stored), /push\.example|test-browser|${p256dh}|${auth}/);
    const audit = await h.env.FAMILY_DB.prepare("SELECT metadata_json FROM family_audit_logs WHERE action = 'push_subscription.create'").first();
    assert.equal(String(audit.metadata_json), '{}');
  } finally { await h.mf.dispose(); }
});

test('VAPID configuration requires a valid matching P-256 pair, allowed subject, and valid encryption key', async () => {
  const h = await harness();
  try {
    await seed(h);
    const cookie = `kkumeum_family_session=${TOKEN_A}`;
    await enableProvider(h);
    const configured = await h.request('/api/family/push/status', { cookie });
    assert.equal(configured.body.configured, true);
    assert.equal(configured.body.code, null);
    assert.match(configured.body.publicKey, /^[A-Za-z0-9_-]+$/);

    const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    h.env.PUSH_VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', otherPair.publicKey)).toString('base64url');
    const mismatch = await h.request('/api/family/push/status', { cookie });
    assert.equal(mismatch.body.configured, false);
    assert.equal(mismatch.body.code, 'vapid_key_mismatch');

    h.env.PUSH_VAPID_PRIVATE_JWK = JSON.stringify({ kty: 'EC', crv: 'P-384', d: 'not-a-key' });
    const malformed = await h.request('/api/family/push/status', { cookie });
    assert.equal(malformed.body.configured, false);
    assert.equal(malformed.body.code, 'vapid_invalid');

    await enableProvider(h);
    h.env.PUSH_VAPID_SUBJECT = 'ftp://push.example';
    const subject = await h.request('/api/family/push/status', { cookie });
    assert.equal(subject.body.configured, false);
    assert.equal(subject.body.code, 'vapid_subject_invalid');

    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(31, 3).toString('base64url');
    const encryption = await h.request('/api/family/push/status', { cookie });
    assert.equal(encryption.body.subscriptionReady, false);
    assert.equal(encryption.body.code, 'subscription_key_invalid');
  } finally { await h.mf.dispose(); }
});

test('a subscription cannot move between guardians and explicit unsubscribe only disables its owner record', async () => {
  const h = await harness();
  try {
    await seed(h);
    await enableProvider(h);
    const a = `kkumeum_family_session=${TOKEN_A}`;
    const b = `kkumeum_family_session=${TOKEN_B}`;
    assert.equal((await h.request('/api/family/push/subscribe', { method: 'POST', cookie: a, origin: 'http://localhost', body: subscription('https://push.example/shared') })).status, 200);
    const stolen = await h.request('/api/family/push/subscribe', { method: 'POST', cookie: b, origin: 'http://localhost', body: subscription('https://push.example/shared') });
    assert.equal(stolen.status, 409);
    const removed = await h.request('/api/family/push/unsubscribe', { method: 'DELETE', cookie: b, origin: 'http://localhost', body: { endpoint: 'https://push.example/shared' } });
    assert.equal(removed.status, 200);
    const active = await h.env.FAMILY_DB.prepare('SELECT active, guardian_id FROM push_subscriptions').first();
    assert.equal(active.guardian_id, GUARDIAN_A);
    assert.equal(active.active, 1);
    assert.equal((await h.request('/api/family/push/unsubscribe', { method: 'DELETE', cookie: a, origin: 'http://localhost', body: { endpoint: 'https://push.example/shared' } })).status, 200);
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT active FROM push_subscriptions').first()).active, 0);
  } finally { await h.mf.dispose(); }
});

test('a disabled guardian or explicit session revoke cannot retain an active push subscription', async () => {
  const h = await harness();
  try {
    await seed(h);
    await enableProvider(h);
    const cookie = `kkumeum_family_session=${TOKEN_A}`;
    assert.equal((await h.request('/api/family/push/subscribe', { method: 'POST', cookie, origin: 'http://localhost', body: subscription('https://push.example/revoke') })).status, 200);
    const revoked = await h.request(`/api/kkumeum/guardians/${GUARDIAN_A}/revoke-sessions`, { method: 'POST', admin: true, origin: 'http://localhost', body: { campusId: 'campus-push', studentId: STUDENT_A } });
    assert.equal(revoked.status, 200);
    const row = await h.env.FAMILY_DB.prepare('SELECT active, revoked_at FROM push_subscriptions WHERE guardian_id = ?').bind(GUARDIAN_A).first();
    assert.equal(row.active, 0);
    assert.ok(row.revoked_at);
  } finally { await h.mf.dispose(); }
});

test('notice publish remains successful while unconfigured push records only the visible active guardian delivery', async () => {
  const h = await harness();
  try {
    await seed(h);
    await enableProvider(h);
    for (const [token, endpoint] of [[TOKEN_A, 'https://push.example/a'], [TOKEN_B, 'https://push.example/b']]) {
      assert.equal((await h.request('/api/family/push/subscribe', { method: 'POST', cookie: `kkumeum_family_session=${token}`, origin: 'http://localhost', body: subscription(endpoint) })).status, 200);
    }
    await h.env.FAMILY_DB.prepare("UPDATE family_guardians SET status = 'disabled' WHERE id = ?").bind(GUARDIAN_B).run();
    delete h.env.PUSH_VAPID_PRIVATE_JWK;
    delete h.env.PUSH_VAPID_SUBJECT;
    const created = await h.request('/api/kkumeum/announcements', { method: 'POST', admin: true, origin: 'http://localhost', body: { campusId: 'campus-push', announcementType: 'child-message', title: '개별 전달', body: '민감 본문은 푸시에 넣지 않습니다.', targets: [{ targetType: 'student', targetId: STUDENT_A }] } });
    assert.equal(created.status, 201);
    const published = await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, { method: 'POST', admin: true, origin: 'http://localhost' });
    assert.equal(published.status, 200);
    assert.equal(published.body.announcement.status, 'published');
    assert.equal(published.body.push.code, 'vapid_subject_invalid');
    assert.equal(published.body.push.failed, 1);
    const deliveries = await h.env.FAMILY_DB.prepare('SELECT guardian_id, status, error_code FROM push_delivery_attempts').all();
    assert.deepEqual(deliveries.results, [{ guardian_id: GUARDIAN_A, status: 'failed', error_code: 'vapid_subject_invalid' }]);
    assert.doesNotMatch(JSON.stringify(deliveries.results), /민감 본문|push\.example/);
  } finally { await h.mf.dispose(); }
});

test('a changed subscription encryption key fails safely without decrypting or deactivating the subscription', async () => {
  const h = await harness();
  try {
    await seed(h);
    await enableProvider(h);
    const cookie = `kkumeum_family_session=${TOKEN_A}`;
    assert.equal((await h.request('/api/family/push/subscribe', {
      method: 'POST', cookie, origin: 'http://localhost', body: subscription('https://push.example/key-id'),
    })).status, 200);
    const stored = await h.env.FAMILY_DB.prepare('SELECT encryption_key_id FROM push_subscriptions').first();
    assert.match(stored.encryption_key_id, /^sha256:[A-Za-z0-9_-]+$/);

    h.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64url');
    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST', admin: true, origin: 'http://localhost',
      body: { campusId: 'campus-push', announcementType: 'child-message', title: '내부 점검', body: '푸시에는 포함하지 않습니다.', targets: [{ targetType: 'student', targetId: STUDENT_A }] },
    });
    const published = await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, { method: 'POST', admin: true, origin: 'http://localhost' });
    assert.equal(published.status, 200);
    assert.equal(published.body.push.failed, 1);
    const delivery = await h.env.FAMILY_DB.prepare('SELECT status, error_code FROM push_delivery_attempts').first();
    assert.deepEqual(delivery, { status: 'failed', error_code: 'subscription_key_mismatch' });
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT active FROM push_subscriptions').first()).active, 1);
  } finally { await h.mf.dispose(); }
});

test('synthetic provider smoke signs and encrypts one generic delivery without a real browser subscription', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init.headers), body: init.body });
    return new Response(null, { status: 201 });
  };
  try {
    await seed(h);
    await enableProvider(h);
    const cookie = `kkumeum_family_session=${TOKEN_A}`;
    const status = await h.request('/api/family/push/status', { cookie });
    assert.equal(status.body.configured, true);
    assert.equal((await h.request('/api/family/push/subscribe', {
      method: 'POST', cookie, origin: 'http://localhost', body: await deliverableSubscription('https://synthetic.push.example/delivery'),
    })).status, 200);
    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST', admin: true, origin: 'http://localhost',
      body: { campusId: 'campus-push', announcementType: 'child-message', title: '내부 점검', body: '이 본문은 push에 노출되면 안 됩니다.', targets: [{ targetType: 'student', targetId: STUDENT_A }] },
    });
    const published = await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, { method: 'POST', admin: true, origin: 'http://localhost' });
    assert.equal(published.status, 200);
    assert.deepEqual(published.body.push, { sent: 1, failed: 0, code: null });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, 'https://synthetic.push.example/delivery');
    assert.match(captured[0].headers.get('authorization'), /^vapid t=[A-Za-z0-9._-]+, k=[A-Za-z0-9_-]+$/);
    assert.equal(captured[0].headers.get('content-encoding'), 'aes128gcm');
    assert.equal(captured[0].headers.get('content-type'), 'application/octet-stream');
    assert.ok(captured[0].body instanceof ArrayBuffer);
    assert.doesNotMatch(Buffer.from(captured[0].body).toString('utf8'), /본문은 push에 노출되면 안 됩니다|내부 점검|테스트학생/);
    const delivery = await h.env.FAMILY_DB.prepare('SELECT status, error_code FROM push_delivery_attempts').first();
    assert.deepEqual(delivery, { status: 'sent', error_code: null });
  } finally {
    globalThis.fetch = originalFetch;
    await h.mf.dispose();
  }
});

test('concurrent publish and later retries deliver a notice only once', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => { sends += 1; return new Response(null, { status: 201 }); };
  try {
    await seed(h);
    await enableProvider(h);
    await h.request('/api/family/push/subscribe', {
      method: 'POST', cookie: `kkumeum_family_session=${TOKEN_A}`, origin: 'http://localhost',
      body: await deliverableSubscription('https://synthetic.push.example/concurrent'),
    });
    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST', admin: true, origin: 'http://localhost',
      body: { campusId: 'campus-push', announcementType: 'child-message', title: 'Synthetic concurrency', body: 'Synthetic only', targets: [{ targetType: 'student', targetId: STUDENT_A }] },
    });
    const db = h.env.FAMILY_DB;
    let arrived = 0;
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    // Both requests must read the draft before either conditional update runs.
    h.env.FAMILY_DB = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare') return (sql) => {
          const statement = target.prepare(sql);
          if (!sql.includes("UPDATE announcements SET status = 'published'")) return statement;
          return { bind(...args) {
            const bound = statement.bind(...args);
            return { async run() {
              arrived += 1;
              if (arrived === 2) release();
              await barrier;
              return bound.run();
            } };
          } };
        };
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const path = `/api/kkumeum/announcements/${created.body.announcement.id}/publish`;
    const publish = () => h.request(path, { method: 'POST', admin: true, origin: 'http://localhost' });
    const results = await Promise.all([publish(), publish()]);
    h.env.FAMILY_DB = db;
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await publish()).status, 409);
    assert.equal(sends, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM push_delivery_attempts').first()).count, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM family_audit_logs WHERE action = 'announcement.publish'").first()).count, 1);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

for (const outcome of [404, 410, 503, 'network']) {
  test(`push failure ${outcome} preserves publication, records a safe error, and never auto-retries`, async () => {
    const h = await harness();
    const originalFetch = globalThis.fetch;
    let sends = 0;
    globalThis.fetch = async () => {
      sends += 1;
      if (outcome === 'network') throw new Error('synthetic-private-provider-detail');
      return new Response('synthetic-private-provider-detail', { status: outcome });
    };
    try {
      await seed(h);
      await enableProvider(h);
      await h.request('/api/family/push/subscribe', {
        method: 'POST', cookie: `kkumeum_family_session=${TOKEN_A}`, origin: 'http://localhost',
        body: await deliverableSubscription('https://synthetic.push.example/failure'),
      });
      const created = await h.request('/api/kkumeum/announcements', {
        method: 'POST', admin: true, origin: 'http://localhost',
        body: { campusId: 'campus-push', announcementType: 'child-message', title: 'Synthetic failure', body: 'Synthetic only', targets: [{ targetType: 'student', targetId: STUDENT_A }] },
      });
      const path = `/api/kkumeum/announcements/${created.body.announcement.id}/publish`;
      const published = await h.request(path, { method: 'POST', admin: true, origin: 'http://localhost' });
      assert.equal(published.status, 200);
      assert.equal(published.body.announcement.status, 'published');
      assert.equal(published.body.push.failed, 1);
      const gone = outcome === 404 || outcome === 410;
      const errorCode = gone ? 'subscription_gone' : outcome === 'network' ? 'provider_error' : 'provider_rejected';
      const attempt = await h.env.FAMILY_DB.prepare('SELECT status, error_code FROM push_delivery_attempts').first();
      assert.deepEqual(attempt, { status: 'failed', error_code: errorCode });
      const subscriptionRow = await h.env.FAMILY_DB.prepare('SELECT active, revoked_at FROM push_subscriptions').first();
      assert.equal(subscriptionRow.active, gone ? 0 : 1);
      assert.equal(Boolean(subscriptionRow.revoked_at), gone);
      assert.equal((await h.request(path, { method: 'POST', admin: true, origin: 'http://localhost' })).status, 409);
      assert.equal(sends, 1);
      assert.doesNotMatch(JSON.stringify(published.body), /synthetic-private-provider-detail|synthetic\.push\.example/);
    } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
  });
}

test('a guardian without a device subscription still receives the notice without any push attempt', async () => {
  const h = await harness();
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async () => { sends += 1; throw new Error('must not send'); };
  try {
    await seed(h);
    await enableProvider(h);
    const created = await h.request('/api/kkumeum/announcements', {
      method: 'POST', admin: true, origin: 'http://localhost',
      body: { campusId: 'campus-push', announcementType: 'child-message', title: 'Synthetic no device', body: 'Synthetic only', targets: [{ targetType: 'student', targetId: STUDENT_A }] },
    });
    const published = await h.request(`/api/kkumeum/announcements/${created.body.announcement.id}/publish`, { method: 'POST', admin: true, origin: 'http://localhost' });
    assert.equal(published.status, 200);
    assert.deepEqual(published.body.push, { sent: 0, failed: 0, code: null });
    assert.equal(sends, 0);
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT COUNT(*) AS count FROM push_delivery_attempts').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('guardian service worker keeps API network-only and displays only a generic notification payload', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../public/family/sw.js', import.meta.url), 'utf8');
  const familySource = await (await import('node:fs/promises')).readFile(new URL('../public/family/family.js', import.meta.url), 'utf8');
  assert.match(source, /self\.addEventListener\('push'/);
  assert.match(source, /self\.addEventListener\('notificationclick'/);
  assert.match(source, /꿈이음 새 소식이 도착했습니다/);
  assert.match(source, /openNotice=/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/family\/'\)/);
  assert.match(source, /if \(url\.pathname\.startsWith\('\/api\/family\/'\)[\s\S]*event\.respondWith\(fetch\(request\)\)/);
  assert.doesNotMatch(source, /학생 이름|보호자|작품 URL|R2 key/);
  assert.match(familySource, /async function currentDevicePushSubscription/);
  assert.match(familySource, /button\.textContent = currentSubscription \? '알림 끄기' : '알림 받기'/);
  assert.doesNotMatch(familySource, /button\.textContent = status\.subscribed/);
});

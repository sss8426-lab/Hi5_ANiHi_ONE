import { DataCoreAccessError } from "./data-core-access";
import { ensureKkumeumAnnouncementSchema, guardianCanViewPublishedAnnouncement } from "./kkumeum-announcements";
import { kkumeumGuardianSessionIdentity, type KkumeumGuardianIdentity } from "./kkumeum-guardian-auth";

export type KkumeumPushEnv = {
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_JWK?: string;
  PUSH_VAPID_SUBJECT?: string;
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY?: string;
};

type StoredSubscription = {
  id: string;
  guardian_id: string;
  endpoint_encrypted: string;
  p256dh_encrypted: string | null;
  auth_encrypted: string | null;
};

type PushConfig = {
  publicKey: string | null;
  encryptionKey: Uint8Array | null;
  privateJwk: JsonWebKey | null;
  subject: string | null;
  subscriptionReady: boolean;
  providerConfigured: boolean;
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_ENDPOINT_LENGTH = 4096;

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fromBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value)) throw new DataCoreAccessError(400, "Push 구독 키 형식이 올바르지 않습니다.");
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return base64Url(new Uint8Array(digest));
}

function text(value: unknown, maximum: number): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

function config(env: KkumeumPushEnv): PushConfig {
  const publicKey = text(env.PUSH_VAPID_PUBLIC_KEY, 200) || null;
  let encryptionKey: Uint8Array | null = null;
  try {
    const value = text(env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY, 200);
    if (value) {
      const bytes = fromBase64Url(value);
      if (bytes.length === 32) encryptionKey = bytes;
    }
  } catch {
    encryptionKey = null;
  }
  let privateJwk: JsonWebKey | null = null;
  try {
    const value = text(env.PUSH_VAPID_PRIVATE_JWK, 4096);
    if (value) privateJwk = JSON.parse(value) as JsonWebKey;
  } catch {
    privateJwk = null;
  }
  const subject = text(env.PUSH_VAPID_SUBJECT, 240) || null;
  const subscriptionReady = Boolean(publicKey && encryptionKey);
  return {
    publicKey,
    encryptionKey,
    privateJwk,
    subject,
    subscriptionReady,
    providerConfigured: Boolean(subscriptionReady && privateJwk && subject),
  };
}

async function encrypt(value: string, key: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", bytesBuffer(key), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesBuffer(iv) }, cryptoKey, bytesBuffer(new TextEncoder().encode(value)));
  const output = new Uint8Array(iv.length + encrypted.byteLength);
  output.set(iv);
  output.set(new Uint8Array(encrypted), iv.length);
  return base64Url(output);
}

async function decrypt(value: string, key: Uint8Array): Promise<string> {
  const bytes = fromBase64Url(value);
  if (bytes.length <= 12) throw new DataCoreAccessError(500, "보호자 Push 구독 정보를 읽을 수 없습니다.");
  const cryptoKey = await crypto.subtle.importKey("raw", bytesBuffer(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesBuffer(bytes.slice(0, 12)) }, cryptoKey, bytesBuffer(bytes.slice(12)));
  return new TextDecoder().decode(plain);
}

export async function ensureKkumeumPushSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumAnnouncementSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      guardian_id TEXT NOT NULL,
      endpoint_hash TEXT NOT NULL UNIQUE,
      endpoint_encrypted TEXT NOT NULL,
      p256dh_encrypted TEXT,
      auth_encrypted TEXT,
      platform TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS push_subscriptions_guardian_active_idx ON push_subscriptions(guardian_id, active, revoked_at)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS push_delivery_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      announcement_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      guardian_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      attempted_at TEXT NOT NULL,
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
      FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
      UNIQUE(announcement_id, subscription_id)
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS push_delivery_attempts_announcement_idx ON push_delivery_attempts(announcement_id, status, attempted_at)"),
  ]);
  const columns = await familyDb.prepare("PRAGMA table_info(push_subscriptions)").all<{ name: string }>();
  const known = new Set((columns.results || []).map((column) => column.name));
  for (const [name, type] of [["p256dh_encrypted", "TEXT"], ["auth_encrypted", "TEXT"], ["last_used_at", "TEXT"], ["revoked_at", "TEXT"]]) {
    if (!known.has(name)) await familyDb.exec(`ALTER TABLE push_subscriptions ADD COLUMN ${name} ${type}`);
  }
}

async function requireGuardian(familyDb: D1Database, request: Request): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumPushSchema(familyDb);
  const guardian = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!guardian) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (guardian.mustChangePassword) throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  return guardian;
}

function subscriptionInput(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const endpoint = text(input.endpoint, MAX_ENDPOINT_LENGTH);
  const keys = input.keys && typeof input.keys === "object" ? input.keys as Record<string, unknown> : {};
  const p256dh = text(keys.p256dh, 200);
  const auth = text(keys.auth, 100);
  const platform = text(input.platform, 120) || null;
  let endpointUrl: URL;
  try { endpointUrl = new URL(endpoint); } catch { throw new DataCoreAccessError(400, "Push 구독 주소 형식이 올바르지 않습니다."); }
  if (endpointUrl.protocol !== "https:") throw new DataCoreAccessError(400, "Push 구독 주소는 HTTPS여야 합니다.");
  if (!p256dh || !auth) throw new DataCoreAccessError(400, "Push 구독 키가 필요합니다.");
  const p256dhBytes = fromBase64Url(p256dh);
  const authBytes = fromBase64Url(auth);
  if (p256dhBytes.length !== 65 || authBytes.length < 16 || authBytes.length > 32) throw new DataCoreAccessError(400, "Push 구독 키 길이가 올바르지 않습니다.");
  return { endpoint, p256dh, auth, platform };
}

async function auditSubscription(familyDb: D1Database, guardianId: string, action: string, subscriptionId: string): Promise<void> {
  await familyDb.prepare(`INSERT INTO family_audit_logs (
    id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
  ) VALUES (?, NULL, 'guardian', ?, ?, 'push_subscription', ?, '{}', ?)`)
    .bind(crypto.randomUUID(), guardianId, action, subscriptionId, new Date().toISOString()).run();
}

export async function guardianPushStatus(familyDb: D1Database, request: Request, env: KkumeumPushEnv) {
  const guardian = await requireGuardian(familyDb, request);
  const active = await familyDb.prepare(`SELECT id FROM push_subscriptions
    WHERE guardian_id = ? AND active = 1 AND revoked_at IS NULL LIMIT 1`).bind(guardian.guardianId).first<{ id: string }>();
  const settings = config(env);
  return { subscribed: Boolean(active), subscriptionReady: settings.subscriptionReady, configured: settings.providerConfigured, publicKey: settings.subscriptionReady ? settings.publicKey : null, code: settings.providerConfigured ? null : "push_not_configured" };
}

export async function subscribeGuardianPush(familyDb: D1Database, request: Request, env: KkumeumPushEnv, rawInput: unknown) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const settings = config(env);
  if (!settings.providerConfigured || !settings.encryptionKey) throw new DataCoreAccessError(503, "push_not_configured");
  const input = subscriptionInput(rawInput);
  const hash = await endpointHash(input.endpoint);
  const existing = await familyDb.prepare("SELECT id, guardian_id FROM push_subscriptions WHERE endpoint_hash = ? LIMIT 1").bind(hash).first<{ id: string; guardian_id: string }>();
  if (existing && existing.guardian_id !== guardian.guardianId) throw new DataCoreAccessError(409, "이 기기는 다른 보호자 계정에 이미 연결되어 있습니다.");
  const now = new Date().toISOString();
  const id = existing?.id || crypto.randomUUID();
  await familyDb.prepare(`INSERT INTO push_subscriptions (
    id, guardian_id, endpoint_hash, endpoint_encrypted, p256dh_encrypted, auth_encrypted, platform, active, created_at, updated_at, last_used_at, revoked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
  ON CONFLICT(endpoint_hash) DO UPDATE SET endpoint_encrypted = excluded.endpoint_encrypted,
    p256dh_encrypted = excluded.p256dh_encrypted, auth_encrypted = excluded.auth_encrypted, platform = excluded.platform,
    active = 1, updated_at = excluded.updated_at, last_used_at = excluded.last_used_at, revoked_at = NULL`).bind(
    id, guardian.guardianId, hash, await encrypt(input.endpoint, settings.encryptionKey), await encrypt(input.p256dh, settings.encryptionKey),
    await encrypt(input.auth, settings.encryptionKey), input.platform, now, now, now,
  ).run();
  await auditSubscription(familyDb, guardian.guardianId, existing ? "push_subscription.refresh" : "push_subscription.create", id);
  return { ok: true, subscribed: true, configured: settings.providerConfigured, code: settings.providerConfigured ? null : "push_not_configured" };
}

export async function unsubscribeGuardianPush(familyDb: D1Database, request: Request, rawInput: unknown) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const endpoint = text((rawInput as Record<string, unknown> | null)?.endpoint, MAX_ENDPOINT_LENGTH);
  if (!endpoint) throw new DataCoreAccessError(400, "Push 구독 주소가 필요합니다.");
  const now = new Date().toISOString();
  const result = await familyDb.prepare(`UPDATE push_subscriptions SET active = 0, revoked_at = ?, updated_at = ?
    WHERE guardian_id = ? AND endpoint_hash = ? AND active = 1`).bind(now, now, guardian.guardianId, await endpointHash(endpoint)).run();
  if (Number(result.meta?.changes || 0) > 0) await auditSubscription(familyDb, guardian.guardianId, "push_subscription.revoke", "self");
  return { ok: true, subscribed: false };
}

export async function revokeGuardianPushSubscriptions(familyDb: D1Database, guardianId: string): Promise<void> {
  await ensureKkumeumPushSchema(familyDb);
  const now = new Date().toISOString();
  await familyDb.prepare(`UPDATE push_subscriptions
    SET active = 0, revoked_at = ?, updated_at = ?
    WHERE guardian_id = ? AND active = 1`).bind(now, now, guardianId).run();
}

function jwtPart(value: unknown): string { return base64Url(new TextEncoder().encode(JSON.stringify(value))); }

async function vapidToken(privateJwk: JsonWebKey, subject: string, audience: string): Promise<string> {
  const header = jwtPart({ typ: "JWT", alg: "ES256" });
  const payload = jwtPart({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject });
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function hmac(key: ArrayBuffer, value: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, size: number): Promise<Uint8Array> {
  const output = new Uint8Array(size);
  let previous = new Uint8Array();
  let offset = 0;
  for (let counter = 1; offset < size; counter += 1) {
    const source = new Uint8Array(previous.length + info.length + 1);
    source.set(previous); source.set(info, previous.length); source[source.length - 1] = counter;
    previous = await hmac(bytesBuffer(prk), bytesBuffer(source));
    output.set(previous.slice(0, Math.min(previous.length, size - offset)), offset);
    offset += previous.length;
  }
  return output;
}

async function encryptPushPayload(p256dh: string, auth: string, payload: Record<string, string>): Promise<Uint8Array> {
  const clientPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  const clientKey = await crypto.subtle.importKey("raw", bytesBuffer(clientPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKeys.privateKey, 256));
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const authPrk = await hmac(bytesBuffer(authSecret), bytesBuffer(shared));
  const info = new Uint8Array(14 + clientPublic.length + serverPublic.length);
  info.set(new TextEncoder().encode("WebPush: info\0")); info.set(clientPublic, 14); info.set(serverPublic, 14 + clientPublic.length);
  const inputKeyMaterial = await hkdfExpand(authPrk, info, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(bytesBuffer(salt), bytesBuffer(inputKeyMaterial));
  const content = new TextEncoder();
  const contentKey = await hkdfExpand(prk, content.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, content.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", bytesBuffer(contentKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bytesBuffer(nonce) }, aesKey, bytesBuffer(content.encode(`${JSON.stringify(payload)}\u0002`))));
  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = serverPublic.length; header.set(serverPublic, 21);
  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header); body.set(ciphertext, header.length);
  return body;
}

async function sendPush(subscription: StoredSubscription, settings: PushConfig, announcementId: string): Promise<{ sent: boolean; errorCode: string | null }> {
  if (!settings.providerConfigured || !settings.encryptionKey || !settings.privateJwk || !settings.subject || !settings.publicKey) return { sent: false, errorCode: "push_not_configured" };
  try {
    const endpoint = await decrypt(subscription.endpoint_encrypted, settings.encryptionKey);
    const p256dh = subscription.p256dh_encrypted ? await decrypt(subscription.p256dh_encrypted, settings.encryptionKey) : "";
    const auth = subscription.auth_encrypted ? await decrypt(subscription.auth_encrypted, settings.encryptionKey) : "";
    if (!p256dh || !auth) return { sent: false, errorCode: "subscription_incomplete" };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `vapid t=${await vapidToken(settings.privateJwk, settings.subject, new URL(endpoint).origin)}, k=${settings.publicKey}`, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "300", Urgency: "normal" },
      body: bytesBuffer(await encryptPushPayload(p256dh, auth, { title: "꿈이음", body: "꿈이음 새 소식이 도착했습니다.", noticeId: announcementId, route: `/family/?openNotice=${encodeURIComponent(announcementId)}` })),
    });
    if (response.ok) return { sent: true, errorCode: null };
    return { sent: false, errorCode: response.status === 404 || response.status === 410 ? "subscription_gone" : "provider_rejected" };
  } catch { return { sent: false, errorCode: "provider_error" }; }
}

async function recordDelivery(familyDb: D1Database, announcementId: string, subscription: StoredSubscription, result: { sent: boolean; errorCode: string | null }) {
  const now = new Date().toISOString();
  await familyDb.prepare(`INSERT INTO push_delivery_attempts (
    id, announcement_id, subscription_id, guardian_id, status, error_code, attempted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(announcement_id, subscription_id) DO UPDATE SET status = excluded.status, error_code = excluded.error_code, attempted_at = excluded.attempted_at`).bind(
    crypto.randomUUID(), announcementId, subscription.id, subscription.guardian_id, result.sent ? "sent" : "failed", result.errorCode, now,
  ).run();
  if (result.errorCode === "subscription_gone") {
    await familyDb.prepare("UPDATE push_subscriptions SET active = 0, revoked_at = ?, updated_at = ? WHERE id = ?").bind(now, now, subscription.id).run();
  } else {
    await familyDb.prepare("UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?").bind(now, subscription.id).run();
  }
}

// Publishing is already committed before this function runs; it must never throw into the publish response.
export async function dispatchGuardianAnnouncementPush(familyDb: D1Database, env: KkumeumPushEnv, announcementId: string): Promise<{ sent: number; failed: number; code: string | null }> {
  try {
    await ensureKkumeumPushSchema(familyDb);
    const subscriptions = await familyDb.prepare(`SELECT ps.id, ps.guardian_id, ps.endpoint_encrypted, ps.p256dh_encrypted, ps.auth_encrypted
      FROM push_subscriptions ps INNER JOIN family_guardians g ON g.id = ps.guardian_id
      WHERE ps.active = 1 AND ps.revoked_at IS NULL AND g.status = 'active'`).all<StoredSubscription>();
    const settings = config(env);
    let sent = 0; let failed = 0;
    for (const subscription of subscriptions.results || []) {
      if (!(await guardianCanViewPublishedAnnouncement(familyDb, announcementId, subscription.guardian_id))) continue;
      const result = await sendPush(subscription, settings, announcementId);
      await recordDelivery(familyDb, announcementId, subscription, result);
      if (result.sent) sent += 1; else failed += 1;
    }
    return { sent, failed, code: settings.providerConfigured ? null : "push_not_configured" };
  } catch { return { sent: 0, failed: 0, code: "push_delivery_unavailable" }; }
}

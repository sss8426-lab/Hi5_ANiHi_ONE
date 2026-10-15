import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// 꿈이음 5단계: Play Store (TWA) 준비. Synthetic values only.
const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const load = async () => (await import(new URL(`../dist/server/index.js?store=${Date.now()}`, import.meta.url))).default;
const get = (worker, env, path = '/.well-known/assetlinks.json') => worker.fetch(new Request(`http://localhost${path}`), env, { waitUntil() {}, passThroughOnException() {} });

test('assetlinks.json answers only when the package and a valid SHA-256 fingerprint are set', async () => {
  const worker = await load();
  assert.equal((await get(worker, {})).status, 404, 'nothing half-configured is published');
  assert.equal((await get(worker, { ANDROID_TWA_PACKAGE: 'com.hi5anihi.kkumeum', ANDROID_TWA_SHA256: 'not-a-print' })).status, 404);
  assert.equal((await get(worker, { ANDROID_TWA_PACKAGE: 'bad package', ANDROID_TWA_SHA256: PRINT })).status, 404);
  const r = await get(worker, { ANDROID_TWA_PACKAGE: 'com.hi5anihi.kkumeum', ANDROID_TWA_SHA256: `${PRINT.toLowerCase()}, ${PRINT}` });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const body = await r.json();
  assert.deepEqual(body[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(body[0].target.package_name, 'com.hi5anihi.kkumeum');
  assert.deepEqual(body[0].target.sha256_cert_fingerprints, [PRINT, PRINT]);
});

test('TWA config matches the installed web app and never ships a signing key', () => {
  const twa = JSON.parse(fs.readFileSync('mobile/android-twa/twa-manifest.json', 'utf8'));
  const web = JSON.parse(fs.readFileSync('public/family/manifest.webmanifest', 'utf8'));
  assert.equal(twa.startUrl, web.start_url);
  assert.equal(twa.themeColor, web.theme_color);
  assert.equal(twa.backgroundColor, web.background_color);
  assert.equal(twa.launcherName, web.short_name);
  assert.equal(twa.enableNotifications, true);
  assert.ok(twa.webManifestUrl.endsWith('/family/manifest.webmanifest'));
  assert.ok(web.icons.some(i => i.purpose === 'maskable'));
  assert.deepEqual(web.categories, ['education']);
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /\*\.keystore/);
  assert.ok(!fs.readdirSync('mobile/android-twa').some(f => /\.(keystore|jks)$/.test(f)));
  const doc = fs.readFileSync('docs/KKUMEUM_STORE_RELEASE_2026-10-15.md', 'utf8');
  for (const piece of ['ANDROID_TWA_PACKAGE', 'ANDROID_TWA_SHA256', '개인정보처리방침', '데이터 보안']) assert.ok(doc.includes(piece), piece);
});

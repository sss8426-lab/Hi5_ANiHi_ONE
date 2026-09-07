import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 보호자 PWA shell은 private fixture 없이 guardian API만 사용한다', async () => {
  const [html, js, newsJs] = await Promise.all([
    read('public/family/index.html'),
    read('public/family/family.js'),
    read('public/family/family-news.js'),
  ]);

  assert.match(html, /꿈이음/);
  assert.match(html, /홈/);
  assert.match(html, /우리아이/);
  assert.match(html, /성장기록/);
  assert.match(html, /소식/);
  assert.match(html, /더보기/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /꿈학생A|테스트 보호자|비공개학교|guardian-test|student-test/);

  for (const path of [
    '/api/family/auth/session',
    '/api/family/auth/login',
    '/api/family/auth/change-password',
    '/api/family/auth/logout',
    '/api/family/children',
  ]) assert.match(js, new RegExp(path.replaceAll('/', '\\/')));
  assert.match(js, /credentials:\s*'include'/);
  assert.match(js, /\/api\/family\/children\/\$\{encodeURIComponent\(studentId\)\}\/reports/);
  assert.match(js, /\/api\/family\/children\/\$\{encodeURIComponent\(studentId\)\}\/artworks/);
  assert.match(newsJs, /\/api\/family\/notices/);
  assert.match(newsJs, /credentials:\s*'include'/);
  assert.doesNotMatch(`${js}\n${newsJs}`, /\/api\/data-core/);
  assert.doesNotMatch(`${js}\n${newsJs}`, /localStorage|sessionStorage|indexedDB/i);
});

test('꿈이음 PWA manifest는 family scope 안에서 standalone으로 설치된다', async () => {
  const manifest = JSON.parse(await read('public/family/manifest.webmanifest'));
  assert.equal(manifest.short_name, '꿈이음');
  assert.equal(manifest.start_url, '/family/');
  assert.equal(manifest.scope, '/family/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.src === '/family/icon.svg'));
});

test('service worker는 명시적 static shell만 캐시하고 family/API를 network-only로 둔다', async () => {
  const sw = await read('public/family/sw.js');
  assert.match(sw, /STATIC_SHELL/);
  for (const asset of [
    '/family/index.html',
    '/family/family.css',
    '/family/family-news.css',
    '/family/family.js',
    '/family/family-news.js',
    '/family/manifest.webmanifest',
    '/family/icon.svg',
  ]) assert.match(sw, new RegExp(asset.replaceAll('/', '\\/')));
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/family\/'\)/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /event\.respondWith\(fetch\(request\)\)/);
  assert.doesNotMatch(sw, /cache\.put\(request[\s\S]*api\/family/);
});

test('보호자 UI는 실제 공지 API를 사용하고 가짜 소식을 만들지 않는다', async () => {
  const [html, js, newsJs] = await Promise.all([
    read('public/family/index.html'),
    read('public/family/family.js'),
    read('public/family/family-news.js'),
  ]);
  assert.doesNotMatch(html, /소식 기능을 준비하고 있습니다/);
  assert.match(newsJs, /api\/family\/notices/);
  assert.match(newsJs, /notices\/\$\{encodeURIComponent\(notice\.announcementId\)\}\/read/);
  assert.match(newsJs, /if \(opening\) await markRead/);
  assert.doesNotMatch(`${js}\n${newsJs}`, /mockNews|sampleNews|fakeNews/i);
});

test('/family route는 staff DATA CORE 인증과 분리된 static guardian shell로만 연결된다', async () => {
  const [router, vite, wrangler] = await Promise.all([
    read('worker/family-shell-router.ts'),
    read('vite.config.ts'),
    read('wrangler.jsonc'),
  ]);
  assert.match(router, /url\.pathname !== "\/family" && url\.pathname !== "\/family\/"/);
  assert.match(router, /url\.pathname = "\/family\/index\.html"/);
  assert.match(router, /env\.ASSETS\.fetch/);
  assert.doesNotMatch(router, /resolveDataCoreAccess|requireAuthenticatedAccess|FAMILY_DB.*prepare/);
  assert.match(vite, /\.\/worker\/family-shell-router\.ts/);
  assert.match(wrangler, /\.\/worker\/family-shell-router\.ts/);
});
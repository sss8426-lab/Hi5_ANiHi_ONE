import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/family/index.html', import.meta.url), 'utf8');
const newsJs = fs.readFileSync(new URL('../public/family/family-news.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/family/sw.js', import.meta.url), 'utf8');

test('꿈이음 보호자 PWA는 실제 소식 UI 자산을 로드한다', () => {
  assert.match(html, /family-news\.css/);
  assert.match(html, /family-news\.js/);
  assert.doesNotMatch(html, /소식 기능을 준비하고 있습니다/);
});

test('보호자 소식은 FAMILY_DB API에서만 읽고 명시적 열기에서만 읽음 처리한다', () => {
  assert.match(newsJs, /api\/family\/notices/);
  assert.match(newsJs, /notices\/\$\{encodeURIComponent\(notice\.announcementId\)\}\/read/);
  assert.match(newsJs, /button\.addEventListener\('click'/);
  assert.match(newsJs, /if \(opening\) await markRead/);
  assert.doesNotMatch(newsJs, /localStorage|sessionStorage|indexedDB/i);
});

test('읽지 않은 소식 수는 하단 메뉴 배지와 소식 화면에 표시된다', () => {
  assert.match(newsJs, /newsNavBadge/);
  assert.match(newsJs, /newsUnreadCount/);
  assert.match(newsJs, /response\.unreadCount/);
});

test('service worker는 보호자 API를 캐시하지 않는다', () => {
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/family\/'\)/);
  assert.match(sw, /event\.respondWith\(fetch\(request\)\)/);
  assert.match(sw, /family-news\.js/);
  assert.match(sw, /family-news\.css/);
});

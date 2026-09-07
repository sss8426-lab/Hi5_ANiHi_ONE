import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 staff shell exposes real notice composer without fabricated family data', async () => {
  const html = await read('public/data-core/work/kkumeum.html');
  const js = await read('public/data-core/work/kkumeum-notices.js');

  assert.match(html, /id="kkAnnouncements"/);
  assert.match(html, /id="kkNoticeForm"/);
  assert.match(html, /임시저장/);
  assert.match(html, /보호자에게 발행/);
  assert.match(html, /kkumeum-notices\.js/);
  assert.match(js, /\/api\/kkumeum\/announcements/);
  assert.match(js, /FAMILY_DB 연결 후/);
  assert.match(js, /예시 데이터 없이 실제 작성한 소식만 표시합니다/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/i);
});

test('notice composer derives visible scopes from staff role and never invents broader client permissions', async () => {
  const js = await read('public/data-core/work/kkumeum-notices.js');

  assert.match(js, /CAMPUS_DIRECTOR/);
  assert.match(js, /TEACHER/);
  assert.match(js, /STAFF/);
  assert.match(js, /\['organization', '전체공지'\]/);
  assert.match(js, /\['campus', '캠퍼스공지'\]/);
  assert.match(js, /\['class', '반소식'\]/);
  assert.match(js, /\['student', '개별소식'\]/);
  assert.match(js, /state\.context\?\.isSuperAdmin/);
  assert.match(js, /state\.health\?\.database/);
  assert.match(js, /state\.health\?\.ok/);
});

test('notice composer keeps draft review before publish and sends mutations only to protected staff API', async () => {
  const js = await read('public/data-core/work/kkumeum-notices.js');

  assert.match(js, /createDraft/);
  assert.match(js, /updateDraft/);
  assert.match(js, /publishDraft/);
  assert.match(js, /window\.confirm/);
  assert.match(js, /\/publish/);
  assert.match(js, /credentials: 'include'/);
  assert.match(js, /cache: 'no-store'/);
  assert.doesNotMatch(js, /\/api\/family\/announcements/);
});

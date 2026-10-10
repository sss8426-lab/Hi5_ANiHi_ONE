import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(path, 'utf8');

test('출결기 page: pairs with a 6-digit 연결번호, 4~6 digit 등하원 번호, 등원/하원, offline queue, no staff login', () => {
  const html = read('public/kiosk/index.html'), js = read('public/kiosk/kiosk.js'), css = read('public/kiosk/kiosk.css');
  for (const id of ['kPair', 'kDisplay', 'kGo', 'kPairGo', 'kResult', 'kMenu', 'kNet']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-action="arrive"[^>]*>등원/); assert.match(html, /data-action="leave"[^>]*>하원/);
  assert.match(js, /\/api\/kiosk\/pair/); assert.match(js, /\/api\/kiosk\/checkin/); assert.match(js, /\/api\/kiosk\/session/);
  assert.doesNotMatch(js, /\/api\/kkumeum\/|\/api\/data-core\//, 'the tablet never calls staff APIs');
  assert.match(js, /kkumeum-kiosk-queue/); assert.match(js, /addEventListener\('online'/);
  assert.match(js, /speechSynthesis/); assert.match(js, /wakeLock/);
  assert.match(css, /^\[hidden\]\{display:none!important\}/, 'hidden overlays never block the keypad');
  const manifest = JSON.parse(read('public/kiosk/manifest.webmanifest'));
  assert.equal(manifest.scope, '/kiosk/'); assert.equal(manifest.display, 'fullscreen');
  assert.doesNotMatch(read('public/kiosk/sw.js'), /cache\.put\([^)]*api/);
});

test('직원 출석체크: one-tap 등원→하원, 등하원 번호, 출결기 표시, 보호자 미연결, 찾기, 타임 모두 하원, 30초 새로고침', () => {
  const js = read('public/data-core/work/kkumeum-attendance.js');
  assert.match(js, /data-att-one="\$\{next\}"/);
  assert.match(js, /auto:status==='arrive'&&ids\.length===1/, 'one tap uses the automatic 지각 rule');
  assert.match(js, /km-att-no/); assert.match(js, /e\.source==='kiosk'/); assert.match(js, /보호자 미연결/);
  assert.match(js, /id="kmAttSearch"/); assert.match(js, /e\.isComposing/);
  assert.match(js, /data-att-bulk=/); assert.match(js, /\},30000\);/);
  assert.match(js, /data-view="attendance-settings"/);
});

test('출결 설정: 출결기 연결번호, 타임 시간, 담당 선생님, 번호 수정, 인증키 한꺼번에 + 문자 보내기, 번호표, CSV', () => {
  const js = read('public/data-core/work/kkumeum-attendance-admin.js');
  for (const path of ['/api/kkumeum/attendance/kiosks', '/api/kkumeum/attendance/settings', '/api/kkumeum/attendance/teachers', '/api/kkumeum/attendance/students', '/api/kkumeum/attendance/invites']) assert.ok(js.includes(path), path);
  assert.match(js, /sms:\$\{d\}\?&body=/);
  assert.match(js, /\/family\/#code=/);
  assert.match(js, /번호표/); assert.match(js, /등하원번호\.csv/);
  const mobile = read('public/data-core/work/kkumeum-mobile.js');
  assert.match(mobile, /view==='attendance-settings'\)\{if\(!manager\(\)\)/);
  const page = read('public/data-core/work/kkumeum.html');
  assert.ok(page.indexOf('kkumeum-attendance-admin.js') < page.indexOf('kkumeum-mobile.js'));
  assert.match(read('public/data-core/work/attendance-roster.js'), /body\.codesAssigned/);
});

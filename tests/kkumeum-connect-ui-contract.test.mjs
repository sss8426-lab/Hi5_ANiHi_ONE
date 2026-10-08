import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(path, 'utf8');

test('보호자 앱: 인증키로 시작하기 first, 아이디 로그인 kept, 오늘 출결 + 출결 기록, 자녀 추가, 앱 설치', () => {
  const html = read('public/family/index.html'), js = read('public/family/family.js'), mobile = read('public/family/family-mobile.js');
  assert.ok(html.indexOf('id="codeForm"') < html.indexOf('id="loginForm"'), 'code form comes before the ID login');
  assert.match(html, /<details class="login-alt">[\s\S]*id="loginForm"/);
  for (const id of ['attendanceToday', 'attendanceList', 'attendanceMonthBtn', 'installBtn', 'addChildForm']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(js, /\/api\/family\/auth\/code/);
  assert.match(js, /\/api\/family\/children\/\$\{encodeURIComponent\(studentId\)\}\/attendance\?month=/);
  assert.match(js, /new URLSearchParams\(location\.hash\.slice\(1\)\)\.get\('code'\)/, 'shared links keep the code in the #fragment');
  assert.match(js, /history\.replaceState\(null, '', '\/family\/'\)/, 'the code leaves the address bar at once');
  assert.match(js, /beforeinstallprompt/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/i);
  assert.match(mobile, /key==='attendance'\)\{extra\.hidden=true;window\.switchTab\('attendance'\);\}/);
});

test('PWA: PNG and maskable icons, apple-touch-icon, attendance pushes show their text while notices stay generic', () => {
  const manifest = JSON.parse(read('public/family/manifest.webmanifest'));
  assert.ok(manifest.icons.some(i => i.src === '/family/icon-512.png' && i.sizes === '512x512'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) assert.ok(fs.statSync(`public/family/${f}`).size > 1000, f);
  assert.match(read('public/family/index.html'), /rel="apple-touch-icon" href="\/family\/apple-touch-icon\.png"/);
  const sw = read('public/family/sw.js');
  assert.match(sw, /payload\?\.kind === 'attendance'/);
  assert.match(sw, /route\.startsWith\('\/family\/'\) \? route : '\/family\/'/, 'a push can only open a /family/ page');
  assert.match(sw, /body: '꿈이음 새 소식이 도착했습니다\.'/, 'notice pushes keep the generic text');
});

test('직원 꿈이음: 출석체크 opens in the app (no redirect to the 출석부 page), 인증키 issued from 보호자 연결', () => {
  const mobile = read('public/data-core/work/kkumeum-mobile.js'), page = read('public/data-core/work/kkumeum.html');
  assert.doesNotMatch(mobile, /location\.replace\('\/data-core\/work\/attendance'\)/);
  assert.match(mobile, /window\.KkumeumAttendance\?\.open\(\{state,route\}\)/);
  assert.ok(page.indexOf('kkumeum-attendance.js') < page.indexOf('kkumeum-mobile.js'));
  const attendance = read('public/data-core/work/kkumeum-attendance.js');
  for (const label of ['등원', '하원', '결석', '지각', '조퇴', '보강', '월별 현황']) assert.ok(attendance.includes(label), label);
  assert.match(attendance, /\/api\/kkumeum\/attendance\/monthly/);
  const operations = read('public/data-core/work/kkumeum-operations.js');
  assert.match(operations, /\/invite-code/);
  assert.match(operations, /\/family\/#code=/);
  assert.match(operations, /이 화면을 닫으면 인증키를 다시 볼 수 없습니다/);
});

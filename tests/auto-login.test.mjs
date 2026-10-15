import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryHarness, users } from './support/library-harness.mjs';

// 자동 로그인(로그인 상태 유지). Synthetic accounts only.
const initial = 'SYNTHETIC Initial 2026!';
const changed = 'SYNTHETIC Remember 2026!';
const cookieOf = result => result.headers.get('set-cookie')?.split(';')[0];
const maxAgeOf = result => Number(/Max-Age=(\d+)/.exec(result.headers.get('set-cookie') || '')?.[1]);
const DAY = 86400;

async function account(h) {
  assert.equal((await h.request('POST', '/api/auth/accounts', users.admin, { loginId: 'synthetic-remember', role: 'CAMPUS_ADMIN', campusId: 'WONJONG', temporaryPassword: initial })).status, 201);
  const first = await h.request('POST', '/api/auth/login', null, { loginId: 'synthetic-remember', password: initial }, 'http://localhost');
  assert.equal((await h.request('PUT', '/api/auth/password', null, { currentPassword: initial, nextPassword: changed }, 'http://localhost', { cookie: cookieOf(first) })).status, 200);
}
const login = (h, remember) => h.request('POST', '/api/auth/login', null, { loginId: 'synthetic-remember', password: changed, ...(remember === undefined ? {} : { remember }) }, 'http://localhost');
const session = (h, cookie) => h.request('GET', '/api/auth/session', null, undefined, 'http://localhost', { cookie });

test('로그인 상태 유지: 체크하면 30일, 안 하면 8시간; 쓰는 동안 하루에 한 번 30일로 다시 늘림; 로그아웃은 바로 끝냄', async () => {
  const h = await libraryHarness();
  try {
    await account(h);
    const normal = await login(h);
    assert.equal(normal.status, 200); assert.equal(maxAgeOf(normal), 8 * 3600, '기본은 지금처럼 8시간');
    const kept = await login(h, true);
    assert.equal(kept.status, 200); assert.equal(maxAgeOf(kept), 30 * DAY);
    assert.ok(Date.parse(kept.body.expiresAt) - Date.now() > 29 * DAY * 1000);

    // 막 로그인한 세션은 다시 늘리지 않는다 (하루에 한 번).
    const fresh = await session(h, cookieOf(kept));
    assert.equal(fresh.body.authenticated, true); assert.equal(fresh.headers.get('set-cookie'), null);

    // 20일이 지난 것처럼 만들면, 화면을 열 때 30일로 다시 늘고 쿠키도 새로 준다.
    const soon = new Date(Date.now() + 10 * DAY * 1000).toISOString();
    await h.env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE remember = 1').bind(soon).run();
    // 로그인 확인은 10초 동안 기억된다. 시간이 지난 것처럼 그 기억을 비운다(인증 변경 요청은 모두 기억을 비움).
    await h.request('POST', '/api/auth/logout', null, {}, 'http://localhost');
    const renewed = await session(h, cookieOf(kept));
    assert.equal(renewed.body.authenticated, true); assert.equal(maxAgeOf(renewed), 30 * DAY);
    const after = await h.env.DB.prepare('SELECT expires_at FROM auth_sessions WHERE remember = 1').first();
    assert.ok(Date.parse(after.expires_at) - Date.now() > 29 * DAY * 1000);
    const activity = await h.request('POST', '/api/auth/activity', null, undefined, 'http://localhost', { cookie: cookieOf(kept) });
    assert.equal(activity.status, 200); assert.equal(activity.headers.get('set-cookie'), null, '같은 날 두 번 늘리지 않는다');

    // 8시간 세션은 늘리지 않는다.
    await h.env.DB.prepare("UPDATE auth_sessions SET expires_at = ? WHERE remember = 0 AND revoked_at IS NULL").bind(new Date(Date.now() + 3600_000).toISOString()).run();
    await h.request('POST', '/api/auth/logout', null, {}, 'http://localhost');
    assert.equal((await session(h, cookieOf(normal))).headers.get('set-cookie'), null);

    // 로그아웃하면 30일 세션도 바로 끝나고, 늘어나지 않는다.
    await h.request('POST', '/api/auth/logout', null, {}, 'http://localhost', { cookie: cookieOf(kept) });
    const gone = await session(h, cookieOf(kept));
    assert.equal(gone.body.authenticated, false); assert.equal(gone.headers.get('set-cookie'), null);
    assert.equal((await login(h, 'yes')).status, 200, '잘못된 값은 그냥 8시간');
    assert.equal(maxAgeOf(await login(h, 'yes')), 8 * 3600);
  } finally { await h.mf.dispose(); }
});

test('로그인 화면: 상태 유지 체크박스, 아이디만 기억하고 비밀번호는 저장하지 않음', () => {
  const html = readFileSync('public/data-core/login.html', 'utf8');
  const script = readFileSync('public/data-core/login.js', 'utf8');
  assert.match(html, /id="rememberLogin" type="checkbox"/);
  assert.match(html, /여러 사람이 쓰는 컴퓨터에서는 체크하지 마세요/);
  assert.match(script, /remember: \$\('rememberLogin'\)\.checked/);
  assert.match(script, /localStorage\.setItem\(LOGIN_ID_KEY/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*password/i, '비밀번호는 브라우저에 저장하지 않는다');
});

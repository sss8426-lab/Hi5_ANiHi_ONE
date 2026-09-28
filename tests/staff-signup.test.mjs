import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, users } from './support/library-harness.mjs';

// Synthetic applicants only. Passwords are test-only strings, never real credentials.
const PASSWORD = 'SYNTHETIC signup 2026!';
const cookie = result => result.headers.get('set-cookie')?.split(';')[0];
const apply = (h, body = {}, headers = {}) => h.request('POST', '/api/auth/signup', null, {
  displayName: '가상 선생님', campusId: 'WONJONG', position: '강사', loginId: 'synthetic-staff', password: PASSWORD, phone: '010-0000-1234', ...body,
}, 'http://localhost', headers);
const login = (h, loginId = 'synthetic-staff', password = PASSWORD) => h.request('POST', '/api/auth/login', null, { loginId, password });
const pending = async h => (await h.request('GET', '/api/auth/signup-requests', users.master)).body.requests;

test('직원인증: anyone can apply; nothing can sign in until a MASTER approves; approval uses the applicant password', async () => {
  const h = await libraryHarness();
  try {
    const options = await h.request('GET', '/api/auth/signup/options', null);
    assert.equal(options.status, 200);
    assert.ok(options.body.campuses.some(c => c.id === 'campus-wonjong' && c.name === '부천 원종 캠퍼스'));
    assert.equal(options.body.passwordMinLength, 12);

    const created = await apply(h);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'pending');
    const stored = await h.env.DB.prepare('SELECT * FROM auth_signup_requests WHERE id = ?').bind(created.body.id).first();
    assert.equal(stored.login_id, 'synthetic-staff'); assert.equal(stored.campus_id, 'campus-wonjong');
    assert.notEqual(stored.password_hash, PASSWORD); assert.ok(!JSON.stringify(stored).includes(PASSWORD));
    assert.equal(await h.env.DB.prepare("SELECT count(*) AS n FROM auth_accounts WHERE login_id='synthetic-staff'").first('n'), 0);

    // Not approved yet: the right password is told it is waiting; a wrong one gets the generic answer.
    const early = await login(h);
    assert.equal(early.status, 403); assert.match(early.body.error, /아직 수락되지 않았습니다/);
    const wrong = await login(h, 'synthetic-staff', 'SYNTHETIC wrong password');
    assert.equal(wrong.status, 401); assert.match(wrong.body.error, /올바르지 않습니다/);

    // The same ID cannot be requested twice while pending.
    assert.equal((await apply(h, { displayName: '다른 사람' })).status, 409);

    // Only a MASTER sees and decides requests; hashes never leave the server.
    for (const user of [users.campusAdmin, users.teacher, users.staff]) {
      assert.equal((await h.request('GET', '/api/auth/signup-requests', user)).status, 403);
      assert.equal((await h.request('POST', `/api/auth/signup-requests/${created.body.id}/approve`, user, { role: 'CAMPUS_ADMIN' })).status, 403);
    }
    assert.equal((await h.request('GET', '/api/auth/signup-requests', null)).status, 401);
    const list = await pending(h);
    assert.deepEqual(list.map(r => [r.display_name, r.campus_name, r.position, r.login_id, r.phone]), [['가상 선생님', '부천 원종 캠퍼스', '강사', 'synthetic-staff', '010-0000-1234']]);
    assert.doesNotMatch(JSON.stringify(list), /password|requester_hash/);
    assert.equal((await h.request('POST', `/api/auth/signup-requests/${created.body.id}/approve`, users.master, { role: 'TEACHER' }, 'https://evil.invalid')).status, 403);

    const approved = await h.request('POST', `/api/auth/signup-requests/${created.body.id}/approve`, users.master, { role: 'TEACHER' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.account.loginId, 'synthetic-staff');
    assert.equal((await h.request('POST', `/api/auth/signup-requests/${created.body.id}/approve`, users.master, { role: 'TEACHER' })).status, 409);
    assert.deepEqual(await pending(h), []);

    // The applicant signs in with the password they chose, no forced change, on their campus and role.
    const signedIn = await login(h);
    assert.equal(signedIn.status, 200); assert.equal(signedIn.body.mustChangePassword, false);
    const session = await h.request('GET', '/api/auth/session', null, undefined, 'http://localhost', { cookie: cookie(signedIn) });
    assert.equal(session.body.authenticated, true);
    assert.deepEqual(session.body.memberships.map(m => [m.campusId, m.role]), [['campus-wonjong', 'TEACHER']]);
    const accounts = (await h.request('GET', '/api/auth/accounts', users.master)).body.accounts;
    const account = accounts.find(a => a.login_id === 'synthetic-staff');
    assert.equal(account.display_name, '가상 선생님'); assert.equal(account.position, '강사'); assert.equal(account.phone, '010-0000-1234');
    assert.equal(account.campus_id, 'campus-wonjong'); assert.equal(account.role, 'TEACHER');
    // An ID that already has an account cannot be requested again.
    assert.equal((await apply(h)).status, 409);
  } finally { await h.mf.dispose(); }
});

test('직원인증: rejection blocks sign-in and frees the ID for a new request; input is validated', async () => {
  const h = await libraryHarness();
  try {
    const created = await apply(h, { loginId: 'synthetic-reject' });
    const rejected = await h.request('POST', `/api/auth/signup-requests/${created.body.id}/reject`, users.master, {});
    assert.equal(rejected.status, 200); assert.equal(rejected.body.status, 'rejected');
    const denied = await login(h, 'synthetic-reject');
    assert.equal(denied.status, 403); assert.match(denied.body.error, /거절되었습니다/);
    assert.equal((await apply(h, { loginId: 'synthetic-reject' })).status, 201, 'a rejected ID can apply again');

    const bad = [
      [{ displayName: '' }, /이름/], [{ campusId: 'campus-unknown' }, /캠퍼스/], [{ position: ' ' }, /직책/],
      [{ loginId: 'ab' }, /아이디/], [{ loginId: '가상아이디' }, /아이디/], [{ password: 'short' }, /12자/],
      [{ phone: '전화없음' }, /연락처/], [{ phone: '010' }, /연락처/],
    ];
    for (const [body, message] of bad) {
      const result = await apply(h, { loginId: 'synthetic-valid', ...body });
      assert.equal(result.status, 400, JSON.stringify(body)); assert.match(result.body.error, message);
    }
    assert.equal((await h.request('POST', '/api/auth/signup', null, { displayName: '가상', campusId: 'WONJONG', position: '강사', loginId: 'synthetic-origin', password: PASSWORD, phone: '010-0000-0000' }, 'https://evil.invalid')).status, 403);
    // A MASTER-role approval needs no campus.
    const master = await apply(h, { loginId: 'synthetic-master-applicant' });
    const promoted = await h.request('POST', `/api/auth/signup-requests/${master.body.id}/approve`, users.master, { role: 'MASTER', campusId: null });
    assert.equal(promoted.status, 200); assert.equal(promoted.body.account.campusId, null);
  } finally { await h.mf.dispose(); }
});

test('회원삭제: the account stops signing in at once, its ID is freed, and what the person made is kept', async () => {
  const h = await libraryHarness();
  try {
    const created = await apply(h, { loginId: 'synthetic-leaver' });
    await h.request('POST', `/api/auth/signup-requests/${created.body.id}/approve`, users.master, { role: 'TEACHER' });
    const signedIn = await login(h, 'synthetic-leaver');
    assert.equal(signedIn.status, 200);
    const account = (await h.request('GET', '/api/auth/accounts', users.master)).body.accounts.find(a => a.login_id === 'synthetic-leaver');
    const userId = (await h.env.DB.prepare('SELECT user_id FROM auth_accounts WHERE id = ?').bind(account.id).first()).user_id;
    // Something the person made before leaving.
    await h.env.DB.prepare(`INSERT INTO data_records (id, organization_id, campus_id, created_by_user_id, record_type, source_app, title, visibility, status, metadata_json, created_at, updated_at)
      VALUES ('synthetic-leaver-record', 'org-hi5-anihi', 'campus-wonjong', ?, 'note', 'synthetic', '남는 자료', 'campus', 'active', '{}', ?, ?)`).bind(userId, new Date().toISOString(), new Date().toISOString()).run();

    const path = `/api/auth/accounts/${account.id}`;
    for (const user of [users.campusAdmin, users.teacher, users.staff]) assert.equal((await h.request('DELETE', path, user)).status, 403);
    assert.equal((await h.request('DELETE', path, null)).status, 401);
    assert.equal((await h.request('DELETE', path, users.master, undefined, 'https://evil.invalid')).status, 403);

    const deleted = await h.request('DELETE', path, users.master);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body)); assert.equal(deleted.body.deleted, true);
    // The open session and the password stop working immediately.
    const session = await h.request('GET', '/api/auth/session', null, undefined, 'http://localhost', { cookie: cookie(signedIn) });
    assert.equal(session.body.authenticated, false);
    assert.equal((await login(h, 'synthetic-leaver')).status, 401);
    assert.ok(!(await h.request('GET', '/api/auth/accounts', users.master)).body.accounts.some(a => a.login_id === 'synthetic-leaver'));
    assert.equal((await h.request('DELETE', path, users.master)).status, 404);
    // Files/records keep their author; the person row is only marked deleted, with no campus access left.
    assert.equal((await h.env.DB.prepare("SELECT created_by_user_id FROM data_records WHERE id = 'synthetic-leaver-record'").first()).created_by_user_id, userId);
    assert.equal((await h.env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(userId).first()).status, 'deleted');
    assert.equal((await h.env.DB.prepare('SELECT count(*) AS n FROM memberships WHERE user_id = ?').bind(userId).first()).n, 0);
    const audit = await h.env.DB.prepare("SELECT metadata_json FROM audit_logs WHERE action = 'account_deleted' AND resource_id = ?").bind(account.id).first();
    assert.match(audit.metadata_json, /synthetic-leaver/);
    // The ID is free again: the person can apply anew (and must be approved again).
    assert.equal((await apply(h, { loginId: 'synthetic-leaver' })).status, 201);
    assert.equal((await login(h, 'synthetic-leaver')).status, 403);

    // A master cannot delete their own account, and the last master account cannot be deleted.
    const masterLogin = await h.request('POST', '/api/auth/accounts', users.admin, { loginId: 'synthetic-only-master', role: 'MASTER', temporaryPassword: PASSWORD });
    const onlyMaster = masterLogin.body.account.id;
    await h.env.DB.prepare('UPDATE auth_accounts SET must_change_password = 0 WHERE id = ?').bind(onlyMaster).run();
    const masterSession = await login(h, 'synthetic-only-master');
    const self = await h.request('DELETE', `/api/auth/accounts/${onlyMaster}`, null, undefined, 'http://localhost', { cookie: cookie(masterSession) });
    assert.equal(self.status, 400); assert.match(self.body.error, /본인 계정/);
    const last = await h.request('DELETE', `/api/auth/accounts/${onlyMaster}`, users.master);
    assert.equal(last.status, 409); assert.match(last.body.error, /마지막 마스터/);
  } finally { await h.mf.dispose(); }
});

test('직원인증: repeated requests from one place are limited', async () => {
  const h = await libraryHarness();
  try {
    const from = { 'cf-connecting-ip': '192.0.2.10' };
    for (let i = 0; i < 5; i++) assert.equal((await apply(h, { loginId: `synthetic-flood-${i}` }, from)).status, 201);
    const limited = await apply(h, { loginId: 'synthetic-flood-5' }, from);
    assert.equal(limited.status, 429); assert.match(limited.body.error, /잠시 후/);
    assert.equal((await apply(h, { loginId: 'synthetic-elsewhere' }, { 'cf-connecting-ip': '192.0.2.11' })).status, 201);
  } finally { await h.mf.dispose(); }
});

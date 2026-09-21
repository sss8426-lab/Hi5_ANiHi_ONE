import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, users } from './support/library-harness.mjs';

const initial = 'SYNTHETIC Initial 2026!';
const changed = 'SYNTHETIC 변경 2026! ()';
const cookie = result => result.headers.get('set-cookie')?.split(';')[0];
async function create(h, loginId='synthetic-password') {
  const result = await h.request('POST','/api/auth/accounts',users.admin,{loginId,role:'CAMPUS_ADMIN',campusId:'WONJONG',temporaryPassword:initial});
  assert.equal(result.status,201); return result.body.account;
}
const login = (h,password=initial,oldCookie) => h.request('POST','/api/auth/login',null,{loginId:'SYNTHETIC-PASSWORD',password},'http://localhost',oldCookie?{cookie:oldCookie}:{});
const session = (h,value) => h.request('GET','/api/auth/session',null,undefined,'http://localhost',{cookie:value});

test('pending cookie does not block relogin; exact changed password works after logout; old sessions/password do not',async()=>{
  const h=await libraryHarness();
  try {
    await create(h);const first=await login(h);assert.equal(first.status,200);
    const again=await login(h,initial,cookie(first));assert.equal(again.status,200);assert.equal(again.body.mustChangePassword,true);
    const result=await h.request('PUT','/api/auth/password',null,{currentPassword:initial,nextPassword:changed},'http://localhost',{cookie:cookie(again)});
    assert.equal(result.status,200);
    assert.equal((await session(h,cookie(first))).body.authenticated,false);
    assert.equal((await session(h,cookie(result))).body.mustChangePassword,false);
    await h.request('POST','/api/auth/logout',null,{},'http://localhost',{cookie:cookie(result)});
    assert.equal((await login(h,initial)).status,401);
    assert.equal((await login(h,changed)).status,200);
  } finally { await h.mf.dispose(); }
});

test('password/session/audit failure rolls back the entire first-change operation',async()=>{
  const h=await libraryHarness();
  try {
    await create(h);const first=await login(h);
    await h.env.DB.prepare("CREATE TRIGGER synthetic_fail_password_audit BEFORE INSERT ON audit_logs WHEN NEW.action='password_changed' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END").run();
    const failed=await h.request('PUT','/api/auth/password',null,{currentPassword:initial,nextPassword:changed},'http://localhost',{cookie:cookie(first)});
    assert.equal(failed.status,500);
    assert.equal((await session(h,cookie(first))).body.authenticated,true);
    assert.equal((await login(h,initial)).status,200);
    assert.equal((await login(h,changed)).status,401);
    await h.env.DB.prepare("CREATE TRIGGER synthetic_fail_reset_audit BEFORE INSERT ON audit_logs WHEN NEW.action='account_updated' BEGIN SELECT RAISE(ABORT,'synthetic reset failure'); END").run();
    const account=(await h.request('GET','/api/auth/accounts',users.master)).body.accounts.find(row=>row.login_id==='synthetic-password');
    assert.equal((await h.request('PATCH',`/api/auth/accounts/${account.id}`,users.master,{newPassword:changed,mustChangePassword:false})).status,500);
    assert.equal((await login(h,initial)).status,200,'failed master audit does not change credentials');
    assert.equal((await session(h,cookie(first))).body.authenticated,true,'failed master write does not revoke sessions');
  } finally { await h.mf.dispose(); }
});

test('master can set a campus password, clear lock and revoke sessions without exposing credentials; campus and cross-origin denied',async()=>{
  const h=await libraryHarness();
  try {
    const account=await create(h);const first=await login(h);
    const path=`/api/auth/accounts/${account.id}`,body={newPassword:changed,mustChangePassword:false};
    for(const user of [users.campusAdmin,users.director,users.teacher,users.staff,users.outsider,null]) assert.equal((await h.request('PATCH',path,user,body)).status,user?403:401);
    for(const origin of ['https://foreign.invalid',null]) assert.equal((await h.request('PATCH',path,users.master,body,origin)).status,403);
    assert.equal((await h.request('PATCH',path,users.master,{newPassword:'short'})).status,400);
    for(let i=0;i<5;i++)await login(h,'synthetic-wrong');
    assert.equal((await login(h)).status,423);
    const result=await h.request('PATCH',path,users.master,body);assert.equal(result.status,200);
    assert.equal((await session(h,cookie(first))).body.authenticated,false);
    const fresh=await login(h,changed);assert.equal(fresh.status,200);assert.equal(fresh.body.mustChangePassword,false);
    assert.equal((await login(h,initial)).status,401);
    const list=await h.request('GET','/api/auth/accounts',users.master);
    const audit=(await h.env.DB.prepare("SELECT metadata_json FROM audit_logs WHERE resource_id=? AND action='account_updated'").bind(account.id).all()).results;
    for(const value of [result.body,list.body,audit]){
      const text=JSON.stringify(value);assert.ok(!text.includes(changed));assert.ok(!text.includes(initial));assert.doesNotMatch(text,/password_hash|password_salt|rawToken/);
    }
    const stored=await h.env.DB.prepare('SELECT password_hash,must_change_password FROM auth_accounts WHERE id=?').bind(account.id).first();
    assert.notEqual(stored.password_hash,changed);assert.equal(stored.must_change_password,0);
    await h.request('PATCH',path,users.master,{newPassword:initial});
    assert.equal((await login(h,initial)).body.mustChangePassword,true,'direct change defaults to forced change');
    await h.request('PATCH',path,users.master,{temporaryPassword:changed});
    assert.equal((await login(h,changed)).body.mustChangePassword,true,'legacy reset contract retained');
    const master=await h.request('POST','/api/auth/accounts',users.admin,{loginId:'synthetic-protected-master',role:'MASTER',temporaryPassword:initial});
    assert.equal((await h.request('PATCH',`/api/auth/accounts/${master.body.account.id}`,users.master,body)).status,403);
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
  } finally { await h.mf.dispose(); }
});

test('expired lock grants a new attempt window instead of immediately relocking',async()=>{
  const h=await libraryHarness();
  try {
    const account=await create(h);
    await h.env.DB.prepare('UPDATE auth_accounts SET failed_login_count=5,locked_until=? WHERE id=?').bind(new Date(Date.now()-1000).toISOString(),account.id).run();
    assert.equal((await login(h,'synthetic-wrong')).status,401);
    const row=await h.env.DB.prepare('SELECT failed_login_count,locked_until FROM auth_accounts WHERE id=?').bind(account.id).first();
    assert.equal(row.failed_login_count,1);assert.equal(row.locked_until,null);
    assert.equal((await login(h)).status,200);
  } finally { await h.mf.dispose(); }
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { libraryHarness, users } from '../tests/support/library-harness.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const h=await libraryHarness(),out=resolve('outputs/campus-password-browser');
await mkdir(out,{recursive:true});
const initial='SYNTHETIC-Initial-2026!',changed='SYNTHETIC-Changed-2026!',managed='SYNTHETIC-Master-2026!';
for(const [loginId,role,campusId] of [['synthetic-master','MASTER',null],['as','CAMPUS_ADMIN','ANSAN']]) {
  assert.equal((await h.request('POST','/api/auth/accounts',users.admin,{loginId,role,campusId,temporaryPassword:initial})).status,201);
}
await h.env.DB.prepare("UPDATE auth_accounts SET must_change_password=0 WHERE login_id='synthetic-master'").run();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'};
h.env.ASSETS={fetch:async request=>{
  const path=resolve('public','.'+new URL(request.url).pathname);
  if(!path.startsWith(resolve('public')+'/')&&!path.startsWith(resolve('public')+'\\'))return new Response(null,{status:404});
  try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
}};
const worker=(await import('../dist/server/index.js')).default;
const server=createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const r=await worker.fetch(new Request(`http://localhost:${server.address().port}${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),h.env,{waitUntil(){}});
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
  } catch {res.writeHead(500);res.end('Synthetic server error');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://localhost:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
const result={syntheticOnly:true,widths:[],flows:[],errors};
try {
  const campus=await browser.newPage();campus.on('pageerror',e=>errors.push(e.message));
  const signIn=async(page,id,pw)=>{
    await page.goto(base+'/data-core/login');
    await page.locator('#loginId').fill(id);await page.locator('#password').fill(pw);
    await page.locator('#loginForm button[type=submit]').click();
  };
  const logout=async(page)=>assert.equal((await page.request.post(base+'/api/auth/logout',{headers:{origin:base}})).status(),200);
  await signIn(campus,'AS',initial);
  await campus.locator('#passwordFormWrap').waitFor({state:'visible'});
  assert.equal(await campus.locator('#changeLoginId').inputValue(),'as');
  await campus.reload();await campus.locator('#passwordFormWrap').waitFor({state:'visible'});
  assert.equal(await campus.locator('#changeLoginId').inputValue(),'as');
  await campus.locator('#switchAccount').click();await campus.locator('#loginFormWrap').waitFor({state:'visible'});
  await signIn(campus,'as',initial);
  await campus.locator('#currentPassword').fill(initial);await campus.locator('#nextPassword').fill(changed);await campus.locator('#confirmPassword').fill(changed);
  await campus.locator('#passwordForm button[type=submit]').click();await campus.waitForURL('**/data-core/work');
  await logout(campus);await signIn(campus,'as',changed);await campus.waitForURL('**/data-core/work');
  result.flows.push('first change, resumed username, account switch, logout, fresh login with changed password');
  const master=await browser.newPage();master.on('pageerror',e=>errors.push(e.message));
  await signIn(master,'synthetic-master',initial);await master.waitForURL('**/data-core/work');
  await master.goto(base+'/data-core/accounts');
  const card=master.locator('.presence-item').filter({hasText:'안산 입시본원'});
  await card.locator('[data-action=password]').click();await master.locator('#passwordDialog').waitFor({state:'visible'});
  assert.equal(await master.locator('#targetLoginId').inputValue(),'as');
  await master.locator('#managedPassword').fill(managed);await master.locator('#managedPasswordConfirm').fill('SYNTHETIC-mismatch!');
  await master.locator('#savePasswordChange').click();await master.getByText('12자 이상 비밀번호를 동일하게 입력하세요.').waitFor();
  await master.locator('#managedPasswordConfirm').fill(managed);await master.locator('#forcePasswordChange').uncheck();
  await master.locator('#showManagedPassword').check();assert.equal(await master.locator('#managedPassword').getAttribute('type'),'text');
  await master.locator('#showManagedPassword').uncheck();
  for(const width of [1920,1440,1024,768,390,320]) {
    await master.setViewportSize({width,height:900});
    const bounds=await master.locator('#passwordDialog').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
    assert.ok(await master.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await master.screenshot({path:resolve(out,`password-${width}.png`)});result.widths.push(width);
  }
  let saves=0;master.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/api/auth/accounts/'))saves++;});
  await master.locator('#savePasswordChange').dblclick();await master.getByText('변경 완료.',{exact:false}).waitFor();assert.equal(saves,1);
  await master.locator('#cancelPasswordChange').click();await master.waitForFunction(()=>document.getElementById('managedPassword').value==='');
  assert.equal((await campus.request.get(base+'/api/auth/session')).ok(),true);
  assert.equal((await (await campus.request.get(base+'/api/auth/session')).json()).authenticated,false);
  await signIn(campus,'as',managed);await campus.waitForURL('**/data-core/work');
  const denied=await campus.request.patch(base+'/api/auth/accounts/invalid',{headers:{origin:base},data:{newPassword:changed}});assert.equal(denied.status(),403);
  result.flows.push('master targeted password dialog, confirmation, optional forced change, one mutation on double click, session revoked, campus relogin, campus mutation 403');
  await card.locator('[data-action=reset]').click();await master.locator('#passwordDialog').waitFor({state:'visible'});
  assert.ok((await master.locator('#managedPassword').inputValue()).length>=12);
  await master.locator('#cancelPasswordChange').click();assert.equal(saves,1,'opening/cancelling reset does not mutate credentials');
  await logout(campus);await signIn(campus,'as',managed);await campus.waitForURL('**/data-core/work');
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();await writeFile(resolve(out,'report.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));

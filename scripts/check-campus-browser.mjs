import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { Miniflare } from 'miniflare';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const worker=(await import('../dist/server/index.js')).default;
const mf=new Miniflare({script:"export default {fetch(){return new Response('ok')}}",modules:true,d1Databases:['DB'],r2Buckets:['FILES'],d1Persist:false,r2Persist:false});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'};
const env={DB:await mf.getD1Database('DB'),FILES:await mf.getR2Bucket('FILES'),DATA_CORE_SUPER_ADMIN_EMAILS:'ui-master@example.test',ASSETS:{fetch:async request=>{
  const path=resolve('public','.'+new URL(request.url).pathname);
  if(!path.startsWith(resolve('public')+'/')&&!path.startsWith(resolve('public')+'\\'))return new Response(null,{status:404});
  try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
}}};
const admin={'oai-authenticated-user-id':'ui-master','oai-authenticated-user-email':'ui-master@example.test','origin':'http://localhost','content-type':'application/json'};
async function seed(path,body){const r=await worker.fetch(new Request('http://localhost'+path,{method:body?'POST':'GET',headers:admin,body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});assert.ok(r.ok);return r.json();}
await seed('/api/auth/session');
for(const [loginId,role,campusId] of [['synthetic-master','MASTER',null],['wj','CAMPUS_ADMIN','WONJONG']]) await seed('/api/auth/accounts',{loginId,role,campusId,temporaryPassword:'Synthetic-Ui-Initial!'});
// Fixtures only: avoid storing actual passwords or operator sessions in screenshots.
await env.DB.prepare('UPDATE auth_accounts SET must_change_password=0').run();
await env.FILES.put('state/admissions-data.json',JSON.stringify({version:1,students:[],cases:[],awardFolders:[],changeLogs:[],universities:[],admissionGradeRules:[],settings:{consultantName:'컨설턴트님'}}));
const server=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const response=await worker.fetch(new Request(`http://localhost:${server.address().port}${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env,{waitUntil(){}});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Synthetic server error');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://localhost:${server.address().port}`,out='outputs/campus-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});let checks=0;
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/data-core/login');
  await page.locator('#loginId').fill('synthetic-master');await page.locator('#password').fill('Synthetic-Ui-Initial!');
  await page.locator('#loginForm button[type=submit]').click();await page.waitForURL('**/data-core/work');
  await page.goto(base+'/data-core/accounts');await page.locator('.presence-item').first().waitFor();
  assert.equal(await page.locator('.presence-item').count(),10);checks++;
  for(const width of [1920,1440,1280,1024,768]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} overflow`);
    await page.screenshot({path:`${out}/master-${width}.png`,fullPage:true});checks++;
  }
  const campus=await browser.newPage();campus.on('pageerror',e=>errors.push(e.message));
  await campus.goto(base+'/data-core/login');await campus.locator('#loginId').fill('WJ');await campus.locator('#password').fill('Synthetic-Ui-Initial!');await campus.locator('#loginForm button[type=submit]').click();await campus.waitForURL('**/data-core/work');
  await campus.locator('#userChip').waitFor();assert.match(await campus.locator('#userChip').innerText(),/부천원종/);
  assert.equal(await campus.locator('[data-nav-scope=admin]:visible').count(),0);checks+=2;
  assert.equal((await campus.request.get(base+'/data-core/accounts')).status(),403);checks++;
  await campus.setViewportSize({width:1024,height:768});await campus.screenshot({path:`${out}/campus-1024.png`,fullPage:true});
  await campus.goto(base+'/admissions-web/renderer/index.html#page=students');await campus.locator('#students').waitFor();
  assert.equal(await campus.locator('[data-page=settings]:visible').count(),0);checks++;
  assert.ok(await campus.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.goto(base+'/admissions-web/renderer/index.html#page=students');
  await page.locator('.admissions-campus-filter select').waitFor();
  await page.locator('.admissions-campus-filter select').selectOption('campus-wonjong');
  await page.waitForURL('**/*campusId=campus-wonjong*');
  await page.locator('#students').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.screenshot({path:`${out}/master-admissions-768.png`,fullPage:true});
  await page.goto(base+'/data-core/accounts');
  await page.locator('.presence-state.online').first().waitFor();
  assert.equal(await page.locator('#campusOnline').textContent(),'1');checks++;
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(27, 28, 28)');checks++;
  assert.equal(await page.locator('#role').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(21, 25, 24)');checks++;
  await page.screenshot({path:`${out}/master-active-768.png`,fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,viewports:[1920,1440,1280,1024,768],pageErrors:errors.length,syntheticOnly:true}));
}finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encode} from 'fast-png';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const png=Buffer.from(encode({width:80,height:100,channels:4,data:Uint8Array.from({length:32000},(_,i)=>(i*71+Math.floor(i/257))%256)}));
const out=process.env.AWARD_VISUAL_ORIGIN?'outputs/award-transfer-preview':'outputs/award-transfer-browser';
await fs.mkdir(out,{recursive:true});
let folders=[],files=[],serial=0,active=0,maxActive=0,failOnce=false,delay=80;
const reset=(count)=>{folders=Array.from({length:count},(_,i)=>({id:`synthetic-${i}`,title:i===1?'1'.repeat(140):`합성 폴더 ${i+1}`,createdAt:String(i).padStart(4,'0'),campusId:null}));files=[];};
reset(2);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 try {
  const u=new URL(req.url,'http://localhost'),p=u.pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(value));};
  if(p==='/api/data-core/context')return json({authenticated:true,canWrite:true,isSuperAdmin:true,user:{name:'Synthetic admin',internalUserId:'synthetic'},memberships:[]});
  if(p==='/api/data-core/health')return json({ok:true,bindings:{database:true,files:true}});
  if(p==='/api/data-core/campuses')return json({campuses:[]});
  if(p==='/api/data-core/records'&&req.method==='GET')return json({records:u.searchParams.get('recordType')==='competition-award-folder'?folders:[]});
  if(p==='/api/data-core/records'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const record={...JSON.parse(Buffer.concat(chunks)),id:`synthetic-new-${serial++}`,createdAt:'z'};
   folders.push(record);return json({record},201);
  }
  if(p.startsWith('/api/data-core/records/')&&req.method==='DELETE'){
   const id=p.split('/').pop();if(files.some(f=>f.recordId===id))return json({error:'not empty'},409);
   folders=folders.filter(f=>f.id!==id);return json({ok:true});
  }
  if(p==='/api/data-core/files'&&req.method==='POST'){
   active++;maxActive=Math.max(maxActive,active);
   try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData();
    await new Promise(r=>setTimeout(r,delay));
    if(failOnce){failOnce=false;return json({error:'synthetic retry'},503);}
    const file={id:`synthetic-file-${serial++}`,recordId:form.get('recordId'),fileName:'합성 수상작.png',mimeType:'image/png',category:'competition-material'};
    files.push(file);return json({file},201);
   } finally {active--;}
  }
  if(p==='/api/data-core/files')return json({files:files.filter(f=>f.recordId===u.searchParams.get('recordId'))});
  if(p.startsWith('/api/data-core/files/')){
   if(req.method==='DELETE'){files=files.filter(f=>f.id!==p.split('/').pop());return json({ok:true,permanent:true});}
   res.writeHead(200,{'content-type':'image/png'}).end(png);return;
  }
  if(p.startsWith('/api/'))return json({files:[],records:[],competitions:[],events:[],items:[],pages:[]});
  const file=path.resolve('public','.'+(p==='/data-core/counseling/competitions'?'/data-core/index.html':decodeURIComponent(p)));
  if(!file.startsWith(path.resolve('public')+path.sep)){res.writeHead(403).end();return;}
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));
 }catch {if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const local=`http://127.0.0.1:${server.address().port}`,base=process.env.AWARD_VISUAL_ORIGIN||local;
if(!/^https?:\/\/(?:127\.0\.0\.1:\d+|[a-z0-9.-]+\.workers\.dev)$/.test(base))throw Error('Invalid origin');
const browser=await chromium.launch({headless:true,channel:'chrome'});
let checks=0;
try {
 const ctx=await browser.newContext();
 if(base!==local)await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
  // Every API is intercepted; the Preview run cannot write any production/preview data.
  if(u.pathname.startsWith('/api/')){const r=await route.fetch({url:local+u.pathname+u.search});return route.fulfill({response:r});}
  if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:await fs.readFile('public/data-core/index.html','utf8')});
  return route.continue();
 });
 const page=await ctx.newPage(),errors=[],consoleErrors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('503'))consoleErrors.push(m.text());});
 for(const width of [1920,1440,1024,820,390,320]){
  console.log(`folders ${width}`);
  await page.setViewportSize({width,height:1000});
  for(const count of [2,5,20]){
   reset(count);await page.goto(base+'/data-core/counseling/competitions');
   await page.locator('[data-award-folder-id]').first().waitFor();
   assert.equal(await page.locator('[data-award-folder-id]').count(),count);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const rows=await page.locator('#awardFolderTrack button').evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().top)));
   assert.ok(Math.max(...rows)-Math.min(...rows)<4,`${width} folder wrap`);
   assert.equal(await page.locator('#awardFolderPrev').isDisabled(),true);
   if(await page.locator('#awardFolderNext').isEnabled()){
    const before=await page.locator('#awardFolderTrack').evaluate(e=>e.scrollLeft);
    await page.locator('#awardFolderNext').click();await page.waitForTimeout(450);
    const after=await page.locator('#awardFolderTrack').evaluate(e=>e.scrollLeft);
    assert.ok(after>before);assert.ok(after-before<=248);
    await page.locator('#awardFolderPrev').click();await page.waitForTimeout(450);
    assert.ok(await page.locator('#awardFolderTrack').evaluate(e=>e.scrollLeft)<after);
   }
   checks+=6;
  }
  await page.locator('#openAwardFolderBtn').click();await page.locator('#awardFolderTitle').fill('합성 마지막 새 폴더');
  await page.locator('#awardFolderForm button[type=submit]').click();
  await page.locator('[data-award-folder-id^="synthetic-new-"]').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#awardFolderTrack').evaluate(e=>{const a=e.querySelector('.active').getBoundingClientRect(),b=e.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;}),true);
  await page.screenshot({path:`${out}/${width}-folders.png`,fullPage:true});checks++;
 }
 await page.setViewportSize({width:1440,height:1000});
 for(const count of [1,10,30]){
  console.log(`upload ${count}`);
  reset(2);maxActive=0;await page.goto(base+'/data-core/counseling/competitions');await page.locator('#openAwardUploadBtn:not([disabled])').waitFor();
  await page.locator('#openAwardUploadBtn').click();
  await page.locator('#uploadFile').setInputFiles(Array.from({length:count},(_,i)=>({name:`synthetic-${i}.png`,mimeType:'image/png',buffer:png})));
  assert.match(await page.locator('#selectedFileName').textContent(),new RegExp(`${count}개 파일 선택`));
  await page.evaluate(()=>{globalThis.progressSamples=[];const element=document.getElementById('uploadProgressPercent');new MutationObserver(()=>progressSamples.push(element.textContent)).observe(element,{childList:true,characterData:true,subtree:true});});
  await page.locator('#uploadSubmitBtn').click();
  await page.locator('#uploadModal').waitFor({state:'hidden'});
  assert.equal(files.length,count);assert.ok(maxActive<=3);
  assert.equal(await page.locator('[data-award-image]').count(),count);
  assert.ok((await page.evaluate(()=>progressSamples)).includes('100%'));
  if(count>1)assert.ok((await page.evaluate(()=>progressSamples)).some(p=>parseInt(p)>0&&parseInt(p)<100));
  assert.ok(files.every(f=>f.recordId==='synthetic-0'));
  await page.locator('[data-award-image]').first().click();await page.locator('#awardLightbox[open]').waitFor();await page.keyboard.press('Escape');
  await page.reload();await page.locator('[data-award-image]').first().waitFor();assert.equal(await page.locator('[data-award-image]').count(),count);checks+=9;
 }
 reset(2);failOnce=true;await page.reload();await page.locator('#openAwardUploadBtn:not([disabled])').waitFor();await page.locator('#openAwardUploadBtn').click();
 await page.locator('#uploadFile').setInputFiles(Array.from({length:10},(_,i)=>({name:`retry-${i}.png`,mimeType:'image/png',buffer:png})));
 await page.locator('#uploadSubmitBtn').click();await page.locator('#retryUploadsBtn:not(.hidden)').waitFor();assert.equal(files.length,9);
  await page.screenshot({path:`${out}/retry.png`});
 await page.locator('#retryUploadsBtn').click();await page.locator('#uploadModal').waitFor({state:'hidden'});assert.equal(files.length,10);checks+=2;
 for(const checkbox of await page.locator('[data-award-select]').all())await checkbox.check();
 await page.locator('#deleteSelectedAwardsBtn').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'cancelAwardDeleteBtn');
 await page.keyboard.press('Enter');assert.equal(files.length,10);
 await page.locator('#deleteSelectedAwardsBtn').click();await page.locator('#confirmAwardDeleteBtn').click();await page.locator('#awardDeleteDialog').waitFor({state:'hidden'});assert.equal(files.length,0);checks+=3;
 reset(2);delay=500;await page.reload();await page.locator('#openAwardUploadBtn:not([disabled])').waitFor();await page.locator('#openAwardUploadBtn').click();
 await page.locator('#uploadFile').setInputFiles(Array.from({length:30},(_,i)=>({name:`cancel-${i}.png`,mimeType:'image/png',buffer:png})));
 await page.locator('#uploadSubmitBtn').click();await page.waitForTimeout(650);page.once('dialog',d=>d.accept());
 await page.locator('[data-close-modal="uploadModal"]').click();await page.getByText('업로드 취소됨',{exact:true}).waitFor();
 await page.waitForTimeout(800);assert.ok(files.length<30);assert.ok(files.length>=3);checks+=2;
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
 await fs.writeFile(`${out}/results.json`,JSON.stringify({checks,errors,consoleErrors,maxConcurrent:maxActive,syntheticOnly:true},null,2));
 console.log(JSON.stringify({checks,errors:errors.length,syntheticOnly:true}));
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

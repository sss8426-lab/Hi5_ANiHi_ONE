// Real Worker API + ephemeral synthetic D1/R2. Remote mode checks deployed assets only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {libraryHarness,users} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const remote=process.env.AWARD_ASSET_ORIGIN||null;
const out=resolve('outputs/award-browser'+(remote?'-remote':''));await mkdir(out,{recursive:true});
const h=await libraryHarness();let role=users.master;
const errors=[],checked=new Set(),result={remoteAssets:remote,backend:'isolated synthetic Worker',widths:[],flows:[]};
const png=await sharp({create:{width:720,height:480,channels:3,background:'#208779'}}).png().toBuffer();
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(/^\/api\/data-core\/competition-sources\/[^/]+\/preview$/.test(url.pathname)) {
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({items:[],warnings:[]}));return;
    }
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?new Uint8Array(Buffer.concat(chunks)):undefined;
      const headers={};if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
      if(req.headers['if-none-match'])headers['if-none-match']=req.headers['if-none-match'];
      const r=await h.raw(req.method,url.pathname+url.search,role,body,'http://localhost',headers);
      const bytes=Buffer.from(await r.arrayBuffer());res.writeHead(r.status,Object.fromEntries(r.headers));res.end(bytes);return;
    }
    const path=['/data-core/counseling/competitions','/data-core/counseling','/data-core/work','/data-core/work/library'].includes(url.pathname)?'/data-core/index.html':url.pathname==='/data-core/operations'?'/data-core/operations.html':url.pathname;
    const file=resolve('public','.'+path);assert.ok(file.startsWith(resolve('public')+sep));
    const bytes=await readFile(file);
    if(remote&&path.startsWith('/data-core/')&&!checked.has(path)) {
      const r=await fetch(remote+path);assert.equal(r.status,200,path);
      const hash=b=>createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(path)?b.toString().replace(/\r\n/g,'\n'):b).digest('hex');
      assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(bytes),'Remote asset mismatch '+path);checked.add(path);
    }
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp'})[extname(file)]||'application/octet-stream'});res.end(bytes);
  }catch(error){errors.push(String(error));res.writeHead(500);res.end('Synthetic test failure');}
});
let browser;
try {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const base=`http://127.0.0.1:${server.address().port}`;
  const visit=async(id)=>{await page.goto(base+'/data-core/counseling/competitions'+(id?'?awardFolder='+id:''));await page.waitForFunction(()=>document.querySelector('#awardActivityList')?.textContent!=='불러오는 중...'&&document.querySelector('#openAwardFolderBtn')?.onclick);};
  const create=async(button,title)=>{
    await page.locator(button).click();await page.locator('#awardFolderTitle').fill(title);await page.locator('#awardFolderTitle').press('Enter');
    await page.waitForFunction(title=>document.querySelector('#selectedAwardFolderTitle')?.textContent===title,title);
    return new URL(page.url()).searchParams.get('awardFolder');
  };
  await visit();
  const root=await create('#openAwardFolderBtn','SYNTHETIC 청강 2026');
  const child=await create('#openAwardChildBtn','SYNTHETIC 2026');
  const leaf=await create('#openAwardChildBtn','SYNTHETIC 고3 긴 한글 폴더 이름');
  assert.equal(await page.locator('#awardBreadcrumb button').count(),4);
  await page.reload();await page.locator('#awardBreadcrumb button').nth(3).waitFor();
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#selectedAwardFolderTitle')?.textContent==='SYNTHETIC 2026');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#selectedAwardFolderTitle')?.textContent==='SYNTHETIC 고3 긴 한글 폴더 이름');
  const publicRoot=await create('#openPublicAwardFolderBtn','SYNTHETIC 공개 2');
  await create('#openPublicAwardFolderBtn','SYNTHETIC 공개 10');
  assert.deepEqual(await page.locator('#publicAwardFolderList strong').allTextContents(),['SYNTHETIC 공개 2','SYNTHETIC 공개 10']);
  await page.locator('#awardSortPublic').selectOption('desc');
  assert.deepEqual(await page.locator('#publicAwardFolderList strong').allTextContents(),['SYNTHETIC 공개 10','SYNTHETIC 공개 2']);
  await visit(leaf);assert.equal(await page.locator('#awardSortPublic').inputValue(),'desc');
  await page.locator('#openAwardUploadBtn').click();
  const name='한글 수상작 (최종) 같은 이름.png';
  await page.locator('#uploadFile').setInputFiles([{name,mimeType:'image/png',buffer:png},{name,mimeType:'image/png',buffer:png}]);
  await page.locator('#uploadSubmitBtn').click();await page.locator('#uploadModal').waitFor({state:'hidden'});
  await page.locator('#awardLibraryFiles [data-award-image]').nth(1).waitFor();
  assert.deepEqual(await page.locator('#awardLibraryFiles strong').allTextContents(),[name,name]);
  const stored=(await h.env.DB.prepare("SELECT * FROM file_objects WHERE data_record_id=? AND category='competition-material'").bind(leaf).all()).results;
  assert.equal(stored.length,2);assert.notEqual(stored[0].r2_key,stored[1].r2_key);
  const count=async()=>Number((await h.env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE resource_type='competition_award' AND action='file.download'").first()).n);
  assert.equal(await count(),0);
  await page.locator('#awardLibraryFiles [data-award-image]').first().click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');assert.equal(await count(),0);
  const pending=page.waitForEvent('download');await page.locator('[data-award-download]').first().click();const download=await pending;
  assert.equal(download.suggestedFilename(),name);await download.saveAs(resolve(out,'synthetic-download.png'));assert.deepEqual(await readFile(resolve(out,'synthetic-download.png')),png);assert.equal(await count(),1);
  for(const width of [1920,1440,1024,820,768,430,390,320]) {
    await page.setViewportSize({width,height:1000});await visit(leaf);
    await page.locator('#awardLibraryFiles [data-award-image]').first().scrollIntoViewIfNeeded();
    await page.locator('#awardLibraryFiles img').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('#awardLibraryFiles img')].every(img=>img.complete&&img.naturalWidth>0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
    const enrolled=await page.locator('.award-collection').nth(0).boundingBox(),pub=await page.locator('.award-collection').nth(1).boundingBox();
    assert.ok(pub.y>=enrolled.y+enrolled.height-1,'groups stacked');
    await page.screenshot({path:resolve(out,`awards-${width}.png`),fullPage:true});result.widths.push(width);
  }
  result.flows.push('two groups, independent numeric sorting/persistence, depth3, back/forward/reload, duplicate Korean filenames, lightbox, download bytes/name, preview not audited');
  await page.setViewportSize({width:1024,height:1000});
  for(const user of [users.master,users.campusAdmin,users.teacher,users.staff]) {
    role=user;await visit(publicRoot);const id=await create('#openAwardChildBtn','SYNTHETIC role '+user.id);
    await page.locator('#openAwardUploadBtn').click();await page.locator('#uploadFile').setInputFiles({name:'역할 검증.png',mimeType:'image/png',buffer:png});await page.locator('#uploadSubmitBtn').click();await page.locator('#uploadModal').waitFor({state:'hidden'});
    await page.locator('#deleteAwardFolderBtn').click();await page.waitForFunction(()=>document.querySelector('#selectedAwardFolderTitle')?.textContent==='SYNTHETIC 공개 2');
    assert.ok((await h.env.DB.prepare('SELECT deleted_at FROM data_records WHERE id=?').bind(id).first()).deleted_at);
  }
  role=users.master;await visit(leaf);await page.locator('#selectAllAwardsBtn').click();await page.locator('#deleteSelectedAwardsBtn').click();await page.locator('#confirmAwardDeleteBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('#awardLibraryFiles [data-award-image]').length===0);
  for(const file of stored){assert.deepEqual(Buffer.from(await (await h.env.FILES.get(file.r2_key)).arrayBuffer()),png);assert.ok((await h.file(file.id)).deleted_at);await h.request('POST',`/api/data-core/trash/files/${file.id}/restore`,users.master);}
  await visit(root);await page.locator('#deleteAwardFolderBtn').click();await page.waitForFunction(()=>document.querySelector('#selectedAwardFolderTitle')?.textContent==='수상작 폴더를 선택하세요');
  await page.goto(base+'/data-core/operations');await page.locator(`[data-award-restore="${root}"]`).click();await page.locator(`[data-award-restore="${root}"]`).waitFor({state:'detached'});
  await visit(leaf);await page.locator('#awardLibraryFiles [data-award-image]').nth(1).waitFor();
  assert.equal((await h.request('GET',`/api/data-core/awards/folders/${child}`,users.staff)).status,200);
  result.flows.push('MASTER/CAMPUS_ADMIN/TEACHER/STAFF UI create/upload/delete; selection trash; MASTER operations folder restore; original bytes preserved');
  role=users.outsider;await visit();await page.locator('#openAwardFolderBtn').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);result.checkedAssets=[...checked];result.errors=errors;
} finally {await browser?.close();await new Promise(r=>server.close(r));await h.mf.dispose();await writeFile(resolve(out,'report.json'),JSON.stringify({...result,errors},null,2));}
console.log(JSON.stringify(result,null,2));

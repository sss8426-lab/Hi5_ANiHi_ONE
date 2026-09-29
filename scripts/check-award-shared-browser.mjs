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
const errors=[],checked=new Set(),result={remoteAssets:remote,backend:'isolated synthetic Worker',protectedAssets:[],widths:[],flows:[]};
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
      const deployed=Buffer.from(await r.arrayBuffer());
      if(path==='/data-core/operations.html') {
        // The real unauthenticated Preview returns the login shell. Do not bypass it
        // or claim that the protected page's bytes were compared remotely.
        assert.match(deployed.toString(),/<title>DATA CORE 로그인<\/title>/);
        assert.ok(!deployed.toString().includes('awardTrashPanel'));
        result.protectedAssets.push(path);
      } else assert.equal(hash(deployed),hash(bytes),'Remote asset mismatch '+path);
      checked.add(path);
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
  const visit=async(id,publicId)=>{await page.goto(base+'/data-core/counseling/competitions'+(id?'?awardFolder='+id:'')+(publicId?'&enrolledAwardFolder='+id+'&publicAwardFolder='+publicId:''));await page.waitForFunction(()=>document.querySelector('#awardActivityList')?.textContent!=='불러오는 중...'&&document.querySelector('#openAwardFolderBtn')?.onclick);};
  const create=async(button,title,type='enrolled')=>{
    await page.locator(button).click();await page.locator('#awardFolderTitle').fill(title);await page.locator('#awardFolderTitle').press('Enter');
    await page.waitForFunction(({title,type})=>document.querySelector((type==='public'?'#public-awardBreadcrumb':'#awardBreadcrumb')+' [aria-current=page]')?.textContent===title,{title,type});
    return new URL(page.url()).searchParams.get('awardFolder');
  };
  await visit();
  assert.equal(await page.locator('#awardFolderDetail').isHidden(),true);
  assert.equal(await page.locator('.award-classify, [id$="saveAwardCollectionBtn"], [id$="selectedAwardFolderTitle"]').count(),0);
  const checkCollectionLayout=async(type)=>{
    const detailId=type==='public'?'#public-awardFolderDetail':'#awardFolderDetail';
    assert.equal(await page.locator(detailId).count(),1);
    assert.equal(await page.locator(detailId).evaluate(el=>el.parentElement.dataset.awardCollection),type);
    const collection=page.locator(`[data-award-collection="${type}"]`);
    const track=await collection.locator(type==='public'?'.award-public-track':'.award-folder-navigation').boundingBox();
    const detail=await page.locator(detailId).boundingBox();
    assert.ok(detail.y>=track.y+track.height-1,'detail follows its own folder selector');
    if(type==='enrolled') {
      const pub=await page.locator('#awardPublicCollection').boundingBox();
      assert.ok(pub.y>=detail.y+detail.height-1,'public collection follows enrolled gallery');
    }
  };
  const root=await create('#openAwardFolderBtn','SYNTHETIC 청강 2026');
  const child=await create('#openAwardChildBtn','SYNTHETIC 2026');
  const leaf=await create('#openAwardChildBtn','SYNTHETIC 고3 긴 한글 폴더 이름');
  assert.equal(await page.locator('#awardBreadcrumb button').count(),4);
  await page.reload();await page.locator('#awardBreadcrumb button').nth(3).waitFor();
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#awardBreadcrumb [aria-current=page]')?.textContent==='SYNTHETIC 2026');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#awardBreadcrumb [aria-current=page]')?.textContent==='SYNTHETIC 고3 긴 한글 폴더 이름');
  const publicRoot=await create('#openPublicAwardFolderBtn','SYNTHETIC 공개 2','public');
  await create('#openPublicAwardFolderBtn','SYNTHETIC 공개 10','public');
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
  await page.locator('#awardSlideshow img:not([hidden])').waitFor();
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
  assert.equal(await page.locator('#awardSlideshow [data-slide-prev]').isDisabled(),true);
  await page.locator('#awardLibraryFiles [data-award-image]').nth(1).click();
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'2 / 2');
  assert.equal(await page.locator('#awardLibraryFiles [aria-current=true]').getAttribute('data-award-image'),await page.locator('#awardLibraryFiles [data-award-image]').nth(1).getAttribute('data-award-image'));
  await page.locator('#awardSlideshow [data-slide-prev]').click();assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
  await page.locator('#awardSlideshow .award-slide-stage').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#awardSlideshow output').textContent(),'2 / 2');
  await page.keyboard.press('Home');assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
  const stage=await page.locator('#awardSlideshow .award-slide-stage').boundingBox();
  await page.mouse.move(stage.x+stage.width*.7,stage.y+stage.height*.5);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.3,stage.y+stage.height*.5,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'2 / 2');
  await page.locator('#awardSlideshow [data-slide-open]:not(:disabled)').click();await page.locator('.core-image-gallery').waitFor();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');assert.equal(await count(),0);
  assert.equal(await page.locator('#awardBreadcrumb [aria-current=page]').textContent(),'SYNTHETIC 고3 긴 한글 폴더 이름');
  assert.equal(await page.locator('#awardBreadcrumb [aria-current=page]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(33, 90, 183)');
  for(const heading of await page.locator('.award-collection h4').all())assert.ok(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=22));
  const pending=page.waitForEvent('download');await page.locator('#awardLibraryFiles [data-award-download]').first().click();const download=await pending;
  assert.equal(download.suggestedFilename(),name);await download.saveAs(resolve(out,'synthetic-download.png'));assert.deepEqual(await readFile(resolve(out,'synthetic-download.png')),png);assert.equal(await count(),1);
  await page.locator('#awardSlideshow [data-slide-next]').click();
  await page.locator('#publicAwardFolderList [data-award-folder-id="'+publicRoot+'"]').click();
  await page.locator('#public-awardBreadcrumb [aria-current=page]').getByText('SYNTHETIC 공개 2',{exact:true}).waitFor();
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'2 / 2');
  await page.locator('#public-openAwardUploadBtn').click();
  const publicPng=await sharp({create:{width:720,height:480,channels:3,background:'#b84d68'}}).png().toBuffer();
  await page.locator('#uploadFile').setInputFiles([{name:'공개 합성1.png',mimeType:'image/png',buffer:publicPng},{name:'공개 합성2.png',mimeType:'image/png',buffer:publicPng}]);
  await page.locator('#uploadSubmitBtn').click();await page.locator('#uploadModal').waitFor({state:'hidden'});
  await page.locator('#public-awardSlideshow img:not([hidden])').waitFor();
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'2 / 2');
  await page.locator('#public-awardSlideshow [data-slide-next]').click();
  assert.equal(await page.locator('#public-awardSlideshow output').textContent(),'2 / 2');
  await page.locator('#awardSlideshow [data-slide-prev]').click();
  assert.equal(await page.locator('#public-awardSlideshow output').textContent(),'2 / 2');
  await page.locator('#awardSortPublic').selectOption('asc');
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
  assert.equal(await page.locator('#public-awardSlideshow output').textContent(),'2 / 2');
  await page.reload();
  await page.locator('#awardSlideshow img:not([hidden])').waitFor();
  await page.locator('#public-awardSlideshow img:not([hidden])').waitFor();
  assert.equal(await page.locator('#awardFolderDetail').isVisible(),true);
  assert.equal(await page.locator('#public-awardFolderDetail').isVisible(),true);
  assert.ok(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);return new Set(ids).size===ids.length;}),'no duplicate DOM ids');
  result.flows.push('two simultaneous independent galleries; public upload, sorting and slideshow preserve enrolled selection; enrolled slideshow preserves public selection; both folders survive reload');
  const originals=new RegExp('/api/data-core/files/('+stored.map(file=>file.id).join('|')+')$');
  await page.route(originals,route=>route.fulfill({status:503,body:'Synthetic outage'}));
  await visit(leaf);await page.locator('#awardSlideshow [data-slide-retry]:not([hidden])').waitFor();
  assert.equal(await page.locator('#awardSlideshow img').isHidden(),true);
  await page.unroute(originals);await page.locator('#awardSlideshow [data-slide-retry]').click();
  await page.locator('#awardSlideshow img:not([hidden])').waitFor();
  await page.route(originals,route=>route.fulfill({status:403,body:'Synthetic permission denial'}));
  await visit(leaf);await page.getByText('이미지 접근 권한을 다시 확인해 주세요.',{exact:true}).waitFor();
  assert.equal(await page.locator('#awardSlideshow').isHidden(),true);
  assert.equal(await page.locator('#awardLibraryFiles img[src]').count(),0);
  await page.unroute(originals);
  result.flows.push('real DOM 503 failure/retry and 403 image/cache removal; no permission bypass');
  for(const width of [1920,1440,1024,820,768,430,390,320]) {
    await page.setViewportSize({width,height:1000});await visit(leaf,publicRoot);
    await page.locator('#awardLibraryFiles [data-award-image]').first().scrollIntoViewIfNeeded();
    await page.locator('#awardLibraryFiles img').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('#awardLibraryFiles img')].every(img=>img.complete&&img.naturalWidth>0));
    await page.locator('#awardSlideshow img:not([hidden])').waitFor();
    assert.equal(await page.locator('#awardSlideshow img').evaluate(el=>getComputedStyle(el).objectFit),'contain');
    const gallery=await page.locator('#awardSlideshow').boundingBox(),strip=await page.locator('#awardLibraryFiles').boundingBox();
    assert.ok(strip.y>=gallery.y+gallery.height,'thumbnails below large image');
    assert.ok(await page.locator('#awardSlideshow .award-slide-stage').evaluate(el=>el.clientHeight>100));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);
    const enrolled=await page.locator('.award-collection').nth(0).boundingBox(),pub=await page.locator('.award-collection').nth(1).boundingBox();
    assert.ok(pub.y>=enrolled.y+enrolled.height-1,'groups stacked');
    await page.locator('#public-awardSlideshow img:not([hidden])').waitFor();
    await checkCollectionLayout('enrolled');
    await checkCollectionLayout('public');
    await page.screenshot({path:resolve(out,`awards-${width}.png`),fullPage:true});result.widths.push(width);
  }
  result.flows.push('two groups, independent numeric sorting/persistence, depth3, blue current breadcrumb, 22px collection headings, back/forward/reload, duplicate Korean filenames, inline first image, thumbnails, arrows/keyboard/swipe, synchronized lightbox, download bytes/name, preview not audited');
  const longTitle='SYNTHETIC 2026 청강대학교 공모전 수상작 VeryLongFolderName1234567890'.repeat(2);
  for(const parent of [root,publicRoot]) {
    const created=await h.request('POST','/api/data-core/awards/folders',users.master,{title:longTitle,parentFolderId:parent});
    assert.equal(created.status,201);
  }
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:1000});await visit(root,publicRoot);
    for(const type of ['enrolled','public']) {
      const collection=page.locator(`[data-award-collection="${type}"]`);
      await collection.locator('.award-child-list button').filter({hasText:longTitle}).waitFor();
      const children=await collection.locator('.award-child-list').boundingBox();
      const actions=await collection.locator('.award-folder-toolbar .row-actions').boundingBox();
      assert.ok(actions.x>=children.x+children.width-1 || actions.y>=children.y+children.height-1,'children/actions do not overlap '+type+' '+width);
      for(const button of await collection.locator('.award-folder-toolbar button').all()) {
        const box=await button.boundingBox();
        assert.ok(box.x>=0&&box.x+box.width<=width+1,'toolbar button stays in viewport');
      }
      assert.equal(await collection.locator('.award-child-list button').filter({hasText:longTitle}).getAttribute('title'),longTitle);
      assert.equal(await collection.locator('.award-child-list button strong').last().evaluate(el=>getComputedStyle(el).webkitLineClamp),'2');
      if(width===1440)assert.ok(actions.x>=children.x+children.width-1,'desktop children left/actions right');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'navigation overflow '+width);
    await page.screenshot({path:resolve(out,`navigation-${width}.png`),fullPage:true});
  }
  const publicTrack=page.locator('#publicAwardFolderTrack');
  await publicTrack.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event('scroll'));});
  const enrolledScroll=await page.locator('#awardFolderTrack').evaluate(el=>el.scrollLeft);
  await page.locator('#publicAwardFolderNext').click();
  await page.waitForFunction(()=>document.querySelector('#publicAwardFolderTrack').scrollLeft>0);
  assert.equal(await page.locator('#awardFolderTrack').evaluate(el=>el.scrollLeft),enrolledScroll);
  await page.locator('#publicAwardFolderPrev').click();
  await page.waitForFunction(()=>document.querySelector('#publicAwardFolderTrack').scrollLeft<=1);
  result.flows.push('no classification UI or redundant title; wrapped two-line child folders left/actions right; mobile controls do not overlap; public folder arrows do not move enrolled strip');
  await visit(leaf,publicRoot);await page.locator('#public-awardLibraryFiles [data-award-select]').first().waitFor();
  await page.locator('#public-awardLibraryFiles [data-award-select]').first().check();
  await page.locator('#public-deleteSelectedAwardsBtn').click();
  assert.match(await page.locator('#awardDeleteSummary').textContent(),/SYNTHETIC 공개 2/);
  await page.locator('#confirmAwardDeleteBtn').click();
  await page.waitForFunction(()=>document.querySelector('#public-awardSlideshow output')?.textContent==='1 / 1');
  assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
  assert.equal(await page.locator('#awardLibraryFiles [data-award-image]').count(),2);
  result.flows.push('public selection deletion changes only public files while enrolled gallery remains intact');
  await page.setViewportSize({width:1024,height:1000});
  for(const user of [users.master,users.campusAdmin,users.teacher,users.staff]) {
    role=user;await visit(leaf,publicRoot);const id=await create('#public-openAwardChildBtn','SYNTHETIC role '+user.id,'public');
    await page.locator('#public-openAwardUploadBtn').click();await page.locator('#uploadFile').setInputFiles({name:'역할 검증.png',mimeType:'image/png',buffer:png});await page.locator('#uploadSubmitBtn').click();await page.locator('#uploadModal').waitFor({state:'hidden'});
    await page.locator('#public-awardSlideshow img:not([hidden])').waitFor();assert.equal(await page.locator('#public-awardSlideshow output').textContent(),'1 / 1');
    assert.equal(await page.locator('#public-awardSlideshow [data-slide-prev]').isDisabled(),true);assert.equal(await page.locator('#public-awardSlideshow [data-slide-next]').isDisabled(),true);
    await checkCollectionLayout('public');
    await page.locator('#public-deleteAwardFolderBtn').click();await page.waitForFunction(()=>document.querySelector('#public-awardBreadcrumb [aria-current=page]')?.textContent==='SYNTHETIC 공개 2');
    assert.equal(await page.locator('#awardSlideshow output').textContent(),'1 / 2');
    assert.ok((await h.env.DB.prepare('SELECT deleted_at FROM data_records WHERE id=?').bind(id).first()).deleted_at);
  }
  role=users.master;await visit(leaf);await page.locator('#selectAllAwardsBtn').click();await page.locator('#deleteSelectedAwardsBtn').click();await page.locator('#confirmAwardDeleteBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('#awardLibraryFiles [data-award-image]').length===0);
  assert.equal(await page.locator('#awardSlideshow').isHidden(),true);
  for(const file of stored){assert.deepEqual(Buffer.from(await (await h.env.FILES.get(file.r2_key)).arrayBuffer()),png);assert.ok((await h.file(file.id)).deleted_at);await h.request('POST',`/api/data-core/trash/files/${file.id}/restore`,users.master);}
  await visit(root);await page.locator('#deleteAwardFolderBtn').click();await page.locator('#awardFolderDetail').waitFor({state:'hidden'});
  await page.goto(base+'/data-core/operations');await page.locator(`[data-award-restore="${root}"]`).click();await page.locator(`[data-award-restore="${root}"]`).waitFor({state:'detached'});
  await visit(leaf);await page.locator('#awardLibraryFiles [data-award-image]').nth(1).waitFor();
  assert.equal((await h.request('GET',`/api/data-core/awards/folders/${child}`,users.staff)).status,200);
  result.flows.push('MASTER/CAMPUS_ADMIN/TEACHER/STAFF UI create/upload/delete; selection trash; MASTER operations folder restore; original bytes preserved');
  const legacy=(await h.request('POST','/api/data-core/records',users.master,{recordType:'competition-award-folder',sourceApp:'competition',title:'SYNTHETIC 미분류 기존 폴더'})).body.record;
  role=users.staff;await visit(legacy.id);const legacyChild=await create('#openAwardChildBtn','SYNTHETIC 미분류 하위 폴더');
  assert.equal((await h.request('GET',`/api/data-core/awards/folders/${legacyChild}`,users.staff)).body.record.collectionType,null);
  result.flows.push('legacy unclassified root permits staff child creation without changing classification');
  role=users.outsider;await visit();await page.locator('#openAwardFolderBtn').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);result.checkedAssets=[...checked].filter(path=>!result.protectedAssets.includes(path));result.errors=errors;
} finally {await browser?.close();await new Promise(r=>server.close(r));await h.mf.dispose();await writeFile(resolve(out,'report.json'),JSON.stringify({...result,errors},null,2));}
console.log(JSON.stringify(result,null,2));

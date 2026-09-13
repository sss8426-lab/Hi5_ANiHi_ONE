// Browser UI uses real Worker APIs backed only by ephemeral synthetic D1/R2.
// --preview validates deployed static assets; no mutation is sent to Cloudflare.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { libraryHarness, users, A, B } from '../tests/support/library-harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv[process.argv.indexOf('--preview') + 1];
const previewOrigin = process.argv.includes('--preview') ? new URL(preview).origin : null;
const out = resolve('outputs/library-browser' + (previewOrigin ? '-preview' : ''));
await mkdir(out, { recursive: true });
const h = await libraryHarness(); let role = users.admin;
const fixtures = {}, checked = new Set();
const imageNetwork=[];let activeImages=0,peakImages=0;
const create = async(parent, title, user) => { const r=await h.folder(parent,'__synthetic_'+title,user); assert.equal(r.status,201,JSON.stringify(r.body)); return r.body.folder.id; };
fixtures.a = await create(`category:${A}:admission-material`, '합성 입시 자료', users.staff);
fixtures.b = await create(`category:${B}:admission-material`, '합성 공유 자료', users.foreign);
fixtures.hq = await create('hq', '합성 본원 자료', users.admin);
await h.upload(fixtures.b, users.foreign);
let deep = fixtures.a;
for(let i=0;i<8;i++) deep=await create(deep, `단계 ${i+1} 긴 한글 폴더 이름`, users.staff);
const server = createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    // This suite tests library images, not the availability of unrelated external news providers.
    if(/^\/api\/data-core\/competition-sources\/[^/]+\/preview$/.test(url.pathname)) {
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({sourceName:'Synthetic source',items:[],warnings:[]}));return;
    }
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('origin','http://localhost');headers.set('oai-authenticated-user-id',role.id);headers.set('oai-authenticated-user-email',role.email);headers.set('oai-authenticated-user-full-name','Synthetic Library');
      const imageRequest=req.method==='GET'&&/^\/api\/data-core\/(library\/)?files\/[^/]+$/.test(url.pathname);
      if(imageRequest){activeImages++;peakImages=Math.max(peakImages,activeImages);}
      try {
        const response=await h.raw(req.method,url.pathname+url.search,role,
          chunks.length ? (headers.get('content-type')?.includes('multipart/form-data') ? await new Response(Buffer.concat(chunks),{headers}).formData() : JSON.parse(Buffer.concat(chunks).toString())) : undefined,
          'http://localhost',req.headers['if-none-match'] ? {'if-none-match':req.headers['if-none-match']} : {});
        const bytes=Buffer.from(await response.arrayBuffer());
        if(imageRequest)imageNetwork.push({path:url.pathname,status:response.status,bytes:bytes.length});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);return;
      } finally {if(imageRequest)activeImages--;}
    }
    const path = url.pathname === '/data-core/work/library' ? '/data-core/index.html' : url.pathname;
    const file = resolve('public', '.'+path);
    if(!file.startsWith(resolve('public')+sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);
    if(previewOrigin && path.startsWith('/data-core/') && !checked.has(path)) {
      const remote=await fetch(previewOrigin+path+'?library-smoke=1');assert.equal(remote.status,200,path);
      const hash=x=>createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(path) ? x.toString('utf8').replace(/\r\n/g,'\n') : x).digest('hex');
      assert.equal(hash(Buffer.from(await remote.arrayBuffer())),hash(bytes),`Preview asset mismatch ${path}`);checked.add(path);
    }
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.json':'application/json'};
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(bytes);
  } catch(e){res.writeHead(500,{'content-type':'text/plain'});res.end('Synthetic harness error');errors.push(String(e));}
});
const errors=[],consoleErrors=[];let expectedThumbnailFailure=false,expectedFolderConflict=false;
const result={preview:previewOrigin, viewports:[], flows:[]};
const browser=await chromium.launch({headless:true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error'&&!(expectedThumbnailFailure&&message.text().includes('400'))&&!(expectedFolderConflict&&message.text().includes('409')))consoleErrors.push({message:message.text(),url:message.location().url});});
  const visit=async(id='root')=>{await page.goto(base+'/data-core/work/library'+(id==='root'?'':'?folder='+encodeURIComponent(id)));await page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false'&&document.querySelector('#libraryBreadcrumb [aria-current]'));};
  const settled=()=>page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false');
  if(!process.argv.includes('--images-only')) {
  await visit();
  assert.equal(await page.locator('#legacyLibrary').isVisible(),false);
  const noCommon=async()=>{
    assert.equal(await page.getByRole('heading',{name:'공통',exact:true}).count(),0);
    assert.equal(await page.locator('#libraryFolders [data-lb-folder="organization"]').count(),0);
    assert.equal(await page.locator('#libraryFolders [data-lb-folder="campus:campus-synthetic-acceptance-20260909"]').count(),0);
  };
  await noCommon();assert.equal(await page.locator('#libraryNew').isVisible(),true);
  await page.locator('#libraryNew').click();await page.locator('#libraryFolderName').fill('__synthetic_root_browser');await page.locator('#libraryCreate').click();
  await page.getByRole('link',{name:'__synthetic_root_browser',exact:true}).click();await settled();
  const customRoot=new URL(page.url()).searchParams.get('folder');assert.ok(customRoot);
  await page.reload();await settled();assert.equal(await page.locator('#libraryTitle').innerText(),'__synthetic_root_browser');
  await page.goBack();await settled();await noCommon();
  await page.goForward();await settled();assert.equal(new URL(page.url()).searchParams.get('folder'),customRoot);
  await page.locator('#libraryUp').click();await settled();await noCommon();
  await page.getByLabel('__synthetic_root_browser 폴더 메뉴').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.lb-folder-menu[open]').count(),0);
  for(const user of [users.director,users.teacher,users.staff]) {
    role=user;await visit();await noCommon();await page.reload();await settled();await noCommon();
    assert.equal(await page.locator('#libraryNew').isVisible(),false);assert.equal(await page.locator('.lb-folder-menu').count(),0);
    assert.equal(await page.locator('#libraryDeleteFolder').isVisible(),false);
    await page.getByRole('link',{name:'__synthetic_root_browser',exact:true}).click();await settled();assert.equal(await page.locator('#libraryNew').isVisible(),false);
    await page.goBack();await settled();await noCommon();
  }
  role=users.admin;await visit();await noCommon();assert.equal(await page.locator('#libraryNew').isVisible(),true);
  await page.getByLabel('__synthetic_root_browser 폴더 메뉴').click();await page.locator(`[data-lb-delete-folder="${customRoot}"]`).click();
  assert.equal(await page.locator('#libraryDeleteTitle').innerText(),'"__synthetic_root_browser" 폴더를 삭제하시겠습니까?');
  await page.locator('#libraryDeleteConfirm').click();await page.getByRole('link',{name:'__synthetic_root_browser',exact:true}).waitFor({state:'detached'});
  assert.ok((await h.env.DB.prepare('SELECT deleted_at FROM data_records WHERE id=?').bind(customRoot).first()).deleted_at);
  result.flows.push('admin root create/open/menu/delete; director/teacher/staff no root controls; common absent across role changes, refresh, back/forward');
  await page.locator(`[data-lb-folder="campus:${A}"]`).click();await settled();
  await page.locator(`[data-lb-folder="category:${A}:admission-material"]`).click();await settled();
  await page.locator(`[data-lb-folder="${fixtures.a}"]`).click();await settled();
  await page.locator('#libraryNew').click();await page.locator('#libraryFolderName').fill('__synthetic_새 하위 폴더');await page.locator('#libraryCreate').click();
  await page.getByRole('link',{name:'__synthetic_새 하위 폴더',exact:true}).waitFor();
  await page.getByRole('link',{name:'__synthetic_새 하위 폴더',exact:true}).press('Space');await settled();
  const current=new URL(page.url()).searchParams.get('folder');assert.ok(current&&current!==fixtures.a);
  await page.reload();await settled();assert.equal(new URL(page.url()).searchParams.get('folder'),current);
  await page.goBack();await settled();assert.equal(new URL(page.url()).searchParams.get('folder'),fixtures.a);
  await page.goForward();await settled();assert.equal(new URL(page.url()).searchParams.get('folder'),current);
  await page.locator('#libraryFileInput').setInputFiles({name:'한글 원본 자료.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic browser file')});
  await page.locator('#libraryCloseProgress').waitFor({state:'visible'});await page.locator('#libraryCloseProgress').click();
  await page.locator('.lb-file').waitFor();assert.equal(await page.locator('.lb-file-main strong').innerText(),'한글 원본 자료.txt');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'다운로드',exact:true}).click();const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'한글 원본 자료.txt');
  const previewPage=page.waitForEvent('popup');await page.getByRole('link',{name:'미리보기',exact:true}).click();const popup=await previewPage;await popup.waitForLoadState();assert.match(await popup.locator('body').innerText(),/synthetic browser file/);await popup.close();
  const fid=await page.locator('.lb-file').getAttribute('data-library-file');
  await page.getByRole('button',{name:'삭제',exact:true}).click();await page.getByRole('button',{name:'휴지통으로 이동',exact:true}).click();
  await page.locator('.lb-file').waitFor({state:'detached'});assert.equal((await h.file(fid)).deleted_at!==null,true);
  assert.equal((await h.request('POST',`/api/data-core/trash/files/${fid}/restore`,users.admin)).status,200);
  await page.locator('#libraryRefresh').click();await page.locator('.lb-file').waitFor();
  expectedFolderConflict=true;
  await page.locator('#libraryDeleteFolder').click();await page.locator('#libraryDeleteConfirm').click();await page.getByText('폴더 안에 자료가 있습니다. 내부 자료를 먼저 정리해주세요.',{exact:true}).waitFor();await page.keyboard.press('Escape');
  expectedFolderConflict=false;
  result.flows.push('navigate, breadcrumb, new folder, Space, refresh, back/forward, upload progress, Unicode download, preview, soft-trash/restore, nonempty409');
  await visit(fixtures.hq);await page.locator('#libraryNew').click();await page.locator('#libraryFolderName').fill('__synthetic_빈 본원 폴더');await page.locator('#libraryCreate').click();await page.getByRole('link',{name:'__synthetic_빈 본원 폴더',exact:true}).click();await settled();await page.locator('#libraryDeleteFolder').click();await page.locator('#libraryDeleteConfirm').click();await page.waitForURL('**folder='+fixtures.hq);await settled();
  role=users.staff;await visit(fixtures.b);assert.equal(await page.locator('#libraryNew').isVisible(),false);assert.equal(await page.locator('#libraryUpload').isVisible(),false);assert.equal(await page.locator('[data-lb-delete]').count(),0);await page.getByRole('link',{name:'다운로드',exact:true}).waitFor();
  result.flows.push('HQ empty-folder delete; foreign browse/download with no mutation controls');
  const foreignDownload=page.waitForEvent('download');await page.getByRole('link',{name:'다운로드',exact:true}).click();assert.equal((await foreignDownload).suggestedFilename(),'검증 자료.txt');
  for(const width of [1920,1440,1024,820,390,320]) {
    await page.setViewportSize({width,height:width<500?900:1080});await visit(deep);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
    await page.screenshot({path:resolve(out,`nested-${width}.png`),fullPage:true});
    await visit();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`root overflow ${width}`);
    await page.screenshot({path:resolve(out,`root-${width}.png`),fullPage:true});result.viewports.push(width);
  }
  role=users.admin;await create('root','최상위 메뉴 반응형 검증',users.admin);
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});await visit();await page.getByLabel('__synthetic_최상위 메뉴 반응형 검증 폴더 메뉴').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`root menu overflow ${width}`);
    assert.ok(await page.locator('.lb-folder-menu[open] button').evaluate(el=>{
      const r=el.getBoundingClientRect();return r.width>=100&&r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;
    }),`root menu label clipped ${width}`);
    await page.screenshot({path:resolve(out,`admin-root-menu-${width}.png`),fullPage:true});
  }
  }
  role=users.staff;
  const imagesFolder=await create(`category:${A}:admission-material`,'이미지 썸네일 검증',users.staff);
  const pixels=Buffer.alloc(1800*2300*3);let seed=12345;
  for(let i=0;i<pixels.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels[i]=seed&255;}
  const jpeg=await sharp(pixels,{raw:{width:1800,height:2300,channels:3}}).jpeg({quality:90}).toBuffer();
  const solid=sharp({create:{width:240,height:180,channels:3,background:'#69ad88'}});
  for(const format of ['png','webp','avif','gif']) {
    const uploaded=await h.upload(imagesFolder,role,{name:`synthetic.${format}`,mime:`image/${format}`,bytes:await solid.clone().toFormat(format).toBuffer()});assert.equal(uploaded.status,201);
  }
  await h.upload(imagesFolder,role,{name:'synthetic.pdf',mime:'application/pdf',bytes:Buffer.from('%PDF-1.4 synthetic')});
  await h.upload(imagesFolder,role,{name:'synthetic.txt'});
  await h.upload(imagesFolder,role,{name:'broken.png',mime:'image/png',bytes:Buffer.from('broken synthetic')});
  const originals=[];
  for(let i=0;i<10;i++){const uploaded=await h.upload(imagesFolder,role,{name:`synthetic-large-${i}.jpg`,mime:'image/jpeg',bytes:jpeg});assert.equal(uploaded.status,201);originals.push(uploaded.body.file.id);}
  await page.setViewportSize({width:1440,height:1000});imageNetwork.length=0;peakImages=0;await visit(imagesFolder);
  await page.screenshot({path:resolve(out,'images-entry.png')});
  await page.waitForFunction(()=>document.querySelectorAll('.lb-image-ready').length>=2);
  assert.ok(imageNetwork.length<15,'offscreen images must not all fetch at entry');assert.ok(peakImages<=3);
  result.imagePerformance={fixtureCount:10,originalBytes:jpeg.length,firstViewportRequests:imageNetwork.length,peakConcurrent:peakImages};
  const first=page.locator('.lb-thumbnail').first();
  const firstPath=new URL(await first.getAttribute('href'),base).pathname;
  let warmRequests;
  for(let n=0;n<2;n++){
    await first.click();await page.waitForFunction(()=>document.querySelector('.cig-image')?.naturalWidth===1800);
    assert.equal(await page.locator('.cig-counter').textContent(),'1 / 15');
    await page.locator('[data-cig-next]').click();assert.equal(await page.locator('.cig-counter').textContent(),'2 / 15');
    await page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden);
    await page.keyboard.press('Escape');
    const count=imageNetwork.filter(r=>r.path===firstPath).length;
    if(n===0)warmRequests=count;
    else assert.equal(count,warmRequests,'decoded original reused in the same folder');
  }
  await page.locator('#libraryUp').click();await settled();await page.goBack();await settled();await page.waitForFunction(()=>document.querySelectorAll('.lb-image-ready').length>=2);
  assert.ok(imageNetwork.filter(r=>r.status===304).length>=2);
  // New local File produces its thumbnail without downloading the original again.
  imageNetwork.length=0;
  await page.locator('#libraryFileInput').setInputFiles({name:'synthetic-new-original.jpg',mimeType:'image/jpeg',buffer:jpeg});
  await page.locator('#libraryCloseProgress').waitFor({state:'visible'});assert.match(await page.locator('#libraryProgressCount').innerText(),/완료 1개 · 실패 0개/);await page.locator('#libraryCloseProgress').click();
  let listing=(await h.list(imagesFolder,role)).body.files;
  const newFile=listing.find(f=>f.fileName==='synthetic-new-original.jpg');assert.ok(newFile?.thumbnailUrl);
  const newRow=await h.file(newFile.id);assert.deepEqual(Buffer.from(await (await h.env.FILES.get(newRow.r2_key)).arrayBuffer()),jpeg);
  const thumbId=newFile.thumbnailUrl.split('/').at(-1),thumbRow=await h.file(thumbId);
  const meta=JSON.parse((await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(thumbRow.data_record_id).first()).metadata_json);
  assert.equal(meta.derivedFromFileId,newFile.id);assert.equal(Math.max(meta.width,meta.height),480);assert.ok(thumbRow.size_bytes<jpeg.length);
  await page.locator(`[data-library-file="${newFile.id}"] .lb-image-ready`).waitFor();
  assert.equal(imageNetwork.filter(r=>r.path.endsWith('/'+newFile.id)).length,0,'thumbnail generation must not fetch original');
  result.imagePerformance.thumbnailBytes=thumbRow.size_bytes;result.imagePerformance.thumbnailDimensions=[meta.width,meta.height];
  await page.locator('#libraryRefresh').click();await settled();await page.locator(`[data-library-file="${newFile.id}"] .lb-image-ready`).waitFor();
  assert.ok(imageNetwork.some(r=>r.path===newFile.thumbnailUrl&&r.status===304&&r.bytes===0));
  result.imagePerformance.thumbnailRepeat={status:304,bodyBytes:0};
  // Fail only the optional derivative request; the original remains a successful single upload.
  expectedThumbnailFailure=true;
  await page.route('**/api/data-core/library/files/*/thumbnail',route=>route.fulfill({status:400,contentType:'application/json',body:'{"error":"synthetic thumbnail failure"}'}));
  await page.locator('#libraryFileInput').setInputFiles({name:'synthetic-fallback.jpg',mimeType:'image/jpeg',buffer:jpeg});
  await page.locator('#libraryCloseProgress').waitFor({state:'visible'});assert.match(await page.locator('#libraryProgressCount').innerText(),/완료 1개 · 실패 0개/);await page.locator('#libraryCloseProgress').click();await page.unroute('**/api/data-core/library/files/*/thumbnail');
  expectedThumbnailFailure=false;
  listing=(await h.list(imagesFolder,role)).body.files;assert.equal(listing.filter(f=>f.fileName==='synthetic-fallback.jpg').length,1);assert.equal(listing.find(f=>f.fileName==='synthetic-fallback.jpg').thumbnailUrl,null);
  for(const width of [1920,1440,1024,820,390,320]){
    await page.setViewportSize({width,height:width<500?900:1080});await visit(imagesFolder);await page.locator('.lb-image-ready').first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`image overflow ${width}`);
    const bounds=await page.locator('.lb-thumbnail').first().boundingBox();assert.equal(bounds.width,112);assert.equal(bounds.height,84);
    assert.equal(await page.locator('.lb-thumbnail img').first().evaluate(img=>getComputedStyle(img).objectFit),'cover');
    await page.screenshot({path:resolve(out,`images-${width}.png`)});
  }
  const broken=page.locator('.lb-file').filter({has:page.getByText('broken.png',{exact:true})});await broken.scrollIntoViewIfNeeded();await broken.locator('.lb-image-fallback').waitFor();assert.equal(await broken.locator('img').isVisible(),false);
  for(const format of ['png','webp','avif','gif']){
    const item=page.locator('.lb-file').filter({has:page.getByText(`synthetic.${format}`,{exact:true})});await item.scrollIntoViewIfNeeded();await item.locator('.lb-image-ready').waitFor();
  }
  for(const name of ['synthetic.pdf','synthetic.txt'])assert.equal(await page.locator('.lb-file').filter({has:page.getByText(name,{exact:true})}).locator('.lb-thumbnail').count(),0);
  result.flows.push('JPEG/PNG/WebP/AVIF/GIF thumbnails; PDF/document icons; broken fallback; click preview; lazy max3; revalidation304; 480px local WebP; optional failure preserves original; six image viewports');
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);result.errors=errors;result.consoleErrors=consoleErrors;result.previewAssetCount=checked.size;
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose(); }

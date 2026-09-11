// Browser UI uses real Worker APIs backed only by ephemeral synthetic D1/R2.
// --preview validates deployed static assets; no mutation is sent to Cloudflare.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { libraryHarness, users, A, B } from '../tests/support/library-harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv[process.argv.indexOf('--preview') + 1];
const previewOrigin = process.argv.includes('--preview') ? new URL(preview).origin : null;
const out = resolve('outputs/library-browser' + (previewOrigin ? '-preview' : ''));
await mkdir(out, { recursive: true });
const h = await libraryHarness(); let role = users.admin;
const fixtures = {}, checked = new Set();
const create = async(parent, title, user) => { const r=await h.folder(parent,title,user); assert.equal(r.status,201,JSON.stringify(r.body)); return r.body.folder.id; };
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
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('origin','http://localhost');headers.set('oai-authenticated-user-id',role.id);headers.set('oai-authenticated-user-email',role.email);headers.set('oai-authenticated-user-full-name','Synthetic Library');
      const response=await h.raw(req.method,url.pathname+url.search,role,
        chunks.length ? (headers.get('content-type')?.includes('multipart/form-data') ? await new Response(Buffer.concat(chunks),{headers}).formData() : JSON.parse(Buffer.concat(chunks).toString())) : undefined);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
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
const errors=[]; const result={preview:previewOrigin, viewports:[], flows:[]};
const browser=await chromium.launch({headless:true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  const visit=async(id='root')=>{await page.goto(base+'/data-core/work/library'+(id==='root'?'':'?folder='+encodeURIComponent(id)));await page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false'&&document.querySelector('#libraryBreadcrumb [aria-current]'));};
  const settled=()=>page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false');
  await visit();
  assert.equal(await page.locator('#legacyLibrary').isVisible(),false);
  await page.locator(`[data-lb-folder="campus:${A}"]`).click();await settled();
  await page.locator(`[data-lb-folder="category:${A}:admission-material"]`).click();await settled();
  await page.locator(`[data-lb-folder="${fixtures.a}"]`).click();await settled();
  await page.locator('#libraryNew').click();await page.locator('#libraryFolderName').fill('새 하위 폴더');await page.locator('#libraryCreate').click();
  await page.getByRole('link',{name:'새 하위 폴더',exact:true}).waitFor();
  await page.getByRole('link',{name:'새 하위 폴더',exact:true}).press('Space');await settled();
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
  await page.locator('#libraryDeleteFolder').click();await page.locator('#libraryDeleteConfirm').click();await page.getByText('폴더 안에 자료가 있습니다. 먼저 내부 자료를 정리하세요.',{exact:true}).waitFor();await page.keyboard.press('Escape');
  result.flows.push('navigate, breadcrumb, new folder, Space, refresh, back/forward, upload progress, Unicode download, preview, soft-trash/restore, nonempty409');
  await visit(fixtures.hq);await page.locator('#libraryNew').click();await page.locator('#libraryFolderName').fill('빈 본원 폴더');await page.locator('#libraryCreate').click();await page.getByRole('link',{name:'빈 본원 폴더',exact:true}).click();await settled();await page.locator('#libraryDeleteFolder').click();await page.locator('#libraryDeleteConfirm').click();await page.waitForURL('**folder='+fixtures.hq);await settled();
  role=users.staff;await visit(fixtures.b);assert.equal(await page.locator('#libraryNew').isVisible(),false);assert.equal(await page.locator('#libraryUpload').isVisible(),false);assert.equal(await page.locator('[data-lb-delete]').count(),0);await page.getByRole('link',{name:'다운로드',exact:true}).waitFor();
  result.flows.push('HQ empty-folder delete; foreign browse/download with no mutation controls');
  for(const width of [1920,1440,1024,820,390,320]) {
    await page.setViewportSize({width,height:width<500?900:1080});await visit(deep);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);
    await page.screenshot({path:resolve(out,`nested-${width}.png`),fullPage:true});
    await visit();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`root overflow ${width}`);
    await page.screenshot({path:resolve(out,`root-${width}.png`),fullPage:true});result.viewports.push(width);
  }
  assert.deepEqual(errors,[]);result.errors=errors;result.previewAssetCount=checked.size;
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose(); }

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {libraryHarness,users,A} from '../tests/support/library-harness.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/sis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const out=resolve('outputs/library-count-layout');await mkdir(out,{recursive:true});
const h=await libraryHarness(),errors=[],network=[];
const long='아주긴폴더이름한글영문LongNameABC1234567890'.repeat(2);
const root=`category:${A}:academy-photo`;
const make=async(parent,name)=>{const r=await h.folder(parent,name,users.staff);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.folder.id;};
const folder=await make(root,long),child=await make(folder,'중첩'+long);await make(root,'이동'+long);
const upload=await h.upload(folder,users.staff,{name:long+long+'.txt'});assert.equal(upload.status,201);
await h.upload(child,users.staff,{name:'nested.txt'});
let delay=0;
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
    const parts=[];for await(const part of req)parts.push(part);const headers=new Headers(req.headers);
    const body=parts.length?(headers.get('content-type')?.includes('multipart/form-data')?await new Response(Buffer.concat(parts),{headers}).formData():JSON.parse(Buffer.concat(parts).toString())):undefined;
    if(delay&&req.method==='POST'&&url.pathname==='/api/data-core/library/files')await new Promise(r=>setTimeout(r,delay));
    const response=await h.raw(req.method,url.pathname+url.search,users.staff,body);network.push({method:req.method,url:url.pathname+url.search,status:response.status});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const route=url.pathname==='/data-core/work/library'?'/data-core/index.html':/^\/data-core\/content\/(blog|instagram)$/.test(url.pathname)?'/data-core/content.html':url.pathname;
  const path=resolve('public','.'+route);if(!path.startsWith(resolve('public')+sep))throw Error('path');
  res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
}catch(e){errors.push(String(e));res.writeHead(500);res.end('Test error');}});
const browser=await chromium.launch({headless:true,channel:'chrome'}),report={widths:[],flows:[]};
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  const settled=()=>page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false'&&document.querySelector('.lb-manage'));
  const visit=async id=>{await page.goto(base+'/data-core/work/library?folder='+encodeURIComponent(id));await settled();};
  const geometry=()=>page.evaluate(()=>{
    const failures=[];const intersect=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
    for(const card of document.querySelectorAll('.lb-folder-item,.lb-file,.lb-recent-item')){
      const name=card.querySelector('.library-item-name');if(!name)continue;
      const rect=name.getBoundingClientRect(),style=getComputedStyle(name);
      if(rect.height>parseFloat(style.lineHeight)*2+1)failures.push('more than two lines');
      if(name.title!==name.textContent)failures.push('missing title');
      for(const other of card.querySelectorAll('.lb-select,.lb-folder-menu summary,.lb-folder-count,.lb-file-actions,.lb-folder>.lb-icon,.lb-thumbnail,.lb-document-visual')){
        if(intersect(rect,other.getBoundingClientRect()))failures.push('name overlaps '+other.className);
      }
      const count=card.querySelector('.lb-folder-count');if(count&&count.getBoundingClientRect().bottom>card.getBoundingClientRect().bottom+1)failures.push('count outside card');
    }
    if(document.documentElement.scrollWidth>innerWidth+1)failures.push('page overflow');return failures;
  });
  await visit(folder);
  for(const width of [320,390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const mode of ['grid','list']){await page.locator(`button[data-view="${mode}"]`).click();assert.deepEqual(await geometry(),[],`${width} ${mode}`);await page.screenshot({path:resolve(out,`${mode}-${width}.png`),fullPage:true});}
    report.widths.push(width);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#libraryFiles .lb-select').click();await page.locator('[data-move]').click();
  await page.locator('.lb-bulk-move [data-folders] .library-item-name').filter({hasText:'중첩'}).waitFor();
  await page.setViewportSize({width:320,height:1000});assert.equal(await page.locator('.lb-bulk-move [data-folders] button').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),true);
  await page.locator('.lb-bulk-move[open] [data-cancel]').click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('파일 정렬').selectOption('name');await settled();
  await page.locator('#libraryQuery').fill('LongName');await page.locator('#libraryQuery').press('Enter');await settled();assert.equal(await page.locator('#libraryFiles .lb-file').count(),1);
  await visit(root);await page.locator(`[data-library-folder="${folder}"] [data-lb-folder]`).dblclick();await settled();assert.equal(new URL(page.url()).searchParams.get('folder'),folder);
  delay=1200;await page.locator('#libraryFileInput').setInputFiles({name:'background.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic')});
  await page.locator('#libraryUploadPanel').waitFor({state:'visible'});
  await page.locator('#libraryBreadcrumb [data-lb-folder="root"]').click();await settled();
  await page.locator(`[data-library-folder="campus:${A}"] .lb-folder-count`).filter({hasText:'파일 3개'}).waitFor();delay=0;
  const rootQueries=network.filter(n=>n.url.includes('/library/folders?parentId=root'));assert.ok(rootQueries.length>=2,'background upload refreshes root totals');
  assert.deepEqual(await geometry(),[],'campus cards');report.flows.push('grid/list, deep folder, selection, folder navigation, move picker, search/sort, upload completion refreshes campus totals');
  for(const channel of ['blog','instagram']){
    await page.goto(base+'/data-core/content/'+channel);await page.locator('#draftCampus').waitFor();
    await page.locator('#draftCampus').selectOption(A);await page.locator(`[data-folder="${root}"]`).click();
    await page.locator(`[data-folder="${folder}"] .library-item-name`).waitFor();
    for(const width of [320,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.photo-folder-grid button').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),true);await page.screenshot({path:resolve(out,`${channel}-${width}.png`),fullPage:true});}
  }
  report.flows.push('blog and instagram shared folder names, tooltip and narrow picker');assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'results.json'),JSON.stringify({...report,network},null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();}

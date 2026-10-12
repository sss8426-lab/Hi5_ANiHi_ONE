// Actual Worker API with isolated synthetic D1/R2; never connects to production.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {libraryHarness,users} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const h=await libraryHarness(), errors=[];
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(url.pathname==='/api/data'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({students:[],cases:[],universities:[],awardFolders:[],settings:{}}));return;}
    if(/^\/api\/data-core\/competition-sources\/[^/]+\/preview$/.test(url.pathname)){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({items:[],warnings:[]}));return;}
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?new Uint8Array(Buffer.concat(chunks)):undefined;
      const headers={};if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
      const response=await h.raw(req.method,url.pathname+url.search,users.master,body,'http://localhost',headers);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const path=url.pathname==='/data-core/counseling/works'||url.pathname==='/data-core/counseling/competitions'||url.pathname==='/data-core/counseling'?'/data-core/index.html':url.pathname;
    const file=resolve('public','.'+path);assert.ok(file.startsWith(resolve('public')+sep));
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png'})[extname(file)]||'application/octet-stream'}).end(bytes);
  }catch(error){errors.push(String(error));res.writeHead(500).end();}
});
let browser;
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  await mkdir('outputs/competition-folder-search',{recursive:true});
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  for (const type of ['enrolled','public']) for (const title of (type==='enrolled'?['청강문화산업대학교','동덕여대','BIAF']:['청강문화산업대학교','서울여대','BIAF'])) {
    const result=await h.request('POST','/api/data-core/awards/folders',users.master,{title,collectionType:type});
    assert.equal(result.status,201);
  }
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/data-core/counseling/competitions?search-preview=1');
    await page.locator('#awardFolderList [data-award-folder-id]').first().waitFor();
    assert.equal(await page.locator('#awardFolderList [data-award-folder-id]').count(),3);
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),3);
    await page.locator('#awardSearchEnrolled').fill('청강');
    assert.equal(await page.locator('#awardFolderList [data-award-folder-id]').count(),1);
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),3);
    await page.locator('#awardSearchPublic').fill(' b i a f ');
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),1);
    assert.match(await page.locator('#publicAwardFolderList').innerText(),/BIAF/);
    await page.locator('#awardSearchEnrolled').fill('일치없음');
    assert.match(await page.locator('#awardFolderList').innerText(),/검색된 폴더가 없습니다/);
    await page.locator('#awardClearEnrolled').click();
    assert.equal(await page.locator('#awardFolderList [data-award-folder-id]').count(),3);
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),1);
    assert.equal(await page.locator('#awardSearchEnrolled').evaluate(el=>el===document.activeElement),true);
    await page.locator('#awardClearPublic').click();
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),3);
    await page.locator('#awardFolderList button').filter({hasText:'청강문화산업대학교'}).click();
    await page.locator('#awardFolderDetail').waitFor();
    await page.locator('#awardSearchEnrolled').fill('BIAF');
    assert.equal(await page.locator('#awardFolderDetail').isHidden(),true);
    await page.locator('#awardClearEnrolled').click();
    assert.equal(await page.locator('#awardFolderDetail').isVisible(),true);
    await page.locator('#awardSortPublic').selectOption('desc');
    await page.locator('#awardSearchEnrolled').fill('청강');
    await page.locator('#awardSearchPublic').fill('BIAF');
    assert.equal(await page.locator('#awardFolderList [data-award-folder-id]').count(),1);
    assert.equal(await page.locator('#publicAwardFolderList [data-award-folder-id]').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.ok(await page.locator('#awardSortEnrolled').evaluate(el=>el.getBoundingClientRect().width)<=200);
    assert.equal(await page.locator('#awardSearchEnrolled').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
    await page.screenshot({path:`outputs/competition-folder-search/${width}.png`,fullPage:true});
    await page.close();
    console.log(`PASS ${width}px: independent competition searches, normalization, no match, reset, selected detail restoration and compact sort`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));await h.mf.dispose();}

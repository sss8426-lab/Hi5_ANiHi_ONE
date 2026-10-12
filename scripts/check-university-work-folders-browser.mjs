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
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?new Uint8Array(Buffer.concat(chunks)):undefined;
      const headers={};if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
      const response=await h.raw(req.method,url.pathname+url.search,users.master,body,'http://localhost',headers);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const path=url.pathname==='/data-core/counseling/works'||url.pathname==='/data-core/counseling'?'/data-core/index.html':url.pathname;
    const file=resolve('public','.'+path);assert.ok(file.startsWith(resolve('public')+sep));
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png'})[extname(file)]||'application/octet-stream'}).end(bytes);
  }catch(error){errors.push(String(error));res.writeHead(500).end();}
});
let browser;
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  await mkdir('outputs/university-work-folders',{recursive:true});
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/admissions-web/renderer/index.html#page=dashboard');
    await page.locator('#students h1').waitFor();
    assert.equal(await page.locator('#nav [data-page=dashboard],#dashboard').count(),0);
    await page.goto(base+'/admissions-web/renderer/index.html#page=works');
    const frame=page.frameLocator('#worksFrame');
    await frame.locator('#admittedAwardFolderList [data-award-folder-id]').first().waitFor();
    assert.equal(await frame.locator('#admittedAwardFolderList [data-award-folder-id]').count(),68);
    assert.equal(await frame.locator('#universityAwardFolderList [data-award-folder-id]').count(),68);
    assert.equal(await frame.locator('#nav [data-view=works]').count(),0);
    assert.equal(await frame.locator('#awardAdmittedCollection h4').innerText(),'대학합격 우수작');
    assert.equal(await frame.locator('#awardUniversityCollection h4').innerText(),'우수작');
    await frame.locator('#admittedAwardFolderList button').filter({hasText:'건국대학교 (글로컬캠퍼스)'}).click();
    await frame.locator('#admitted-openAwardChildBtn').click();
    await frame.locator('#awardFolderTitle').fill('합성 검증 연도 '+width);
    await frame.locator('#awardFolderTitle').press('Enter');
    await frame.locator('#admitted-awardBreadcrumb [aria-current=page]').filter({hasText:'합성 검증 연도 '+width}).waitFor();
    assert.equal(await frame.locator('#universityAwardFolderList [data-award-folder-id]').count(),68);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`outputs/university-work-folders/${width}.png`,fullPage:true});
    await page.close();
    console.log(`PASS ${width}px: removed dashboard/duplicate nav, 68+68 folders, independent year creation and breadcrumbs`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(done=>server.close(done));await h.mf.dispose();}

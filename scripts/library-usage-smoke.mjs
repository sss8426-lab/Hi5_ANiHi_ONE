// Isolated D1/R2 only. Baseline serves origin/main browser assets against the same fixture API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {libraryHarness,users,A} from '../tests/support/library-harness.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const h=await libraryHarness(), baseline=process.argv.includes('--baseline'), errors=[], timings=[], counts={storage:0,billing:0}, assets=new Map();
const out=resolve('outputs/library-usage');await mkdir(out,{recursive:true});
const hq=(await h.folder('hq','__synthetic_legacy',users.master)).body.folder.id;
for(const name of ['수업그림','원장전용','자료','제작물'])await h.folder(`campus:${A}`,name,users.master);
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.includes('/usage/')){
      const kind=url.pathname.split('/').at(-1);counts[kind]++;
      await new Promise(r=>setTimeout(r,3500));
      const data=kind==='storage'?{bytes:1234567890123,gb:1234.567890123,gib:1149.78,buckets:[{bucket:'synthetic-bucket',bytes:1234567890123,asOf:new Date().toISOString()}]}:{cost:1234567.1234,currency:'USD',periods:[]};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({kind,state:'current',data,updatedAt:new Date().toISOString(),attemptedAt:new Date().toISOString()}));return;
    }
    if(url.pathname.startsWith('/api/')){
      const response=await h.raw('GET',url.pathname+url.search,users.master);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const path=url.pathname==='/data-core/work/library'?'/data-core/index.html':url.pathname;
    const file=resolve('public','.'+path);if(!file.startsWith(resolve('public')+sep))throw Error('path');
    if(!assets.has(path))assets.set(path,baseline?execFileSync('git',['show','origin/main:public'+path],{maxBuffer:8e6}):await readFile(file));
    const bytes=assets.get(path);
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp'};
    res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});res.end(bytes);
  }catch(e){errors.push(String(e));res.writeHead(500);res.end('synthetic harness failure');}
});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  const settled=()=>page.waitForFunction(()=>document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false'&&document.querySelector('#libraryFolders .lb-folder'));
  for(let i=0;i<6;i++){await page.goto(base+'/data-core/work/library');await settled();if(i)timings.push(await page.evaluate(()=>performance.now()));}
  if(!baseline){
    assert.equal(await page.locator('#libraryHq,[data-lb-folder="hq"]').count(),0);
    await page.waitForFunction(()=>document.querySelector('#libraryUsage')?.textContent.includes('1,234.5679'));
    const before={...counts};
    for(let i=0;i<30;i++)await page.evaluate(async({i,A})=>{history.pushState(null,'','/data-core/work/library'+(i%2?'':'?folder='+encodeURIComponent('campus:'+A)));await window.DataCoreLibrary.refresh();},{i,A});
    assert.deepEqual(counts,before);
    const widths=[320,390,768,1024,1440,1920];
    for(const width of widths){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);
      const boxes=await page.locator('#libraryUsage button,#libraryNew,#libraryRefresh').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,`overlap ${width}`);}
      await page.screenshot({path:resolve(out,`${width}.png`)});
      await page.locator('[data-usage="billing"]').click();assert.ok(await page.locator('#libraryUsageDialog').isVisible());
      assert.ok(await page.evaluate(()=>document.querySelector('#libraryUsageDialog').scrollWidth<=document.querySelector('#libraryUsageDialog').clientWidth+1));
      await page.locator('[data-usage-close]').click();
    }
    await page.goto(base+'/data-core/work/library?folder='+hq);await settled();assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.locator('#libraryHq').count(),0);
  }
  assert.deepEqual(errors,[]);
  const report={baseline,timingsMs:timings,medianMs:[...timings].sort((a,b)=>a-b)[2],statsDelayMs:3500,requests:counts,errors};
  await writeFile(resolve(out,baseline?'baseline.json':'after.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();}

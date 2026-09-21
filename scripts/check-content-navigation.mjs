import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {libraryHarness,users,A} from '../tests/support/library-harness.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const h=await libraryHarness(),root=path.resolve('public'),out=path.resolve('outputs/content-navigation');await fs.mkdir(out,{recursive:true});
const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC performance',users.staff)).body.folder;
const png=await sharp({create:{width:320,height:200,channels:3,background:'#208978'}}).png().toBuffer();
const thumb=await sharp(png).webp().toBuffer(), originals=new Set();
for(let i=0;i<50;i++){
  const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC-'+i+'.png',mime:'image/png',bytes:png})).body.file;originals.add(file.id);
  const form=new FormData();form.set('file',new Blob([thumb],{type:'image/webp'}),'thumb.webp');
  assert.equal((await h.request('POST','/api/data-core/library/files/'+file.id+'/thumbnail',users.staff,form)).status,201);
}
let before=false,failFiles=false,deny=false;const assets=new Map();let counts={},active=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=http.createServer(async(req,res)=>{active++;try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    const key=url.pathname;counts[key]=(counts[key]||0)+1;
    if(key==='/api/data-core/health')await wait(900);
    if(key==='/api/data-core/library/files')await wait(350);
    if(key==='/api/data-core/library/folders')await wait(30);
    if(deny){res.writeHead(401,{'content-type':'application/json'}).end('{"error":"Synthetic expired session"}');return;}
    if(failFiles&&key==='/api/data-core/library/files'){res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Synthetic files unavailable"}');return;}
    const result=await h.raw(req.method,url.pathname+url.search,users.staff);
    res.writeHead(result.status,Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));return;
  }
  const pathname=url.pathname.startsWith('/data-core/content/')?'/data-core/content.html':url.pathname;
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const key=(before?'before:':'after:')+pathname;
  if(!assets.has(key))assets.set(key,before?execFileSync('git',['show','af4a61d:public'+pathname],{maxBuffer:20*1024*1024,stdio:['ignore','pipe','ignore']}):await fs.readFile(file));
  res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'}).end(assets.get(key));
}catch{res.writeHead(404).end();}finally{active--;}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chrome'}),results={};
const origin='http://127.0.0.1:'+server.address().port;
try{
  for(const baseline of [true,false]){
    before=baseline;counts={};const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    await page.addInitScript(()=>{let Cache;Object.defineProperty(window,'DataCorePrivateImageCache',{configurable:true,get(){return Cache;},set(Value){Cache=class extends Value{constructor(...args){super(...args);window.__thumbnailCache=this;}};}});});
    await page.goto(origin+'/data-core/content/instagram');await page.locator(`[data-folder="category:${A}:class-photo"]`).waitFor();await wait(1500);counts={};
    const initial=performance.now();await page.reload();await page.locator(`#photoFolders [data-folder="category:${A}:class-photo"]`).waitFor();
    const initialMs=Math.round(performance.now()-initial);
    await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`#photoFolders [data-folder="${folder.id}"]`).waitFor();
    let started=performance.now();await page.locator(`[data-folder="${folder.id}"]`).click();await page.locator('[data-pick-file]').first().waitFor();
    const filesMs=Math.round(performance.now()-started);await page.locator('#filePickList').scrollIntoViewIfNeeded();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#filePickList img')).some(img=>img.naturalWidth));
    const firstThumbnailMs=Math.round(performance.now()-started),visits=[];
    for(let i=0;i<30;i++){
      started=performance.now();await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`#photoFolders [data-folder="${folder.id}"]`).waitFor();visits.push(Math.round(performance.now()-started));
      await page.locator(`#photoFolders [data-folder="${folder.id}"]`).click();await page.waitForFunction(id=>document.querySelector('#photoBreadcrumb button:last-child')?.dataset.folder===id&&document.querySelectorAll('[data-pick-file]').length===50,folder.id);
    }
    const sorted=[...visits].sort((a,b)=>a-b),cache=await page.evaluate(()=>window.__thumbnailCache?{entries:window.__thumbnailCache.entries.size,bytes:window.__thumbnailCache.bytes,active:window.__thumbnailCache.active}:null);
    if(cache){assert.ok(cache.entries<=50);assert.ok(cache.bytes<=8*1024*1024);}
    const originalReads=Object.entries(counts).filter(([key])=>originals.has(key.split('/').pop())).reduce((sum,[,n])=>sum+n,0);assert.equal(originalReads,0);
    results[baseline?'before':'after']={initialMs,filesMs,firstThumbnailMs,revisitMedianMs:sorted[15],revisitP95Ms:sorted[28],requests:Object.values(counts).reduce((a,b)=>a+b,0),originalReads,cache};
    if(!baseline){
      failFiles=true;await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${folder.id}"]`).waitFor();
      await page.waitForFunction(()=>document.querySelector('#pickerStatus').textContent.includes('Synthetic files unavailable'));
      assert.equal(await page.locator(`[data-folder="${folder.id}"]`).isEnabled(),true);failFiles=false;
      await page.locator(`[data-folder="${folder.id}"]`).click();await page.locator('[data-pick-file]').first().waitFor();
      deny=true;await page.locator('#fileSearchBtn').click();await page.waitForFunction(()=>document.querySelectorAll('[data-pick-file]').length===0&&window.__thumbnailCache.entries.size===0);deny=false;
      await page.goto(origin+'/data-core/content/blog');await page.locator(`[data-folder="category:${A}:class-photo"]`).waitFor();
      await page.screenshot({path:path.join(out,'blog-shared-picker.png'),fullPage:true});
    }
    await context.close();
  }
  await fs.writeFile(path.join(out,'metrics.json'),JSON.stringify({fixture:{files:50,visits:30,healthDelayMs:900,fileDelayMs:350,folderDelayMs:30},...results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));while(active)await wait(20);await h.mf.dispose();}

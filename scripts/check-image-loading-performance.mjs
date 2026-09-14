import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const baselineRef=process.env.GALLERY_BASELINE_REF||'4d5064b';
const old=execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'show',`${baselineRef}:public/data-core/image-gallery.js`],{encoding:'utf8'});
const current=await readFile('public/data-core/image-gallery.js','utf8');
const css=await readFile('public/data-core/image-gallery.css');
const preview=await sharp({create:{width:1000,height:1400,channels:3,background:'#72b9a0'}}).webp().toBuffer();
const original=await sharp({create:{width:2600,height:3600,channels:3,background:'#72b9a0'}}).png().toBuffer();
const server=createServer((req,res)=>{
  if(req.url==='/viewer.js')res.writeHead(200,{'content-type':'text/javascript'}).end(current);
  else if(req.url==='/old.js')res.writeHead(200,{'content-type':'text/javascript'}).end(old);
  else if(req.url==='/style.css')res.writeHead(200,{'content-type':'text/css'}).end(css);
  else if(req.url.startsWith('/data-core/assets/'))readFile(resolve('public/data-core/assets/core-icons.svg')).then(b=>res.writeHead(200,{'content-type':'image/svg+xml'}).end(b));
  else res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(`<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><button id="anchor">작품</button><script src="${req.url==='/baseline'?'/old.js':'/viewer.js'}"></script></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
await mkdir('outputs/image-loading',{recursive:true});
try {
 for(const mode of ['baseline','current']) {
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'}),page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/synthetic/**',async route=>{
    const url=new URL(route.request().url());requests.push(url.pathname);
    const large=url.pathname.includes('original');await new Promise(r=>setTimeout(r,large?1800:80));
    await route.fulfill({contentType:large?'image/png':'image/webp',body:large?original:preview}).catch(()=>{});
  });
  await page.goto(`${base}/${mode}`);
  const start=Date.now();
  await page.evaluate(()=>window.DataCoreImageGallery.open({anchor:document.querySelector('#anchor'),title:'합성 커리큘럼',items:[0,1,2].map(i=>({src:`/synthetic/original-${i}`,displaySrc:`/synthetic/preview-${i}`,previewSrc:`/synthetic/preview-${i}`}))}));
  await page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden&&document.querySelector('.cig-image')?.naturalWidth);
  const firstMs=Date.now()-start,originalsBeforeZoom=requests.filter(p=>p.includes('original')).length;
  await page.waitForTimeout(400);
  const nextStart=Date.now();await page.locator('[data-cig-next]').click();
  await page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden&&document.querySelector('.cig-counter')?.textContent==='2 / 3');
  const nextMs=Date.now()-nextStart;
  if(mode==='current') {
    assert.equal(originalsBeforeZoom,0);assert.ok(firstMs<900,`first ${firstMs}ms`);assert.ok(nextMs<700,`next ${nextMs}ms`);
    const count=requests.length;await page.locator('[data-cig-prev]').click();await page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden);
    await page.waitForTimeout(120);assert.equal(requests.length,count,'back reuses decoded page');
    await page.locator('[data-cig-zoom]').click();await page.waitForFunction(()=>document.querySelector('.cig-image')?.naturalWidth===2600);
    assert.equal(requests.filter(p=>p==='/synthetic/original-0').length,1);
    await page.locator('[data-cig-zoom]').click();await page.locator('[data-cig-zoom]').click();assert.equal(requests.filter(p=>p==='/synthetic/original-0').length,1);
  }
  results.push({mode,firstMs,nextMs,originalsBeforeZoom});await page.keyboard.press('Escape');
  if(mode==='current') {
    // A slow original must not obscure a usable thumbnail or repeat on back navigation.
    await page.evaluate(()=>window.DataCoreImageGallery.open({anchor:document.querySelector('#anchor'),items:[{src:'/synthetic/student-original',previewSrc:'/synthetic/student-thumb'}]}));
    await page.waitForFunction(()=>document.querySelector('.core-image-gallery')?.classList.contains('cig-has-preview'));
    const overlay=await page.locator('.cig-feedback').boundingBox();assert.ok(overlay.height<100);
    await page.screenshot({path:'outputs/image-loading/nonblocking-preview.png'});
    await page.keyboard.press('Escape');
    await page.evaluate(async()=>{
      const cache=window.DataCoreImageGallery.createCache();const both=await Promise.all([cache.get('/synthetic/dedup'),cache.get('/synthetic/dedup')]);
      if(both[0]!==both[1])throw Error('duplicate resource');cache.dispose();
    });assert.equal(requests.filter(p=>p==='/synthetic/dedup').length,1);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 await writeFile('outputs/image-loading/result.json',JSON.stringify({baselineRef,results,productionDataUsed:false,networkDelays:{previewMs:80,originalMs:1800}},null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close();await new Promise(r=>server.close(r));}

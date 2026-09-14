import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=resolve('public'), out='outputs/image-gallery'+(process.env.GALLERY_PREVIEW_ORIGIN?'-preview':'');
await mkdir(out,{recursive:true});
const pictures=await Promise.all(['#94c9b4','#b3c4de','#e9c884'].map(color=>sharp({create:{width:1200,height:1600,channels:3,background:color}}).png().toBuffer()));
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/gallery')return res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>합성 갤러리 검증</title><link rel="stylesheet" href="/data-core/design-tokens.css"><link rel="stylesheet" href="/data-core/image-gallery.css"><body><button id="open">합성 작품</button><script src="/data-core/image-gallery.js"></script></body></html>');
    const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+sep))return res.writeHead(403).end();
    const bytes=await readFile(file);res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'}).end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`, preview=process.env.GALLERY_PREVIEW_ORIGIN;
if(preview)assert.match(preview,/^https:\/\/[a-z0-9.-]+\.workers\.dev$/);
const browser=await chromium.launch({headless:true,channel:'chrome'}), errors=[],requests=[];
let failed=true,checks=0;
try {
 const context=await browser.newContext({serviceWorkers:'block',hasTouch:true});
 await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==base)return route.abort();
   if(u.pathname.startsWith('/synthetic/')) {
     requests.push(u.pathname);
     if(u.pathname.endsWith('/fail')&&failed)return route.fulfill({status:503,body:''});
     if(u.pathname.endsWith('/slow'))await new Promise(r=>setTimeout(r,350));
     return route.fulfill({contentType:'image/png',body:pictures[Number(u.pathname.split('/').at(-1))%3||0]});
   }
   if(preview&&u.pathname.startsWith('/data-core/')) {
     const remote=await fetch(preview+u.pathname);assert.equal(remote.status,200);
     const bytes=Buffer.from(await remote.arrayBuffer());
     assert.equal(bytes.toString().replace(/\r\n/g,'\n'),(await readFile(resolve(root,'.'+u.pathname),'utf8')).replace(/\r\n/g,'\n'));
     return route.fulfill({body:bytes,contentType:remote.headers.get('content-type')});
   }
   return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const open=async(index=0)=>page.evaluate(index=>{
   const items=Array.from({length:3},(_,i)=>({src:`/synthetic/${i}`,title:`합성 작품 ${i+1}`}));
   document.querySelector('#open').onclick=()=>window.DataCoreImageGallery.open({items,index,title:'학생 그림',anchor:document.querySelector('#open'),scope:'test'});
   document.querySelector('#open').click();
 },index);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden&&document.querySelector('.cig-image')?.naturalWidth);
 const count=async(value)=>{assert.equal(await page.locator('.cig-counter').textContent(),value);checks++;};
 const swipe=async(dx,dy=0)=>{
   const r=await page.locator('.cig-canvas').boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
 };
 for(const width of [1920,1440,1280,1024,820,768,430,390,375,320]){
   await page.setViewportSize({width,height:900});await page.goto(base+'/gallery');await open();await ready();await count('1 / 3');
   assert.equal(await page.locator('[data-cig-prev]').isDisabled(),true);
   await page.locator('[data-cig-next]').click();await ready();await count('2 / 3');
   assert.match(await page.locator('.cig-image').getAttribute('data-source'),/synthetic\/1$/);
   await swipe(-70);await ready();await count('3 / 3');
   assert.equal(await page.locator('[data-cig-next]').isDisabled(),true);
   await swipe(70);await ready();await count('2 / 3');
   await swipe(0,65);await count('2 / 3');
   await page.locator('[data-cig-zoom]').click();await swipe(-70);await count('2 / 3');
   await page.locator('[data-cig-zoom]').click();await page.keyboard.press('End');await count('3 / 3');await page.keyboard.press('Home');await ready();await count('1 / 3');
   assert.equal(await page.locator('.core-image-gallery').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}),true);
   assert.equal(await page.locator('.cig-image').evaluate(i=>getComputedStyle(i).objectFit),'contain');
   assert.ok(await page.locator('[data-cig-next] svg').evaluate(i=>i.getBBox().width>0));
   await page.waitForFunction(()=>document.querySelector('[data-cig-zoom] svg')?.getBBox().width>0);
   await page.screenshot({path:`${out}/${width}.png`});
   // Native dialog keeps Tab within the modal and returns focus after closing.
   for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('.core-image-gallery'))),true);}
   await page.keyboard.press('Escape');assert.equal(await page.locator('.core-image-gallery').count(),0);
   assert.equal(await page.locator('#open').evaluate(e=>e===document.activeElement),true);checks+=13;
 }
 // Real touch input, not just pointer-event dispatch.
 await page.setViewportSize({width:390,height:844});await open();await ready();
 const cdp=await context.newCDPSession(page),rect=await page.locator('.cig-canvas').boundingBox(),y=rect.y+rect.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width*.8,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width*.2,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await count('2 / 3');
 // Multi-touch must not turn a page.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:150,y},{id:1,x:230,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:90,y},{id:1,x:290,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await count('2 / 3');
 await cdp.detach();await page.keyboard.press('Escape');
 await page.evaluate(()=>window.DataCoreImageGallery.open({items:[{src:'/synthetic/fail'}],anchor:document.querySelector('#open')}));
 await page.locator('[data-cig-retry]:visible').waitFor();assert.equal(await page.locator('[data-cig-next]').isVisible(),false);
 failed=false;await page.locator('[data-cig-retry]').click();await ready();await page.keyboard.press('Escape');checks+=2;
 await page.evaluate(()=>{
   window.DataCoreImageGallery.open({items:[{load:()=>new Promise(r=>setTimeout(()=>r('/synthetic/slow'),300))},{src:'/synthetic/2'}],anchor:document.querySelector('#open')});
   document.querySelector('[data-cig-next]').click();
 });
 await ready();await page.waitForTimeout(450);assert.match(await page.locator('.cig-image').getAttribute('data-source'),/synthetic\/2$/);checks++;
 await open();assert.equal(await page.locator('.core-image-gallery').count(),1);
 await page.evaluate(()=>document.querySelector('#open').remove());await page.locator('.core-image-gallery').waitFor({state:'detached'});checks+=2;
 await page.goto(base+'/gallery');await open();await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));assert.equal(await page.locator('.core-image-gallery').count(),0);checks++;
 await page.evaluate(()=>window.DataCoreImageGallery.open({items:[{src:'https://invalid.example/private-image'}]}));await page.locator('[data-cig-retry]:visible').waitFor();checks++;
 assert.deepEqual(errors,[]);
 const result={checks,pageErrors:errors.length,widths:[1920,1440,1280,1024,820,768,430,390,375,320],touchSwipe:true,pinchGuard:true,staleLoadGuard:true,originalContain:true,preview:preview||null};
 await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}

// Identical synthetic data, browser, viewport and three cold navigations per build.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/sis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),results={};
const baseline=process.argv[2];if(!baseline)throw Error('Pass a built baseline checkout directory.');
const image=await sharp({create:{width:1200,height:800,channels:3,background:'#33796c'}}).jpeg().toBuffer();
try{for(const [label,root] of [['before',resolve(baseline)],['after',process.cwd()]]){
 const {libraryHarness,users,A}=await import(pathToFileURL(resolve(root,'tests/support/library-harness.mjs')).href);const h=await libraryHarness();let db=0,r2=0;
 const nativeDB=h.env.DB;h.env.DB=new Proxy(nativeDB,{get(target,key){if(key==='prepare')return sql=>{db++;return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const bucket=h.env.FILES;h.env.FILES=new Proxy(bucket,{get(target,key){const value=target[key];return typeof value==='function'? (...args)=>{r2++;return value.apply(target,args);}:value;}});
 const category=`category:${A}:academy-photo`;let parent=category;for(let i=0;i<4;i++)parent=(await h.folder(parent,`__synthetic_level_${i}`,users.staff)).body.folder.id;
 for(let i=0;i<12;i++)await h.upload(parent,users.staff,{name:`image-${i}.jpg`,bytes:image,mime:'image/jpeg'});
 let apis=0,active=0;const errors=[];const server=createServer(async(req,res)=>{active++;try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){apis++;const response=await h.raw(req.method,url.pathname+url.search,users.staff);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const path=url.pathname==='/data-core/work/library'?'/data-core/index.html':url.pathname,file=resolve(root,'public','.'+path);if(!file.startsWith(resolve(root,'public')+sep))throw Error('Invalid path');const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.json':'application/json'})[extname(file)]||'application/octet-stream'});res.end(bytes);
 }catch(e){errors.push(String(e));res.writeHead(500);res.end('error');}finally{active--;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const measurements=[];
 try{for(let n=0;n<3;n++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await page.addInitScript(()=>{window.__marks={};const scan=()=>{const mark=(name,yes)=>{if(yes&&window.__marks[name]===undefined)window.__marks[name]=performance.now();};mark('folder',document.querySelector('#libraryContents')?.getAttribute('aria-busy')==='false'&&document.querySelector('#libraryBreadcrumb [aria-current]'));mark('thumbnail',document.querySelector('.lb-image-ready'));mark('recent',document.querySelector('.lb-recent-item'));};new MutationObserver(scan).observe(document,{subtree:true,childList:true,attributes:true});});
  db=r2=apis=0;await page.goto(`${base}/data-core/work/library?folder=${encodeURIComponent(parent)}`);await page.waitForFunction(()=>window.__marks.thumbnail&&window.__marks.folder);const entry={...(await page.evaluate(()=>window.__marks)),api:apis,db,r2};
  const times=[];for(let i=0;i<2;i++){
   const trigger=page.locator(label==='before'?'.lb-thumbnail':'#libraryFiles [data-lb-preview]').first();await trigger.scrollIntoViewIfNeeded();
   await page.evaluate(()=>document.addEventListener('click',()=>{window.__previewStarted=performance.now();},{once:true,capture:true}));
   await trigger.click();await page.waitForFunction(before=>{const image=document.querySelector(before?'.cig-image':'.lb-preview img');if(image?.naturalWidth>0&&(!before||document.querySelector('.cig-feedback')?.hidden)){window.__previewElapsed=performance.now()-window.__previewStarted;return true;}return false;},label==='before');
   times.push(Math.round(await page.evaluate(()=>window.__previewElapsed)));await page.keyboard.press('Escape');
  }
  await page.goto(`${base}/data-core/work/library?folder=${encodeURIComponent('campus:'+A)}`);await page.waitForFunction(()=>window.__marks.recent);entry.recent=await page.evaluate(()=>window.__marks.recent);entry.previewCold=times[0];entry.previewWarm=times[1];measurements.push(entry);await context.close();
 }}finally{await new Promise(r=>server.close(r));while(active)await new Promise(r=>setTimeout(r,20));await h.mf.dispose();}
 if(errors.length)throw Error(errors.join('\n'));results[label]={runs:measurements,median:Object.fromEntries(Object.keys(measurements[0]).map(key=>[key,measurements.map(r=>r[key]).sort((a,b)=>a-b)[1]]))};
}}finally{await browser.close();}
await mkdir('outputs/library-management',{recursive:true});await writeFile('outputs/library-management/benchmark.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));

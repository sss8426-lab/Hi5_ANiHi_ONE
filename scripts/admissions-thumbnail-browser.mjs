import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {libraryHarness,users,A} from '../tests/support/library-harness.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const h=await libraryHarness(),out='outputs/admissions-thumbnails';await mkdir(out,{recursive:true});
const original=await sharp({create:{width:1200,height:900,channels:3,background:'#73a99c'}}).withMetadata({orientation:6}).jpeg().toBuffer();
const state={students:[{id:1,name:'SYNTHETIC student',campusId:A,studentType:'result',artworks:Array.from({length:6},(_,i)=>({path:`artworks/SYNTHETIC-${i}.jpg`,name:`SYNTHETIC ${i}`}))}],universities:[],cases:[],awardFolders:[],settings:{}};
state.students.push({id:2,name:'SYNTHETIC other student',campusId:A,studentType:'result',artworks:[{path:'artworks/SYNTHETIC-0.jpg',name:'Other student image'}]});
state.universities.push({id:10,name:'SYNTHETIC university',admissionImages:Array.from({length:3},(_,i)=>({id:`synthetic-guideline-${i}`,url:`/synthetic-guideline/${i}`,fileName:`SYNTHETIC guideline ${i}`}))});
state.awardFolders.push({id:'synthetic-awards',universityName:'SYNTHETIC award',years:{'2024':state.universities[0].admissionImages}});
const before=JSON.stringify(state);await h.env.FILES.put('state/admissions-data.json',before);
for(let i=0;i<6;i++)await h.env.FILES.put(`artworks/SYNTHETIC-${i}.jpg`,original,{httpMetadata:{contentType:'image/jpeg'}});
const preview=process.argv.includes('--preview')?new URL(process.argv[process.argv.indexOf('--preview')+1]).origin:null;
const checked=new Set(),errors=[],network=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname.startsWith('/synthetic-guideline/')){res.writeHead(200,{'content-type':'image/jpeg'});res.end(original);return;}
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?req.headers['content-type']?.includes('multipart/form-data')?await new Response(Buffer.concat(chunks),{headers:req.headers}).formData():JSON.parse(Buffer.concat(chunks).toString()):undefined;
      const response=await h.raw(req.method,url.pathname+url.search,users.admin,body,'http://localhost',req.headers['if-none-match']?{'if-none-match':req.headers['if-none-match']}:{});
      const bytes=Buffer.from(await response.arrayBuffer());network.push({method:req.method,path:url.pathname,status:response.status,bytes:bytes.length});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);return;
    }
    const path=resolve('public','.'+url.pathname);if(!path.startsWith(resolve('public')+sep))throw Error('Invalid path');
    const bytes=await readFile(path);
    if(preview && !checked.has(url.pathname)){
      const remote=await fetch(preview+url.pathname);assert.equal(remote.status,200);
      const hash=b=>createHash('sha256').update(b.toString().replace(/\r\n/g,'\n')).digest('hex');
      if(/\.(js|css|html)$/.test(path))assert.equal(hash(Buffer.from(await remote.arrayBuffer())),hash(bytes),url.pathname);
      checked.add(url.pathname);
    }
    res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(path)]||'application/octet-stream'});res.end(bytes);
  }catch(error){errors.push(String(error));res.writeHead(500);res.end('Synthetic harness error');}
});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/admissions-web/renderer/index.html#page=students');
  await page.locator('[data-student-row="1"] td').nth(1).click();
  await page.locator('[data-generate-thumbnails]').click();
  await page.getByRole('button',{name:'5장 썸네일 준비 완료'}).waitFor();
  assert.equal((await h.env.DB.prepare("SELECT count(*) AS n FROM file_objects WHERE category='admissions-legacy-thumbnail'").first()).n,5);
  const widths=[1920,1440,1280,1024,768,390];
  for(const width of widths){
    await page.setViewportSize({width,height:1050});
    const gallery=page.locator('.student-detail-row .student-gallery img');
    for(const image of await gallery.all())await image.evaluate(i=>i.decode());
    assert.deepEqual(await gallery.first().evaluate(i=>[i.naturalWidth,i.naturalHeight]),[360,480]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${out}/students-${width}.png`,fullPage:true});
    await page.locator('.student-detail-row [data-open-artwork]').first().click();
    assert.match(await page.locator('.cig-image').getAttribute('src'),/\/artworks\/0$/);
    assert.equal(await page.locator('.cig-counter').textContent(),'1 / 6');
    await page.locator('[data-cig-next]').click();
    await page.locator('.cig-image').evaluate(i=>i.decode());
    assert.match(await page.locator('.cig-image').getAttribute('src'),/\/artworks\/1$/);
    if([1440,1024,390].includes(width))await page.screenshot({path:`${out}/enlarged-${width}.png`});
    await page.keyboard.press('Escape');assert.equal(await page.locator('.core-image-gallery').count(),0);
    await page.locator('[data-artwork-student="1"]').click();assert.equal(await page.locator('.cig-counter').textContent(),'1 / 6');await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>window.desktopAPI.openAdmissionImages(10));
  await page.locator('.cig-image').evaluate(i=>i.decode());assert.equal(await page.locator('.cig-counter').textContent(),'1 / 3');
  await page.locator('[data-cig-next]').click();assert.equal(await page.locator('.cig-counter').textContent(),'2 / 3');await page.keyboard.press('Escape');
  await page.goto(base+'/admissions-web/renderer/index.html#page=awards');
  await page.locator('[data-award-image]').first().click();await page.locator('[data-cig-next]').click();
  assert.equal(await page.locator('.cig-counter').textContent(),'2 / 3');await page.keyboard.press('Escape');
  const result=await page.evaluate(async({bytes,campus})=>{
    const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'SYNTHETIC-new.jpg',{type:'image/jpeg'});
    const f=new FormData();f.set('file',file);f.set('purpose','student-artwork');f.set('campusId',campus);
    const r=await fetch('/api/upload',{method:'POST',body:f});return {status:r.status,body:await r.json()};
  },{bytes:original.toString('base64'),campus:A});
  assert.equal(result.status,200);assert.equal(result.body.thumbnailGenerationStatus,'ready');
  const row=await h.file(result.body.dataCoreFileId);assert.ok(Buffer.from(await (await h.env.FILES.get(row.r2_key)).arrayBuffer()).equals(original));
  assert.equal(await (await h.env.FILES.get('state/admissions-data.json')).text(),before);
  for(let i=0;i<6;i++)assert.ok(Buffer.from(await (await h.env.FILES.get(`artworks/SYNTHETIC-${i}.jpg`)).arrayBuffer()).equals(original));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({widths,exifOrientation:6,thumbnail:[360,480],originalBytes:original.length,generated:5,newUpload:'ready',originalsUnchanged:true,previewAssets:checked.size,pageErrors:errors.length,thumbnailGetBytes:network.filter(n=>n.method==='GET'&&n.path.endsWith('/thumbnail')).map(n=>n.bytes).slice(-6)}));
}finally{await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();}

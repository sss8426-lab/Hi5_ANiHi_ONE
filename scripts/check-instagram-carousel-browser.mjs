import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {encode,decode} from 'fast-png';
import sharp from 'sharp';
import {libraryHarness,users,A,B} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=path.resolve('outputs/instagram-carousel'),root=path.resolve('public');await fs.mkdir(out,{recursive:true});
const previewOrigin=process.argv.includes('--preview')?new URL(process.argv[process.argv.indexOf('--preview')+1]).origin:null;
const checked=new Set(),assetErrors=[];
const h=await libraryHarness(),realFetch=globalThis.fetch;
let textCalls=0,imageCalls=0,failText=false,activeUser=users.staff;
let lastRendered=null,avoidedPreviewBytes=0;const fileReads=new Map();
const pixels=Uint8Array.from({length:320*120*4},(_,i)=>{const n=Math.floor(i/4),x=n%320,y=Math.floor(n/320);return i%4===3?255:(x<4||x>=316||y<4||y>=116?[220,60,50]:[110,178,154])[i%4];});
const png=encode({width:320,height:120,channels:4,depth:8,data:pixels});
let noiseSeed=42;const aiPixels=new Uint8Array(1024*1536*3);
for(let i=0;i<aiPixels.length;i++){noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;aiPixels[i]=noiseSeed>>>24;}
const aiPng=encode({width:1024,height:1536,channels:3,depth:8,data:aiPixels});
globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.openai.com/'))return realFetch(url,options);
  if(String(url).endsWith('/images/edits')){imageCalls++;return Response.json({data:[{b64_json:Buffer.from(aiPng).toString('base64')}]});}
  textCalls++;if(failText)return Response.json({error:'synthetic failure'},{status:500});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'합성 공간 소개',body:'밝은 공간을 소개합니다. 그림을 가까이 살펴보세요. 자세한 내용은 함께 이야기해요.',hashtags:['미술'],cta:'DM 문의'})}]}]});
};
h.env.OPENAI_API_KEY='synthetic-only';
const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC carousel browser',users.staff)).body.folder,files=[];
for(let i=0;i<11;i++)files.push((await h.upload(folder.id,users.staff,{name:`SYNTHETIC-${i}.png`,mime:'image/png',bytes:png})).body.file);
const formatFolder=(await h.folder('category:'+A+':class-photo','SYNTHETIC raster formats',users.staff)).body.folder,formatFiles=[];
for(const [ext,mime,width,height] of [['png','image/png',300,1600],['jpg','image/jpeg',2200,300],['jpeg','image/jpeg',700,700],['webp','image/webp',800,1400],['gif','image/gif',400,200],['avif','image/avif',300,600]]){
  const bytes=await sharp({create:{width,height,channels:3,background:'#409b82'}}).toFormat(ext==='jpg'?'jpeg':ext).toBuffer();
  const response=await h.upload(formatFolder.id,users.staff,{name:`SYNTHETIC.${ext}`,mime,bytes});assert.equal(response.status,201,JSON.stringify(response.body));formatFiles.push(response.body.file);
}
// Small uncompressed BMP fixture; also exercise historical metadata, without rewriting production rows.
const bmp=Buffer.alloc(70);bmp.write('BM');bmp.writeUInt32LE(70,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);
bmp.writeInt32LE(2,18);bmp.writeInt32LE(2,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.fill(120,54);
const bmpUpload=await h.upload(formatFolder.id,users.staff,{name:'SYNTHETIC.bmp',mime:'image/bmp',bytes:bmp});
assert.equal(bmpUpload.status,201,JSON.stringify(bmpUpload.body));formatFiles.push(bmpUpload.body.file);
await h.env.DB.prepare('UPDATE file_objects SET mime_type=? WHERE id=?').bind('image/jpg',formatFiles[1].id).run();
await h.env.DB.prepare('UPDATE file_objects SET mime_type=? WHERE id=?').bind('application/octet-stream',formatFiles[3].id).run();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      if(req.method==='GET'&&url.pathname.startsWith('/api/data-core/files/'))fileReads.set(url.pathname,(fileReads.get(url.pathname)||0)+1);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
      const body=bytes.length?(String(req.headers['content-type']).startsWith('multipart/form-data')?await new Request('http://localhost',{method:'POST',headers:req.headers,body:bytes}).formData():JSON.parse(bytes.toString())):undefined;
      const result=await h.raw(req.method,url.pathname+url.search,activeUser,body);
      if(req.method==='POST'&&url.pathname.endsWith('/render')&&result.ok)lastRendered=(await result.clone().json()).file;
      res.writeHead(result.status,Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));return;
    }
    const pathname=/^\/data-core\/content\/(instagram|blog)$/.test(url.pathname)?'/data-core/content.html':url.pathname,file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const bytes=await fs.readFile(file);
    if(previewOrigin&&!checked.has(pathname)){
      const remote=await realFetch(previewOrigin+pathname);
      assert.equal(remote.status,200,pathname);
      const hash=data=>createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(pathname)?data.toString('utf8').replace(/\r\n/g,'\n'):data).digest('hex');
      assert.equal(hash(Buffer.from(await remote.arrayBuffer())),hash(bytes),'Preview asset mismatch '+pathname);checked.add(pathname);
    }
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(bytes);
  }catch(error){if(previewOrigin&&error.code!=='ENOENT')assetErrors.push(error.message);res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
try{
  const context=await browser.newContext({serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  const origin='http://127.0.0.1:'+server.address().port;
  // MASTER starts with organization scope, unlike the single-campus fixtures used before.
  activeUser=users.master;
  await page.goto(origin+'/data-core/content/instagram');
  await page.waitForFunction(()=>document.querySelector('#draftCampus').options.length>2);
  assert.equal(await page.locator('#draftCampus').inputValue(),'');
  await page.locator('#draftCampus').selectOption(A);
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===5&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  await page.route('**/instagram-policy?campusId='+B,async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
  const stalePolicy=page.waitForResponse(response=>response.url().endsWith('instagram-policy?campusId='+B));
  await page.locator('#draftCampus').selectOption(B);await page.locator('#draftCampus').selectOption(A);
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===5&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  await stalePolicy;await page.unroute('**/instagram-policy?campusId='+B);
  await page.locator('#draftCampus').selectOption('');assert.equal(await page.locator('[data-logo]').count(),0);
  await page.locator('[data-folder="campus:'+A+'"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===5&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  activeUser=users.staff;
  async function open(){
    await page.goto(origin+'/data-core/content/instagram');
    await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${folder.id}"]`).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-pick-file]').length===11&&document.querySelectorAll('[data-logo]').length===5);
  }
  async function generate(count,mode='original'){
    await open();for(let i=0;i<count;i++)await page.locator(`[data-pick-file="${files[i].id}"]`).click();
    await page.locator('#aiCommand').fill('합성 공간의 밝고 차분한 분위기');await page.locator('#igMode').selectOption(mode);
    await page.locator('#igGenerate').evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>document.querySelector('#igStatus').textContent.endsWith('장 제작 완료'),null,{timeout:180000});
    assert.equal(await page.locator('#igSlides button').count(),count);assert.equal(await page.locator('#igDownloads button').count(),0);
    assert.equal(await page.locator('#igComplete').isEnabled(),true);
    const preview=await page.locator('#igPreview').getAttribute('src');
    assert.match(preview,/^blob:/,'reuse the generated pixels rather than download the just-uploaded master');
    await page.waitForFunction(()=>document.querySelector('#igPreview').naturalWidth===2160);
    await page.locator('#igComplete').evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>document.querySelector('#igSaved').textContent==='저장 완료');
    await page.waitForFunction(()=>!document.querySelector('#igGenerate').disabled,null,{timeout:180000});
    assert.equal(await page.locator('#igPreview').getAttribute('src'),preview);
    assert.equal(await page.locator('#igDownloads button').count(),count);
    const masterPath='/api/data-core/files/'+lastRendered.id;
    assert.equal(fileReads.get(masterPath)||0,0,'no redundant master download during generation/completion');
    avoidedPreviewBytes+=lastRendered.sizeBytes;
    return masterPath;
  }
  await open();assert.equal(await page.locator('#igGenerate').isDisabled(),true);
  for(const logo of ['anihi','hi5','combined','slogan','horizontal']){
    await page.locator(`[data-logo="${logo}"]`).click();assert.equal(await page.locator(`[data-logo="${logo}"]`).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-logo][aria-pressed="true"]').count(),1);
  }
  for(let i=0;i<11;i++)await page.locator(`[data-pick-file="${files[i].id}"]`).click();
  assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),10);
  await page.locator(`[data-pick-file="${files[0].id}"]`).click();assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),9);
  for(const width of [320,390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'overflow '+width);
    assert.equal(await page.locator('#manualWork').isVisible(),false);
    assert.equal(await page.locator('#pastWork').isVisible(),false);
    assert.ok(await page.locator('#aiCommand').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('#igLogos'))&Node.DOCUMENT_POSITION_FOLLOWING)));
    await page.screenshot({path:path.join(out,'input-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const artwork=await generate(1);assert.equal(imageCalls,0);assert.equal(textCalls,1);
  const master=decode(new Uint8Array(await(await h.raw('GET',artwork,users.staff)).arrayBuffer()));
  assert.deepEqual([master.width,master.height],[2160,2700]);
  // Landscape artwork retains all four original corners inside the centered contain box.
  for(const [x,y]of [[62,1114],[2098,1114],[62,1870],[2098,1870]]){
    const offset=(y*master.width+x)*master.channels;assert.deepEqual(Array.from(master.data.slice(offset,offset+3)),[220,60,50]);
  }
  await page.locator('#igCopy').click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('합성 공간'));
  const event=page.waitForEvent('download');await page.locator('#igDownloads button').first().click();const download=await event,file=path.join(out,'published.png');await download.saveAs(file);
  const exported=decode(await fs.readFile(file));assert.deepEqual([exported.width,exported.height],[1080,1350]);
  const photo=await generate(5,'photo-layout');assert.equal(imageCalls,0);
  await page.locator('#igPreview').screenshot({path:path.join(out,'photo-layout.png')});
  const photoImage=decode(new Uint8Array(await(await h.raw('GET',photo,users.staff)).arrayBuffer()));
  for(const [x,y]of [[1080,350],[1080,2630]]){const p=(y*2160+x)*photoImage.channels;assert.notDeepEqual(Array.from(photoImage.data.slice(p,p+3)),[255,255,255]);}
  await generate(10);assert.equal(await page.locator('#igSlides button').count(),10);
  const row=await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE record_type='instagram-carousel-set' ORDER BY created_at DESC LIMIT 1").first();
  const ids=[];for(const item of JSON.parse(row.metadata_json).items){const draft=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(item.draftId).first();ids.push(JSON.parse(draft.metadata_json).relatedFileIds[0]);}
  assert.deepEqual(ids,files.slice(0,10).map(file=>file.id));
  for(const width of [320,390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.locator('#igResult').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'result-'+width+'.png'),fullPage:true});
  }
  await page.route('**/api/data-core/context',async route=>{await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});
  await page.reload();await page.getByText('저장한 이미지 세트',{exact:true}).click();await page.locator('#igHistory button').first().click();
  await page.unroute('**/api/data-core/context');
  await page.waitForFunction(()=>document.querySelector('#igSaved').textContent==='저장된 최종본');assert.equal(await page.locator('#igDownloads button').count(),10);
  assert.ok((await page.locator('#igCaptionText').inputValue()).includes('합성 공간'));
  failText=true;await generate(1,'photo');assert.equal(imageCalls,1);assert.equal(await page.locator('#igCaptionRetry').isVisible(),true);
  failText=false;await page.locator('#igCaptionRetry').click();await page.waitForFunction(()=>document.querySelector('#igCaptionStatus').textContent.includes('작성 완료'));
  assert.equal(imageCalls,1,'caption retry never edits images again');
  const oldPreview=await page.locator('#igPreview').getAttribute('src');
  await page.locator('#aiCommand').fill('새 방향');
  assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},oldPreview),true,'clearing the draft releases the local image');
  await page.goto(origin+'/data-core/content/instagram');
  await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${formatFolder.id}"]`).click();
  for(const file of formatFiles)await page.locator(`[data-pick-file="${file.id}"]`).click();
  // No direction is required for deterministic auto-fit. No external image call is made.
  await page.locator('#igGenerate').click();
  await page.waitForFunction(()=>document.querySelector('#igStatus').textContent==='7장 제작 완료',null,{timeout:180000});
  assert.equal(imageCalls,1);assert.equal(await page.locator('#igSlides button').count(),7);
  await page.screenshot({path:path.join(out,'formats-auto-fit.png'),fullPage:true});
  // Shared picker remains multi-select in the blog editor, without the Instagram controls.
  await page.goto(origin+'/data-core/content/blog');await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${folder.id}"]`).click();
  await page.locator('[data-pick-file]').nth(0).click();await page.locator('[data-pick-file]').nth(1).click();
  assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),2);assert.equal(await page.locator('#igGenerate').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);console.log(JSON.stringify({passed:true,widths:[320,390,768,1024,1440,1920],textCalls,imageCalls,sets:[1,5,10],previewAssets:checked.size,avoidedPreviewBytes,outputs:out}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;await h.mf.dispose();}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {encode,decode} from 'fast-png';
import sharp from 'sharp';
import {libraryHarness,users,A,B} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const out=path.resolve('outputs/instagram-carousel'),root=path.resolve('public');await fs.mkdir(out,{recursive:true});
const previewOrigin=process.argv.includes('--preview')?new URL(process.argv[process.argv.indexOf('--preview')+1]).origin:null;
const checked=new Set(),assetErrors=[];
const baseline=process.argv.includes('--baseline'),measureOnly=process.argv.includes('--measure-only'),measurements=[],assets=new Map();
const h=await libraryHarness(),realFetch=globalThis.fetch;
let textCalls=0,imageCalls=0,failText=false,activeUser=users.staff,failSetOnce=true;
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
const protectedFolder=(await h.folder('category:'+A+':student-artwork','SYNTHETIC protected artwork',users.staff)).body.folder;
const protectedFile=(await h.upload(protectedFolder.id,users.staff,{name:'SYNTHETIC-artwork.png',mime:'image/png',bytes:png})).body.file;
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
      if(failSetOnce&&req.method==='POST'&&url.pathname==='/api/data-core/content/instagram-sets'){
        failSetOnce=false;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Synthetic save failure"}');return;
      }
      const result=await h.raw(req.method,url.pathname+url.search,activeUser,body);
      if(req.method==='POST'&&url.pathname.endsWith('/render')&&result.ok)lastRendered=(await result.clone().json()).file;
      res.writeHead(result.status,Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));return;
    }
    const pathname=/^\/data-core\/content\/(instagram|blog)$/.test(url.pathname)?'/data-core/content.html':url.pathname,file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    if(!assets.has(pathname))assets.set(pathname,baseline?execFileSync('git',['show','818dbc9:public'+pathname],{maxBuffer:20*1024*1024,stdio:['ignore','pipe','ignore']}):await fs.readFile(file));
    const bytes=assets.get(pathname);
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
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===6&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  await page.route('**/instagram-policy?campusId='+B,async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
  const stalePolicy=page.waitForResponse(response=>response.url().endsWith('instagram-policy?campusId='+B));
  await page.locator('#draftCampus').selectOption(B);await page.locator('#draftCampus').selectOption(A);
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===6&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  await stalePolicy;await page.unroute('**/instagram-policy?campusId='+B);
  await page.locator('#draftCampus').selectOption('');assert.equal(await page.locator('[data-logo]').count(),0);
  await page.locator('[data-folder="campus:'+A+'"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-logo]').length===6&&document.querySelector('#igCampusLabel').textContent==='부천 입시본원');
  activeUser=users.staff;
  async function open(){
    await page.goto(origin+'/data-core/content/instagram');
    await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${folder.id}"]`).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-pick-file]').length===11&&document.querySelectorAll('[data-logo]').length===6);
  }
  async function generate(count,mode='original',logo='anihi'){
    await open();for(let i=0;i<count;i++)await page.locator(`[data-pick-file="${files[i].id}"]`).click();
    await page.locator('#aiCommand').fill('합성 공간의 밝고 차분한 분위기');await page.locator('#igMode').selectOption(mode);await page.locator(`[data-logo="${logo}"]`).click();
    const started=performance.now();
    await page.locator('#igGenerate').evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>document.querySelector('#igStatus').textContent.endsWith('장 제작 완료'),null,{timeout:180000});
    if(!baseline){assert.equal(await page.locator('#igPercent').textContent(),'100%');assert.equal(await page.locator('#igProgress').getAttribute('value'),'100');}
    assert.equal(await page.locator('#igSlides button').count(),count);assert.equal(await page.locator('#igDownloads button').count(),0);
    assert.equal(await page.locator('#igComplete').isEnabled(),true);
    const preview=await page.locator('#igPreview').getAttribute('src');
    assert.match(preview,/^blob:/,'reuse the generated pixels rather than download the just-uploaded master');
    await page.waitForFunction(()=>document.querySelector('#igPreview').naturalWidth===2160);
    const expectFailure=failSetOnce;
    const generated=performance.now();
    await page.locator('#igComplete').evaluate(button=>{button.click();button.click();});
    if(expectFailure){await page.waitForFunction(()=>document.querySelector('#igSaved').textContent.includes('저장 실패'));assert.equal(await page.locator('#igDownloads button').count(),0);await page.locator('#igComplete').click();}
    await page.waitForFunction(()=>document.querySelector('#igSaved').textContent==='저장 완료');
    const completed=performance.now();
    await page.waitForFunction(()=>!document.querySelector('#igGenerate').disabled,null,{timeout:180000});
    await page.waitForFunction(()=>/작성 완료|작성하지 못했습니다/.test(document.querySelector('#igCaptionStatus').textContent),null,{timeout:180000});
    measurements.push({count,mode,logo,generateMs:generated-started,completeMs:completed-generated,captionMs:performance.now()-completed,
      stages:await page.evaluate(()=>performance.getEntriesByType('measure').filter(e=>e.name.startsWith('instagram.')).map(e=>({name:e.name,ms:e.duration})))});
    assert.equal(await page.locator('#igPreview').getAttribute('src'),preview);
    assert.equal(await page.locator('#igDownloads button').count(),count);
    const masterPath='/api/data-core/files/'+lastRendered.id;
    assert.equal(fileReads.get(masterPath)||0,0,'no redundant master download during generation/completion');
    avoidedPreviewBytes+=lastRendered.sizeBytes;
    return masterPath;
  }
  if(measureOnly){
    failSetOnce=false;
    for(const count of [1,5,10])for(let repeat=0;repeat<3;repeat++)await generate(count);
    await fs.writeFile(path.join(out,baseline?'timings-before.json':'timings-after.json'),JSON.stringify({baseline:'818dbc9',server:'same current Worker in isolated D1/R2; frontend comparison',measurements},null,2));
    console.log(JSON.stringify(measurements));
  }else{
  await open();assert.equal(await page.locator('#igGenerate').isDisabled(),true);
  for(const logo of ['anihi','hi5','combined','slogan','horizontal','none']){
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
    const boxes=await page.locator('.defaults-grid textarea').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
    assert.equal(boxes[0].y,boxes[1].y,'defaults stay side by side');assert.ok(boxes[1].x>boxes[0].x+boxes[0].width);
    assert.ok(await page.locator('#aiCommand').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('#igLogos'))&Node.DOCUMENT_POSITION_FOLLOWING)));
    await page.waitForFunction(()=>{
      const box=document.querySelector('#filePickList').getBoundingClientRect();
      return [...document.querySelectorAll('#filePickList img[data-thumbnail],#selectedFiles img[data-thumbnail]')].filter(img=>{
        if(img.closest('#selectedFiles'))return true;
        const r=img.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom;
      }).every(img=>img.complete&&img.naturalWidth>0);
    },null,{timeout:30000});
    await page.screenshot({path:path.join(out,'input-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#defaultHashtags').fill('#미술 #합성 #미술');await page.locator('#defaultFooter').fill('합성 문의\n032-000-0000\n');
  await page.locator('#saveDefaults').click();await page.waitForFunction(()=>document.querySelector('#defaultsStatus').textContent.includes('저장되었습니다'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#defaultFooter').value==='합성 문의\n032-000-0000\n');
  await page.route('**/api/data-core/content/defaults',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic defaults failure"}'}));
  await page.locator('#defaultFooter').fill('보존할 입력\n');await page.locator('#saveDefaults').click();await page.waitForFunction(()=>document.querySelector('#defaultsStatus').textContent.includes('Synthetic defaults failure'));
  assert.equal(await page.locator('#defaultFooter').inputValue(),'보존할 입력\n');await page.unroute('**/api/data-core/content/defaults');
  const artwork=await generate(1);assert.equal(imageCalls,0);assert.equal(textCalls,1);
  const captionValue=await page.locator('#igCaptionText').inputValue();assert.ok(captionValue.includes('합성 문의\n032-000-0000\n'));assert.ok(captionValue.endsWith('#미술 #합성'));
  const originalBody='직접 수정한 본문\n'+captionValue;
  await page.locator('#igCaptionText').fill(originalBody);await page.locator('#defaultFooter').fill('새 마지막 문구');await page.locator('#defaultHashtags').fill('#새태그');
  await page.getByRole('button',{name:'현재 결과에 적용',exact:true}).click();
  let changedCaption=await page.locator('#igCaptionText').inputValue();assert.ok(changedCaption.startsWith('직접 수정한 본문\n합성 공간'));assert.ok(changedCaption.endsWith('새 마지막 문구\n\n#새태그'));assert.ok(!changedCaption.includes('합성 문의'));assert.equal(textCalls,1);assert.equal(imageCalls,0);
  await page.locator('#igCaptionSave').click();await page.waitForFunction(()=>document.querySelector('#igCaptionStatus').textContent==='문구 저장 완료');
  const savedTail=await h.env.DB.prepare("SELECT metadata_json,content_text FROM data_records WHERE record_type='instagram-carousel-set' ORDER BY created_at DESC LIMIT 1").first();assert.equal(JSON.parse(savedTail.metadata_json).captionManagedTail,'새 마지막 문구\n\n#새태그');assert.equal(savedTail.content_text,changedCaption);
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
  await page.locator('#defaultFooter').fill('다시 연 결과의 마지막 문구');await page.locator('#defaultHashtags').fill('#다시열기');
  await page.getByRole('button',{name:'현재 결과에 적용',exact:true}).click();
  assert.ok((await page.locator('#igCaptionText').inputValue()).endsWith('다시 연 결과의 마지막 문구\n\n#다시열기'));
  failText=true;await generate(1,'photo');assert.equal(imageCalls,1);assert.equal(await page.locator('#igCaptionRetry').isVisible(),true);
  let releaseCaption,markCaptionHeld;
  const captionHeld=new Promise(resolve=>markCaptionHeld=resolve);
  await page.route('**/api/data-core/content/generate',async route=>{markCaptionHeld();await new Promise(release=>releaseCaption=release);await route.fulfill({json:{generated:{title:'STALE',body:'STALE',hashtags:[]}}}).catch(()=>{});});
  failText=false;await page.locator('#igCaptionRetry').click();await captionHeld;
  assert.equal(await page.locator('#igDownloads button').first().isEnabled(),true);
  assert.equal(await page.locator('#igGenerate').isEnabled(),true);
  assert.equal(imageCalls,1,'caption retry never edits images again');
  await page.locator('[data-logo="none"]').click();assert.match(await page.locator('#igStatus').textContent(),/미저장/);
  releaseCaption();await page.waitForTimeout(100);await page.unroute('**/api/data-core/content/generate');
  assert.equal(await page.locator('#igCaptionText').inputValue(),'','late caption cannot overwrite the changed selection');
  await page.locator('#igGenerate').click();await page.waitForFunction(()=>document.querySelector('#igStatus').textContent==='1장 제작 완료',null,{timeout:180000});
  assert.equal(imageCalls,1,'logo-only changes reuse the authorized AI intermediate');
  const oldPreview=await page.locator('#igPreview').getAttribute('src');
  await page.locator('#aiCommand').fill('새 방향');
  assert.equal(await page.locator('#igResult').isVisible(),false,'changing the command invalidates the preview');
  assert.equal(await page.evaluate(async url=>{try{await fetch(url,{cache:'no-store'});return false;}catch{return true;}},oldPreview),true,'clearing the draft releases the local image');
  await page.goto(origin+'/data-core/content/instagram');
  await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${formatFolder.id}"]`).click();
  for(const file of formatFiles)await page.locator(`[data-pick-file="${file.id}"]`).click();
  // No direction is required for deterministic auto-fit. No external image call is made.
  await page.locator('#igGenerate').click();
  await page.waitForFunction(()=>document.querySelector('#igStatus').textContent==='7장 제작 완료',null,{timeout:180000});
  assert.equal(imageCalls,1);assert.equal(await page.locator('#igSlides button').count(),7);
  await page.screenshot({path:path.join(out,'formats-auto-fit.png'),fullPage:true});
  // A real student-private file selected in AI mode must complete without sending its pixels.
  await page.goto(origin+'/data-core/content/instagram');
  await page.locator(`[data-folder="category:${A}:student-artwork"]`).click();await page.locator(`[data-folder="${protectedFolder.id}"]`).click();
  await page.locator(`[data-pick-file="${protectedFile.id}"]`).click();await page.locator('#igMode').selectOption('photo');
  assert.equal(await page.locator('#igSourceNotice').isVisible(),true);
  const imageCallsBefore=imageCalls;
  await page.locator('#igGenerate').click();
  await page.waitForFunction(()=>document.querySelector('#igStatus').textContent==='1장 제작 완료',null,{timeout:180000});
  assert.equal(imageCalls,imageCallsBefore,'student artwork never sent to image provider');
  assert.equal(await page.locator('#igPercent').textContent(),'100%');
  const preserved=decode(new Uint8Array(await(await h.raw('GET','/api/data-core/files/'+lastRendered.id,users.staff)).arrayBuffer()));
  for(const [x,y]of [[62,1114],[2098,1114],[62,1870],[2098,1870]]){
    const offset=(y*preserved.width+x)*preserved.channels;assert.deepEqual(Array.from(preserved.data.slice(offset,offset+3)),[220,60,50]);
  }
  await page.locator('#igComplete').click();await page.waitForFunction(()=>document.querySelector('#igCaptionStatus').textContent.includes('사진 전송 없이 작성 완료'));
  assert.equal(imageCalls,imageCallsBefore);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.locator('#igProgressWrap').screenshot({path:path.join(out,'progress-'+width+'.png')});
  }
  // Provider wait is stage-based, never a fake timer reaching 100%; cancellation stays below 100.
  await open();await page.locator(`[data-pick-file="${files[0].id}"]`).click();await page.locator('#igMode').selectOption('photo');await page.locator('#aiCommand').fill('합성 사진 보정');
  let releaseImage,holdImage;
  const imageHeld=new Promise(resolve=>holdImage=resolve);
  await page.route('**/api/data-core/content/image-edit',async route=>{holdImage();await new Promise(resolve=>releaseImage=resolve);await route.fulfill({status:503,json:{error:'Synthetic provider unavailable'}}).catch(()=>{});});
  await page.locator('#igGenerate').click();await imageHeld;
  assert.equal(await page.locator('#igPercent').textContent(),'10%');
  assert.match(await page.locator('#igStatus').textContent(),/AI 응답 대기/);
  await page.locator('#igCancel').click();releaseImage();await page.unroute('**/api/data-core/content/image-edit');
  await page.waitForFunction(()=>document.querySelector('#igStatus').textContent.includes('중단했습니다'));
  assert.notEqual(await page.locator('#igPercent').textContent(),'100%');
  await page.locator('#aiCommand').fill('새 작업');assert.equal(await page.locator('#igProgressWrap').isVisible(),false);
  for(const count of [1,5,10]){
    const resource=await generate(count,count===1?'original':'photo-layout','none');
    const noLogo=decode(new Uint8Array(await(await h.raw('GET',resource,users.staff)).arrayBuffer()));
    if(count===1){for(const [x,y]of [[62,972],[2098,972],[62,1728],[2098,1728]]){const p=(y*2160+x)*noLogo.channels;assert.deepEqual(Array.from(noLogo.data.slice(p,p+3)),[220,60,50],'all artwork corners survive');}}
    else for(const [x,y]of [[1080,60],[1080,250],[1080,2630]]){const p=(y*2160+x)*noLogo.channels;assert.notDeepEqual(Array.from(noLogo.data.slice(p,p+3)),[255,255,255],'no blank logo header');}
    const stored=await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE record_type='instagram-carousel-set' ORDER BY created_at DESC LIMIT 1").first();
    const first=JSON.parse(stored.metadata_json).items[0];const draft=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(first.draftId).first();
    assert.equal(JSON.parse(draft.metadata_json).instagramDesign.logoType,'none');
  }
  // Shared picker remains multi-select in the blog editor, without the Instagram controls.
  await page.goto(origin+'/data-core/content/blog');await page.locator(`[data-folder="category:${A}:class-photo"]`).click();await page.locator(`[data-folder="${folder.id}"]`).click();
  await page.locator('[data-pick-file]').nth(0).click();await page.locator('[data-pick-file]').nth(1).click();
  assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),2);assert.equal(await page.locator('#igGenerate').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);console.log(JSON.stringify({passed:true,widths:[320,390,768,1024,1440,1920],textCalls,imageCalls,sets:[1,5,10],previewAssets:checked.size,avoidedPreviewBytes,outputs:out}));
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;await h.mf.dispose();}

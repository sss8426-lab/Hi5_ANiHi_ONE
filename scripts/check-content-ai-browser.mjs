import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { encode, decode } from 'fast-png';
import { libraryHarness, users, A } from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const previewOrigin=process.argv.includes('--preview')?new URL(process.argv[process.argv.indexOf('--preview')+1]).origin:null;
const checked=new Set(),assetErrors=[];
const root=path.resolve('public'), out=path.resolve('outputs/content-ai-browser'+(previewOrigin?'-preview':''));
await fs.mkdir(out,{recursive:true});
const h=await libraryHarness(), originalFetch=globalThis.fetch;
const generated={title:'합성 칸만화 수업',body:'선택한 그림을 살펴보며 표현력을 키우는 수업입니다.',hashtags:['칸만화','미술교육'],cta:'상담 문의'};
const synthetic=encode({width:64,height:80,channels:4,depth:8,data:Uint8Array.from({length:64*80*4},(_,i)=>i%4===3?255:i%4===0?110:i%4===1?178:154)});
let textCalls=0,imageCalls=0,failText=false;
globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
  if(String(url).endsWith('/images/edits')){imageCalls++;return Response.json({data:[{b64_json:Buffer.from(synthetic).toString('base64')}]});}
  textCalls++;if(failText)return Response.json({error:'synthetic failure'},{status:500});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(generated)}]}]});
};
h.env.OPENAI_API_KEY='synthetic-adapter-test-only';
const folder=(await h.folder('category:'+A+':class-photo','__synthetic_browser_photos',users.staff)).body.folder;
for(let i=0;i<7;i++)assert.equal((await h.upload(folder.id,users.staff,{name:'Synthetic-'+i+'.png',mime:'image/png',bytes:synthetic})).status,201);
await h.upload(folder.id,users.staff,{name:'Synthetic-document.txt'});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const bytes=Buffer.concat(chunks);
    const body=bytes.length?(String(req.headers['content-type']).startsWith('multipart/form-data')
      ?await new Request('http://localhost',{method:'POST',headers:req.headers,body:bytes}).formData()
      :JSON.parse(bytes.toString())):undefined;
    const result=await h.raw(req.method,url.pathname+url.search,users.staff,body);
    res.writeHead(result.status,Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));return;
  }
  const pathname=/^\/data-core\/content\/(blog|instagram)$/.test(url.pathname)?'/data-core/content.html':url.pathname;
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    const bytes=await fs.readFile(file);
    if(previewOrigin&&!checked.has(pathname)) {
      const remote=await originalFetch(previewOrigin+pathname);
      assert.equal(remote.status,200,pathname);
      const hash=value=>createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(pathname)?value.toString('utf8').replace(/\r\n/g,'\n'):value).digest('hex');
      assert.equal(hash(Buffer.from(await remote.arrayBuffer())),hash(bytes),'deployed asset mismatch '+pathname);
      checked.add(pathname);
    }
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(bytes);
  }catch(error){if(previewOrigin&&error.code!=='ENOENT'){assetErrors.push(pathname);console.error('Deployed asset check failed:',pathname);}res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'}), errors=[];
try {
  const context=await browser.newContext({serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function open(channel){
    await page.goto(origin+'/data-core/content/'+channel);
    await page.waitForFunction(()=>document.querySelector('#draftCampus').options.length>0);
    await page.locator('[data-folder="category:'+A+':class-photo"]').click();
    await page.locator('[data-folder="'+folder.id+'"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-pick-file]').length===7);
  }
  for(const width of [1920,1440,1280,1024,768,390,320]){
    await page.setViewportSize({width,height:1000});await open('blog');
    assert.equal(await page.locator('#aiResult').isVisible(),false);
    assert.equal(await page.locator('[data-super-admin-nav]:visible').count(),0);
    await page.locator('[data-pick-file]').nth(0).click();await page.locator('[data-pick-file]').nth(1).click();
    await page.locator('[data-preview]').first().click();
    assert.equal(await page.locator('.cig-counter').textContent(),'1 / 7');
    await page.locator('[data-cig-next]').click();await page.waitForFunction(()=>document.querySelector('.cig-feedback')?.hidden&&document.querySelector('.cig-image')?.naturalWidth);
    assert.equal(await page.locator('.cig-counter').textContent(),'2 / 7');await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),2);
    await page.locator('#aiCommand').fill('합성 그림의 수업 기록을 써줘.');
    await page.locator('#defaultHashtags').fill('#칸만화 #합성');
    await page.locator('#defaultFooter').fill('합성 고정 문구');
    await page.locator('#saveDefaults').click();await page.waitForFunction(()=>document.querySelector('#defaultsStatus').textContent.includes('저장'));
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(out,'blog-input-'+width+'.png'),fullPage:true});
    const before=textCalls;await page.locator('#generateAi').click();
    await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent==='작성이 완료되었습니다.');
    assert.equal(textCalls,before+1);
    assert.equal(await page.locator('#draftTitle').inputValue(),generated.title);
    assert.equal(await page.locator('#draftTags').inputValue(),'#칸만화 #합성 #미술교육');
    assert.equal(await page.locator('#resultFooter').inputValue(),'합성 고정 문구');
    await page.locator('#draftContent').fill('수정한 합성 본문');await page.locator('#copyContent').click();
    assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('수정한 합성 본문'));
    await page.locator('#saveDraftBtn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('초안을 저장'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'blog overflow '+width);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(out,'blog-result-'+width+'.png'),fullPage:true});
    await open('instagram');await page.locator('[data-pick-file]').first().click();
    await page.locator('[data-pick-file]').nth(1).click();assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),1);
    await page.locator('[data-preview]').nth(1).click();await page.locator('[data-cig-next]').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-pick-file][aria-pressed="true"]').count(),1);
    await page.locator('#aiCommand').fill('원본을 유지하며 밝게 보정해줘.');
    const old=imageCalls;await page.locator('#generateAi').click();
    await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent==='작성이 완료되었습니다.');
    assert.equal(imageCalls,old+1);
    await page.locator('#aiOutput').evaluate(i=>i.decode());
    assert.deepEqual(await page.locator('#aiOutput').evaluate(i=>[i.naturalWidth,i.naturalHeight]),[2160,2700]);
    await page.locator('#compareImage').click();assert.equal(await page.locator('#aiOriginalFigure').isVisible(),true);
    const pending=page.waitForEvent('download');await page.locator('#downloadImage').click();const download=await pending;
    const file=path.join(out,'download-'+width+'.png');await download.saveAs(file);
    const image=decode(await fs.readFile(file));assert.equal(image.width/image.height,4/5);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'instagram overflow '+width);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(out,'instagram-result-'+width+'.png'),fullPage:true});
    console.log('synthetic adapter UI passed',width);
  }
  await open('instagram');await page.locator('[data-pick-file]').first().click();
  await page.locator('#aiCommand').fill('합성 이미지와 문구');failText=true;
  const beforeRetry=imageCalls;await page.locator('#generateAi').click();
  await page.waitForFunction(()=>!document.querySelector('#retryCaption').hidden);
  assert.equal(imageCalls,beforeRetry+1);assert.equal(await page.locator('#aiOutput').isVisible(),true);
  failText=false;await page.locator('#retryCaption').click();
  await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent==='작성이 완료되었습니다.');
  assert.equal(imageCalls,beforeRetry+1,'caption retry must not edit the image again');
  await open('instagram');await page.locator('[data-pick-file]').first().click();
  const beforeManual=imageCalls;
  await page.locator('#manualWork summary').click();await page.locator('#makeInstagramImage').click();
  await page.waitForFunction(()=>!document.querySelector('#saveDerivative').disabled);
  await page.locator('#saveDerivative').click();
  await page.waitForFunction(()=>document.querySelector('#derivativeStatus').textContent.includes('저장되었습니다'));
  assert.equal(imageCalls,beforeManual,'manual crop must not call OpenAI');
  assert.equal(await page.locator('#selectedDerivatives img').count(),1);
  delete h.env.OPENAI_API_KEY;
  await open('blog');await page.locator('[data-pick-file]').first().click();await page.locator('#aiCommand').fill('합성 글');
  await page.locator('#generateAi').click();await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent.includes('연결 준비'));
  assert.equal(await page.locator('#aiResult').isVisible(),false);
  await page.locator('#manualWork summary').click();await page.locator('#manualDraft').click();
  assert.equal(await page.locator('#draftContent').isVisible(),true);
  assert.deepEqual(errors,[]);
  assert.deepEqual(assetErrors,[]);
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({scope:'isolated synthetic adapter, NOT live OpenAI',previewOrigin,verifiedAssets:checked.size,widths:[1920,1440,1280,1024,768,390,320],textCalls,imageCalls,errors},null,2));
  console.log('PASS: synthetic browser workflow; no production writes or live provider requests');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;await h.mf.dispose();}

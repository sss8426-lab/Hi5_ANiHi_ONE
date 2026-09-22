import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {libraryHarness,users,A,B} from '../tests/support/library-harness.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/sis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const out=resolve('outputs/blog-workflow');await mkdir(out,{recursive:true});
const h=await libraryHarness(),network=[],errors=[],report={synthetic:true,paidAi:false,viewports:[],flows:[]};
const folder=(await h.folder(`category:${A}:academy-photo`,'__synthetic_blog')).body.folder.id;
const files=[];
for(let i=0;i<10;i++){const bytes=await sharp({create:{width:180+i*5,height:120,channels:3,background:{r:30+i*20,g:140,b:100}}}).png().toBuffer();const r=await h.upload(folder,users.admin,{bytes,name:'검증 사진.png',mime:'image/png'});assert.equal(r.status,201);files.push(r.body.file.id);}
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){const parts=[];for await(const part of req)parts.push(part);const headers=new Headers(req.headers);const body=parts.length?(headers.get('content-type')?.includes('multipart/form-data')?await new Response(Buffer.concat(parts),{headers}).formData():JSON.parse(Buffer.concat(parts).toString())):undefined;const response=await h.raw(req.method,url.pathname+url.search,users.admin,body);network.push({method:req.method,url:url.pathname+url.search,status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const file=resolve('public','.'+(url.pathname==='/data-core/content/blog'?'/data-core/content.html':url.pathname));if(!file.startsWith(resolve('public')+sep))throw Error('path');const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});res.end(bytes);
}catch(error){errors.push(String(error));res.writeHead(500);res.end('Synthetic harness failure');}});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/api/data-core/content/generate',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,generated:{strategy:{primaryTopic:'수업',searchIntent:'수업 이해',nextQuestion:'준비',readerProblem:'수업 선택'},titles:{search:'수업 안내',homefeed:'작품을 완성하는 과정',balanced:'수업에서 배우는 관찰'},selectedTitleKind:'balanced',lead:'관찰을 통해 표현을 배웁니다.',body:'학생이 주제를 관찰하고 표현한 과정을 소개합니다.\n\n작업에서 발견한 점을 다음 연습에 연결합니다.',hashtags:['수업기록'],cta:'수업 내용은 문의해주세요.',nextTopics:['다음 수업 준비']}})}));
  await page.route('**/api/data-core/content/blog/text-action',async route=>{const p=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(p.mode==='rewrite'?{text:'간결하게 다듬은 격리 검증 본문입니다.',reason:'의미를 유지하는 검증용 응답'}:{checks:[{blockId:p.blocks[0].id,status:'human_required',reason:'실제 사진과 대조가 필요합니다.'}]})});});
  await page.goto(base+'/data-core/content/blog');await page.waitForSelector('#blogOriginals');
  assert.ok(await page.locator('#blogOriginals').isDisabled());
  for(let i=0;i<30;i++){const value=i%2?A:B;const response=page.waitForResponse(r=>r.url().includes('/content/defaults?')&&r.url().includes(value));await page.locator('#draftCampus').selectOption(value);await response;}
  assert.equal(await page.locator('#blogComplete').count(),1);assert.equal(await page.locator('#blogOriginals').count(),1);report.flows.push('30 campus switches, single workflow and independent defaults');
  await page.locator('#draftCampus').selectOption(A);
  await page.locator(`[data-folder="category:${A}:academy-photo"]`).click();await page.locator(`[data-folder="${folder}"]`).click();await page.waitForSelector('[data-pick-file]');
  for(const id of files.slice(0,5))await page.locator(`[data-pick-file="${id}"]`).click();
  for(let i=0;i<100&&network.filter(n=>n.method==='POST'&&n.url.endsWith('/thumbnail')).length<10;i++)await page.waitForTimeout(100);
  await page.waitForTimeout(500);const start=network.length;
  const event=page.waitForEvent('download');await page.locator('#blogOriginals').click();const download=await event;await download.saveAs(resolve(out,'selected.zip'));
  assert.match(await page.locator('#blogDownloadStatus').innerText(),/다운로드 시작/);
  assert.ok(network.slice(start).every(n=>n.url==='/api/data-core/content/blog/files'||/\/library\/files\/[^/]+\/download$/.test(n.url)),JSON.stringify(network.slice(start)));
  report.flows.push('selection immediately downloads original ZIP without AI/upload/folder requests');
  await page.locator('summary').filter({hasText:'사진별 설명·순서'}).click();await page.locator('[data-photo-id] [data-key=description]').first().fill('선생님의 관찰 연구작입니다.');await page.locator('[data-photo-id] [data-key=kind]').first().selectOption('teacher');
  await page.locator('[data-down="0"]').click();assert.equal(await page.locator('[data-photo-id] [data-key=description]').nth(1).inputValue(),'선생님의 관찰 연구작입니다.');
  for(const kind of ['class','student','teacher','award','admission','recruit']){
    await page.locator('#aiCommand').fill(kind+' 격리 검증용 글');
    await page.locator('#quickGenerateAi').click();await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent.includes('작성이 완료'));
    await page.locator('summary').filter({hasText:'캠퍼스 블로그 양식'}).evaluate(el=>el.parentElement.open=true);
    await page.locator('#blogTemplate').selectOption(kind);await page.locator('#blogPrivacy').check();
    await page.locator('#blogAssemble').click();await page.locator('#blogCompleteSave').click();await page.waitForFunction(()=>document.querySelector('#blogSaveStatus').textContent==='저장 완료');
    report.flows.push(kind+' generated (stub), assembled, saved (real isolated API)');
  }
  await page.locator('summary').filter({hasText:'대표 이미지'}).click();assert.equal(await page.locator('#blogCoverStyle').inputValue(),'work');await page.locator('#blogCoverTitle').fill('관찰과 표현');await page.locator('#blogCoverPreview').click();await page.waitForFunction(()=>!document.querySelector('#blogCoverApply').disabled);
  const pixel=await page.locator('#blogCoverCanvas').evaluate(c=>{const p=c.getContext('2d').getImageData(600,400,1,1).data;return [...p];});assert.notDeepEqual(pixel,[255,255,255,255]);
  await page.locator('#blogCoverApply').click();await page.waitForFunction(()=>document.querySelector('#blogCoverStatus').textContent.includes('적용 완료'));
  await page.locator('#blogAiReview').click();await page.waitForFunction(()=>document.querySelector('#blogAiReviewResult').textContent.includes('실제 사진'));await page.getByRole('button',{name:'이 블록만 AI 다듬기',exact:true}).first().click();await page.waitForSelector('#blogRewriteDialog[open]');await page.locator('#blogRewriteApply').click();await page.locator('#blogUndo').click();
  await page.locator('#blogCompleteSave').click();await page.waitForFunction(()=>document.querySelector('#blogSaveStatus').textContent==='저장 완료');
  const pack=page.waitForEvent('download');await page.locator('#blogPackage').click();await (await pack).saveAs(resolve(out,'publish-package.zip'));
  for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);await page.screenshot({path:resolve(out,`blog-${width}.png`),fullPage:true});report.viewports.push(width);}
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.locator('#blogComplete').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`complete-${width}.png`)});}
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.waitForSelector('#blogOriginals');await page.locator('#pastWork').evaluate(el=>el.open=true);await page.locator('[data-open-draft]').first().click();await page.waitForFunction(()=>document.querySelector('#blogSaveStatus').textContent.includes('저장된 버전'));assert.equal(await page.locator('#blogBlocks img').count(),6);assert.equal(await page.locator('[data-photo-id]').count(),5);
  report.flows.push('cover PNG real save, nonblank canvas, text-only review/rewrite stub, undo, actual HTML/image package, persisted reopen');
  assert.deepEqual(errors,[]);await writeFile(resolve(out,'results.json'),JSON.stringify({...report,network},null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),errors,network},null,2));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));await h.mf.dispose();}

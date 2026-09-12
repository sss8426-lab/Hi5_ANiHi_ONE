import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
const { chromium }=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3135';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)&&!/^https:\/\/[a-f0-9]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(base))throw Error('Local/immutable Preview synthetic testing only');
const out='outputs/curriculum-browser';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const image=await sharp({create:{width:900,height:1200,channels:3,background:'#bad7c4'}}).composite([{input:Buffer.from('<svg width="900" height="1200"><rect x="50" y="50" width="800" height="1100" fill="white" stroke="#247052" stroke-width="8"/><circle cx="450" cy="500" r="200" fill="#cee4d5"/><path d="M100 1000H800 M100 1050H800" stroke="#247052" stroke-width="8"/></svg>')}]).jpeg().toBuffer();
let auth=true,admin=true,catalogRevision=0,failPrint=false,printCalls=0,mutations=0;const errors=[],missing=[],requests=[];
const folders=stage=>Array.from({length:5+catalogRevision},(_,i)=>({id:`syn-${stage}-${i}`,title:`${i+1}-1 합성 수업`,order:i+1,parentFolderId:null,representativeUrl:`/api/data-core/files/thumb-${stage}-${i}-0`,pageCount:4}));
const pages=(stage,folder)=>Array.from({length:4},(_,i)=>({id:`page-${stage}-${folder}-${i}`,folderId:`syn-${stage}-${folder}`,order:i+1,width:900,height:1200,
  previewUrl:`/api/data-core/files/view-${stage}-${folder}-${i}`,thumbnailUrl:`/api/data-core/files/thumb-${stage}-${folder}-${i}`,originalUrl:`/api/data-core/files/original-${stage}-${folder}-${i}`,printUrl:`/api/data-core/files/print-${stage}-${folder}-${i}`}));
try{
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.addInitScript(()=>{window.print=()=>{window.__printCalls=(window.__printCalls||0)+1;};});
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());requests.push(u.pathname);
    if(req.method()==='POST'&&u.pathname==='/api/auth/activity')return route.fulfill({json:{ok:true}});
    // Production's shared shell previews public contest sources with read-only POSTs.
    if(req.method()==='POST'&&/^\/api\/data-core\/competition-sources\/(mgood|artmd)\/preview$/.test(u.pathname))return route.fulfill({json:{items:[]}});
    if(req.method()!=='GET'){mutations++;console.log(JSON.stringify({unexpectedMutation:u.pathname,method:req.method()}));return route.fulfill({status:405,body:''});}
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated:auth,canWrite:auth,isSuperAdmin:auth&&admin,user:auth?{name:'Synthetic QA'}:null,memberships:admin?[]:[{campusId:'synthetic-campus',role:'CAMPUS_ADMIN'}]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname.startsWith('/api/data-core/curriculum')){
      if(!auth)return route.fulfill({status:401,json:{error:'Synthetic unauthenticated'}});
      const match=u.pathname.match(/folders\/syn-(basic|advanced)-(\d+)$/),stage=match?.[1]||u.searchParams.get('stage'),index=match?Number(match[2]):null,lesson=u.searchParams.get('lesson');
      const list=folders(stage),folder=index===null?null:list[index];
      return route.fulfill({json:{family:'content',stage,folder,breadcrumbs:folder?[folder]:[],folders:folder?[]:list,totalPages:list.length*4,
        pages:u.pathname.endsWith('/print')?(lesson?pages(stage,Number(lesson.split('-').at(-1))):list.flatMap((_,i)=>pages(stage,i))):folder?pages(stage,index):[]}});
    }
    if(u.pathname.startsWith('/api/data-core/files/')){
      if(failPrint&&u.pathname.includes('print-')&&u.pathname.endsWith('-1'))return route.fulfill({status:503,body:''});
      return route.fulfill({body:image,contentType:'image/jpeg',headers:{'cache-control':'private, no-cache'}});
    }
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],competitions:[],pages:[],items:[]}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))missing.push(r.url());});
  const widths=[1920,1440,1024,820,390,320],reports=[];
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  for(const width of widths){
    await page.setViewportSize({width,height:1000});
    for(const stage of ['basic','advanced']){
      requests.length=0;await page.goto(`${base}/data-core/curriculum/content/${stage}`);
      await page.locator('.lesson-card').first().waitFor();assert.equal(await page.locator('.lesson-card').count(),5);
      for(const img of await page.locator('.lesson-card img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(i=>i.decode());}
      assert.equal(requests.some(p=>/files\/(view|print|original)-/.test(p)),false);
      await noOverflow();await page.screenshot({path:`${out}/${stage}-${width}-folders.png`,fullPage:true});
      await page.locator('.lesson-card').first().click();await page.locator('.lesson-canvas img').evaluate(i=>i.decode());
      assert.equal(await page.locator('.lesson-counter').textContent(),'1 / 4');
      assert.equal(requests.some(p=>/files\/(print|original)-/.test(p)),false);
      await page.getByRole('button',{name:'다음 페이지',exact:true}).click();assert.ok(page.url().includes('slide=2'));
      await page.reload();await page.getByText('2 / 4',{exact:true}).waitFor();
      await page.keyboard.press('End');assert.equal(await page.locator('.lesson-counter').textContent(),'4 / 4');
      await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.lesson-counter').textContent(),'2 / 4');
      await page.goBack();await page.getByText('1 / 4',{exact:true}).waitFor();
      await page.locator('.lesson-canvas').scrollIntoViewIfNeeded();
      const box=await page.locator('.lesson-canvas').boundingBox();await page.mouse.move(box.x+box.width*.8,box.y+80);await page.mouse.down();await page.mouse.move(box.x+box.width*.2,box.y+80);await page.mouse.up();
      if(await page.locator('.lesson-counter').textContent()!=='2 / 4'){
        await page.screenshot({path:`${out}/swipe-failure-${width}.png`});
        console.log(JSON.stringify(await page.evaluate(({x,y})=>({hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,200),width:innerWidth}),{x:box.x+box.width*.8,y:box.y+80})));
      }
      assert.equal(await page.locator('.lesson-counter').textContent(),'2 / 4');
      await page.locator('.lesson-canvas').click();await page.locator('.lesson-zoom[open] img').evaluate(i=>i.decode());assert.ok((await page.locator('.lesson-zoom img').getAttribute('src')).includes('original-'));
      await page.getByRole('button',{name:'원본 크기로 확대'}).click();assert.equal(await page.locator('.lesson-zoom').evaluate(d=>d.classList.contains('actual-size')),true);await page.keyboard.press('Escape');
      await noOverflow();await page.screenshot({path:`${out}/${stage}-${width}-lesson.png`,fullPage:true});
      await page.getByRole('button',{name:'이 수업 인쇄',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.lesson-status')?.textContent==='인쇄 준비가 완료되었습니다.');
      assert.equal(await page.locator('.curriculum-print-sheet').count(),4);
      await page.emulateMedia({media:'print'});assert.equal(await page.locator('.sidebar').isVisible(),false);
      for(const img of await page.locator('.curriculum-print-sheet img').all())assert.equal(await img.evaluate(i=>getComputedStyle(i).objectFit),'contain');
      if(width===1440)await page.pdf({path:`${out}/${stage}-lesson.pdf`,preferCSSPageSize:true,printBackground:true});
      await page.emulateMedia({media:'screen'});
      await page.locator('.lesson-breadcrumb a').filter({hasText:stage==='basic'?'기초과정':'심화과정'}).click();await page.locator('.lesson-card').first().waitFor();
      await page.getByRole('button',{name:'전체 인쇄',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.lesson-status')?.textContent==='인쇄 준비가 완료되었습니다.');
      assert.equal(await page.locator('.curriculum-print-sheet').count(),20);
      assert.deepEqual(await page.locator('.curriculum-print-sheet').evaluateAll(es=>es.map(e=>e.dataset.page)),folders(stage).flatMap((_,i)=>pages(stage,i)).map(p=>p.id));
      await page.emulateMedia({media:'print'});
      if(width===1440)await page.pdf({path:`${out}/${stage}-all.pdf`,preferCSSPageSize:true,printBackground:true});
      await page.emulateMedia({media:'screen'});
      reports.push({width,stage,passed:true});
    }
    console.log(JSON.stringify({width,passed:true}));
  }
  // Fresh API data must appear without rebuilding the static app, including for a campus account.
  admin=false;await page.goto(`${base}/data-core/curriculum/content/basic`);await page.locator('.lesson-card').first().waitFor();
  assert.equal(await page.locator('.lesson-card').count(),5);catalogRevision=1;
  await page.reload();await page.locator('.lesson-card').nth(5).waitFor();assert.equal(await page.locator('.lesson-card').count(),6);
  await page.locator('.lesson-card').last().click();await page.locator('.lesson-canvas img').evaluate(i=>i.decode());
  await page.locator('[data-print]').click();await page.waitForFunction(()=>document.querySelector('.lesson-status')?.textContent==='인쇄 준비가 완료되었습니다.');
  assert.equal(await page.locator('.curriculum-print-sheet').count(),4);
  catalogRevision=0;
  await page.goto(`${base}/data-core/curriculum/content/basic?lesson=syn-basic-0`);await page.locator('[data-print]').waitFor();failPrint=true;
  printCalls=await page.evaluate(()=>window.__printCalls||0);await page.locator('[data-print]').click();await page.getByRole('button',{name:'다시 시도',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__printCalls||0),printCalls);assert.equal(await page.locator('.curriculum-print-root').count(),0);
  failPrint=false;await page.getByRole('button',{name:'다시 시도',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.lesson-status')?.textContent==='인쇄 준비가 완료되었습니다.');
  auth=false;await page.reload();await page.getByText('로그인이 필요합니다.',{exact:true}).waitFor();assert.equal(await page.locator('.lesson-card,.lesson-reader').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.equal(mutations,0);
  const result={origin:base,checks:reports,errors:0,missingAssets:0,mutations:0,printFailureBlocked:true,campusReadPrint:true,apiUpdatesWithoutRedeploy:true,sourceFilesystemAccess:false};await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}

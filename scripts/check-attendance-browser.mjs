import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {attendanceFixture} from '../tests/helpers/attendance-fixture.mjs';
import {autoFixture} from '../tests/helpers/attendance-auto-fixture.mjs';
import {analyzeWorkbook,generateWorkbook,printWorkbook} from '../public/data-core/work/attendance-auto.js';
import {openTemplate,analyzeSheet,generateAttendance,templateStudents,printDocument} from '../public/data-core/work/attendance-template.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve('public'),out=path.resolve(process.env.ATTENDANCE_ORIGIN?'outputs/attendance-preview':'outputs/attendance-browser');
await fs.mkdir(out,{recursive:true});
const withNav=html=>html.replace('</body>','<script src="/data-core/work/kkumeum-nav.js?v=20260914-attendance-work"></script></body>');
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/data-core/kkumeum')p='/data-core/work/kkumeum.html';if(['/data-core/work','/data-core/work/attendance','/data-core/work/library','/data-core/counseling'].includes(p))p='/data-core/index.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});res.end(p==='/data-core/index.html'?withNav(bytes.toString()):bytes);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.env.ATTENDANCE_ORIGIN||`http://127.0.0.1:${server.address().port}`;
assert.match(base,/^https?:\/\/(?:127\.0\.0\.1:\d+|[a-z0-9.-]+\.workers\.dev)$/);
let previewShell=null;
if(process.env.ATTENDANCE_ORIGIN){
  for(const asset of ['data-core/index.html','data-core/app.js','data-core/work/kkumeum-nav.js','data-core/work/kkumeum.html','data-core/work/kkumeum-mobile.js','data-core/work/attendance-page.js','data-core/work/attendance.js','data-core/work/attendance-template.js','data-core/work/attendance-auto.js','data-core/work/attendance.css','data-core/vendor/fflate-0.8.3.js']){
    const response=await fetch(`${base}/${asset}`);assert.equal(response.status,200,asset);
    const deployed=await response.text();assert.equal(deployed.replace(/\r\n/g,'\n'),(await fs.readFile(path.join(root,asset),'utf8')).replace(/\r\n/g,'\n'),asset);
    if(asset==='data-core/index.html')previewShell=withNav(deployed);
  }
}
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],requests=[],checks=[];let role='CAMPUS_ADMIN';
const sourcePreviewRequest=r=>r.method==='POST'&&/^\/api\/data-core\/competition-sources\/(artmd|mgood)\/preview$/.test(r.path);
try {
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();
    // The staff route requires a real server session. Use its verified deployed shell
    // with synthetic context, never a production login or a forged server cookie.
    if(previewShell&&req.isNavigationRequest()&&u.pathname.startsWith('/data-core/work'))return r.fulfill({contentType:'text/html',body:previewShell});
    if(previewShell&&req.isNavigationRequest()&&u.pathname==='/data-core/kkumeum')return r.fulfill({contentType:'text/html',body:await fs.readFile(path.join(root,'data-core/work/kkumeum.html'),'utf8')});
    if(!u.pathname.startsWith('/api/'))return r.continue();
    requests.push({path:u.pathname,method:req.method()});
    // The common home reads news through POST preview endpoints. Stub those reads too.
    if(sourcePreviewRequest({path:u.pathname,method:req.method()}))return r.fulfill({json:{items:[],preview:{items:[]}}});
    if(req.method()!=='GET')return r.fulfill({status:403,json:{error:'Synthetic test forbids writes'}});
    if(u.pathname==='/api/data-core/context')return r.fulfill({json:{authenticated:role!=='ANONYMOUS',canWrite:role!=='ANONYMOUS',isSuperAdmin:role==='MASTER',user:{displayName:'SYNTHETIC'},memberships:role==='MASTER'?[]:[{role,campusId:'synthetic-a'}]}});
    if(u.pathname==='/api/data-core/health')return r.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname==='/api/data-core/campuses')return r.fulfill({json:{campuses:[{id:'synthetic-a',name:'SYNTHETIC 캠퍼스 A'},{id:'synthetic-b',name:'SYNTHETIC 캠퍼스 B'}]}});
    if(u.pathname==='/api/kkumeum/health')return r.fulfill({json:{status:{ok:true,database:true,files:true}}});
    if(u.pathname==='/api/kkumeum/dashboard')return r.fulfill({json:{dashboard:{students:0,classes:0,reports:{missing:0,draft:0,ready:0,sent:0},guardians:{linked:0}}}});
    return r.fulfill({json:{classes:[],students:[],announcements:[],items:[],reports:[],artworks:[],guardians:[],events:[],categories:[]}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const source=Buffer.from(autoFixture({review:false,students:20,blocks:false}));
  for(const width of [1920,1440,1280,1024,820,768,430,390]){
    await page.setViewportSize({width,height:width>=768?900:844});await page.goto(base+'/data-core/work');
    await page.locator('[data-kkumeum-card]').waitFor();
    assert.equal(await page.locator('[data-kkumeum-nav] + [data-view=attendance]').count(),1);
    await page.locator('.at-work-link').click();await page.locator('#atFile').waitFor();
    assert.equal(new URL(page.url()).pathname,'/data-core/work/attendance');
    assert.equal(await page.locator('#kkMobileApp').count(),0);
    assert.equal(await page.locator('#atCampus option').count(),1);
    assert.equal(await page.locator('#atCampus').isDisabled(),true);
    for(const id of ['atFile','atMonth','atGenerate'])assert.equal(await page.locator('#'+id).isVisible(),true);
    assert.equal(await page.locator('#atGenerate').isDisabled(),true);
    assert.equal(await page.locator('#atMapping,#atSource,#atYear').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    if(width>=768)assert.ok(await page.locator('#atGenerate').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight));
    await page.screenshot({path:path.join(out,width+'-initial.png'),fullPage:true});
    await page.locator('#atFile').setInputFiles({name:'출석부26.09_.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});
    await page.locator('#atGenerate:not([disabled])').waitFor();
    assert.equal(await page.locator('#atMonth').inputValue(),'2026-10');
    assert.match(await page.locator('#atRecognized').textContent(),/2개 출석부 확인/);
    await page.locator('#atGenerate').click();await page.locator('#atResult:visible').waitFor();
    assert.equal(await page.locator('#atTabs [role=tab]').count(),2);
    assert.match(await page.locator('#atEstimate').textContent(),/A4 가로 1장/);
    assert.equal(await page.locator('#atTable [data-cell=AH2]').textContent(),'31');
    await page.locator('#atTab1').click();
    assert.equal(await page.locator('#atTable [data-cell=AS2]').textContent(),'31');
    assert.equal(await page.locator('#atTab1').getAttribute('aria-selected'),'true');
    await page.locator('#atTab1').press('ArrowLeft');
    assert.equal(await page.locator('#atTab0').getAttribute('aria-selected'),'true');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.locator('#atSize').click();
    assert.equal(await page.locator('#atSize').getAttribute('aria-pressed'),'true');
    await page.locator('#atSize').click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,width+'-result.png'),fullPage:true});
    const event=page.waitForEvent('download');await page.locator('#atDownload').click();const download=await event;
    assert.equal(download.suggestedFilename(),'출석부26.10_.xlsx');
    await download.saveAs(path.join(out,'download-'+width+'.xlsx'));
    const reopened=openTemplate(await fs.readFile(path.join(out,'download-'+width+'.xlsx')),{DOMParser,XMLSerializer});
    assert.equal(analyzeWorkbook(reopened,download.suggestedFilename()).month,10);
    checks.push({width,simpleUI:true,tabs:true,download:true,layout:true});
  }
  await page.locator('#atPrint').click();
  await page.waitForFunction(()=>document.querySelector('.at-print-frame')?.contentDocument?.querySelectorAll('.at-print-page').length===2);
  await page.locator('#atAgain').click();await page.locator('#atMonth').fill('2027-02');
  await page.locator('#atGenerate').click();await page.locator('#atResult:visible').waitFor();
  assert.equal(await page.locator('#atTable [data-cell=AH2]').textContent(),'');
  await page.locator('#atAgain').click();
  const reviewSource=Buffer.from(autoFixture());
  await page.locator('#atFile').setInputFiles({name:'출석부26.09_.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:reviewSource});
  await page.locator('#atReviewPrompt:visible').waitFor();
  assert.match(await page.locator('#atReviewCount').textContent(),/2명/);
  assert.equal(await page.locator('#atGenerate').isDisabled(),true);
  await page.locator('#atReview').click();await page.locator('#atReviewSave').click();
  assert.match(await page.locator('#atReviewError').textContent(),/선택/);
  for(const item of await page.locator('[data-review]').all())await item.locator('input[value="1"]').check();
  await page.locator('#atReviewSave').click();await page.locator('#atGenerate').click();await page.locator('#atResult:visible').waitFor();
  await page.locator('#atAgain').click();
  await page.locator('#atFile').setInputFiles({name:'invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('invalid')});
  await page.locator('#atStatus').filter({hasText:/자동으로 인식/}).waitFor();
  assert.equal(await page.locator('#atGenerate').isDisabled(),true);
  assert.equal(await page.locator('#atResult').isVisible(),false);
  assert.equal(await page.locator('#atMapping,#atSource').count(),0);
  await page.locator('#atFile').setInputFiles([]);
  await page.locator('#view-attendance [data-view=work-home]').click();await page.goBack();await page.locator('#atFile').waitFor();
  assert.equal(await page.locator('#atResult').isVisible(),false);
  await page.goto(base+'/data-core/kkumeum?view=attendance');await page.waitForURL('**/data-core/work/attendance');
  role='MASTER';await page.reload();await page.locator('#atFile').waitFor();
  await page.locator('#atFile').setInputFiles({name:'출석부26.09_.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});
  await page.locator('#atGenerate:not([disabled])').waitFor();
  await page.locator('#atCampus').selectOption('synthetic-b');assert.equal(await page.locator('#atGenerate').isDisabled(),true);
  assert.equal(await page.locator('#atRecognized').isVisible(),false);
  role='TEACHER';await page.reload();await page.locator('#atFile').waitFor();
  role='STAFF';await page.reload();await page.getByText('출석부 생성은 캠퍼스 관리자와 교사만 사용할 수 있습니다.').waitFor();
  role='ANONYMOUS';await page.reload();await page.getByText('로그인 후 출석부를 사용할 수 있습니다.').waitFor();
  checks.push({review:true,invalidFile:true,reset:true,campusIsolation:true,roles:true,february:true,printDialog:true});
  const autoTemplate=openTemplate(autoFixture({students:45,review:false,fit:false}),{DOMParser,XMLSerializer});
  const autoOutput=generateWorkbook(autoTemplate,analyzeWorkbook(autoTemplate,'출석부26.09_.xlsx'),{year:2026,month:10});
  const printedAuto=await context.newPage();await printedAuto.setContent(printWorkbook(autoOutput));
  await printedAuto.evaluate(()=>document.fonts.ready);
  await printedAuto.pdf({path:path.join(out,'automatic-two-sheets.pdf'),preferCSSPageSize:true,printBackground:true});
  const expected=autoOutput.results.reduce((n,r)=>n+r.plan.pages.length,0);
  assert.equal(await printedAuto.locator('.at-print-page').count(),expected);
  for(const sheet of ['.at-book-0','.at-book-1']){
    const last=sheet.endsWith('0')?'AH2':'AS2';
    for(const p of await printedAuto.locator(sheet+' .at-print-page').all()){
      assert.equal(await p.locator('[data-cell='+last+']').textContent(),'31');
      const fits=await p.evaluate(el=>{const t=el.querySelector('table').getBoundingClientRect(),b=el.getBoundingClientRect();return t.right<=b.right+1&&t.bottom<=b.bottom+3;});
      assert.equal(fits,true);
    }
  }
  await printedAuto.screenshot({path:path.join(out,'automatic-print.png'),fullPage:true});await printedAuto.close();
  checks.push({automaticPDF:true,pages:expected});
  // Real Chromium PDF generation, not only CSS/emulated print assertions.
  for(const spec of [{students:20},{students:30},{students:30,total:60},{students:20,month:2},{students:30,orientation:'portrait'}]){
    const source=attendanceFixture(spec),template=openTemplate(source,{DOMParser,XMLSerializer}),m=analyzeSheet(template,0),students=templateStudents(template,m);
    if(spec.total)students.push(...Array.from({length:spec.total-students.length},(_,i)=>({name:`SYNTHETIC_EXTRA_${i}`,weekdays:'화목'})));
    const result=generateAttendance(template,m,{year:2027,month:spec.month||10,students});const id=`${spec.total||spec.students}-${spec.month||10}-${spec.orientation||'landscape'}`;
    const printed=await context.newPage();await printed.setContent(printDocument(result));await printed.evaluate(()=>document.fonts.ready);await printed.pdf({path:path.join(out,`${id}.pdf`),preferCSSPageSize:true,printBackground:true});
    for(const [i,p] of await printed.locator('.at-print-page').all().then(a=>a.map((p,i)=>[i,p]))) {
      const geo=await p.evaluate(el=>{const table=el.querySelector('table').getBoundingClientRect(),box=el.getBoundingClientRect();return {width:table.width,height:table.height,boxWidth:box.width,boxHeight:box.height,right:table.right-box.left,bottom:table.bottom-box.top};});
      assert.ok(geo.right<=geo.boxWidth+1,JSON.stringify(geo));assert.ok(geo.bottom<=geo.boxHeight+3,JSON.stringify(geo));assert.equal(await p.locator('[data-cell=AG2]').count(),1);
      await p.screenshot({path:path.join(out,`${id}-page-${i+1}.png`)});
    }
    checks.push({pdf:id,pages:result.plan.pages.length});await printed.close();
  }
  const unexpected=requests.filter(r=>r.method!=='GET'&&!sourcePreviewRequest(r));
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  const result={base,checks,errors,mutations:0,realStudentData:false,authentication:'synthetic context; not a live account login'};await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}

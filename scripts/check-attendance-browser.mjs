import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {attendanceFixture} from '../tests/helpers/attendance-fixture.mjs';
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
  for(const asset of ['data-core/index.html','data-core/app.js','data-core/work/kkumeum-nav.js','data-core/work/kkumeum.html','data-core/work/kkumeum-mobile.js','data-core/work/attendance-page.js','data-core/work/attendance.js','data-core/work/attendance-template.js','data-core/work/attendance.css','data-core/vendor/fflate-0.8.3.js']){
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
  const source=Buffer.from(attendanceFixture({students:30}));
  for(const width of [1920,1440,1280,1024,768,390,320]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/data-core/work');
    await page.locator('[data-kkumeum-card]').waitFor();
    assert.equal(await page.locator('[data-kkumeum-nav] + [data-view=attendance]').count(),1);
    const below=await page.locator('.at-work-link').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('[data-kkumeum-card]').getBoundingClientRect().bottom);
    assert.equal(below,true);
    await page.screenshot({path:path.join(out,`${width}-work-home.png`),fullPage:true});
    await page.locator('.at-work-link').click();await page.locator('#atFile').waitFor();
    assert.equal(new URL(page.url()).pathname,'/data-core/work/attendance');
    assert.equal(await page.locator('#kkMobileApp').count(),0);
    assert.equal(await page.locator('#atCampus option').count(),1);
    assert.equal(await page.locator('#atCampus').isDisabled(),true);
    assert.equal(await page.locator('[data-nav-scope=work] [data-view=attendance]').getAttribute('class'),'nav-item active');
    for(const id of ['atYear','atMonth','atPreviousMonth','atNextMonth','atThisMonth','atClosures','atDownload','atPrint'])assert.equal(await page.locator(`#${id}`).isVisible(),true,id);
    for(const id of ['atGenerate','atClosures','atDownload','atPrint'])assert.equal(await page.locator(`#${id}`).isDisabled(),true,id);
    assert.equal(await page.locator('#atRoster summary').isVisible(),true);
    await page.locator('#atYear').selectOption('2026');await page.locator('#atMonth').selectOption('10');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:path.join(out,`${width}-initial.png`),fullPage:true});
    await page.locator('#atFile').setInputFiles({name:'SYNTHETIC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});
    await page.locator('#atTemplateControls:not([disabled])').waitFor();assert.equal(await page.locator('#atYear').inputValue(),'2026');assert.equal(await page.locator('#atMonth').inputValue(),'10');await page.locator('#atMapping').evaluate(e=>e.open=false);await page.locator('#atConfirm').check();
    await page.locator('#atForm [type=submit]').click();await page.locator('#atResult:visible').waitFor();assert.match(await page.locator('#atEstimate').textContent(),/A4 가로 1장/);
    assert.equal(await page.locator('#atTable [data-cell=AG2]').textContent(),'31');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('#atPreview').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
    await page.locator('#atActual').click();assert.equal(await page.locator('#atPreview').evaluate(el=>el.scrollWidth>el.clientWidth),await page.locator('#atPreview').evaluate(el=>document.querySelector('#atTable').offsetWidth>el.clientWidth));
    await page.locator('#atFit').click();await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,`${width}.png`),fullPage:true});
    await page.screenshot({path:path.join(out,`${width}-viewport.png`)});
    const downloadPromise=page.waitForEvent('download');await page.locator('#atDownload').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/2026년_10월_출석부\.xlsx$/);await download.saveAs(path.join(out,`download-${width}.xlsx`));
    const reopened=openTemplate(new Uint8Array(await fs.readFile(path.join(out,`download-${width}.xlsx`))),{DOMParser,XMLSerializer});assert.equal(analyzeSheet(reopened,0).sourceMonth,10);
    checks.push({width,initialYearMonth:true,initialTools:true,fit:true,scroll:true,download:true,pages:1});
  }
  await page.locator('#atPrint').click();await page.locator('.at-print-frame').waitFor({state:'attached'}).catch(()=>{});
  await page.setViewportSize({width:1024,height:1000});
  await page.locator('#atNextMonth').click();assert.equal(await page.locator('#atMonth').inputValue(),'11');
  assert.equal(await page.locator('#atResult').isVisible(),false);assert.equal(await page.locator('#atDownload').isDisabled(),true);
  await page.locator('#atYear').selectOption('2026');await page.locator('#atMonth').selectOption('12');await page.locator('#atNextMonth').click();
  assert.equal(await page.locator('#atYear').inputValue(),'2027');assert.equal(await page.locator('#atMonth').inputValue(),'1');await page.locator('#atPreviousMonth').click();assert.equal(await page.locator('#atYear').inputValue(),'2026');assert.equal(await page.locator('#atMonth').inputValue(),'12');
  await page.locator('#atYear').selectOption('1901');await page.locator('#atMonth').selectOption('1');assert.equal(await page.locator('#atPreviousMonth').isDisabled(),true);
  await page.locator('#atYear').selectOption('2100');await page.locator('#atMonth').selectOption('12');assert.equal(await page.locator('#atNextMonth').isDisabled(),true);
  await page.locator('#atThisMonth').click();const today=await page.evaluate(()=>({year:String(new Date().getFullYear()),month:String(new Date().getMonth()+1)}));assert.equal(await page.locator('#atYear').inputValue(),today.year);assert.equal(await page.locator('#atMonth').inputValue(),today.month);
  await page.locator('#atYear').selectOption('2027');await page.locator('#atMonth').selectOption('2');
  await page.locator('#atRoster summary').click();await page.locator('[data-student="0"][data-field="weekdays"]').fill('화목');await page.locator('[data-student="0"][data-field="makeup"]').fill('2');await page.locator('#atClosures').fill('1');await page.locator('#atClear').check();await page.locator('#atConfirm').check();
  await page.locator('#atGenerate').click();await page.locator('#atResult:visible').waitFor();assert.equal(await page.locator('#atTable [data-cell=AG2]').textContent(),'');assert.equal(await page.locator('#atTable [data-cell=AG4]').textContent(),'');assert.equal(await page.locator('#atTable [data-cell=B4]').textContent(),'화목');
  const colors=await page.locator('#atTable').evaluate(el=>['C4','D4'].map(ref=>getComputedStyle(el.querySelector(`[data-cell="${ref}"]`)).backgroundColor));assert.notEqual(colors[0],colors[1]);
  await page.locator('#atClosures').fill('29');assert.equal(await page.locator('#atDownload').isDisabled(),true);await page.locator('#atConfirm').check();await page.locator('#atGenerate').click();await page.getByText(/휴원일이 선택한 월/).waitFor();assert.equal(await page.locator('#atResult').isVisible(),false);
  await page.locator('#atClosures').fill('1');await page.locator('#atConfirm').check();await page.locator('#atGenerate').click();await page.locator('#atResult:visible').waitFor();
  await page.locator('#atRoster summary').click();await page.screenshot({path:path.join(out,'1024-february.png'),fullPage:true});
  await page.locator('#atFile').setInputFiles({name:'SYNTHETIC-invalid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('not a workbook')});
  await page.locator('#atStatus').filter({hasText:/xlsx 파일을/}).waitFor();assert.equal(await page.locator('#atYear').isEnabled(),true);assert.equal(await page.locator('#atGenerate').isDisabled(),true);assert.equal(await page.locator('#atDownload').isDisabled(),true);assert.equal(await page.locator('#atSource').textContent(),'');assert.equal(await page.locator('[data-student]').count(),0);
  await page.locator('#atFile').setInputFiles({name:'SYNTHETIC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});await page.locator('#atTemplateControls:not([disabled])').waitFor();assert.equal(await page.locator('#atMonth').inputValue(),'2');
  await page.locator('#atSheet').selectOption('1');assert.equal(await page.locator('#atMapping').getAttribute('open'),'');assert.equal(await page.locator('[data-student]').count(),0);assert.equal(await page.locator('#atDownload').isDisabled(),true);
  await page.locator('#atSheet').selectOption('0');assert.equal(await page.locator('#atStudentCount').textContent(),'30명');
  await page.locator('#atMapping summary').click();await page.locator('#atReadRows').click();assert.equal(await page.locator('#atStudentCount').textContent(),'30명');await page.locator('#atMapping summary').click();
  const original=page.locator('details').filter({has:page.locator('#atSource')});await original.locator('summary').click();assert.match(await page.locator('#atSource').textContent(),/2026년 9월/);await original.locator('summary').click();
  await page.locator('#atRoster summary').click();await page.locator('#atAdd').click();assert.equal(await page.locator('[data-field=name]').count(),31);await page.locator('[data-student="30"][data-field=name]').fill('SYNTHETIC_ADDED');assert.equal(await page.locator('#atStudentCount').textContent(),'31명');await page.locator('[data-clear-row="30"]').click();assert.equal(await page.locator('#atStudentCount').textContent(),'30명');assert.equal(await page.locator('[data-student="30"][data-field=name]').inputValue(),'');
  await page.locator('#atFile').setInputFiles([]);assert.equal(await page.locator('#atGenerate').isDisabled(),true);assert.equal(await page.locator('[data-student]').count(),0);assert.equal(await page.locator('#atMonth').inputValue(),'2');
  checks.push({monthNavigation:true,yearBounds:true,thisMonth:true,weekdays:true,makeups:true,closures:true,invalidDateBlocked:true,staleDownloadBlocked:true,invalidFileRecovery:true,sheetSwitch:true,mapping:true,originalPreview:true,addClearStudent:true,clearFile:true});
  await page.locator('#view-attendance [data-view=work-home]').click();await page.goBack();await page.locator('#atFile').waitFor();assert.equal(await page.locator('#atResult').isVisible(),false);
  await page.goto(base+'/data-core/kkumeum?view=attendance');await page.waitForURL('**/data-core/work/attendance');await page.locator('#atFile').waitFor();
  role='MASTER';await page.reload();await page.locator('#atFile').waitFor();await page.locator('#atFile').setInputFiles({name:'SYNTHETIC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});await page.locator('#atTemplateControls:not([disabled])').waitFor();await page.locator('#atCampus').selectOption('synthetic-b');await page.locator('#atFile').waitFor();assert.equal(await page.locator('#atYear').isVisible(),true);assert.equal(await page.locator('#atGenerate').isDisabled(),true);assert.equal(await page.locator('#atResult').isVisible(),false);assert.equal(await page.locator('[data-student]').count(),0);
  role='TEACHER';await page.reload();await page.locator('#atFile').waitFor();
  role='STAFF';await page.reload();await page.getByText('출석부 생성은 캠퍼스 관리자와 교사만 사용할 수 있습니다.').waitFor();assert.equal(await page.locator('#atFile').count(),0);
  role='ANONYMOUS';await page.reload();await page.getByText('로그인 후 출석부를 사용할 수 있습니다.').waitFor();assert.equal(await page.locator('#atFile').count(),0);
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

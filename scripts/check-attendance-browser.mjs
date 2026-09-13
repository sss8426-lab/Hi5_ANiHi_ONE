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
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/data-core/kkumeum')p='/data-core/work/kkumeum.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'});res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.env.ATTENDANCE_ORIGIN||`http://127.0.0.1:${server.address().port}`;
assert.match(base,/^https?:\/\/(?:127\.0\.0\.1:\d+|[a-z0-9.-]+\.workers\.dev)$/);
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],requests=[],checks=[];let role='CAMPUS_ADMIN';
try {
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',r=>{
    const req=r.request(),u=new URL(req.url());if(u.origin!==base)return r.abort();
    if(!u.pathname.startsWith('/api/'))return r.continue();
    requests.push({path:u.pathname,method:req.method()});
    if(req.method()!=='GET')return r.fulfill({status:403,json:{error:'Synthetic test forbids writes'}});
    if(u.pathname==='/api/data-core/context')return r.fulfill({json:{authenticated:role!=='ANONYMOUS',isSuperAdmin:role==='MASTER',user:{displayName:'SYNTHETIC'},memberships:role==='MASTER'?[]:[{role,campusId:'synthetic-a'}]}});
    if(u.pathname==='/api/data-core/campuses')return r.fulfill({json:{campuses:[{id:'synthetic-a',name:'SYNTHETIC 캠퍼스 A'},...(role==='MASTER'?[{id:'synthetic-b',name:'SYNTHETIC 캠퍼스 B'}]:[])]}});
    if(u.pathname==='/api/kkumeum/health')return r.fulfill({json:{status:{ok:true,database:true,files:true}}});
    if(u.pathname==='/api/kkumeum/dashboard')return r.fulfill({json:{dashboard:{students:0,classes:0,reports:{missing:0,draft:0,ready:0,sent:0},guardians:{linked:0}}}});
    return r.fulfill({json:{classes:[],students:[],announcements:[],items:[],reports:[],artworks:[],guardians:[],events:[],categories:[]}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const source=Buffer.from(attendanceFixture({students:30}));
  for(const width of [1920,1440,1280,1024,768,390,320]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/data-core/kkumeum?view=attendance');await page.locator('#atFile').waitFor();
    await page.locator('#atFile').setInputFiles({name:'SYNTHETIC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});
    await page.locator('#atForm:visible').waitFor();await page.locator('#atMonth').fill('2026-10');await page.locator('#atMapping').evaluate(e=>e.open=false);await page.locator('#atConfirm').check();
    await page.locator('#atForm [type=submit]').click();await page.locator('#atResult:visible').waitFor();assert.match(await page.locator('#atEstimate').textContent(),/A4 가로 1장/);
    assert.equal(await page.locator('#atTable [data-cell=AG2]').textContent(),'31');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('#atPreview').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
    await page.locator('#atActual').click();assert.equal(await page.locator('#atPreview').evaluate(el=>el.scrollWidth>el.clientWidth),true);
    await page.locator('#atFit').click();await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,`${width}.png`),fullPage:true});
    await page.screenshot({path:path.join(out,`${width}-viewport.png`)});
    const downloadPromise=page.waitForEvent('download');await page.locator('#atDownload').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/2026년_10월_출석부\.xlsx$/);await download.saveAs(path.join(out,`download-${width}.xlsx`));
    const reopened=openTemplate(new Uint8Array(await fs.readFile(path.join(out,`download-${width}.xlsx`))),{DOMParser,XMLSerializer});assert.equal(analyzeSheet(reopened,0).sourceMonth,10);
    checks.push({width,fit:true,scroll:true,download:true,pages:1});
  }
  await page.locator('#atPrint').click();await page.locator('.at-print-frame').waitFor({state:'attached'}).catch(()=>{});
  await page.locator('[data-menu=news]').click();await page.goBack();await page.locator('#atFile').waitFor();assert.equal(await page.locator('#atResult').isVisible(),false);
  role='MASTER';await page.reload();await page.locator('#atFile').waitFor();await page.locator('#atFile').setInputFiles({name:'SYNTHETIC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});await page.locator('#atForm:visible').waitFor();await page.locator('#kmCampus').selectOption('synthetic-b');await page.locator('[data-menu=attendance]').click();await page.locator('#atFile').waitFor();assert.equal(await page.locator('#atForm').isVisible(),false);
  role='TEACHER';await page.reload();await page.locator('#atFile').waitFor();
  role='STAFF';await page.reload();await page.getByText('출석부 생성은 캠퍼스 관리자와 교사만 사용할 수 있습니다.').waitFor();assert.equal(await page.locator('#atFile').count(),0);
  role='ANONYMOUS';await page.reload();await page.locator('[data-retry]').waitFor();assert.equal(await page.locator('#atFile').count(),0);
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
  assert.equal(requests.some(r=>r.method!=='GET'),false);assert.deepEqual(errors,[]);
  const result={base,checks,errors,mutations:0,realStudentData:false};await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}

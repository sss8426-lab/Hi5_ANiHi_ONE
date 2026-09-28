import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {expandedRosterFixture} from '../tests/helpers/attendance-roster-fixture.mjs';
import {parseRoster} from '../public/data-core/work/attendance-roster-parser.js';
import {openTemplate} from '../public/data-core/work/attendance-template.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve('public'),out=path.resolve('outputs/attendance-roster-browser');
await fs.mkdir(out,{recursive:true});
const testPage=`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/data-core/work/attendance.css"></head><body><main id="attendanceHost"></main><script type="module">import {mountAttendancePage} from '/data-core/work/attendance-page.js';mountAttendancePage(document.querySelector('#attendanceHost'),{context:{authenticated:true,isSuperAdmin:false,memberships:[{campusId:'synthetic-a',role:'CAMPUS_ADMIN'}]},campuses:[{id:'synthetic-a',name:'SYNTHETIC 캠퍼스'}]});</script></body></html>`;
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://local').pathname;
    if(pathname==='/attendance-test.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(testPage);}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    const bytes=await fs.readFile(file);
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});
    res.end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.ATTENDANCE_BROWSER_CHANNEL||'chrome',headless:true});
const errors=[],requests=[];
try{
  const context=await browser.newContext({acceptDownloads:true});
  await context.route('**/api/data-core/calendar**',async route=>{
    const request=route.request();requests.push({method:request.method(),url:request.url()});
    if(request.method()!=='GET')return route.fulfill({status:403,json:{error:'Synthetic test forbids writes'}});
    return route.fulfill({json:{events:[],hasMore:false}});
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const fixture=expandedRosterFixture(),fileBytes=Buffer.from(fixture.bytes),roster=parseRoster(fixture.bytes,{DOMParser,XMLSerializer});
  assert.equal(roster.studentCount,2);assert.deepEqual(roster.issues,[]);
  for(const width of [1920,1440,1024,768,390,320]){
    console.log(`browser check ${width}px: opening`);
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/attendance-test.html');
    await page.locator('#arFile').waitFor();
    assert.equal(await page.locator('#atTemplate').getAttribute('href').then(href=>href.startsWith('/data-core/work/templates/attendance-roster-template.xlsx')),true);
    assert.equal(await page.locator('.at-legacy,#atFile').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`initial horizontal overflow at ${width}px`);
    await page.locator('#arFile').setInputFiles({name:'synthetic-expanded.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fileBytes});
    console.log(`browser check ${width}px: uploaded`);
    await page.locator('#arSummary:not([hidden])').waitFor();
    assert.match(await page.locator('#arSummary').textContent(),/학생2명/);
    assert.equal(await page.locator('#arGenerate').isDisabled(),false);
    const year=await page.locator('#arYear').inputValue(),month=await page.locator('#arMonth').inputValue();
    await page.locator('#arGenerate').click();await page.locator('#arResult:not([hidden])').waitFor();
    console.log(`browser check ${width}px: generated`);
    assert.equal(await page.locator('#arSheets tr').count(),1);
    assert.match(await page.locator('#arSheets').textContent(),/2명/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`result horizontal overflow at ${width}px`);
    const downloadEvent=page.waitForEvent('download');await page.locator('#arDownload').click();
    const download=await downloadEvent,downloadBytes=await fs.readFile(await download.path());
    console.log(`browser check ${width}px: downloaded`);
    const generated=openTemplate(downloadBytes,{DOMParser,XMLSerializer});
    assert.equal(generated.sheets.length,1);
    assert.match(download.suggestedFilename(),new RegExp(`${year}년${String(month).padStart(2,'0')}월_반별출석부\\.xlsx$`));
    await page.screenshot({path:path.join(out,`${width}px.png`),fullPage:true});
  }
  assert.ok(requests.length>0);
  assert.ok(requests.every(({method})=>method==='GET'));
  assert.deepEqual(errors,[]);
  const result={view:'roster attendance',syntheticStudents:roster.studentCount,widths:[1920,1440,1024,768,390,320],uploadGenerateDownload:true,generatedWorkbook:'one class sheet',mutations:0,calendarRequests:requests.length,pageErrors:errors};
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

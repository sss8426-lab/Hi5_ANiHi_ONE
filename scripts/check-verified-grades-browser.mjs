import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve('public');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const body=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const output=path.resolve('outputs/verified-grades');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const grades=Array.from({length:10},(_,i)=>({id:`test-${i}`,schoolYear:'1학년',semester:'1학기',subjectName:`합성과목${i}`,subjectGroup:['KOREAN','MATH','ENGLISH','SOCIAL','SCIENCE'][i%5],subjectType:'COMMON',grade:3}));
let db={students:[{id:1,name:'합성 학생',track:'웹툰',detailedTranscript:grades,notes:'보존 대상'},{id:2,name:'평균만 학생',gpa:3}],universities:[],cases:[],settings:{}},failSave=false,writes=0,checks=0;
const errors=[],external=[],requests=[];
try{
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());requests.push({url:url.href,method:request.method()});
    if(url.origin!==base){external.push(url.href);return route.abort();}
    if(url.pathname==='/api/data'){
      if(request.method()==='PUT'){if(failSave)return route.fulfill({status:403,json:{error:'합성 권한 오류'}});db=request.postDataJSON();writes++;return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:db});
    }
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const nav=async section=>{const button=page.locator(`#nav [data-page=${section}]`);if(!await button.isVisible())await page.locator('.core-menu-toggle').click();await button.click();await page.locator(`#${section} [data-calculate]`).waitFor();};
  for(const width of [320,390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});await page.goto(`${base}/admissions-web/renderer/index.html`);
    const scope=page.locator('#dashboard');await scope.locator('[data-sample]').click();
    const before=requests.length;await scope.locator('[data-calculate]').click();
    assert.equal(await scope.locator('.vg-result').count(),8);assert.match(await scope.locator('[data-status]').textContent(),/예시/);
    assert.equal(requests.slice(before).filter(r=>r.url.includes('/api/')).length,0);assert.equal(writes,0);
    await scope.locator('.vg-result details summary').first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width} overflow`);
    const overlap=await scope.locator('.vg-row').evaluateAll(rows=>rows.some(row=>{const boxes=[...row.children].map(el=>el.getBoundingClientRect());return boxes.some((a,i)=>boxes.some((b,j)=>i<j&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));}));assert.equal(overlap,false);
    await scope.locator('[data-results]').screenshot({path:path.join(output,`${width}-results.png`)});
    await scope.locator('[data-rows]').screenshot({path:path.join(output,`${width}-inputs.png`)});
    await scope.locator('[data-directory] summary').click();await scope.locator('.vg-directory-row').nth(73).waitFor();
    assert.equal(await scope.locator('.vg-directory-row').count(),74);
    await scope.locator('[data-search]').fill('가천');await page.waitForTimeout(30);assert.match(await scope.locator('[data-links]').innerText(),/2026 자료/);
    await scope.locator('[data-profile=year]').selectOption('2028');await scope.locator('[data-complete]').check();await scope.locator('[data-calculate]').click();assert.equal(await scope.locator('.vg-result').count(),0);assert.match(await scope.locator('[data-results]').innerText(),/검증된 환산식이 없습니다/);
    await nav('strategy');assert.equal(await page.locator('#strategy [data-profile=year]').inputValue(),'2028');
    checks+=10;
  }
  await page.setViewportSize({width:1440,height:1000});await page.reload();
  let scope=page.locator('#strategy');await scope.locator('[data-student]').selectOption('1');assert.equal(await scope.locator('[data-row]').count(),10);
  await scope.locator('[data-field=grade]').first().fill('2');await scope.locator('[data-complete]').check();await scope.locator('[data-calculate]').click();
  assert.equal(await scope.locator('.vg-result').count(),8);await scope.locator('[data-save]').click();await scope.getByText('성적 저장됨',{exact:true}).waitFor();
  assert.equal(db.students[0].detailedTranscript[0].grade,'2');assert.equal(db.students[0].notes,'보존 대상');assert.equal(writes,1);checks+=4;
  await page.reload();await scope.locator('[data-student]').selectOption('1');assert.equal(await scope.locator('[data-field=grade]').first().inputValue(),'2');checks++;
  await scope.locator('[data-field=grade]').first().fill('1');failSave=true;await scope.locator('[data-save]').click();await scope.getByText(/저장 실패/).waitFor();
  assert.equal(await scope.locator('[data-field=grade]').first().inputValue(),'1');assert.equal(db.students[0].detailedTranscript[0].grade,'2');checks+=2;
  await scope.locator('[data-student]').selectOption('2');assert.equal(await scope.locator('[data-row]').count(),0);await scope.locator('[data-complete]').check();await scope.locator('[data-calculate]').click();assert.equal(await scope.locator('.vg-result').count(),0);checks+=2;
  await scope.locator('[data-sample]').click();await scope.locator('[data-field=subjectName]').first().fill('<img src=x onerror=alert(1)>');await scope.locator('[data-complete]').check();await scope.locator('[data-calculate]').click();
  assert.equal(await scope.locator('[data-results] img').count(),0);checks++;
  await scope.locator('[data-copy]').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/2027학년도 수시 교과 환산/);checks++;
  const download=page.waitForEvent('download');await scope.locator('[data-export]').click();const file=await download;await file.saveAs(path.join(output,'report.png'));assert.match(file.suggestedFilename(),/교과환산/);checks++;
  const before=requests.length;for(let i=0;i<32;i++){await nav(i%2?'strategy':'dashboard');}
  assert.equal(requests.slice(before).filter(r=>r.url.includes('/api/')).length,0);assert.equal(await page.locator('#strategy .vg-row').count(),10);checks+=2;
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({passed:checks,pageErrors:errors,externalRequests:external,writes,screenshots:output}));
}finally{await browser.close();await new Promise(done=>server.close(done));}

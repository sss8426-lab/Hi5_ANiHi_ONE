import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {programView,filterPrograms,ratioFilterOptions} from '../public/data-core/roadmap-model.js';
import {paginate} from '../public/data-core/pagination.js';
import {universityLogos} from '../public/data-core/university-logo-manifest.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3107';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw Error('Local synthetic tests only');
const output='outputs/connected-browser';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const rows=universityLogos.slice(0,12).map((l,i)=>({id:`fixture-${i}`,metadata:{universityName:l.name,major:'합성 웹툰학과',year:2027,region:'합성지역',guidelineId:`fixture-${i}`,admissionSeason:i%2?'jungsi':'susi',admission:i%2?'정시':'수시',selectionFormula:i===0?'실기100':i===1?'수능100':i===2?'1단계 서류100 / 2단계 실기100':'학생부20/실기70/면접10',practicalType:'합성 실기',quota:0,competitionRate:0,verificationStatus:'public-source-unverified',sourceUrl:'https://grinalda.net/univ-info-susi/'}}));
const errors=[];let checks=0,reads=0;
try{
  const ctx=await browser.newContext();
  await ctx.route('**/api/data-core/roadmap/programs?*',async route=>{
    reads++;const params=Object.fromEntries(new URL(route.request().url()).searchParams);
    const selected=filterPrograms(rows.map(programView),params),p=paginate(selected,params.page);
    await route.fulfill({json:{programs:p.rows.map(v=>rows.find(r=>r.id===v.id)),total:12,pagination:{page:p.page,totalPages:p.totalPages,buttons:p.buttons,total:selected.length},facets:{region:['합성지역'],schoolType:[],...ratioFilterOptions(rows.map(programView),params)},trend:null}});
  });
  await ctx.route('**/api/data-core/admissions/guidelines?*',route=>route.fulfill({json:{rows:[{id:'fixture-0',universityName:'합성대학',department:'합성 웹툰학과',academicYear:2027,admissionSeason:'susi',selectionFormula:'실기100',sourceUrl:'https://grinalda.net/univ-info-susi/'}]}}));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['small-mobile',320,740]]){
    await page.setViewportSize({width,height});await page.goto(base+'/data-core/roadmap#family=story&career=D001');
    await page.locator('.university-item').first().waitFor();assert.equal(await page.locator('.university-item').count(),4);
    assert.match(await page.locator('.university-item').first().innerText(),/0%/);
    assert.doesNotMatch(await page.locator('#universityContent').innerText(),/등록 출처 확인|대학 데이터 관리/);
    for(const img of await page.locator('.university-logo').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());assert.ok(await img.evaluate(e=>e.naturalWidth>0));}
    await page.locator('#universitySection').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${name}-universities.png`});
    await page.getByRole('button',{name:'입시요강 보기',exact:true}).first().click();await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('dialog a[href*="page=admin"]').count(),0);await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
    for(const next of [2,3]){await page.getByRole('button',{name:`${next} 페이지`,exact:true}).click();await page.waitForFunction(n=>document.querySelector('#universityCount').textContent.includes(`${n} /`),next);for(const img of await page.locator('.university-logo').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}}
    await page.selectOption('#practicalRatioFilter','0');await page.waitForFunction(()=>document.querySelectorAll('.university-item').length===1);assert.match(await page.locator('#universityCount').innerText(),/1 \/ 1/);
    await page.selectOption('#practicalRatioFilter','');await page.locator('.program-stage').waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.university-item').length===4);
    assert.equal(await page.locator('.foundation-item').count(),6);
    for(const img of await page.locator('.foundation-item img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());assert.equal(await img.evaluate(e=>e.naturalWidth),900);}
    await page.locator('#foundationTitle').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${name}-foundation.png`,fullPage:false});
    const columns=await page.locator('.foundation-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(columns,width<=680?1:width<=1000?2:3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    checks+=20;
  }
  await page.setViewportSize({width:1440,height:1000});
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l0AAAAASUVORK5CYII=','base64');
  await ctx.route('**/api/data',route=>route.fulfill({json:{students:[{id:'synthetic-student',studentType:'result',name:'합성 확인 학생',grade:'고2',artworkImage:'',image:'/api/files/student-artwork%2Fmissing.png',artworks:[{url:'/api/files/student-artwork%2Fmissing.png',fileName:'original.png',name:'합성 그림'}]}],universities:[],cases:[],awardFolders:[],settings:{}}}));
  await ctx.route('**/api/admissions/students/synthetic-student/artworks/0',route=>route.fulfill({contentType:'image/png',body:pixel}));
  await page.goto(base+'/admissions-web/renderer/index.html#page=students');
  const thumbnail=page.locator('img.student-thumb');
  try{await thumbnail.waitFor({timeout:5000});}catch(error){await page.screenshot({path:`${output}/student-failure.png`,fullPage:true});console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(-1800)}));throw error;}
  await thumbnail.evaluate(e=>e.decode());
  assert.match(await thumbnail.getAttribute('src'),/\/api\/admissions\/students\/synthetic-student\/artworks\/0$/);
  await page.locator('.thumb-wrap[data-open-artwork]').click();await page.locator('.artwork-viewer').waitFor();await page.locator('.artwork-viewer img').evaluate(e=>e.decode());
  await page.locator('.artwork-viewer button[data-close-artwork-viewer]').click();await page.locator('.artwork-viewer').waitFor({state:'detached'});
  await ctx.route('**/api/admissions/students/synthetic-student/artworks/0',route=>route.fulfill({status:404,body:'Missing synthetic image'}));
  await page.reload();await page.locator('.artwork-missing:visible').first().waitFor();assert.equal(await page.locator('img.student-thumb:visible').count(),0);checks+=5;
  await page.setContent(`<main style="display:grid;grid-template-columns:repeat(7,1fr);gap:12px">${universityLogos.map(l=>`<figure><img src="${base+l.src}" style="width:110px;height:42px;object-fit:contain"><figcaption>${l.name}</figcaption></figure>`).join('')}</main>`);
  for(const img of await page.locator('img').all())await img.evaluate(e=>e.decode());await page.screenshot({path:`${output}/logos.png`,fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,serverPageReads:reads,logos:49,pageErrors:0}));
}finally{await browser.close();}

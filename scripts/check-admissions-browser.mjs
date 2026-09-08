import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3107';
if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw new Error('Synthetic fixtures require localhost');
const output=path.resolve('outputs/admissions-browser');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL || 'chrome'});
let checks=0;const errors=[];
try{
  const ctx=await browser.newContext();let admin=true;
  const university={id:1,name:'합성대학교',major:'웹툰콘텐츠학과',admission:'실기우수',year:2027,gradeRatio:30,skillRatio:70,requiredScores:{},acceptedStats:{},checkedComplete:true};
  await ctx.route('**/api/data',r=>r.fulfill({json:{students:[],universities:[university],cases:[],awardFolders:[],settings:{consultantName:'합성 상담교사'}}}));
  const fact={id:'synthetic-fact',academicYear:'2027',universityName:'합성대학교',department:'웹툰콘텐츠학과',admissionType:'실기우수',region:'테스트지역',quota:12,gradeRatio:30,practicalRatio:70,competitionRate:12.5,sourceName:'그리날다',sourceUrl:'https://grinalda.net/univ-info-susi/',sourceUpdatedAt:'2026-08-25T12:24:01Z',fetchedAt:'2026-09-09T00:00:00Z',universityId:'1'};
  let applied=0;
  await ctx.route('**/api/data-core/admin/admissions/guidelines/sync',async r=>{const body=r.request().postDataJSON();if(body.mode==='preview')return r.fulfill({json:{token:'synthetic',total:1,counts:{susi:{new:1,changed:0,unchanged:0,review:0,mappingReview:0},jungsi:{new:0,changed:0,unchanged:0,review:0,mappingReview:0}}}});applied++;return r.fulfill({json:{applied:1,nextOffset:1,total:1,done:true}});});
  await ctx.route('**/api/data-core/admissions/guidelines?*',async r=>{const p=new URL(r.request().url()).searchParams;const rows=p.get('query')==='없는대학'?[]:[{...fact,admissionSeason:p.get('season')}];await r.fulfill({json:{rows,total:rows.length,page:1,canSync:admin,facets:{year:['2027'],region:['테스트지역'],university:['합성대학교'],group:[],category:[],practical:[],csatSubjects:[]}}});});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [name,width,height]of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['small-mobile',320,740]]){
    await page.setViewportSize({width,height});await page.goto(`${base}/admissions-web/renderer/index.html#page=admin&university=1`);
    await page.locator('#aName').waitFor();assert.equal(await page.locator('#aName').inputValue(),'합성대학교');assert.equal(await page.locator('#admin').isVisible(),true);
    await page.screenshot({path:path.join(output,`${name}-universities.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,JSON.stringify(await page.locator('body *').evaluateAll(els=>els.filter(e=>e.getClientRects().length && e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))));checks+=3;
    await page.locator('#nav [data-page=susi]').click();await page.locator('#susi [data-detail]').waitFor();assert.match(page.url(),/#page=susi$/);
    await page.locator('#susi [name=year]').selectOption('2027');await page.locator('#susi [data-detail]').waitFor();
    await page.locator('#susi [data-detail]').click();await page.locator('dialog[open]').waitFor();assert.match(await page.locator('dialog').textContent(),/실제 지원 전 반드시/);
    await page.screenshot({path:path.join(output,`${name}-detail.png`)});await page.getByRole('button',{name:'상세 닫기'}).click();
    await page.locator('#susi [name=query]').fill('없는대학');await page.locator('#susi form button[type=submit]').click();await page.locator('.guideline-empty').waitFor();
    await page.locator('#susi form button[type=reset]').click();await page.locator('#susi [data-detail]').waitFor();
    await page.screenshot({path:path.join(output,`${name}-guidelines.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.locator('#nav [data-page=jungsi]').click();await page.locator('#jungsi [data-detail]').waitFor();await page.reload();await page.locator('#jungsi [data-detail]').waitFor();
    await page.goBack();await page.locator('#susi [data-detail]').waitFor();checks+=8;
    for(const section of ['dashboard','students','cases','strategy','settings']){
      await page.locator(`#nav [data-page=${section}]`).click();await page.locator(`#${section}:visible`).waitFor();
      await page.waitForTimeout(60);assert.equal(await page.locator(`#${section} .error-box`).count(),0,section);
      await page.screenshot({path:path.join(output,`${name}-${section}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} ${section} overflow`);checks+=2;
    }
    await page.locator('#nav [data-page=susi]').click();await page.locator('#susi [data-detail]').waitFor();
  }
  await page.locator('#susi [data-sync]').click();await page.locator('dialog [data-apply]').waitFor();assert.equal(applied,0);
  await page.locator('dialog [data-cancel]').click();assert.equal(applied,0);
  await page.locator('#susi [data-sync]').click();await page.locator('dialog [data-apply]').click();await page.getByText('입시요강 1건 적용 완료.',{exact:false}).waitFor();assert.equal(applied,1);checks+=3;
  admin=false;await page.reload();await page.locator('#susi [data-detail]').waitFor();assert.equal(await page.locator('#susi [data-sync]').isVisible(),false);checks++;
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks,pageErrors:0,screenshots:output}));
}finally{await browser.close();}

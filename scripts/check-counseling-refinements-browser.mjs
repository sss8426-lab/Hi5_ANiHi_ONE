import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3112';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Synthetic tests require localhost');
const out='outputs/counseling-refinements';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});let checks=0;
try{
  const ctx=await browser.newContext(),errors=[];
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(!u.pathname.startsWith('/api/'))return route.continue();
    if(u.pathname.includes('/competition-sources/') && u.pathname.endsWith('/preview'))return route.fulfill({json:{pages:[],items:[]}});
    if(req.method()!=='GET')return route.fulfill({status:403,json:{error:'Synthetic read-only fixture'}});
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated:true,isSuperAdmin:true,canWrite:true,user:{name:'Synthetic teacher'},memberships:[]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname.endsWith('/programs'))return route.fulfill({json:{programs:Array.from({length:55},(_,i)=>({id:`synthetic-${i}`,metadata:{universityName:`합성대 ${i}`,major:'웹툰학과',region:i<4?'서울':'부산',year:'2027',admission:'수시',sourceUniversityId:`source-${i}`}}))}});
    if(u.pathname.endsWith('/guidelines')){const season=u.searchParams.get('season');return route.fulfill({json:{rows:[{id:'synthetic-guide',academicYear:'2027',admissionSeason:season,universityName:'합성대학교',department:'웹툰학과',admissionType:'실기전형',selectionFormula:'1단계 학생부 100 / 2단계 실기 60',practicalType:'기초디자인',applicationPeriod:'2027-09-01 ~ 2027-09-10',quota:0,competitionRate:12,gradeRatio:null,practicalRatio:null,csatRatio:40,mappingStatus:'review',mappingReason:'campus-ambiguous',sourceName:'그리날다',sourceUrl:`https://grinalda.net/univ-info-${season}/`,publicDetails:{previousQuota:'10',previousApplicants:'120',admissionDivision:'정원내',admissionSubtype:'실기우수',scheduleNotes:'<img src=x onerror=alert(1)>',documents:'2027-09-11'},fetchedAt:'2026-09-09T00:00:00Z'}],total:1,page:1,canSync:false,facets:{}}});}
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],competitions:[]}});
  });
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  for(const width of [1920,1440,820,390,320]){
    await p.setViewportSize({width,height:1000});await p.goto(base+'/data-core/counseling');
    await p.locator('#view-counseling-home.active').waitFor();
    const cards=p.locator('.counseling-image-cards .feature-card');assert.equal(await cards.count(),3);
    for(const image of await cards.locator('img').all())await image.evaluate(i=>i.decode());
    const columns=await p.locator('.counseling-image-cards').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(columns,width>1100?3:width>760?2:1);
    assert.equal(await cards.nth(1).getAttribute('href'),'/data-core/roadmap');assert.equal(await cards.nth(2).getAttribute('href'),'/');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`home overflow ${width}`);
    await p.screenshot({path:`${out}/home-${width}.png`,fullPage:true});
    await cards.first().click();await p.locator('#view-competitions.active').waitFor();assert.ok(p.url().endsWith('/counseling/competitions'));
    assert.equal(await p.locator('#openCompetitionBtn,#competitionList,#competitionDetail').count(),0);
    await p.locator('.competition-hero>img').evaluate(i=>i.decode());
    assert.equal(await p.locator('#openAwardFolderBtn').count(),1);assert.equal(await p.locator('#refreshCompetitionSourcesBtn').count(),1);
    await p.screenshot({path:`${out}/competitions-${width}.png`,fullPage:true});
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`competition overflow ${width}: ${JSON.stringify(await p.locator('main *').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right}))))}`);
    await p.screenshot({path:`${out}/competitions-${width}.png`,fullPage:true});
    await p.goto(base+'/data-core/roadmap#family=story&career=D001');await p.locator('.university-item').first().waitFor();
    assert.equal(await p.locator('.university-item').count(),4);
    await p.getByRole('button',{name:'2 페이지',exact:true}).click();
    assert.match(await p.locator('.university-item').first().textContent(),/합성대 4/);
    assert.match(await p.locator('.university-source-link').first().getAttribute('href'),/source-4$/);
    await p.getByRole('button',{name:'다음 페이지',exact:true}).click();assert.match(await p.locator('.university-item').first().textContent(),/합성대 8/);
    await p.getByRole('button',{name:'이전 페이지',exact:true}).click();assert.equal(await p.locator('[aria-current="page"]').textContent(),'2');
    await p.locator('#regionFilter').selectOption('서울');assert.equal(await p.locator('[aria-current="page"]').textContent(),'1');assert.equal(await p.locator('.university-item').count(),4);
    await p.locator('#regionFilter').selectOption('');await p.getByRole('button',{name:'14 페이지',exact:true}).click();assert.equal(await p.locator('.university-item').count(),3);
    await p.goto(base+'/data-core/roadmap#family=design&career=D017');await p.locator('.university-item').first().waitFor();assert.equal(await p.locator('[aria-current="page"]').textContent(),'1');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await p.locator('#universityContent').scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/roadmap-${width}.png`});
    // Exercise the real module in a minimal synthetic host without loading legacy student state.
    await p.goto(base+'/admissions-web/renderer/index.html');
    await p.evaluate(()=>{document.body.replaceChildren();for(const season of ['susi','jungsi']){const section=document.createElement('section');section.id=season;section.className=season==='susi'?'':'hidden';document.body.append(section);}});
    for(const season of ['susi','jungsi']){
      await p.evaluate(async season=>{for(const id of ['susi','jungsi'])document.getElementById(id).classList.toggle('hidden',id!==season);const m=await import('/admissions-web/renderer/guidelines.js');await m.renderGuidelines(season);},season);
      await p.locator(`#${season} [data-row-detail]`).waitFor();
      assert.match(await p.locator(`#${season} [data-results]`).textContent(),/2027-09-01/);
      await p.locator(`#${season} [data-row-detail]`).click();await p.locator('.guideline-dialog[open]').waitFor();
      const body=await p.locator('.guideline-dialog').innerText();assert.match(body,/120/);assert.match(body,/정원내/);assert.match(body,/공식 모집요강을 반드시 확인/);assert.match(body,/공개 자료에서 확인 필요/);
      assert.equal(await p.locator('.guideline-dialog img').count(),0);assert.equal(await p.locator('.guideline-dialog a').first().getAttribute('href'),`https://grinalda.net/univ-info-${season}/`);
      assert.equal(await p.locator('.guideline-dialog').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
      await p.screenshot({path:`${out}/${season}-${width}.png`});await p.keyboard.press('Escape');await p.locator('.guideline-dialog').waitFor({state:'detached'});assert.equal(await p.locator('.guideline-dialog').count(),0);
    }
    checks+=28;
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,browserErrors:errors.length,viewports:5}));
}finally{await browser.close();}

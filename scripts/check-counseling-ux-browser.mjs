import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {encode} from 'fast-png';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3122';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local synthetic fixtures only');
const out='outputs/counseling-ux';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const png=Buffer.from(encode({width:16,height:20,channels:4,depth:8,data:new Uint8Array(16*20*4).fill(150)}));
const universities=Array.from({length:35},(_,i)=>({id:i+1,name:`합성대 ${i+1}`,campus:'합성캠퍼스',major:'웹툰콘텐츠학과',admission:'실기우수',year:2027,gradeRatio:30,skillRatio:70,requiredScores:{},acceptedStats:{},checkedComplete:true,campusLocation:i===0?null:{campus:'합성캠퍼스',latitude:37.56-i/100,longitude:126.98,verificationStatus:'verified',sourceUrl:'https://synthetic.example/campus'}}));
const students=Array.from({length:14},(_,i)=>({id:i+1,name:`합성학생 ${i+1}`,studentType:'result',campusId:'synthetic-campus',gpa:3,skill:80,track:'웹툰',skillLevel:'중',artworks:Array.from({length:5},(_,j)=>({path:`artworks/synthetic-${i}-${j}.png`,name:`합성그림 ${j+1}`})),admissionResults:[{year:'2027',round:'수시',result:i<6?'합격':'불합격',universityName:'합성대 1',major:'웹툰콘텐츠학과',resultNote:i<6?'':['','예비30','예비 535번','468','예비424','예비 148번','예비9','예비4'][i-6]}]}));
let checks=0, dataReads=0;const requests=new Map(),errors=[];
try {
  const ctx=await browser.newContext();
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
    if(!u.pathname.startsWith('/api/'))return route.continue();
    if(u.pathname.includes('/competition-sources/')&&u.pathname.endsWith('/preview'))return route.fulfill({json:{pages:[],items:[]}});
    if(req.method()!=='GET')throw Error(`Unexpected mutation in read-only browser test: ${req.method()} ${u.pathname}`);
    if(u.pathname==='/api/data'){dataReads++;return route.fulfill({json:{students,universities,cases:[],awardFolders:[],settings:{}}});}
    if(u.pathname.startsWith('/api/admissions/students/')){requests.set(u.pathname,(requests.get(u.pathname)||0)+1);return route.fulfill({body:png,contentType:'image/png',headers:{'cache-control':'private, no-cache'}});}
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated:true,isSuperAdmin:true,canWrite:true,user:{name:'Synthetic teacher'},memberships:[]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],competitions:[],rows:[],total:0,facets:{}}});
  });
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  const noOverflow=async label=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+JSON.stringify(await p.locator('main *').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})))));
  const navigate=async id=>{const b=p.locator(`#nav [data-page="${id}"]`);if(!await b.isVisible())await p.locator('.core-menu-toggle').click();await b.click();await p.locator(`#${id}:visible`).waitFor();};
  const widths=process.env.TEST_WIDTHS?process.env.TEST_WIDTHS.split(',').map(Number):[1920,1440,1280,1024,768,390];
  for(const width of widths){
    await p.setViewportSize({width,height:1050});await p.goto(`${base}/data-core/counseling`);
    const nav=p.locator('.nav-group[data-nav-scope="counseling"]');
    assert.match(await nav.innerText(),/대학합격 로드맵\s*.*꿈을 향한 커리큘럼/s);
    if(!await nav.isVisible())await p.locator('.core-menu-toggle').click();
    await p.locator('[data-view="curriculum"]').click();await p.locator('#view-curriculum.active').waitFor();
    for(const img of await p.locator('.curriculum-card img').all())await img.evaluate(i=>i.decode());
    assert.equal(await p.locator('.curriculum-card').count(),2);await noOverflow(`curriculum ${width}`);
    await p.screenshot({path:`${out}/curriculum-${width}.png`,fullPage:true});
    for(const family of ['content','design']){
      await p.locator(`.curriculum-card[href$="/${family}"]`).click();assert.equal(await p.locator('.curriculum-folders a').count(),3);
      for(const stage of ['basic','advanced','admission']){
        await p.locator(`.curriculum-folders a[href$="/${stage}"]`).click();assert.equal(await p.locator(`.curriculum-empty[data-family="${family}"][data-stage="${stage}"]`).count(),1);
        await p.reload();await p.locator('.curriculum-empty').waitFor();assert.ok(p.url().endsWith(`${family}/${stage}`));
        await p.locator('.curriculum-back').click();await p.locator('.curriculum-folders').waitFor();checks+=3;
      }
      await p.locator('.curriculum-back').click();await p.locator('.curriculum-cards').waitFor();
    }
    await p.locator('.curriculum-card').first().click();await p.goBack();await p.locator('.curriculum-cards').waitFor();
    await p.goto(`${base}/admissions-web/renderer/index.html#page=dashboard`);await p.locator('#gpa').waitFor();
    await p.locator('#studentName').fill('합성 상담');await p.locator('#gradeYear').selectOption('고2');
    await p.locator('#gpa').fill('3');await p.locator('#skill').fill('80');await p.locator('#analyzeBtn').click();
    assert.equal(await p.locator('.top-list tbody tr[data-uni]').count(),30);
    assert.equal(await p.locator('#studentName').inputValue(),'합성 상담');assert.equal(await p.locator('#gradeYear').inputValue(),'고2');checks+=2;
    assert.equal(await p.locator('.top-list tbody tr[data-uni]').first().getAttribute('data-uni'),'2');
    assert.match(await p.locator('#goSearchBtn').textContent(),/입시요강 확인/);
    for(const id of ['studentName','gradeYear','track','dashPracticalType','gpa','skill','koreanScore','englishScore','mathScore','socialScore','scienceScore']){
      const box=await p.locator(`#${id}`).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`${id} ${width}`);
      if(id.endsWith('Score'))assert.ok(box.width<=80,`${id} compact`);
    }
    await noOverflow(`dashboard ${width}`);await p.screenshot({path:`${out}/dashboard-${width}.png`,fullPage:true});
    await p.locator('#goSearchBtn').click();await p.locator('#aName').waitFor();assert.ok(p.url().endsWith('#page=admin'));
    await navigate('cases');await p.locator('#caseSearchInput').fill('합성대');await p.locator('#caseSearchBtn').click();
    assert.equal(await p.locator('[data-case-column="pass"] .case-compare-card').count(),3);
    assert.equal(await p.locator('[data-case-column="fail"] .case-compare-card').count(),3);
    assert.equal(await p.locator('.case-column-head b').count(),0);assert.doesNotMatch(await p.locator('.search-summary').textContent(),/\d+건/);
    assert.match(await p.locator('[data-case-column="fail"] .case-compare-card').nth(0).textContent(),/535/);
    const passFirst=await p.locator('[data-case-column="pass"] .case-compare-card').first().textContent();
    await p.getByRole('button',{name:'불합격 사례 다음',exact:true}).click();assert.match(await p.locator('[data-case-column="fail"] .case-compare-card').first().textContent(),/148/);
    assert.equal(await p.locator('[data-case-column="pass"] .case-compare-card').first().textContent(),passFirst);
    await p.getByRole('button',{name:'합격 사례 다음',exact:true}).click();assert.notEqual(await p.locator('[data-case-column="pass"] .case-compare-card').first().textContent(),passFirst);
    await p.getByRole('button',{name:'합격 사례 이전',exact:true}).click();assert.equal(await p.locator('[data-case-column="pass"] .case-compare-card').first().textContent(),passFirst);
    await noOverflow(`cases ${width}`);await p.screenshot({path:`${out}/cases-${width}.png`,fullPage:true});
    await p.locator('#caseSearchInput').fill('not-found');await p.locator('#caseSearchBtn').click();assert.equal(await p.locator('.case-compare-card').count(),0);
    await navigate('students');await p.locator('[data-student-row="1"]').waitFor();
    const thumb=p.locator('[data-student-row="1"] img');await thumb.scrollIntoViewIfNeeded();await thumb.evaluate(i=>i.decode());
    await thumb.evaluate(i=>i.dataset.syntheticIdentity='retained');
    const readsBefore=dataReads,firstPath='/api/admissions/students/1/artworks/0',countBefore=requests.get(firstPath)||0;
    await p.locator('[data-student-row="1"] td').nth(1).click();
    const gallery=p.locator('.student-detail-row .student-gallery img');assert.equal(await gallery.count(),5);
    for(const img of await gallery.all()){assert.equal(await img.getAttribute('loading'),'eager');await img.evaluate(i=>i.decode());}
    assert.equal(dataReads,readsBefore);assert.equal(await thumb.getAttribute('data-synthetic-identity'),'retained');
    await p.locator('.student-detail-row [data-open-artwork]').first().scrollIntoViewIfNeeded();
    await p.waitForLoadState('networkidle');
    const loaded=await p.locator('#students img[data-student-artwork]').evaluateAll(images=>images.filter(i=>i.complete&&i.naturalWidth).map(i=>new URL(i.src).pathname));
    const beforeOpen=new Map(requests);await p.locator('.student-detail-row [data-open-artwork]').first().click();await p.locator('.core-image-gallery img').evaluate(i=>i.decode());
    assert.equal(await thumb.getAttribute('data-synthetic-identity'),'retained');
    for(const key of loaded)if(key!==firstPath)assert.equal(requests.get(key),beforeOpen.get(key),`loaded image re-request ${key}`);
    await p.keyboard.press('Escape');assert.equal(await p.locator('.core-image-gallery').count(),0);
    assert.equal(await thumb.getAttribute('data-synthetic-identity'),'retained');
    assert.ok((requests.get(firstPath)||0)-countBefore<=2,'no duplicate rerender requests');
    await noOverflow(`students ${width}`);await p.screenshot({path:`${out}/students-${width}.png`,fullPage:true});checks+=35;
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,pageErrors:errors.length,viewports:widths,syntheticOnly:true,screenshots:out}));
} finally {await browser.close();}

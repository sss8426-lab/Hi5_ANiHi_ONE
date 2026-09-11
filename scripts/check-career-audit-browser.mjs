import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {programView,filterPrograms,ratioFilterOptions} from '../public/data-core/roadmap-model.js';
import {paginate} from '../public/data-core/pagination.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3107';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)&&!/^https:\/\/[a-f0-9]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(base))throw Error('Local or immutable Cloudflare preview only; production tests forbidden');
const sandbox={window:{}};vm.runInNewContext(await fs.readFile('public/data-core/roadmap-content.js','utf8'),sandbox);
const careers=JSON.parse(JSON.stringify(sandbox.window.HI5_ROADMAP_CONTENT.careers));
const output=`outputs/career-browser-${base.startsWith('http:')?'local':'preview'}`;await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL||'chrome'});
const reports=[],errors=[],missing=[],mutations=[];let auth=true,empty=false,current;
const fixtures=c=>Array.from({length:9},(_,i)=>({id:`synthetic-${c.id}-${i}`,metadata:{universityName:`합성 검증대학 ${i+1}`,major:c.majors[0]+' 합성전공',region:'합성지역',year:2027,admission:i%2?'정시':'수시',admissionSeason:i%2?'jungsi':'susi',guidelineId:`synthetic-${c.id}-${i}`,selectionFormula:i===0?'실기100':i===1?'수능100':i===2?'1단계 서류100 / 2단계 실기100':'학생부20/실기70/면접10',sourceUrl:'https://grinalda.net/univ-info-susi/',verificationStatus:'public-source-unverified',practicalType:'합성 실기',quota:0,competitionRate:0}}));
try{
 const ctx=await browser.newContext({serviceWorkers:'block'});
 ctx.setDefaultTimeout(15000);ctx.setDefaultNavigationTimeout(30000);
 // All API traffic is intercepted even on preview; no real records or sessions enter fixtures.
 await ctx.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()!=='GET'){mutations.push(url.pathname);return route.fulfill({status:405,json:{error:'Read only synthetic test'}});}
  if(!auth)return route.fulfill({status:401,json:{error:'Authentication required'}});
  if(url.pathname==='/api/data-core/roadmap/programs'){
   const params=Object.fromEntries(url.searchParams),c=careers.find(c=>c.id===params.careerId);assert.ok(c);
   const rows=empty?[]:fixtures(c),filtered=filterPrograms(rows.map(programView),params),p=paginate(filtered,params.page);
   return route.fulfill({json:{programs:p.rows.map(v=>rows.find(r=>r.id===v.id)),pagination:{page:p.page,totalPages:p.totalPages,buttons:p.buttons,total:filtered.length},total:rows.length,facets:{region:['합성지역'],schoolType:[],...ratioFilterOptions(rows.map(programView),params)},trend:null}});
  }
  if(url.pathname==='/api/data-core/admissions/guidelines'){
   const id=url.searchParams.get('id'),c=careers.find(c=>id?.includes(c.id));assert.ok(c);
   return route.fulfill({json:{rows:[{id,universityName:'합성 검증대학',department:c.majors[0]+' 합성전공',academicYear:2027,admissionSeason:'susi',admissionType:'합성 실기전형',selectionFormula:'실기100',quota:0,competitionRate:0,practicalType:'합성 실기',applicationPeriod:'합성 일정',practicalDate:'합성 일정',sourceUrl:'https://grinalda.net/univ-info-susi/',mappingStatus:'review',universityId:null}]}});
  }
  return route.fulfill({status:401,json:{error:'Synthetic context only'}});
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))missing.push({url:new URL(r.url()).pathname,status:r.status()});});
 const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 for(const [width,height] of [[1920,1080],[1440,1000],[820,1180],[390,844],[320,740]]){
  await page.setViewportSize({width,height});
  for(const c of careers){
   current={id:c.id,width};
   await page.goto(`${base}/data-core/roadmap#family=${c.family}`);
   await page.locator(`.dream-card[href="#family=${c.family}&career=${c.id}"]`).click();
   await page.locator('.university-item').first().waitFor();
   assert.equal(await page.locator('#resultGoal').textContent(),c.name);
   assert.equal(await page.locator('#resultGoalSummary').textContent(),c.summary);
   assert.equal(await page.locator('#careerDistinction').textContent(),c.distinction);
   assert.equal(await page.locator('#majorGrid .major-item').count(),c.majors.length);
   assert.equal(await page.locator('.university-item').count(),4);
   await page.locator('#resultPortrait img').evaluate(e=>e.decode());
   assert.equal(await page.locator('#resultPortrait img').evaluate(e=>getComputedStyle(e).objectFit),'cover');
   assert.deepEqual(await page.locator('.timeline h3').allTextContents(),['기초 표현력','전공 기초','전공 심화','입시 실기 적용','실전 완성도']);
   assert.match(await page.locator('.timeline li').last().textContent(),new RegExp(c.completionFocus));
   assert.match(await page.locator('#preparationGrid').textContent(),new RegExp(c.specialization[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   await page.getByRole('button',{name:'입시요강 보기',exact:true}).first().click();await page.locator('dialog[open]').waitFor();
   assert.match(await page.locator('dialog').innerText(),/합성 검증대학/);
   assert.match(await page.locator('dialog').innerText(),/실기100/);
   assert.equal(await page.locator('dialog a[href*="page=admin"]').count(),0);
   await noOverflow();await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
   await page.getByRole('button',{name:'2 페이지',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#universityCount').textContent.includes('2 / 3'));
   assert.equal(await page.locator('.university-item').count(),4);
   await page.getByRole('button',{name:'3 페이지',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#universityCount').textContent.includes('3 / 3'));
   assert.equal(await page.locator('.university-item').count(),1);
   await page.locator('.flow-strip a[href="#curriculumSection"]').click();assert.ok(page.url().includes(`career=${c.id}`));
   await page.waitForFunction(()=>{const r=document.querySelector('#curriculumSection h2').getBoundingClientRect();return r.top>=0&&r.top<innerHeight/2;});
   await noOverflow();
   if(['D001','D005','D009','D013','D017','D025','D027','D030','D035'].includes(c.id))await page.screenshot({path:`${output}/${width}-${c.id}-stages.png`});
   await page.locator('.flow-strip a[href="#preparationSection"]').click();
   await page.waitForFunction(()=>{const r=document.querySelector('#preparationSection h2').getBoundingClientRect();return r.top>=0&&r.top<innerHeight/2;});await noOverflow();
   await page.reload();await page.locator('.university-item').first().waitFor();assert.equal(await page.locator('#resultGoal').textContent(),c.name);
   assert.equal(await page.locator('#universityPagination [aria-current]').textContent(),'3');
   await page.goBack();await page.waitForFunction(()=>document.querySelector('#universityCount').textContent.includes('2 / 3'));
   await page.goBack();await page.waitForFunction(()=>document.querySelector('#universityCount').textContent.includes('1 / 3'));
   await page.goBack();await page.locator('#catalogSection:visible').waitFor();
   await page.goForward();await page.locator('#roadmapResult:visible').waitFor();
   reports.push({id:c.id,width,passed:true});
  }
  console.log(JSON.stringify({width,traversals:reports.length}));
 }
 for(const id of ['D010','D011','D028','D031']){
  const c=careers.find(c=>c.id===id);await page.goto(`${base}/data-core/roadmap#family=${c.family}`);
  await page.locator('#goalSearchInput').fill(c.aliases.at(-1));assert.equal(await page.locator(`a[href="#family=${c.family}&career=${id}"]`).count(),1);
 }
 empty=true;await page.goto(base+'/data-core/roadmap#family=story&career=D001');await page.getByText('연결 대학 검수 필요',{exact:false}).waitFor();
 assert.equal(await page.locator('.university-item').count(),0);
 auth=false;await page.reload();await page.getByRole('link',{name:'교직원 로그인',exact:true}).waitFor();assert.equal(await page.locator('.timeline li').count(),5);
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(mutations,[]);
 const result={traversals:reports.length,careers:35,viewports:5,reports,pageErrors:0,missingAssets:0,mutationRequests:0};await fs.writeFile(output+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,reports:undefined}));
}catch(error){console.error(JSON.stringify({current,traversals:reports.length,error:String(error),pageErrors:errors,missing}));throw error;}
finally{await browser.close();}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {programView,filterPrograms,ratioFilterOptions} from '../public/data-core/roadmap-model.js';
import {paginate} from '../public/data-core/pagination.js';
import {universityLogos} from '../public/data-core/university-logo-manifest.js';
import {ratioPrograms} from '../tests/fixtures/roadmap-ratio-programs.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3107';
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)&&!/^https:\/\/[a-f0-9]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(base))throw Error('Synthetic tests require local or immutable preview, never production');
const output=`outputs/ratio-browser-${base.startsWith('http:')?'local':'preview'}`;
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL||'chrome'});
const rows=ratioPrograms.map((p,i)=>({...p,metadata:{...p.metadata,universityName:universityLogos[i].name}}));
const views=rows.map(programView),errors=[],missing=[],mutations=[],reports=[];
let auth=true,requests=0,hold=false,release,announce,page;
try{
  const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(15000);ctx.setDefaultNavigationTimeout(30000);
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()!=='GET'){mutations.push(url.pathname);return route.fulfill({status:405,json:{error:'Synthetic read only'}});}
    if(!auth)return route.fulfill({status:401,json:{error:'Authentication required'}});
    if(url.pathname==='/api/data-core/roadmap/programs'){
      requests++;const filters=Object.fromEntries(url.searchParams);
      assert.equal(url.searchParams.has('focus'),false);
      if(hold){hold=false;announce();await new Promise(resolve=>{release=resolve;});}
      const filtered=filterPrograms(views,filters),p=paginate(filtered,filters.page);
      return route.fulfill({json:{programs:p.rows.map(v=>rows.find(r=>r.id===v.id)),pagination:{page:p.page,totalPages:p.totalPages,buttons:p.buttons,total:filtered.length},total:rows.length,facets:{region:['경기','서울'],schoolType:['4년제','전문대'],...ratioFilterOptions(views,filters)},trend:null}}).catch(()=>{});
    }
    if(url.pathname==='/api/data-core/admissions/guidelines'){
      const p=rows.find(p=>p.id===url.searchParams.get('id'));assert.ok(p);
      return route.fulfill({json:{rows:[{id:p.id,...p.metadata,department:p.metadata.major,academicYear:2028,admissionType:'합성 전형',mappingStatus:'review',universityId:null}]}});
    }
    return route.fulfill({status:401,json:{error:'Synthetic only'}});
  });
  page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))missing.push({path:new URL(r.url()).pathname,status:r.status()});});
  const ready=()=>page.waitForFunction(()=>document.querySelector('#universityContent').getAttribute('aria-busy')==='false'&&document.querySelector('#notice').hidden);
  const action=async fn=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data-core/roadmap/programs');await fn();await response;await ready();};
  const select=(id,value)=>action(()=>page.selectOption('#'+id,value));
  const check=async(expected,total=expected.length)=>{
    const names=await page.locator('.university-title h3').allTextContents();
    assert.deepEqual(names,expected.map(id=>rows.find(p=>p.id===`synthetic-ratio-${id}`).metadata.universityName));
    assert.match(await page.locator('#universityCount').textContent(),new RegExp(`^${total}개 전형`));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('.university-filters select,.university-item').evaluateAll(els=>els.some(e=>e.getBoundingClientRect().right>innerWidth+1||e.scrollWidth>e.clientWidth+1)),false);
  };
  for(const width of (process.env.ROADMAP_TEST_WIDTHS||'1920,1440,1024,820,390,320').split(',').map(Number)){
    console.log(JSON.stringify({width,phase:'start'}));
    await page.setViewportSize({width,height:width>=1024?1080:width===820?1180:844});
    console.log(JSON.stringify({width,phase:'viewport'}));
    await page.goto(base+'/data-core/roadmap#family=story');
    console.log(JSON.stringify({width,phase:'catalog'}));
    await page.locator('[data-group="웹툰·만화"]').click();assert.equal(await page.locator('.dream-card').count(),4);
    await page.locator('#goalSearchInput').fill('웹툰 작가');
    await action(()=>page.locator('a[href="#family=story&career=D001"]').click());
    console.log(JSON.stringify({width,phase:'programs'}));
    assert.equal(await page.locator('#focusFilter').count(),0);
    for(const label of ['지역','학교 유형','모집 시기','성적 %','실기 %'])assert.equal(await page.getByLabel(label,{exact:true}).count(),1);
    await check(['A','B','C','D'],10);
    assert.deepEqual(await page.locator('#academicRatioFilter option').allTextContents(),['전체','0%','20%','25%','30%','35%','40%','100%']);
    assert.deepEqual(await page.locator('#practicalRatioFilter option').allTextContents(),['전체','0%','60%','65%','70%','75%','80%','100%']);
    for(const img of await page.locator('.university-logo').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}
    await page.locator('#universitySection').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:`${output}/${width}-filters.png`});
    await action(()=>page.getByRole('button',{name:'3 페이지',exact:true}).click());await check(['I','J'],10);
    await select('academicRatioFilter','20');await check(['A','F']);assert.match(await page.locator('#universityCount').textContent(),/1 \/ 1/);
    await select('practicalRatioFilter','80');await check(['A']);
    assert.match(await page.locator('.ratios').textContent(),/성적 20%.*실기 80%.*기타 0%/);
    assert.ok(page.url().includes('academicRatio=20')&&page.url().includes('practicalRatio=80'));
    await action(()=>page.reload());await check(['A']);assert.equal(await page.locator('#academicRatioFilter').inputValue(),'20');
    await action(()=>page.goBack());await check(['A','F']);
    await action(()=>page.goForward());await check(['A']);
    await page.getByRole('button',{name:'입시요강 보기',exact:true}).click();await page.locator('dialog[open]').waitFor();
    assert.match(await page.locator('dialog').textContent(),/학생부20 \+ 실기80/);
    assert.equal(await page.locator('dialog a[href*="page=admin"]').count(),0);await page.keyboard.press('Escape');
    await select('practicalRatioFilter','60');await check(['F']);assert.match(await page.locator('.ratios').textContent(),/기타 20%/);
    await select('practicalRatioFilter','70');await check([]);
    await select('academicRatioFilter','30');await check(['B']);
    await select('practicalRatioFilter','');await check(['B']);
    await select('academicRatioFilter','');await select('practicalRatioFilter','100');await check(['D']);
    await select('practicalRatioFilter','0');await check(['E']);
    await select('practicalRatioFilter','');await select('academicRatioFilter','25');await check(['I']);
    await select('regionFilter','경기');await check(['A','D','G','H']);
    assert.equal(await page.locator('#academicRatioFilter').inputValue(),'');assert.ok(!page.url().includes('academicRatio='));
    assert.deepEqual(await page.locator('#practicalRatioFilter option').allTextContents(),['전체','80%','100%']);
    await select('schoolFilter','4년제');await select('admissionFilter','수시');await select('academicRatioFilter','20');await select('practicalRatioFilter','80');await check(['A']);
    await page.locator('#universitySection').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:`${output}/${width}-combined.png`});
    await action(async()=>{await page.locator('#practicalRatioFilter').focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Tab');});
    assert.equal(await page.locator('#practicalRatioFilter').inputValue(),'');
    assert.equal(await page.locator('.foundation-item').count(),6);
    reports.push({width,passed:true});
    console.log(JSON.stringify({width,passed:true}));
  }
  // A slow earlier response cannot overwrite a newer ratio selection.
  await action(()=>page.goto(base+'/data-core/roadmap#family=design&career=D017'));
  const started=new Promise(resolve=>{announce=resolve;});hold=true;
  await page.selectOption('#academicRatioFilter','20');await started;
  await page.selectOption('#academicRatioFilter','30');await ready();release();await check(['B']);
  auth=false;await page.reload();await page.getByRole('link',{name:'교직원 로그인',exact:true}).waitFor();
  assert.equal(await page.locator('.university-item').count(),0);assert.equal(await page.locator('.timeline li').count(),5);
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(mutations,[]);
  const report={origin:base,viewports:reports,requests,pageErrors:0,missingAssets:0,mutationRequests:0};
  await fs.writeFile(output+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  if(page){await page.screenshot({path:output+'/failure.png'});console.log(JSON.stringify({errors,requests,url:page.url(),count:await page.locator('#universityCount').textContent(),notice:await page.locator('#notice').textContent(),filters:await page.locator('#universityFilters').textContent()}));}
  throw error;
}finally{await browser.close();}

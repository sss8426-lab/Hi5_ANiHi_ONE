import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3123';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local synthetic fixtures only');
const preview=process.env.STATIC_PREVIEW_ORIGIN;
if(preview&&!/^https:\/\/[a-z0-9-]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(preview))throw Error('Unexpected preview origin');
const out='outputs/award-curriculum';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
let checks=0;
try {
  const context=await browser.newContext(), errors=[], requests=new Map();
  let authenticated=true, failOnce=true, active=0, maxActive=0;
  const maker=await context.newPage();
  const encoded=await maker.evaluate(()=>{
    const c=document.createElement('canvas');c.width=2400;c.height=1600;const x=c.getContext('2d');
    x.fillStyle='#eef3f1';x.fillRect(0,0,c.width,c.height);
    for(let i=0;i<80;i++){x.fillStyle=i%2?'#418078':'#597eae';x.fillRect(i*30,120+i*12,180,200);}
    return c.toDataURL('image/jpeg',0.9).split(',')[1];
  });await maker.close();
  const image=Buffer.from(encoded,'base64');
  const files=Array.from({length:40},(_,i)=>({id:`synthetic-${i}`,recordId:'synthetic-folder',mimeType:'image/jpeg',fileName:`Synthetic ${i}.jpg`,category:'competition-material'}));
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin!==base)return route.abort();
    if(!u.pathname.startsWith('/api/')) {
      if(preview){const response=await route.fetch({url:preview+u.pathname+u.search});return route.fulfill({response});}
      return route.continue();
    }
    if(req.method()!=='GET' && !u.pathname.endsWith('/preview'))throw Error('Unexpected mutation');
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated,canWrite:authenticated,isSuperAdmin:authenticated,user:{name:'Synthetic admin'},memberships:[]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname==='/api/data-core/records')return route.fulfill({json:{records:u.searchParams.get('recordType')==='competition-award-folder'?[{id:'synthetic-folder',title:'Synthetic gallery',campusId:null}]:[]}});
    if(u.pathname==='/api/data-core/files')return route.fulfill({json:{files:u.searchParams.get('recordId')==='synthetic-folder'?files:[]}});
    if(u.pathname.startsWith('/api/data-core/files/')){
      requests.set(u.pathname,(requests.get(u.pathname)||0)+1);active++;maxActive=Math.max(active,maxActive);
      await new Promise(r=>setTimeout(r,50));active--;
      if(u.pathname.endsWith('/synthetic-7')&&failOnce){failOnce=false;return route.fulfill({status:503,body:''});}
      return route.fulfill({contentType:'image/jpeg',body:image});
    }
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],competitions:[],pages:[],items:[]}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const ready=async id=>{
    const img=page.locator(`[data-award-thumbnail="synthetic-${id}"]`);await img.scrollIntoViewIfNeeded();
    await page.waitForFunction(id=>document.querySelector(`[data-award-thumbnail="synthetic-${id}"]`)?.dataset.loadState==='ready',id);
    assert.ok(await img.evaluate(i=>i.naturalWidth<=480&&i.naturalHeight<=480&&i.naturalWidth>0));
  };
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/data-core/counseling/competitions');
  await page.locator('[data-award-thumbnail]').first().waitFor();await ready(0);
  assert.ok(requests.size<40,'offscreen originals are not all downloaded at once');checks++;
  await page.locator('[data-award-thumbnail="synthetic-7"]').scrollIntoViewIfNeeded();
  await page.locator('[data-award-retry="synthetic-7"]:visible').waitFor();
  assert.equal(await page.locator('[data-award-thumbnail="synthetic-7"]').getAttribute('src'),null);
  await page.locator('[data-award-retry="synthetic-7"]').click();await ready(7);checks+=2;
  for(let i=0;i<40;i++)await ready(i);
  const before=new Map(requests);await ready(0);assert.deepEqual(requests,before);
  assert.equal(await page.locator('[data-award-thumbnail][data-load-state="ready"]').count(),40);
  assert.ok(maxActive<=3);checks+=43;
  await page.screenshot({path:`${out}/gallery-1280.png`,fullPage:true});
  await page.locator('[data-award-image="synthetic-0"]').click();
  await page.locator('#awardLightbox[open]').waitFor();
  // The retained small preview appears immediately, then the uncached original replaces it.
  assert.match(await page.locator('#awardLightboxImage').getAttribute('src'),/^blob:/);
  await page.waitForFunction(()=>document.getElementById('awardLightboxImage').naturalWidth===2400);
  const count=requests.get('/api/data-core/files/synthetic-0');
  await page.keyboard.press('Escape');await page.locator('[data-award-image="synthetic-0"]').click();
  await page.locator('#awardLightboxImage').evaluate(i=>i.decode());assert.equal(requests.get('/api/data-core/files/synthetic-0'),count);
  await page.locator('#closeAwardLightboxBtn').click();checks+=3;
  const widths=[1920,1440,1280,1024,768,390,320], assets=new Set();
  for(const width of widths){
    await page.setViewportSize({width,height:1000});
    for(const family of ['content','design']){
      await page.goto(`${base}/data-core/curriculum/${family}`);
      await page.locator('.curriculum-folders a').first().waitFor();
      assert.equal(await page.locator('.curriculum-folders a').count(),3);
      for(const img of await page.locator('.curriculum-folders img').all()){
        await img.evaluate(i=>i.decode());assets.add(await img.getAttribute('src'));
        assert.equal(await img.evaluate(i=>getComputedStyle(i).objectFit),'cover');checks++;
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const boxes=await page.locator('.curriculum-folders a').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));
      assert.ok(Math.max(...boxes)-Math.min(...boxes)<=1);
      await page.screenshot({path:`${out}/${family}-${width}.png`,fullPage:true});
      for(const stage of ['basic','advanced','admission']){
        await page.locator(`.curriculum-folders a[href$="/${stage}"]`).click();
        await page.locator(`.curriculum-empty[data-family="${family}"][data-stage="${stage}"]`).waitFor();
        await page.reload();await page.locator('.curriculum-empty').waitFor();
        await page.goBack();await page.locator('.curriculum-folders').waitFor();checks+=3;
      }
      checks+=3;
    }
  }
  assert.equal(assets.size,6);
  authenticated=false;await page.goto(base+'/data-core/curriculum/design');
  await page.locator('.curriculum-stage-card').first().waitFor();
  assert.equal(await page.locator('.curriculum-stage-card').count(),3);checks++;
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,viewports:widths,distinctNewAssets:assets.size,galleryImages:40,maxGalleryConcurrency:maxActive,warmScrollDownloads:0,pageErrors:errors.length,syntheticOnly:true,staticPreview:preview||null,screenshots:out}));
} finally {await browser.close();}

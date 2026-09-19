// Deployed visual assets + synthetic admissions fixtures; no production writes or PII.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';
import {libraryHarness,users} from '../tests/support/library-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const remote=process.env.CAREER_REVIEW_ORIGIN || '';
if(remote && !/^https:\/\/(?:[a-f0-9]+-)?hi5-anihi-one\.sss8426\.workers\.dev$/.test(remote)) throw Error('Unsupported deployed origin');
const out=`outputs/career-images-v2-${remote?'deployed':'local'}`;
await fs.mkdir(out,{recursive:true});
const sandbox={window:{}};vm.runInNewContext(await fs.readFile('public/data-core/roadmap-content.js','utf8'),sandbox);
const careers=JSON.parse(JSON.stringify(sandbox.window.HI5_ROADMAP_CONTENT.careers));
const h=await libraryHarness();
const root=path.resolve('public'),errors=[],checked=new Set(),reports=[],remoteAssets=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
async function asset(req) {
  const url=new URL(typeof req==='string'?req:req.url);
  const pathname=url.pathname==='/data-core/roadmap'?'/data-core/roadmap.html':url.pathname;
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep))return new Response(null,{status:403});
  try {
    const local=await fs.readFile(file);
    let bytes=local;
    if(remote && !pathname.startsWith('/data-core/roadmap/image-review') && pathname!=='/data-core/roadmap.html') {
      if (!remoteAssets.has(pathname)) {
        const r=await fetch(remote+pathname+url.search);assert.equal(r.status,200,pathname);
        remoteAssets.set(pathname,Buffer.from(await r.arrayBuffer()));
      }
      bytes=remoteAssets.get(pathname);
      const hash=v=>createHash('sha256').update(/\.(html|js|css|json)$/.test(pathname)?v.toString().replace(/\r\n/g,'\n'):v).digest('hex');
      assert.equal(hash(bytes),hash(local),`deployed asset ${pathname}`);checked.add(pathname);
    }
    return new Response(bytes,{headers:{'content-type':mime[path.extname(file)]||'application/octet-stream'}});
  } catch(e) { errors.push(String(e));return new Response(null,{status:404}); }
}
h.env.ASSETS={fetch:asset};
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
    const u=new URL(req.url,'http://localhost');
    const r=u.pathname.startsWith('/data-core/roadmap/image-review')?await h.raw('GET',u.pathname+u.search,users.master):await asset(new Request(u));
    res.writeHead(r.status,Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
  } catch(e){errors.push(String(e));res.writeHead(500).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'});
const mutations=[];
try {
  if(remote)for(const suffix of ['','/','.html','.js','.css'])for(const method of ['GET','HEAD']) {
    const r=await fetch(remote+'/data-core/roadmap/image-review'+suffix,{method});
    assert.equal(r.status,401,'Deployed review stays private '+suffix);
    assert.match(r.headers.get('cache-control'),/no-store/);
  }
  if(remote)for(const path of ['/data-core/roadmap/%69mage-review.html','/data-core/roadmap/image-review%2Ehtml']) {
    assert.equal((await fetch(remote+path)).status,401,'Encoded review path stays private');
  }
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(req.method()!=='GET'){mutations.push(u.pathname);return route.fulfill({status:405,json:{error:'Read only fixture'}});}
    if(u.pathname==='/api/data-core/roadmap/programs') {
      const c=careers.find(x=>x.id===u.searchParams.get('careerId'));assert.ok(c);
      return route.fulfill({json:{programs:[{id:'synthetic-'+c.id,metadata:{universityName:'합성 검증대학',major:c.majors[0],year:2027,region:'합성지역',admission:'수시',admissionSeason:'susi',guidelineId:'synthetic-'+c.id,selectionFormula:'학생부20/실기80',practicalType:'합성 실기',verificationStatus:'public-source-unverified'}}],pagination:{page:1,totalPages:1,buttons:[1],total:1},total:1,facets:{region:['합성지역'],schoolType:[],academicRatio:[20],practicalRatio:[80]},trend:null}});
    }
    if(u.pathname==='/api/data-core/admissions/guidelines')return route.fulfill({json:{rows:[{id:u.searchParams.get('id'),universityName:'합성 검증대학',department:'합성 전공',academicYear:2027,admissionSeason:'susi',admissionType:'합성 실기전형',selectionFormula:'학생부20/실기80',practicalType:'합성 실기',mappingStatus:'review'}]}});
    return route.fulfill({status:401,json:{error:'Synthetic test context'}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  for(const width of [1920,1440,1024,820,768,430,390,320]) {
    await page.setViewportSize({width,height:width<=430?844:1080});
    await page.goto(origin+'/data-core/roadmap/image-review');
    assert.equal(await page.locator('.review-item').count(),35);
    for(const img of await page.locator('.review-item img').all()) {await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}
    await noOverflow();await page.screenshot({path:`${out}/contact-sheet-${width}.png`,fullPage:true});
    await page.locator('#hideLabels').check();
    assert.equal(await page.locator('.review-label').first().evaluate(e=>getComputedStyle(e).visibility),'hidden');
    if(width===1440)await page.screenshot({path:`${out}/contact-sheet-unlabelled.png`,fullPage:true});
    await page.locator('#hideLabels').uncheck();
    for(const c of careers) {
      const concept=occupationImageConcepts.find(x=>x.occupationId===c.id);
      await page.goto(`${origin}/data-core/roadmap#family=${c.family}`);
      const card=page.locator(`.dream-card[href="#family=${c.family}&career=${c.id}"]`);
      const image=card.locator('img');await image.scrollIntoViewIfNeeded();await image.evaluate(e=>e.decode());
      assert.equal(await image.getAttribute('src'),concept.asset+'?v='+concept.version);
      assert.equal(await image.getAttribute('loading'),'lazy');
      assert.deepEqual(await image.evaluate(e=>[e.naturalWidth,e.naturalHeight]),[640,480]);
      assert.equal(await image.evaluate(e=>getComputedStyle(e).objectFit),'contain');
      await noOverflow();await card.click();await page.locator('.university-item').first().waitFor();
      assert.equal(await page.locator('#resultGoal').textContent(),c.name);
      assert.equal(await page.locator('#majorGrid .major-item').count(),c.majors.length);
      const hero=page.locator('#resultPortrait img');await hero.evaluate(e=>e.decode());
      assert.equal(await hero.getAttribute('src'),concept.detailAsset+'?v='+concept.version);
      assert.equal(await hero.getAttribute('alt'),concept.alt);
      assert.equal(await hero.getAttribute('fetchpriority'),'high');
      assert.deepEqual(await hero.evaluate(e=>[e.naturalWidth,e.naturalHeight]),[concept.detailWidth,concept.detailHeight]);
      assert.equal(await hero.evaluate(e=>getComputedStyle(e).objectFit),'contain');
      assert.ok(await hero.evaluate(e=>e.getBoundingClientRect().width>=Math.min(innerWidth-50,600)),'Detail scene must be large enough to inspect');
      await noOverflow();
      if(['D001','D010','D019','D028','D035'].includes(c.id)) {await hero.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${width}-${c.id}-detail.png`});}
      assert.equal(await page.locator('.career-visual-section').count(),3);
      await page.getByRole('button',{name:'입시요강 보기',exact:true}).first().click();await page.locator('dialog[open]').waitFor();
      assert.match(await page.locator('dialog').innerText(),/합성 검증대학/);
      await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
      assert.deepEqual(await page.locator('.timeline h3').allTextContents(),['기초 표현력','전공 기초','전공 심화','입시 실기 적용','실전 완성도']);
      await page.locator('.flow-strip a[href="#curriculumSection"]').click();
      assert.ok(page.url().includes('career='+c.id));await noOverflow();
      reports.push({width,id:c.id,passed:true});
    }
    console.log(JSON.stringify({width,traversals:reports.length}));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  await fs.writeFile(`${out}/report.json`,JSON.stringify({remote,protectedReview:'real Worker authorization with local synthetic identities; deployed anonymous 401',admissions:'synthetic intercepted fixtures',reports,errors,mutations,verifiedDeployedAssets:checked.size},null,2));
} finally {await browser.close();await new Promise(done=>server.close(done));await h.mf.dispose();}

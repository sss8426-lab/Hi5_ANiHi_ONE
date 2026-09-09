import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3107';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Synthetic fixtures require localhost');
const output=path.resolve('outputs/layout-browser');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL || 'chrome'});
let checks=0;
try {
  const context=await browser.newContext();
  let authenticated=true;
  let loginPage=false;
  const errors=[], writes=[], broken=[];
  const hqFolders=['class-artwork','director-only','resources','production'].map((key,i)=>({
    id:`hq-${i}`,title:`Synthetic HQ ${i}`,recordType:'hq-library-folder',sourceApp:'data-core-library',
    campusId:null,metadata:{folderKey:key,sortOrder:i+1},
  }));
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(url.origin!==base) return route.abort();
    // Serve the real protected shells locally, without production credentials.
    const shells={'/data-core/work':'index.html','/data-core/work/library':'index.html','/data-core/content/blog':'content.html','/data-core/content/instagram':'content.html','/data-core/accounts':'accounts.html','/data-core/operations':'operations.html','/data-core/readiness':'readiness.html','/data-core/kkumeum':'work/kkumeum.html'};
    if(req.isNavigationRequest() && shells[p]) {
      let html=await fs.readFile(`public/data-core/${shells[p]}`,'utf8');
      if(shells[p]==='index.html') html=html.replace('</body>','<script src="/data-core/work/kkumeum-nav.js?v=20260908-mode-home"></script></body>');
      return route.fulfill({contentType:'text/html',body:html});
    }
    if(!p.startsWith('/api/')) return route.continue();
    if(req.method()==='POST' && /^\/api\/data-core\/competition-sources\/(mgood|artmd)\/preview$/.test(p)) return route.fulfill({json:{items:[]}});
    if(req.method()!=='GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({status:403,json:{error:'Synthetic read-only fixture'}}); }
    const ctx={authenticated,isSuperAdmin:authenticated,canWrite:authenticated,user:authenticated?{displayName:'Synthetic admin',name:'Synthetic admin'}:null,memberships:[]};
    if(p==='/api/data-core/context'||p==='/api/auth/session') return route.fulfill({json:loginPage?{...ctx,authenticated:false}:ctx});
    if(p==='/api/data-core/health'||p==='/api/kkumeum/health') return route.fulfill({json:{ok:true,bindings:{database:true,files:true},status:{ok:true,database:true,files:true}}});
    if(p==='/api/kkumeum/dashboard') return route.fulfill({json:{dashboard:{students:0,classes:0,yearMonth:'2026-09',reports:{missing:0,draft:0,ready:0,sent:0},artworks:0,guardians:{linked:0}}}});
    if(p.startsWith('/api/kkumeum/analytics/')) return route.fulfill({status:503,json:{error:'합성 데이터 환경에서는 통계를 제공하지 않습니다.'}});
    if(p==='/api/data-core/campuses') return route.fulfill({json:{campuses:[{id:'synthetic-campus',name:'Synthetic campus'}]}});
    if(p==='/api/data-core/records') return route.fulfill({json:{records:url.searchParams.get('recordType')==='hq-library-folder'?hqFolders:[]}});
    return route.fulfill({json:{ok:true,accounts:[],classes:[],students:[],announcements:[],items:[],events:[],competitions:[],files:[],records:[],drafts:[],backups:[],totals:{},status:{}}});
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()===404&&!r.url().includes('/api/')) broken.push(new URL(r.url()).pathname);});
  const routes=['','/counseling','/work','/work/library','/content/blog','/content/instagram','/accounts','/operations','/readiness','/kkumeum','/login'];
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['small-mobile',320,740]]) {
    await page.setViewportSize({width,height});
    for(const route of routes) {
      loginPage=route==='/login';
      console.log(`Checking ${name} /data-core${route}`);
      await page.goto(`${base}/data-core${route}`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('body.data-core-layout').count(),1,route);
      assert.equal(await page.locator('link[href*="layout-theme.css?v="]').count(),1,route);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} ${route} overflow`);
      assert.equal(await page.locator('[hidden]').evaluateAll(els=>els.every(el=>getComputedStyle(el).display==='none')),true,`${route} hidden states`);
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 250, 253)');
      const sidebar=page.locator('.sidebar,.kk-sidebar');
      if(await sidebar.count()) {
        assert.match(await sidebar.evaluate(el=>getComputedStyle(el).backgroundImage),/mode-sidebar\.svg/);
        checks++;
      }
      if(name!=='small-mobile') await page.screenshot({path:path.join(output,`${name}${route.replaceAll('/','-')||'-home'}.png`),fullPage:true,mask:[page.locator('#temporaryPassword')]});
      if(route==='/kkumeum') {
        await page.locator('#kkAddClassBtn').click();
        await page.locator('dialog[open]').waitFor();
        assert.equal(await page.locator('dialog[open]').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);
        await page.getByRole('button',{name:'취소',exact:true}).click();
        await page.locator('dialog[open]').waitFor({state:'hidden'});
        checks+=2;
      }
      checks+=5;
    }
    loginPage=false;
    await page.goto(`${base}/data-core`);
    await page.locator('[data-mode-card="counseling"]').click();
    await page.waitForURL(`${base}/data-core/counseling`);
    await page.goBack();
    await page.locator('[data-mode-card="work"]').click();
    await page.waitForURL(`${base}/data-core/work`);
    await page.reload();
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('mode-home-artwork-active')),false);
    checks+=3;
  }
  authenticated=false;
  for(const route of ['','/work/library','/content/blog','/readiness','/kkumeum','/login']) {
    await page.goto(`${base}/data-core${route}`);await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('body.data-core-layout').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`unauth ${route}`);
    if(route==='/readiness') assert.equal(await page.locator('#runBtn').isDisabled(),true);
    checks+=2;
  }
  assert.deepEqual(writes,[],'Layout navigation must not write data');
  assert.deepEqual(errors,[],'Browser runtime errors');
  assert.deepEqual(broken,[],'Missing static assets');
  console.log(JSON.stringify({passed:checks,pageErrors:0,brokenAssets:0,syntheticOnly:true,screenshots:output}));
} finally { await browser.close(); }

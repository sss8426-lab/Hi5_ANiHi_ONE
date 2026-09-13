import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3137';
const pass=process.env.BRAND_PASS||'final';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)&&!/^https:\/\/([a-f0-9]+-)?hi5-anihi-one\.sss8426\.workers\.dev$/.test(base))throw Error('Unexpected test origin');
const out=`outputs/brand-home/${pass}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
let role='master',events=[],writes=0;const errors=[],reports=[],checks=[];
try{
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin!==base)return route.abort();
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated:role!=='guest',isSuperAdmin:role==='master',canWrite:role!=='guest',user:role==='guest'?null:{displayName:'테스트 관리자',internalUserId:'local:synthetic'},memberships:role==='campus'?[{role:'CAMPUS_ADMIN',campusId:'synthetic-campus',campusName:'테스트 캠퍼스'}]:[]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname==='/api/auth/activity')return route.fulfill({json:{ok:true}});
    if(u.pathname==='/api/auth/logout'){role='guest';return route.fulfill({json:{ok:true}});}
    if(u.pathname==='/api/data-core/calendar'){
      if(req.method()==='POST'){writes++;const body=req.postDataJSON();events=[{...body,id:'synthetic-event',canEdit:true}];return route.fulfill({json:{event:events[0]}});}
      return route.fulfill({json:{events}});
    }
    if(u.pathname.includes('/competition-sources/')&&u.pathname.endsWith('/preview'))return route.fulfill({json:{items:[],pages:[]}});
    if(req.method()!=='GET')return route.fulfill({status:403,json:{error:'Synthetic test denies other writes'}});
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],memberships:[],competitions:[],folders:[],pages:[],totalFolders:0,totalPages:0}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1920,1440,1280,1180,1024,768,390,320]){
    await page.setViewportSize({width,height:width>=1024?900:1000});
    await page.goto(base+'/data-core/counseling');
    await page.locator('#userChip strong').getByText('테스트 관리자',{exact:true}).waitFor();
    const cards=page.locator('.counseling-image-cards .feature-card');assert.equal(await cards.count(),3);
    for(const img of await cards.locator('img').all())await img.evaluate(i=>i.decode());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Overflow ${width}`);
    if(pass==='final'){
      assert.equal(await page.locator('#pageTitle').textContent(),'너와 나의 합격의 순간');
      assert.equal(await page.locator('#view-counseling-home h2').textContent(),'하이파이브.애니하이');
      assert.doesNotMatch(await page.locator('body').innerText(),/상담용|상담 홈|컨설팅|임시 컨설턴트/);
      assert.equal(await page.locator('.counseling-card-copy small').count(),0);
      const geometry=await page.evaluate(()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        return {
          cards:[...document.querySelectorAll('.counseling-image-cards .feature-card')].map(rect),
          header:[...document.querySelector('.topbar').children].filter(e=>e.getBoundingClientRect().width).map(rect),
          crops:[...document.querySelectorAll('.counseling-image-cards img')].map(e=>({ratio:e.clientWidth/e.clientHeight,fit:getComputedStyle(e).objectFit})),
          font:getComputedStyle(document.querySelector('#pageTitle')).fontSize,
        };
      });
      assert.equal(new Set(geometry.cards.map(r=>r.top)).size,width>=1024?1:width>760?2:3);
      if(width>=1024)assert.ok(geometry.cards.every(r=>r.bottom<900),`Cards above fold ${width}`);
      for(const crop of geometry.crops){assert.ok(Math.abs(crop.ratio-1.5)<.02);assert.equal(crop.fit,'cover');}
      for(let a=0;a<geometry.header.length;a++)for(let b=a+1;b<geometry.header.length;b++){
        const x=geometry.header[a],y=geometry.header[b];
        assert.ok(Math.min(x.right,y.right)-Math.max(x.left,y.left)<1||Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)<1,`Header overlap ${width}`);
      }
      assert.ok(Number.parseFloat(geometry.font)>=(width<=390?28:width<=760?34:38));
      const contrasts=await page.evaluate(()=>{
        const luminance=color=>{
          const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
          return c[0]*.2126+c[1]*.7152+c[2]*.0722;
        };
        return [...document.querySelectorAll('#pageTitle,#view-counseling-home h2,.counseling-card-copy strong,.sidebar .nav-item,.sidebar .connection-card strong,.sidebar .back-link')].filter(e=>e.getClientRects().length).map(e=>{
          let parent=e,background;
          while(parent){background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;parent=parent.parentElement;}
          const a=luminance(getComputedStyle(e).color),b=luminance(background);
          return {text:e.textContent.trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
        });
      });
      for(const color of contrasts)assert.ok(color.ratio>=4.5,`Text contrast ${width}: ${color.text} ${color.ratio}`);
    }
    await page.screenshot({path:`${out}/home-${width}.png`,fullPage:true});
    if(pass==='final'){
      await page.locator('#brandPresentationStart').click();
      assert.equal(await page.locator('#userChip').isVisible(),false);
      assert.equal(await page.locator('#logoutBtn').isVisible(),false);
      if(width<=1100)await page.locator('.core-menu-toggle').click();
      assert.equal(await page.locator('[data-nav-scope="admin"]').isVisible(),false);
      assert.equal(await page.locator('.sidebar-bottom').isVisible(),false);
      for(const label of ['홈','공모전·실기대회','꿈·전공 로드맵','대학합격 로드맵','꿈을 향한 커리큘럼'])assert.equal(await page.locator('[data-nav-scope="counseling"]').getByText(label,{exact:true}).isVisible(),true);
      if(width<=1100){await page.screenshot({path:`${out}/presentation-menu-${width}.png`});await page.keyboard.press('Escape');}
      await page.screenshot({path:`${out}/presentation-${width}.png`});
      await page.locator('#brandPresentationExit').click();
      assert.equal(await page.locator('#userChip').isVisible(),true);
      assert.equal(await page.locator('#logoutBtn').isVisible(),true);
      assert.equal(await page.locator('#brandPresentationStart').evaluate(e=>e===document.activeElement),true);
    }
    reports.push({width,cards:3,overflow:false});
  }
  if(pass==='final'){
    await page.setViewportSize({width:1440,height:900});
    await page.goto(base+'/data-core/counseling');
    const home=page.locator('#view-counseling-home');
    await home.locator('[data-calendar-add]:visible').waitFor();
    const currentMonth=await home.locator('[data-calendar-month]').textContent();
    const waitMonth=equal=>page.waitForFunction(({text,equal})=>(document.querySelector('#view-counseling-home [data-calendar-month]').textContent===text)===equal,{text:currentMonth,equal});
    await home.locator('[data-calendar-prev]').click();
    await waitMonth(false);
    assert.notEqual(await home.locator('[data-calendar-month]').textContent(),currentMonth);
    await home.locator('[data-calendar-next]').click();
    await waitMonth(true);
    assert.equal(await home.locator('[data-calendar-month]').textContent(),currentMonth);
    await home.locator('[data-calendar-next]').click();
    await waitMonth(false);
    await home.locator('[data-calendar-today]').click();
    await waitMonth(true);
    assert.equal(await home.locator('[data-calendar-month]').textContent(),currentMonth);
    await home.locator('[data-calendar-add]').click();
    await page.locator('#calendarTitle').fill('SYNTHETIC_BRAND_HOME');
    await page.locator('#calendarSubmitBtn').click();
    await page.locator('#calendarModal.hidden').waitFor({state:'attached'});
    await home.locator('[data-calendar-list]').getByText('SYNTHETIC_BRAND_HOME',{exact:true}).waitFor();
    assert.equal(writes,1);
    checks.push('calendar prev/next/today/add: synthetic intercepted API only');
    await page.locator('#brandPresentationStart').click();
    await page.reload();
    await page.locator('#brandPresentationExit:visible').waitFor();
    await home.locator('[data-view="competitions"]').click();
    await page.waitForURL(base+'/data-core/counseling/competitions');
    assert.equal(await page.locator('body.brand-home').count(),0);
    assert.equal(await page.locator('#userChip').isVisible(),true);
    await page.goBack();
    await page.locator('#brandPresentationExit:visible').waitFor();
    await page.locator('#brandPresentationExit').click();
    const nav=page.locator('[data-nav-scope="counseling"]');
    assert.match(await nav.locator('[data-view="counseling-home"]').getAttribute('class'),/active/);
    assert.equal(await nav.locator('a').filter({hasText:'꿈·전공 로드맵'}).getAttribute('href'),'/data-core/roadmap');
    assert.equal(await nav.locator('a').filter({hasText:'대학합격 로드맵'}).getAttribute('href'),'/');
    assert.equal(await home.locator('a').nth(0).getAttribute('href'),'/data-core/roadmap');
    assert.equal(await home.locator('a').nth(1).getAttribute('href'),'/');
    await nav.locator('[data-view="curriculum"]').click();
    await page.waitForURL(base+'/data-core/curriculum');
    await page.locator('#view-curriculum.active').waitFor();
    assert.equal(await page.locator('body.brand-home').count(),0);
    await page.goBack();
    await nav.locator('[data-view="mode-home"]').click();
    await page.waitForURL(base+'/data-core');
    await page.goBack();
    await page.locator('#adminNav').click();
    await page.locator('#view-admin.active').waitFor();
    await nav.locator('[data-view="counseling-home"]').click();
    checks.push('home, competition, curriculum, mode, permissions navigation; roadmap/admissions original links');
    checks.push('MASTER presentation on/off, refresh, back, scoped restoration');
    // Forging a saved preference must never enable the MASTER-only control.
    role='campus';
    await page.evaluate(()=>sessionStorage.setItem('data-core.brand-presentation.v1','on'));
    await page.reload();
    await page.locator('#userChip strong').getByText('테스트 캠퍼스',{exact:true}).waitFor();
    assert.equal(await page.locator('#brandPresentationStart').isVisible(),false);
    assert.equal(await page.locator('[data-nav-scope="admin"]').isVisible(),false);
    assert.equal(await page.locator('body.brand-presenting').count(),0);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('data-core.brand-presentation.v1')),null);
    await page.locator('#logoutBtn').click();
    await page.locator('#userChip strong').getByText('로그인이 필요합니다',{exact:true}).waitFor();
    assert.equal(await page.locator('#brandPresentationStart').isVisible(),false);
    assert.equal(await home.locator('[data-calendar-add]').isVisible(),false);
    checks.push('campus and guest visibility; logout via mock, no real credentials');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await home.locator('.feature-card img').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
    checks.push('text contrast >= 4.5:1, reduced-motion');
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/result.json`,JSON.stringify({base,pass,reports,checks,errors,syntheticWrites:writes,productionWrites:0},null,2));
  console.log(JSON.stringify({pass,viewports:reports.length,checks,errors,productionWrites:0}));
}finally{await browser.close();}

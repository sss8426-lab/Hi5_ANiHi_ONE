import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const publicRoot=path.resolve('public');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
const shells={'/data-core':'index','/data-core/':'index','/data-core/counseling':'index','/data-core/counseling/competitions':'index','/data-core/work':'index','/data-core/work/library':'index','/data-core/content/blog':'content','/data-core/content/instagram':'content','/data-core/accounts':'accounts','/data-core/operations':'operations','/data-core/readiness':'readiness','/data-core/kkumeum':'work/kkumeum','/data-core/login':'login','/data-core/roadmap':'roadmap'};
for (const suffix of ['', '/content', '/design', '/content/basic', '/content/advanced', '/content/admission', '/design/basic']) shells['/data-core/curriculum' + suffix] = 'index';
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  const file=path.resolve(publicRoot,'.'+decodeURIComponent(u.pathname));
  if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403).end();return;}
  try{const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.CORE_VISUAL_ORIGIN||`http://127.0.0.1:${server.address().port}`;
if(!/^https?:\/\/(?:127\.0\.0\.1:\d+|localhost:\d+|[a-z0-9.-]+\.workers\.dev)$/.test(base))throw Error('Unsupported visual test origin');
const out=process.env.CORE_VISUAL_ORIGIN?'outputs/core-design-preview':'outputs/core-design-browser';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[],consoleErrors=[],broken=[],mutations=[];let authenticated=true,checks=0;
const hq=['class-artwork','director-only','resources','production'].map((key,i)=>({id:`synthetic-hq-${i}`,title:`Synthetic folder ${i}`,recordType:'hq-library-folder',sourceApp:'data-core-library',campusId:null,metadata:{folderKey:key,sortOrder:i+1}}));
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;
  if(u.origin!==base)return route.abort();
  // Protected shells use the exact checked-out HTML; all visual assets come from the chosen origin.
  if(req.isNavigationRequest()&&shells[p]){
   let html=await fs.readFile(`public/data-core/${shells[p]}.html`,'utf8');
   if(shells[p]==='index')html=html.replace('</body>','<script src="/data-core/work/kkumeum-nav.js"></script></body>');
   return route.fulfill({contentType:'text/html',body:html});
  }
  if(!p.startsWith('/api/'))return route.continue();
  if(req.method()==='POST'&&p==='/api/auth/activity')return route.fulfill({json:{ok:true}});
  if(req.method()==='POST'&&p.includes('/competition-sources/')&&p.endsWith('/preview'))return route.fulfill({json:{pages:[],items:[]}});
  if(req.method()!=='GET'){mutations.push(`${req.method()} ${p}`);return route.fulfill({status:403,json:{error:'Read-only synthetic fixture'}});}
  const auth=authenticated&&!req.headers().referer?.includes('/login');
  if(p==='/api/family/auth/session')return route.fulfill({json:{authenticated:auth,displayName:'Synthetic guardian',mustChangePassword:false}});
  if(p==='/api/family/children')return route.fulfill({json:{children:[{studentId:'synthetic-child',displayName:'Synthetic child',campusName:'Synthetic campus'}]}});
  if(p.startsWith('/api/family/'))return route.fulfill({json:{reports:[],artworks:[],notices:[],unreadCount:0,configured:false,subscriptionReady:false}});
  if(p==='/api/data-core/context'||p==='/api/auth/session')return route.fulfill({json:{authenticated:auth,isSuperAdmin:auth,canWrite:auth,user:auth?{name:'Synthetic admin',displayName:'Synthetic admin',internalUserId:'local:synthetic'}:null,memberships:[]}});
  if(p==='/api/auth/campuses')return route.fulfill({json:{summary:{total:10,online:2,today:4},campuses:Array.from({length:10},(_,i)=>({campusName:`Synthetic campus ${i+1}`,loginId:`synthetic-${i}`,accountId:`synthetic-${i}`,status:'active',online:i<2,lastLoginAt:'2026-09-13T00:00:00Z',lastSeenAt:'2026-09-13T00:05:00Z'})),recentLogins:[{campusName:'Synthetic campus 1',loginAt:'2026-09-13T00:00:00Z'}]}});
  if(p==='/api/kkumeum/analytics/preview')return route.fulfill({json:{analytics:{activeStudentCount:0,reports:{completionRate:0,missing:0,draft:0,ready:0,sent:0},artworks:{count:0,averagePerActiveStudent:0},stageBreakdown:{suppressed:false,buckets:[]},growthSkills:{suppressed:false,buckets:[]},minimumCohortSize:5},syncEnabled:false}});
  if(p==='/api/data-core/curriculum')return route.fulfill({json:{folders:[],lessons:[],totalFolders:0,totalPages:0}});
  if(p==='/api/data-core/library/folders')return route.fulfill({json:{folder:{id:'root',title:'자료보관함',canWrite:true,canDelete:false},breadcrumbs:[{id:'root',title:'자료보관함'}],folders:Array.from({length:4},(_,i)=>({id:`synthetic-folder-${i}`,title:`Synthetic folder ${i+1}`,canWrite:true,canDelete:false}))}});
  if(p==='/api/data-core/library/files')return route.fulfill({json:{files:[],hasMore:false}});
  if(p==='/api/data-core/content/defaults')return route.fulfill({json:{defaults:{hashtags:'',footer:''}}});
  if(p==='/api/data-core/content/ai-status')return route.fulfill({json:{configured:false,models:{text:'configured-model',image:'configured-model'}}});
  if(p.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true},status:{ok:true,database:true,files:true}}});
  if(p==='/api/data')return route.fulfill({json:{students:[],universities:[],cases:[],awardFolders:[],settings:{}}});
  if(p==='/api/kkumeum/dashboard')return route.fulfill({json:{dashboard:{students:0,classes:0,yearMonth:'2026-09',reports:{missing:0,draft:0,ready:0,sent:0},artworks:0,guardians:{linked:0}}}});
  if(p==='/api/data-core/campuses')return route.fulfill({json:{campuses:[{id:'synthetic-campus',name:'Synthetic campus'}]}});
  if(p==='/api/data-core/records')return route.fulfill({json:{records:u.searchParams.get('recordType')==='hq-library-folder'?hq:[]}});
  if(p.endsWith('/guidelines'))return route.fulfill({json:{rows:[{id:'synthetic-guide',universityName:'합성대학교',department:'디자인학과',academicYear:'2027',admissionSeason:u.searchParams.get('season'),admissionType:'실기전형',mappingStatus:'review',sourceName:'Synthetic source',sourceUrl:'https://example.com/guide'}],total:1,page:1,facets:{},canSync:false}});
  return route.fulfill({json:{ok:true,accounts:[],classes:[],students:[],announcements:[],items:[],events:[],competitions:[],files:[],records:[],drafts:[],backups:[],programs:[],totals:{},status:{}}});
 });
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.startsWith('/api/'))broken.push(new URL(r.url()).pathname);});
 const routes=[...Object.keys(shells).filter(p=>p!=='/data-core/'),'/admissions-web/renderer/index.html','/admissions-web/renderer/index.html#page=susi','/admissions-web/renderer/index.html#page=jungsi'];
 for(const width of [1920,1440,1280,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const route of routes){
   console.log(`visual ${width} ${route}`);
   await page.goto(base+route);await page.waitForLoadState('networkidle');
   const detail=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,offenders:[...document.querySelectorAll('main *')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+1).slice(0,6).map(e=>({tag:e.tagName,cls:e.className}))}));
   assert.equal(detail.overflow,false,`${width} ${route} ${JSON.stringify(detail.offenders)}`);
   const clipped=await page.locator('button:visible').evaluateAll(nodes=>nodes.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>e.id||e.className));
   assert.deepEqual(clipped,[],`${width} ${route} clipped buttons`);
   assert.doesNotMatch(await page.locator('body').innerText(),/Cannot read properties|TypeError|ReferenceError/);
   if(route==='/data-core/accounts')assert.equal(await page.locator('.presence-item').count(),10);
   if(route==='/admissions-web/renderer/index.html'){
    for(const label of await page.locator('.summary-metrics b').all())assert.ok(await label.evaluate(e=>e.clientWidth>=80),'Admission metric labels retain readable width');
    checks+=4;
   }
   const visibleImages=page.locator('img:visible');
   for(const img of await visibleImages.all())await img.evaluate(i=>i.decode());
   if(route!=='/data-core/login'){
    assert.equal(await page.locator('link[href*="design-system.css"]').count(),1);
    const background='rgb(248, 248, 245)';
    assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),background);
   }
   const toggle=page.locator('.core-menu-toggle');
   if(await toggle.count()){
    if(width<=1100){
     assert.equal(await toggle.isVisible(),true);await toggle.click();
     const dialog=page.locator('#coreNavigation');assert.equal(await dialog.evaluate(e=>e.open),true);
     assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
     assert.equal(await page.locator('.sidebar,.kk-sidebar').evaluate(e=>getComputedStyle(e).backgroundImage),'none');
     await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(e=>e.open),false);
     await page.waitForFunction(()=>document.querySelector('.core-menu-toggle').getAttribute('aria-expanded')==='false');
     assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
    }else{
     assert.equal(await toggle.isVisible(),false);
     assert.equal(await page.locator('.sidebar,.kk-sidebar').evaluate(e=>getComputedStyle(e).backgroundImage),'none');
    }
    checks+=5;
   }
   if(route==='/data-core/kkumeum'){
    await page.locator('[data-menu=more]').click();await page.getByRole('button',{name:'반관리',exact:true}).click();
    await page.locator('#kkAddClassBtn').click();const modal=page.locator('dialog[open]');await modal.waitFor();
    assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);checks+=2;
   }
   if([1440,1024,768,390].includes(width))await page.screenshot({path:`${out}/${width}-${route.replace(/[^a-z0-9]/gi,'-')}.png`,fullPage:true});
   checks+=4;
  }
  for(const family of ['story','design']){
   console.log(`visual ${width} career family ${family}`);
   await page.goto(base+`/data-core/roadmap#family=${family}`);await page.locator('.dream-card').first().waitFor();
   for(const img of await page.locator('.dream-card img').all())await img.evaluate(i=>{i.loading='eager';return i.decode();});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   if([1440,1024,768,390].includes(width))await page.screenshot({path:`${out}/${width}-jobs-${family}.png`,fullPage:true});
   await page.locator('.dream-card').first().click();await page.locator('#roadmapResult:not([hidden])').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.goBack();await page.locator('.dream-card').first().waitFor();checks+=4;
  }
  await page.goto(base+'/data-core');await page.locator('[data-mode-card=counseling]').click();await page.waitForURL('**/data-core/counseling');
  await page.goBack();await page.locator('[data-mode-card=work]').click();await page.waitForURL('**/data-core/work');checks+=2;
 }
 // Move the same sidebar through both layouts; native handlers must survive.
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/data-core/counseling');await page.locator('.core-menu-toggle').click();
 await page.locator('.sidebar [data-view=competitions]').click();await page.waitForURL('**/counseling/competitions');
 assert.equal(await page.locator('#coreNavigation').evaluate(e=>e.open),false);
 await page.setViewportSize({width:1440,height:1000});await page.locator('.app-shell > .sidebar').waitFor();
 await page.locator('.sidebar [data-view=counseling-home]').click();await page.waitForURL('**/data-core/counseling');checks+=4;
 for(const width of [1920,1440,1280,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.goto(base+'/family/index.html');await page.locator('#familyView:visible').waitFor();
  await page.locator('[data-family-records]').click();
  await page.locator('#homeChildName').getByText('Synthetic child',{exact:true}).waitFor();
  assert.equal(await page.locator('#latestArtworks > .empty-inline').evaluate(e=>getComputedStyle(e).gridColumn),'1 / -1');
  assert.equal(await page.locator('#guardianName').evaluate(e=>getComputedStyle(e.parentElement).wordBreak),'keep-all');
  checks+=2;
  for(const button of await page.locator('.km-bottom button').all()){
   await button.click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(248, 248, 245)');
   checks+=2;
  }
  await page.locator('.km-more [data-open=home]').click();
  if([1440,1024,390].includes(width))await page.screenshot({path:`${out}/${width}-family.png`,fullPage:true});
 }
 authenticated=false;
 await page.goto(base+'/family/index.html');await page.locator('#loginView:visible').waitFor();checks++;
 for(const route of ['/data-core','/data-core/counseling','/data-core/roadmap','/data-core/login']){
  await page.goto(base+route);await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(broken,[]);assert.deepEqual(mutations,[]);
 const report={checks,viewports:[1920,1440,1280,1024,768,390,320],pageErrors:errors,consoleErrors,brokenAssets:broken,mutations,syntheticOnly:true,assetsOrigin:base,protectedShells:'checked-out HTML, mocked APIs; no production data'};
 await fs.writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error.message);throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

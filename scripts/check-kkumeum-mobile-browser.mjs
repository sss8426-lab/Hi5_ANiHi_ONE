import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=path.resolve('public');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p==='/data-core/kkumeum')p='/data-core/work/kkumeum.html';if(p==='/family/')p='/family/index.html';const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}).end(await fs.readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.KK_VISUAL_ORIGIN||`http://127.0.0.1:${server.address().port}`;
assert.match(base,/^https?:\/\/(?:127\.0\.0\.1:\d+|[a-z0-9.-]+\.workers\.dev)$/);
const out=process.env.KK_VISUAL_ORIGIN?'outputs/kkumeum-preview':'outputs/kkumeum-mobile';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[],badAssets=[],writes=[];let checks=0,role='MASTER',fail=false;
try{
if(process.env.KK_VISUAL_ORIGIN){
 for(const file of ['data-core/work/kkumeum.html','data-core/work/kkumeum.js','data-core/work/kkumeum-operations.js','data-core/work/kkumeum-mobile.js','family/kkumeum-mobile.css','family/index.html','family/family-mobile.js','family/family-mobile.css','family/sw.js']){
  const remote=await fetch(`${base}/${file}`);assert.equal(remote.status,200,file);assert.equal((await remote.text()).replace(/\r\n/g,'\n'),(await fs.readFile(path.join(root,file),'utf8')).replace(/\r\n/g,'\n'),`Deployed asset ${file}`);
 }
}
const classes=[{id:'class-a',name:'SYNTHETIC 기초반',updated_at:'2026-09-10'},{id:'class-b',name:'SYNTHETIC 심화반',updated_at:'2026-09-12'}];
const students=[{id:'student-a',name:'SYNTHETIC 학생 A',current_class_id:'class-a',status:'active',updated_at:'2026-09-13T00:00:00.000Z'},{id:'student-b',name:'SYNTHETIC 학생 B',current_class_id:'class-a',status:'active'}];
let notices=[{id:'notice-a',campusId:'campus-a',announcementType:'campus-news',title:'SYNTHETIC 공지 제목',body:'합성 공지 본문입니다.',status:'draft',readCount:0,createdAt:'2026-09-13',targets:[{targetType:'campus',targetId:'campus-a'}]},{id:'class-notice',campusId:'campus-a',announcementType:'class-news',title:'SYNTHETIC 반소식',body:'합성 반소식',status:'published',readCount:2,createdAt:'2026-09-12',targets:[{targetType:'class',targetId:'class-a'}]}];
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',async r=>{
  const req=r.request(),u=new URL(req.url()),p=u.pathname;
  if(u.origin!==base)return r.abort();
  if(req.isNavigationRequest()&&p==='/data-core/kkumeum')return r.fulfill({contentType:'text/html',body:await fs.readFile(path.join(root,'data-core/work/kkumeum.html'),'utf8')});
  if(!p.startsWith('/api/'))return r.continue();
  const reply=(json,status=200)=>r.fulfill({json,status});
  if(p==='/api/data-core/context')return reply({authenticated:true,isSuperAdmin:role==='MASTER',canWrite:true,user:{displayName:'SYNTHETIC',internalUserId:'synthetic-actor'},campusIds:['campus-a'],memberships:role==='MASTER'?[]:[{role,campusId:'campus-a'}]});
  if(p==='/api/data-core/campuses')return reply({campuses:[{id:'campus-a',name:'SYNTHETIC 캠퍼스'},...(role==='MASTER'?[{id:'campus-b',name:'SYNTHETIC 도착 캠퍼스'}]:[])]});
  if(p==='/api/kkumeum/health')return reply({status:{ok:true,database:true,files:true}});
  if(p==='/api/kkumeum/announcement-capabilities')return reply({canPublishCampus:['MASTER','STAFF'].includes(role)});
  if(p==='/api/kkumeum/classes')return fail?reply({error:'synthetic failure'},503):reply({classes:u.searchParams.get('campusId')==='campus-b'?[{id:'destination-class',name:'SYNTHETIC 도착 반',active:1}]:classes});
  if(p==='/api/kkumeum/students')return reply({students});
  if(p.endsWith('/transfer')){if(req.method()==='GET')return reply({transfers:[]});writes.push(req.postDataJSON());return reply({transfer:{studentId:'student-a',toCampusId:'campus-b'}});}
  if(p.startsWith('/api/kkumeum/students/'))return reply({student:students[0]});
  if(p==='/api/kkumeum/announcements'&&req.method()==='POST'){const body=req.postDataJSON();writes.push(body);const n={...body,id:`saved-${writes.length}`,status:'draft',canEdit:true,readCount:0,createdAt:'2026-09-13'};notices.push(n);return reply({announcement:n},201);}
  if(p==='/api/kkumeum/announcements')return reply({announcements:notices});
  if(p.startsWith('/api/kkumeum/announcements/')){const id=p.split('/').at(-1);const n=notices.find(n=>n.id===id);return reply({announcement:{...n,canEdit:n?.status==='draft'}});}
  if(p==='/api/kkumeum/dashboard')return reply({dashboard:{students:2,classes:2,yearMonth:'2026-09',reports:{missing:0,draft:0,ready:0,sent:0},artworks:0,guardians:{linked:0}}});
  if(p==='/api/kkumeum/analytics/preview')return reply({analytics:{activeStudentCount:2,reports:{completionRate:0,missing:0,draft:0,ready:0,sent:0},artworks:{count:0,averagePerActiveStudent:0},stageBreakdown:{suppressed:true,buckets:[]},growthSkills:{suppressed:true,buckets:[]},minimumCohortSize:5},syncEnabled:false});
  if(p==='/api/family/auth/session')return reply({authenticated:true,displayName:'SYNTHETIC guardian',mustChangePassword:false});
  if(p==='/api/family/children')return reply({children:[{studentId:'synthetic-child',displayName:'SYNTHETIC child',className:'SYNTHETIC 기초반'}]});
  if(p==='/api/family/notices')return reply({notices:[{announcementId:'family-notice',announcementType:'class-news',title:'SYNTHETIC 보호자 반소식',body:'보호자에게 전달된 내용',publishedAt:'2026-09-13',unread:false}],unreadCount:0});
  if(p==='/api/data-core/calendar'&&req.method()==='POST'){writes.push(req.postDataJSON());return reply({event:{id:'synthetic-event'}},201);}
  if(p.startsWith('/api/family/'))return reply({reports:[],artworks:[],notices:[],unreadCount:0,configured:false});
  if(req.method()!=='GET'){writes.push({path:p,method:req.method()});return reply({error:'Unexpected synthetic write'},403);}
  return reply({reports:[],artworks:[],guardians:[],categories:[],events:[],items:[]});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.startsWith('/api/'))badAssets.push(new URL(r.url()).pathname);});
 async function geometry(width){
  const g=await page.evaluate(()=>{const e=document.querySelector('.km-frame');const r=e.getBoundingClientRect();return{frame:r.width,left:r.left,overflow:document.documentElement.scrollWidth>innerWidth+1,bottom:document.querySelector('.km-bottom').getBoundingClientRect().bottom,innerHeight};});
  assert.ok(g.frame<=480.1&&g.frame<=width);assert.equal(g.overflow,false,JSON.stringify(g));assert.ok(Math.abs(g.left-(width-g.frame)/2)<2);assert.ok(Math.abs(g.bottom-g.innerHeight)<2);checks+=4;
 }
 for(const width of [1920,1440,1024,820,768,430,390,375,320]){
  console.log(`kkumeum ${width}`);await page.setViewportSize({width,height:900});await page.goto(base+'/data-core/kkumeum');await page.locator('#kmGroups .km-group').first().waitFor();await geometry(width);
  assert.equal(await page.locator('.km-group-head svg').first().getAttribute('viewBox'),'0 0 24 24');
  assert.ok(await page.locator('.km-group-head svg').first().evaluate(e=>e.getBBox().width>0),'Folder icon renders');
  for(const tab of ['kids-news','class-news','notices','select-delivery']){
   await page.locator(`[data-km-tab="${tab}"]`).click();assert.equal(await page.locator(`[data-km-tab="${tab}"]`).getAttribute('aria-selected'),'true');await geometry(width);
   if(['kids-news','class-news'].includes(tab)){await page.locator('[data-expand="class-a"]').click();assert.equal(await page.locator('[data-expand="class-a"]').getAttribute('aria-expanded'),'true');await page.locator('[data-expand="class-a"]').click();}
   if(tab==='notices'){await page.locator('[data-notice=notice-a]').click();await page.getByText('합성 공지 본문입니다.',{exact:true}).waitFor();await page.reload();await page.getByText('합성 공지 본문입니다.',{exact:true}).waitFor();await page.locator('[data-back]').click();}
   if(tab==='select-delivery'){await page.locator('[data-class-check="class-a"]').check();assert.equal(await page.locator('#kmSelected').innerText(),'선택 2명');await page.locator('[data-expand="class-a"]').click();await page.locator('[data-student-check="student-a"]').uncheck();assert.equal(await page.locator('#kmSelected').innerText(),'선택 1명');assert.equal(await page.locator('[data-class-check="class-a"]').evaluate(e=>e.indeterminate),true);await page.locator('#kmWriteSelected').click();await page.locator('#kmComposer').waitFor();await geometry(width);await page.locator('[data-back]').click();}
   if([1440,820,390,320].includes(width))await page.screenshot({path:`${out}/${width}-${tab}.png`,fullPage:true});checks+=4;
  }
  await page.locator('[data-km-tab=kids-news]').click();await page.locator('#kmSearch').fill('존재하지않음');assert.equal(await page.locator('#kmGroups .km-group').count(),0);await page.locator('#kmSearch').fill('');await page.locator('#kmSort').click();assert.equal(await page.locator('#kmSort').innerText(),'최신순');
  await page.locator('[data-menu=more]').click();await page.getByRole('dialog',{name:'더보기'}).waitFor();await page.getByRole('button',{name:'반관리',exact:true}).click();await page.locator('#kkAddClassBtn:visible').waitFor();await page.locator('#kkAddClassBtn').click();await page.getByRole('dialog',{name:'더보기'}).waitFor({state:'hidden'});assert.equal(await page.locator('dialog[open]').count(),1);await geometry(width);await page.keyboard.press('Escape');await page.locator('#kmLegacyBack').click();
  await page.locator('[data-menu=news]').click();if(await page.locator('[data-expand=class-a]').getAttribute('aria-expanded')==='false')await page.locator('[data-expand=class-a]').click();await page.locator('[data-student=student-a]').click();await page.locator('#kkReportForm:visible').waitFor();await geometry(width);await page.locator('#kmLegacyBack').click();
  for(const menu of ['attendance','answers','inquiries']){await page.locator(`[data-menu=${menu}]`).click();await page.getByText(/아직 전용 API가 구현되지 않았습니다/).waitFor();}
  await page.locator('[data-menu=more]').click();await page.locator('#kmMoreClose').click();assert.equal(await page.locator('#kmMore').evaluate(e=>e.open),false);checks+=10;
 }
 // Synthetic selection -> exact target payload -> persisted draft -> actual detail route.
 await page.goto(base+'/data-core/kkumeum?tab=select-delivery');await page.locator('[data-class-check=class-a]').check();await page.locator('#kmWriteSelected').click();await page.locator('#kmComposer [name=title]').fill('SYNTHETIC 선택전달');await page.locator('#kmComposer [name=body]').fill('합성 선택전달 내용');await page.locator('#kmComposer [type=submit]').click();await page.getByText('합성 선택전달 내용',{exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].announcementType,'selected-delivery');assert.deepEqual(writes[0].targets.map(t=>t.targetId).sort(),['student-a','student-b']);checks+=3;
 await page.goto(base+'/data-core/kkumeum?tab=select-delivery');await page.locator('[data-class-check=class-a]').check();await page.locator('#kmScheduleSelected').click();await page.locator('#kmScheduleDate').waitFor();assert.match(await page.locator('#kmComposer').innerText(),/자동 예약발송은 지원하지 않습니다/);checks++;
 await page.locator('#kmScheduleDate').fill('2026-09-20');await page.locator('#kmComposer [name=title]').fill('SYNTHETIC 일정 안내');await page.locator('#kmComposer [name=body]').fill('합성 일정');await page.locator('#kmComposer [type=submit]').click();await page.locator('.km-detail-body').waitFor();assert.match(writes[1].body,/일정: 2026-09-20/);checks++;
 await page.locator('[data-menu=more]').click();await page.getByRole('button',{name:'일정관리',exact:true}).click();await page.locator('#kmCalendarAdd').click();await page.locator('#kmCalendarForm [name=title]').fill('SYNTHETIC 공통 일정');await page.locator('#kmCalendarForm [name=date]').fill('2026-09-20');await page.locator('#kmCalendarForm [type=submit]').click();await page.locator('#kmCalendarAdd').waitFor();assert.equal(writes[2].campusId,'campus-a');assert.equal(writes[2].metadata.startDate,'2026-09-20');assert.ok(!JSON.stringify(writes[2]).includes('student-a'));checks+=3;
 role='TEACHER';await page.goto(base+'/data-core/kkumeum?tab=notices');await page.locator('#kmNotices').waitFor();assert.equal(await page.locator('[data-write-notice]').count(),0);await page.locator('[data-menu=more]').click();assert.equal(await page.getByRole('button',{name:'반관리',exact:true}).count(),0);await page.keyboard.press('Escape');checks+=2;
 role='STAFF';await page.reload();await page.locator('[data-write-notice]').waitFor();await page.locator('[data-write-notice]').click();await page.locator('#kmComposer').waitFor();checks++;role='TEACHER';
 fail=true;await page.reload();await page.locator('[data-retry]').waitFor();fail=false;await page.locator('[data-retry]').click();await page.locator('#kmNotices').waitFor();checks++;
 for(const width of [1920,1440,1024,820,768,430,390,375,320]){
  role='MASTER';await page.setViewportSize({width,height:900});await page.goto(base+'/data-core/kkumeum?view=student&item=student-a');await page.locator('#kkTransferStudent').waitFor();await page.locator('#kkTransferStudent').click();
  assert.equal(await page.locator('#kkToolbar').isVisible(),false);assert.equal(await page.locator('#kmLegacyMount .kk-main > .kk-status-grid').isVisible(),false);checks+=2;
  const form=page.locator('dialog[open] form');await form.locator('[name=toCampusId]').selectOption('campus-b');await form.locator('[name=classId] option[value=destination-class]').waitFor({state:'attached'});await form.locator('[name=classId]').selectOption('destination-class');
  assert.equal(await form.locator('[type=submit]').isEnabled(),true);
  assert.equal(await page.locator('dialog[open]').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  await page.screenshot({path:`${out}/${width}-campus-transfer.png`,fullPage:true});await page.keyboard.press('Escape');checks+=2;
 }
 await page.locator('#kkTransferStudent').click();await page.locator('dialog[open] [name=toCampusId]').selectOption('campus-b');await page.locator('dialog[open] [name=classId] option[value=destination-class]').waitFor({state:'attached'});await page.locator('dialog[open] [name=classId]').selectOption('destination-class');await page.locator('dialog[open] [type=checkbox]').check();await page.locator('dialog[open] [type=submit]').click();await page.locator('#kmGroups').waitFor();assert.deepEqual(writes[3],{fromCampusId:'campus-a',toCampusId:'campus-b',classId:'destination-class',expectedUpdatedAt:'2026-09-13T00:00:00.000Z'});checks++;
 role='CAMPUS_ADMIN';await page.goto(base+'/data-core/kkumeum?view=student&item=student-a');await page.locator('#kkEditStudent').waitFor();assert.equal(await page.locator('#kkTransferStudent').count(),0);assert.equal(await page.locator('#kmCampus').isEnabled(),false);checks+=2;
 for(const width of [1920,1440,1024,820,768,430,390,375,320]){
  await page.setViewportSize({width,height:900});await page.goto(base+'/family/');await page.locator('.km-tabs:visible').waitFor();await geometry(width);
  for(let i=0;i<4;i++){await page.locator(`[data-family-news="${i}"]`).click();assert.equal(await page.locator(`[data-family-news="${i}"]`).getAttribute('aria-selected'),'true');await geometry(width);}
  await page.locator('[data-family-news="1"]').click();await page.getByText('SYNTHETIC 보호자 반소식',{exact:true}).click();await page.locator('.news-body:not(.hidden)').waitFor();
  await page.locator('[data-family-menu=more]').click();assert.equal(await page.getByRole('button',{name:'반관리',exact:true}).count(),0);await page.getByRole('button',{name:'작품',exact:true}).click();await geometry(width);
  if([1440,390,320].includes(width))await page.screenshot({path:`${out}/${width}-guardian.png`,fullPage:true});checks+=2;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(badAssets,[]);console.log(JSON.stringify({ok:true,checks,writes:writes.length,scope:'Synthetic UI fixtures; no production API writes',base}));
 await fs.writeFile(`${out}/results.json`,JSON.stringify({ok:true,checks,errors,badAssets,scope:'Synthetic UI fixtures',base},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

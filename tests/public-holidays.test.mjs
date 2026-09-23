import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryHarness,users,A} from './support/library-harness.mjs';

// Synthetic iCalendar feed in the shape of Google's "대한민국의 휴일" calendar: all-day events whose
// description is "공휴일" (days off) or "기념일…" (observances, not days off).
const year=new Date(Date.now()+9*3600_000).getUTCFullYear();
const d=(m,day)=>`${year}${String(m).padStart(2,'0')}${String(day).padStart(2,'0')}`;
const next=(m,day)=>{const t=new Date(Date.UTC(year,m-1,day+1));return `${t.getUTCFullYear()}${String(t.getUTCMonth()+1).padStart(2,'0')}${String(t.getUTCDate()).padStart(2,'0')}`;};
const vevent=(start,summary,description,end=null)=>['BEGIN:VEVENT',`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${end||next(Number(start.slice(4,6)),Number(start.slice(6)))}`,`UID:${start}_${summary}@google.com`,`SUMMARY:${summary}`,`DESCRIPTION:${description}`,'END:VEVENT'].join('\r\n');
const OBS='기념일\\n기념일을 숨기려면 Google Calendar 설정 > 대한민국의 휴일 캘린더로 이동하세요.';
function feed(events){return ['BEGIN:VCALENDAR','VERSION:2.0',...events,'END:VCALENDAR'].join('\r\n');}
const base=()=>[
  vevent(d(1,1),'새해첫날','공휴일'),
  vevent(d(3,1),'삼일절','공휴일'),
  vevent(d(5,5),'어린이날','공휴일'),
  vevent(d(5,8),'어버이날',OBS),
  vevent(d(6,6),'현충일','공휴일'),
  vevent(d(8,15),'광복절','공휴일'),
  vevent(d(10,3),'개천절','공휴일'),
  vevent(d(10,5),'쉬는 날 개천절','공휴일'),
  vevent(d(12,24),'크리스마스 이브',OBS),
  vevent(d(12,25),'크리스마스','공휴일'),
  // Folded long line (RFC 5545) must still parse.
  ['BEGIN:VEVENT',`DTSTART;VALUE=DATE:${d(10,9)}`,`DTEND;VALUE=DATE:${d(10,10)}`,'SUMMARY:한글',' 날','DESCRIPTION:공휴일','END:VEVENT'].join('\r\n'),
  vevent(`${year-1}1225`,'작년 크리스마스','공휴일'),
];
async function withFeed(body,fn,status=200){
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{if(String(url).includes('calendar.google.com')){calls.push(String(url));return new Response(body,{status,headers:{'content-type':'text/calendar'}});}return original(url,init);};
  try{return await fn(calls);}finally{globalThis.fetch=original;}
}
const holidays=async(h,user=users.staff)=>{
  const events=[];
  for(let m=1;m<=12;m+=2){
    const from=`${year}-${String(m).padStart(2,'0')}-01`,to=new Date(Date.UTC(year,m+1,0)).toISOString().slice(0,10);
    const res=await h.request('GET',`/api/data-core/calendar?from=${from}&to=${to}&eventType=holiday`,user);
    assert.equal(res.status,200,JSON.stringify(res.body));events.push(...res.body.events);
  }
  return events.sort((a,b)=>a.metadata.startDate.localeCompare(b.metadata.startDate));
};

test('공휴일 sync adds days off to the CORE calendar as organization-wide read-only holiday events', async()=>{
  const h=await libraryHarness();
  try{
    const result=await withFeed(feed(base()),async calls=>{
      const res=await h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin);
      assert.equal(calls.length,1);return res;
    });
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.deepEqual({added:result.body.added,updated:result.body.updated,removed:result.body.removed},{added:9,updated:0,removed:0});
    const events=await holidays(h);
    assert.deepEqual(events.map(e=>[e.metadata.startDate.slice(5),e.title]),[
      ['01-01','새해첫날'],['03-01','삼일절'],['05-05','어린이날'],['06-06','현충일'],['08-15','광복절'],
      ['10-03','개천절'],['10-05','쉬는 날 개천절'],['10-09','한글날'],['12-25','크리스마스']]);
    for(const e of events){
      assert.equal(e.campusId,null);assert.equal(e.visibility,'organization');assert.equal(e.metadata.eventType,'holiday');
      assert.equal(e.metadata.sourceApp,'kr-public-holidays');assert.equal(e.canManage,false);
    }
    // Every campus role sees them; nobody can edit or delete a synced holiday by hand.
    assert.equal((await holidays(h,users.teacher)).length,9);assert.equal((await holidays(h,users.foreign)).length,9);
    assert.equal((await h.request('PATCH',`/api/data-core/calendar/${events[0].id}`,users.admin,{title:'변경'})).status,403);
    assert.equal((await h.request('DELETE',`/api/data-core/calendar/${events[0].id}`,users.admin)).status,403);
  } finally {await h.mf.dispose();}
});

test('re-sync is idempotent, follows renames and cancellations, and never touches hand-made events', async()=>{
  const h=await libraryHarness();
  try{
    await withFeed(feed(base()),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    const manual=await h.request('POST','/api/data-core/calendar',users.campusAdmin,{title:'캠퍼스 자체 휴무',campusId:A,metadata:{startDate:`${year}-07-20`,eventType:'holiday'}});
    assert.equal(manual.status,201,JSON.stringify(manual.body));
    const again=await withFeed(feed(base()),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    assert.deepEqual([again.body.added,again.body.updated,again.body.removed],[0,0,0]);
    // 임시공휴일 announced, 쉬는 날 개천절 cancelled, 크리스마스 renamed.
    const changed=base().filter(e=>!e.includes('쉬는 날 개천절')).map(e=>e.replace('SUMMARY:크리스마스\r','SUMMARY:기독탄신일\r'));
    changed.push(vevent(d(6,3),'임시공휴일','공휴일'));
    const res=await withFeed(feed(changed),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    assert.deepEqual([res.body.added,res.body.updated,res.body.removed],[1,1,1]);
    const titles=(await holidays(h,users.campusAdmin)).map(e=>`${e.metadata.startDate.slice(5)} ${e.title}`);
    assert.ok(titles.includes('06-03 임시공휴일'));assert.ok(titles.includes('12-25 기독탄신일'));assert.ok(!titles.includes('10-05 쉬는 날 개천절'));
    assert.ok(titles.includes('07-20 캠퍼스 자체 휴무'),'manual campus holiday stays');
  } finally {await h.mf.dispose();}
});

test('a broken or unreachable feed changes nothing; only MASTER can run the sync', async()=>{
  const h=await libraryHarness();
  try{
    await withFeed(feed(base()),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    const broken=await withFeed(feed([vevent(d(1,1),'새해첫날','공휴일')]),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    assert.equal(broken.status,502);assert.match(broken.body.error,/바꾸지 않았습니다/);
    const down=await withFeed('unavailable',()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin),503);
    assert.equal(down.status,502);
    assert.equal((await holidays(h)).length,9);
    for(const user of [users.campusAdmin,users.teacher,users.staff])assert.equal((await withFeed(feed(base()),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',user))).status,403);
    assert.equal((await h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin,undefined,'https://evil.example')).status,403);
    assert.equal((await h.request('POST','/api/data-core/calendar/public-holidays/sync',null)).status,401);
  } finally {await h.mf.dispose();}
});

test('설날·추석 always get the day before and after, even when the feed lists only two days', async()=>{
  const h=await libraryHarness();
  try{
    // Shape of Google's later-year data: 설날 + 설날 연휴 (day after) + 대체공휴일, but no day before.
    const events=[...base(),vevent(d(2,7),'설날','공휴일'),vevent(d(2,8),'설날 연휴','공휴일'),vevent(d(2,9),'쉬는 날 설날','공휴일'),
      vevent(d(9,15),'추석','공휴일'),vevent(d(9,16),'추석 연휴','공휴일')];
    const res=await withFeed(feed(events),()=>h.request('POST','/api/data-core/calendar/public-holidays/sync',users.admin));
    assert.equal(res.status,200,JSON.stringify(res.body));
    const titles=(await holidays(h)).map(e=>`${e.metadata.startDate.slice(5)} ${e.title}`);
    for(const t of ['02-06 설날 연휴','02-07 설날','02-08 설날 연휴','02-09 쉬는 날 설날','09-14 추석 연휴','09-15 추석','09-16 추석 연휴'])assert.ok(titles.includes(t),t);
    assert.ok(!titles.includes('02-10 설날 연휴'),'쉬는 날 is not treated as 설날 itself');
    assert.equal(res.body.added,9+7);
  } finally {await h.mf.dispose();}
});

test('the daily cron handler runs the same sync', async()=>{
  const h=await libraryHarness();
  try{
    const worker=(await import(new URL(`../dist/server/index.js?cron=${Date.now()}`,import.meta.url))).default;
    assert.equal(typeof worker.scheduled,'function');
    const waits=[];
    await withFeed(feed(base()),async()=>{await worker.scheduled({cron:'0 18 * * *',scheduledTime:Date.now()},h.env,{waitUntil:p=>waits.push(p),passThroughOnException(){}});await Promise.all(waits);});
    assert.equal((await holidays(h)).length,9);
  } finally {await h.mf.dispose();}
});

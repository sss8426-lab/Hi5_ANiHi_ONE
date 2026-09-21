import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryHarness,users,A,B,ORG} from './support/library-harness.mjs';

test('calendar query applies scope and overlap before keyset paging; old future and malformed legacy rows are safe',async()=>{
  const h=await libraryHarness();
  try {
    const rows=Array.from({length:260},(_,i)=>({id:`synthetic-cal-${String(i).padStart(3,'0')}`,campus:i<140?B:A,
      date:i===259?'2027-02-01':i<140?'2026-10-10':'2026-10-11',created:i===259?'2020-01-01T00:00:00Z':'2026-09-21T00:00:00Z'}));
    for(let i=0;i<rows.length;i+=30)await h.env.DB.batch(rows.slice(i,i+30).map(r=>h.env.DB.prepare(`INSERT INTO data_records(id,organization_id,campus_id,record_type,source_app,title,summary,visibility,status,metadata_json,created_by_user_id,created_at,updated_at)
      VALUES(?,?,?,'academy-calendar-event','academy-calendar',?,?,'campus','active',?,?,?,?)`).bind(r.id,ORG,r.campus,'같은 제목',r.id,JSON.stringify({startDate:r.date,eventType:'meeting'}),`oai:${users.staff.id}`,r.created,r.created)));
    const query='/api/data-core/calendar?from=2026-10-01&to=2026-10-31';
    const first=await h.request('GET',query,users.staff);assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.events.length,100);assert.equal(first.body.hasMore,true);
    const second=await h.request('GET',query+'&cursor='+encodeURIComponent(first.body.nextCursor),users.staff);
    assert.equal(second.body.events.length,19);assert.equal(second.body.hasMore,false);
    const ids=[...first.body.events,...second.body.events].map(e=>e.id);assert.equal(new Set(ids).size,119);assert.ok(first.body.events.every(e=>e.campusId===A));
    const search=await h.request('GET',query+'&q=synthetic-cal-258&eventType=meeting',users.staff);assert.deepEqual(search.body.events.map(e=>e.id),['synthetic-cal-258']);
    const old=await h.request('GET','/api/data-core/calendar?from=2027-02-01&to=2027-02-28',users.staff);assert.deepEqual(old.body.events.map(e=>e.id),['synthetic-cal-259']);
    assert.equal((await h.request('GET',query+'&campusId='+B,users.staff)).status,403);
    assert.equal((await h.request('GET','/api/data-core/calendar/synthetic-cal-000',users.staff)).status,403);
    const other=await h.request('GET','/api/data-core/calendar/synthetic-cal-150',users.teacher);assert.equal(other.status,200);assert.equal(other.body.event.canManage,false);
    assert.equal((await h.request('GET','/api/data-core/calendar/synthetic-cal-150',users.campusAdmin)).body.event.canManage,true);
    assert.equal((await h.request('PATCH','/api/data-core/calendar/synthetic-cal-150',users.teacher,{title:'forbidden'})).status,403);
    assert.equal((await h.request('GET',query,null)).status,401);
    assert.equal((await h.request('GET',query+'&cursor=bad',users.staff)).status,400);
    await h.env.DB.prepare("UPDATE data_records SET metadata_json='malformed' WHERE id='synthetic-cal-141'").run();
    await h.env.DB.prepare("UPDATE data_records SET metadata_json=? WHERE id='synthetic-cal-142'").bind(JSON.stringify({startDate:'2026-02-30'})).run();
    const safe=await h.request('GET',query,users.staff);assert.equal(safe.status,200);assert.ok(!safe.body.events.some(e=>e.id==='synthetic-cal-141'));
    assert.equal((await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE id='synthetic-cal-141'").first()).metadata_json,'malformed');
  } finally {await h.mf.dispose();}
});

test('calendar detail/time/location preserve ownership and legacy compatibility; copy creates only on explicit POST',async()=>{
  const h=await libraryHarness(),path='/api/data-core/calendar';
  try {
    const original=await h.request('POST',path,users.admin,{title:'<img src=x onerror=alert(1)>',summary:'첫 줄\n둘째 줄',visibility:'organization',metadata:{startDate:'2028-02-29',endDate:'2028-03-03',eventType:'meeting',location:'합성 장소',allDay:false,startTime:'22:00',endTime:'01:00'}});
    assert.equal(original.status,201,JSON.stringify(original.body));const id=original.body.event.id;
    const detail=await h.request('GET',path+'/'+id,users.staff);assert.equal(detail.status,200);assert.equal(detail.body.event.canManage,false);assert.equal(detail.body.event.metadata.location,'합성 장소');
    for(const [from,to] of [['2028-02-29','2028-02-29'],['2028-03-01','2028-03-31']])assert.ok((await h.request('GET',`${path}?from=${from}&to=${to}&scope=organization`,users.staff)).body.events.some(e=>e.id===id));
    for(const metadata of [{startDate:'2027-02-29'},{startDate:'2028-02-29',endDate:'2028-02-28'},{startDate:'2028-02-29',startTime:'25:00'},{startDate:'2028-02-29',startTime:'12:00',endTime:'11:00'},{startDate:'',startTime:'12:00'}]){
      assert.equal((await h.request('POST',path,users.staff,{title:'invalid',campusId:A,metadata})).status,400);
    }
    const before=await h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(id).first();
    assert.equal((await h.request('POST',path,users.staff,{title:'copy',visibility:'organization',metadata:{startDate:'2028-03-04'}})).status,403);
    const copied=await h.request('POST',path,users.staff,{title:detail.body.event.title,summary:detail.body.event.summary,campusId:A,createdByUserId:'spoof',metadata:{startDate:'2028-03-04',location:detail.body.event.metadata.location}});
    assert.equal(copied.status,201);assert.notEqual(copied.body.event.id,id);assert.equal(copied.body.event.createdByUserId,`oai:${users.staff.id}`);assert.equal(copied.body.event.visibility,'campus');
    assert.deepEqual(await h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(id).first(),before);
    assert.equal((await h.request('PATCH',path+'/'+id,users.admin,{title:'cross origin'},'https://example.test')).status,403);
    const updated=await h.request('PATCH',path+'/'+id,users.admin,{metadata:{endDate:'',endTime:'23:00'}});assert.equal(updated.status,200);assert.equal(updated.body.event.metadata.endDate,undefined);assert.equal(updated.body.event.metadata.location,'합성 장소');
    const cleared=await h.request('PATCH',path+'/'+id,users.admin,{metadata:{allDay:true}});assert.equal(cleared.body.event.metadata.startTime,undefined);
    assert.equal((await h.request('DELETE',path+'/'+copied.body.event.id,users.foreign)).status,403);
    assert.equal((await h.request('DELETE',path+'/'+copied.body.event.id,users.staff)).status,200);
    assert.ok((await h.env.DB.prepare('SELECT deleted_at FROM data_records WHERE id=?').bind(copied.body.event.id).first()).deleted_at);
    assert.equal((await h.request('GET',path+'/'+copied.body.event.id,users.staff)).status,404);
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
  } finally {await h.mf.dispose();}
});

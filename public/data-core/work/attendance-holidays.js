// 공휴일·학원 휴무일 for an attendance month, from CORE's academy calendar: events of type
// "holiday" that apply organization-wide or to the chosen campus. No year's holidays are hard-coded;
// public holidays are synced into the calendar automatically and a campus adds its own closures there.
// A campus that teaches on one of those days marks it with a "공휴일 수업" class event
// (metadata.holidayOverride), and that date is then a normal lesson day for the campus.
const pad=n=>String(n).padStart(2,'0');
export function monthRange(year,month){
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return {from:`${year}-${pad(month)}-01`,to:`${year}-${pad(month)}-${pad(last)}`};
}
const inScope=(event,campusId)=>!(event.campusId&&campusId&&event.campusId!==campusId);
function eachDay(meta,{from,to},fn){
  const start=meta.startDate,end=meta.endDate||start;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end))return;
  for(let t=Date.parse(start+'T00:00:00Z');t<=Date.parse(end+'T00:00:00Z');t+=86400000){
    const day=new Date(t).toISOString().slice(0,10);
    if(day>=from&&day<=to)fn(day);
  }
}
/** Expands calendar events into 'YYYY-MM-DD' → name, clipped to the month. */
export function holidayDates(events,{year,month,campusId}={}){
  const range=monthRange(year,month),out=new Map();
  for(const event of events||[]){
    const meta=event?.metadata||{};
    if(meta.eventType!=='holiday'||!inScope(event,campusId))continue;
    eachDay(meta,range,day=>{if(!out.has(day))out.set(day,String(event.title||'휴무').trim()||'휴무');});
  }
  return out;
}
/** The campus's "공휴일 수업" days in the month: 'YYYY-MM-DD' → calendar event id. */
export function holidayClassDates(events,{year,month,campusId}={}){
  const range=monthRange(year,month),out=new Map();
  for(const event of events||[]){
    const meta=event?.metadata||{};
    if(meta.eventType!=='class'||meta.holidayOverride!==true||!event.campusId||event.campusId!==campusId)continue;
    eachDay(meta,range,day=>{if(!out.has(day))out.set(day,event.id);});
  }
  return out;
}
async function calendarEvents(params,{fetchImpl,signal}){
  const events=[];let cursor='';
  for(let page=0;page<20;page++){
    const query=new URLSearchParams({...params,limit:'100'});if(cursor)query.set('cursor',cursor);
    const response=await fetchImpl('/api/data-core/calendar?'+query,{credentials:'same-origin',cache:'no-store',signal});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw Error(body?.error||'공휴일·휴무 일정을 불러오지 못했습니다.');
    events.push(...(body?.events||[]));
    if(!body?.hasMore||!body.nextCursor)break;cursor=body.nextCursor;
  }
  return events;
}
/**
 * The month's days off for a campus.
 * @returns {Promise<{all:Map<string,string>,classes:Map<string,string>,holidays:Map<string,string>}>}
 *   all: every 공휴일·휴무 (date → name) · classes: dates the campus teaches anyway (date → event id)
 *   · holidays: what the attendance sheet marks 휴 (all minus classes)
 */
export async function fetchMonthHolidays({year,month,campusId,fetchImpl=globalThis.fetch,signal}={}){
  const {from,to}=monthRange(year,month);
  const [holidayEvents,classEvents]=await Promise.all([
    calendarEvents({from,to,eventType:'holiday'},{fetchImpl,signal}),
    campusId?calendarEvents({from,to,eventType:'class',campusId},{fetchImpl,signal}):[],
  ]);
  const all=holidayDates(holidayEvents,{year,month,campusId}),classes=holidayClassDates(classEvents,{year,month,campusId});
  return {all,classes,holidays:new Map([...all].filter(([date])=>!classes.has(date)))};
}
/** Reads the month's holiday dates (all pages) from /api/data-core/calendar, minus 공휴일 수업 days. */
export async function fetchHolidays(options={}){
  return (await fetchMonthHolidays(options)).holidays;
}
/** Marks a 공휴일·휴무 date as a normal lesson day for the campus (a campus calendar class event). */
export async function addHolidayClass({date,name,campusId,fetchImpl=globalThis.fetch}){
  const response=await fetchImpl('/api/data-core/calendar',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
    body:JSON.stringify({title:`공휴일 수업 · ${name}`,summary:'공휴일·휴무이지만 이 캠퍼스는 정상 수업합니다. 출석부에 휴로 표시하지 않습니다.',campusId,visibility:'campus',
      metadata:{startDate:date,eventType:'class',allDay:true,holidayOverride:true}})});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.error||'공휴일 수업을 저장하지 못했습니다.');
  return body.event.id;
}
/** Back to 휴: removes the campus's 공휴일 수업 event. */
export async function removeHolidayClass({id,fetchImpl=globalThis.fetch}){
  const response=await fetchImpl('/api/data-core/calendar/'+encodeURIComponent(id),{method:'DELETE',credentials:'same-origin'});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.error||'공휴일 수업을 취소하지 못했습니다.');
}
/** "9/24~26 추석 연휴 · 10/3 개천절" for the sheet's footer note. */
export function holidaySummary(holidays){
  const groups=[];
  for(const [date,name] of [...holidays].sort(([a],[b])=>a.localeCompare(b))){
    const [,m,d]=date.split('-').map(Number),last=groups.at(-1);
    if(last&&last.name===name&&last.month===m&&last.to===d-1)last.to=d;else groups.push({name,month:m,from:d,to:d});
  }
  return groups.map(g=>`${g.month}/${g.from}${g.to!==g.from?`~${g.to}`:''} ${g.name}`).join(' · ');
}

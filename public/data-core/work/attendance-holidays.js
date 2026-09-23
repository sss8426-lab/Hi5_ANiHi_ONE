// 공휴일·학원 휴무일 for an attendance month, from CORE's academy calendar: events of type
// "holiday" that apply organization-wide or to the chosen campus. No year's holidays are hard-coded;
// a campus adds them once in the calendar and every attendance sheet follows.
const pad=n=>String(n).padStart(2,'0');
export function monthRange(year,month){
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return {from:`${year}-${pad(month)}-01`,to:`${year}-${pad(month)}-${pad(last)}`};
}
/** Expands calendar events into 'YYYY-MM-DD' → name, clipped to the month. */
export function holidayDates(events,{year,month,campusId}={}){
  const {from,to}=monthRange(year,month),out=new Map();
  for(const event of events||[]){
    const meta=event?.metadata||{};
    if(meta.eventType!=='holiday')continue;
    if(event.campusId&&campusId&&event.campusId!==campusId)continue;
    const start=meta.startDate,end=meta.endDate||start;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end))continue;
    for(let t=Date.parse(start+'T00:00:00Z');t<=Date.parse(end+'T00:00:00Z');t+=86400000){
      const day=new Date(t).toISOString().slice(0,10);
      if(day>=from&&day<=to&&!out.has(day))out.set(day,String(event.title||'휴무').trim()||'휴무');
    }
  }
  return out;
}
/** Reads the month's holiday events (all pages) from /api/data-core/calendar. */
export async function fetchHolidays({year,month,campusId,fetchImpl=globalThis.fetch,signal}={}){
  const {from,to}=monthRange(year,month),events=[];let cursor='';
  for(let page=0;page<20;page++){
    const params=new URLSearchParams({from,to,eventType:'holiday',limit:'100'});if(cursor)params.set('cursor',cursor);
    const response=await fetchImpl('/api/data-core/calendar?'+params,{credentials:'same-origin',cache:'no-store',signal});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw Error(body?.error||'공휴일·휴무 일정을 불러오지 못했습니다.');
    events.push(...(body?.events||[]));
    if(!body?.hasMore||!body.nextCursor)break;cursor=body.nextCursor;
  }
  return holidayDates(events,{year,month,campusId});
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

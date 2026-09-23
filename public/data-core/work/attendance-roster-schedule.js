// 수업요일 text → exact class slots, the chosen month's columns, planned lessons and 일수.
// Weekdays are 월~금; weekends always carry a time number (토1/토2/토3, 일1/일2/일3). Nothing is
// guessed from repetition ("토토"): a weekend day without its number is an error.
export const WEEKDAYS=['월','화','수','목','금'];
export const WEEKEND_SLOTS=['토1','토2','토3','일1','일2','일3'];
export const SLOT_ORDER=[...WEEKDAYS,...WEEKEND_SLOTS];
const DAY_NAMES='일월화수목금토';
export const WEEKS_PER_MONTH=4;

export class ScheduleError extends Error {}
/** "화목토2일1" → {slots:['화','목','토2','일1'], weekly:4} */
export function parseSchedule(text){
  const value=String(text??'').replace(/[\s,·/|+]/g,'');
  if(!value)throw new ScheduleError('수업요일이 비어 있습니다. 예: 화목토2일1');
  const slots=[];let rest=value;
  while(rest){
    const m=/^(?:(월|화|수|목|금)(?![1-9])|(토|일)([1-9])?)/.exec(rest);
    if(!m)throw new ScheduleError(`수업요일 형식 오류: "${value}" — 월·화·수·목·금, 토1·토2·토3, 일1·일2·일3만 쓸 수 있습니다.`);
    if(m[1])slots.push(m[1]);
    else{
      if(!m[3])throw new ScheduleError(`토/일 타임 번호 오류: "${value}" — ${m[2]}요일은 ${m[2]}1·${m[2]}2·${m[2]}3처럼 타임 번호를 붙여주세요.`);
      if(!['1','2','3'].includes(m[3]))throw new ScheduleError(`토/일 타임 번호 오류: "${value}" — ${m[2]}${m[3]}는 없습니다. 1~3타임만 쓸 수 있습니다.`);
      slots.push(m[2]+m[3]);
    }
    rest=rest.slice(m[0].length);
  }
  const duplicate=slots.find((s,i)=>slots.indexOf(s)!==i);
  if(duplicate)throw new ScheduleError(`수업요일 형식 오류: "${value}" — ${duplicate}이(가) 두 번 들어 있습니다.`);
  const ordered=SLOT_ORDER.filter(s=>slots.includes(s));
  return {slots:ordered,weekly:ordered.length,text:value};
}
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
/**
 * The month's attendance columns. Every weekday of the month gets one column; a Saturday/Sunday gets
 * one column per time slot that someone in the class actually uses (unused slots are left out).
 * @param {Map<string,string>|Record<string,string>} holidays  'YYYY-MM-DD' → name (academy/public)
 */
export function monthColumns(year,month,usedSlots,holidays=new Map()){
  if(!Number.isInteger(year)||year<1901||year>2100||!Number.isInteger(month)||month<1||month>12)throw new ScheduleError('연도와 월을 확인해주세요.');
  const off=holidays instanceof Map?holidays:new Map(Object.entries(holidays||{}));
  const used=new Set(usedSlots);
  const days=new Date(Date.UTC(year,month,0)).getUTCDate(),columns=[];
  for(let day=1;day<=days;day++){
    const date=iso(year,month,day),weekday=DAY_NAMES[new Date(Date.UTC(year,month-1,day)).getUTCDay()];
    const holiday=off.has(date)?off.get(date)||'휴무':null;
    if(WEEKDAYS.includes(weekday))columns.push({date,day,weekday,slot:weekday,label:weekday,weekend:false,holiday});
    else for(const n of ['1','2','3'])if(used.has(weekday+n))columns.push({date,day,weekday,slot:weekday+n,label:weekday+n,weekend:true,holiday});
  }
  return columns;
}
/** Which columns are planned lessons for this student (never on a holiday). */
export function plannedColumns(schedule,columns){
  const slots=new Set(schedule?.slots||[]);
  return columns.map(c=>!c.holiday&&slots.has(c.slot));
}
/** 일수: the 4-week standard (weekly slots × 4) and how the month really differs: 12 · 12+2 · 12-1. */
export function lessonCount(schedule,planned){
  const base=(schedule?.weekly||0)*WEEKS_PER_MONTH,actual=planned.filter(Boolean).length,diff=actual-base;
  return {base,actual,diff,label:diff===0?String(base):diff>0?`${base}+${diff}`:`${base}${diff}`};
}

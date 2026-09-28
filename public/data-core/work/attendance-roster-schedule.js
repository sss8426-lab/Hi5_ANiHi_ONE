// 수업요일 text → exact class slots, the chosen month's columns, planned lessons and 일수.
// Every day has time slots 1~3 (월1·월2·월3 … 일1·일2·일3). Accepted forms: "화1 목1 토1.2", "월2.3 화1.2.3",
// "토1토3" and the older "월수금토1" (a weekday without a number is its 1st time). Weekends always need
// their number: nothing is guessed from repetition ("토토").
export const WEEKDAYS=['월','화','수','목','금'];
export const DAYS=[...WEEKDAYS,'토','일'];
export const WEEKEND_SLOTS=['토1','토2','토3','일1','일2','일3'];
/** Canonical slots in week order: 월1 월2 월3 화1 … 일3. */
export const SLOT_ORDER=DAYS.flatMap(day=>['1','2','3'].map(n=>day+n));
const DAY_NAMES='일월화수목금토';
export const WEEKS_PER_MONTH=4;

export class ScheduleError extends Error {}
/** "화1 목1 토1.2" → {slots:['화1','목1','토1','토2'], weekly:4} */
export function parseSchedule(text){
  const value=String(text??'').replace(/[\s,·/|+]/g,'');
  if(!value)throw new ScheduleError('수업요일이 비어 있습니다. 예: 화1 목1 토1.2');
  const slots=[];let rest=value;
  while(rest){
    const m=/^([월화수목금토일])([1-9](?:\.[1-9])*)?/.exec(rest);
    if(!m)throw new ScheduleError(`수업요일 형식 오류: "${value}" — 화1 목1 토1.2처럼 요일과 1~3타임 번호로 입력하세요.`);
    const day=m[1],times=m[2]?m[2].split('.'):[];
    if((day==='토'||day==='일')&&!times.length)throw new ScheduleError(`토/일 타임 번호 오류: "${value}" — ${day}요일은 ${day}1·${day}2·${day}3처럼 타임 번호를 붙여주세요.`);
    const bad=times.find(n=>!['1','2','3'].includes(n));
    if(bad)throw new ScheduleError(`타임 번호 오류: "${value}" — ${day}${bad}는 없습니다. 1~3타임만 쓸 수 있습니다.`);
    slots.push(...(times.length?times:['1']).map(n=>day+n));
    rest=rest.slice(m[0].length);
  }
  const duplicate=slots.find((s,i)=>slots.indexOf(s)!==i);
  if(duplicate)throw new ScheduleError(`수업요일 형식 오류: "${value}" — ${duplicate}이(가) 두 번 들어 있습니다.`);
  const ordered=SLOT_ORDER.filter(s=>slots.includes(s));
  return {slots:ordered,weekly:ordered.length,text:value};
}
/** Slots back in the form's own notation: ['월2','월3','화1','토1','토2'] → "월2.3 화1 토1.2". */
export function scheduleLabel(schedule){
  const slots=schedule?.slots||[];
  return DAYS.map(day=>{const times=slots.filter(s=>s[0]===day).map(s=>s.slice(1));return times.length?day+times.join('.'):'';}).filter(Boolean).join(' ');
}
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
/**
 * The month's attendance columns, in the official output look:
 * - a weekday always has a column; one per time slot the class uses. When the class uses only its
 *   1st time (or does not use that weekday) the column reads just "화", otherwise "화1 화2 화3";
 * - a Saturday/Sunday gets a column only for each slot someone uses, always numbered ("토1", "토2").
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
    const weekend=!WEEKDAYS.includes(weekday);
    const slots=['1','2','3'].map(n=>weekday+n).filter(s=>used.has(s));
    if(!weekend&&(!slots.length||(slots.length===1&&slots[0]===weekday+'1'))){
      columns.push({date,day,weekday,slot:weekday+'1',label:weekday,weekend,holiday});
      continue;
    }
    for(const slot of slots)columns.push({date,day,weekday,slot,label:slot,weekend,holiday});
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

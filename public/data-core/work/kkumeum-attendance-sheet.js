// 출결 반영 출석부: the month's 반별 출석부 (same official A4 design as 업무 › 출석부) with each date cell
// showing that day's 꿈이음 출석체크 result. The roster and marks come from /api/kkumeum/attendance/sheet,
// 공휴일·휴무 from CORE's calendar, and the Excel is written in the browser by the 출석부 page's own writer.
import {buildRosterWorkbook} from './attendance-roster-export.js?v=20261010-marks';
import {fetchMonthHolidays} from './attendance-holidays.js?v=20260924-class-days';

const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEFT_LABEL={leave:'휴원',withdrawn:'퇴원',moved:'이동',graduated:'졸업'};

/** Server sheet → the roster shape buildRosterWorkbook reads (slots become the 수업요일 schedule). */
export function sheetRoster(sheet,campusName){
  return {campus:campusName||'캠퍼스',classes:sheet.classes.map(group=>({name:group.name,students:group.students.map(s=>({
    no:s.no,name:LEFT_LABEL[s.status]?`${s.name} (${LEFT_LABEL[s.status]})`:s.name,school:s.school,grade:s.grade,
    studentPhone:s.studentPhone,parentPhone:s.parentPhone,registered:s.registered?{serial:s.registered.serial||null,text:s.registered.text||''}:null,
    schedule:{slots:s.slots,weekly:s.slots.length},scheduleText:'',marks:s.marks||{}}))}))};
}

export async function downloadAttendanceSheet({campusId,campusName,month}){
  const res=await fetch(`/api/kkumeum/attendance/sheet?campusId=${encodeURIComponent(campusId)}&month=${encodeURIComponent(month)}`,{credentials:'include',cache:'no-store'});
  const sheet=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(sheet.error||'출석부를 불러오지 못했습니다.');
  if(!sheet.classes?.length)throw new Error('이 달 출석부에 볼 수 있는 학생이 없습니다.');
  const [year,m]=month.split('-').map(Number);
  let holidays=new Map(),classDays=new Map();
  try{const loaded=await fetchMonthHolidays({year,month:m,campusId});holidays=loaded.holidays;classDays=new Map([...loaded.all].filter(([date])=>loaded.classes.has(date)));}
  catch{ /* 공휴일을 못 불러와도 출결은 그대로 받는다. */ }
  const [,tm,td]=String(sheet.today||'').split('-').map(Number);
  const result=buildRosterWorkbook(sheetRoster(sheet,campusName),{year,month:m,holidays,classDays,attendance:{asOf:tm?`${tm}/${td}`:''}});
  const url=URL.createObjectURL(new Blob([result.bytes],{type:XLSX_TYPE}));
  const link=document.createElement('a');link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  return {filename:result.filename,students:sheet.classes.reduce((n,c)=>n+c.students.length,0)};
}

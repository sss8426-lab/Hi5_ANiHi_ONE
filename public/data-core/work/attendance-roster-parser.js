// 출석부 종합입력(.xlsx) → 캠퍼스 · 반 · 학생. The official input: a campus line ("캠퍼스: …") above a
// header row (A No … U 비고), then big class bars (A:U merged, class name in A) each followed by that
// class's students. There is no class column and no status column: every student row belongs to the
// bar above it and is an enrolled student.
import {openTemplate,all,attr,range,textOf,indexSheet,cellRef} from './attendance-template.js?v=20260919-sparse-import';
import {parseSchedule} from './attendance-roster-schedule.js?v=20260924-roster';

export const ROSTER_HEADERS=['No','이름','학교','학년','학생 전화번호','학부모 전화번호','등록일','수업요일','월','화','수','목','금','토(1)','토(2)','토(3)','일(1)','일(2)','일(3)','총횟수','비고'];
// I:S — the sheet's own check marks, used only to cross-check the 수업요일 text (H is the source).
const CHECK_SLOTS=['월','화','수','목','금','토1','토2','토3','일1','일2','일3'];
const LAST_COLUMN=21; // U

export class RosterError extends Error {constructor(message,issues=[]){super(message);this.issues=issues;}}
const norm=v=>String(v??'').replace(/\s+/g,'').trim();

function cellInfo(grid,template,c,r){
  const cell=grid.cells.get(cellRef(c,r));
  if(!cell)return {text:'',type:'',raw:''};
  const type=attr(cell,'t');
  return {text:textOf(cell,template.strings).trim(),type,raw:cell};
}
// Phone numbers stay text. A number that Excel turned into a numeric cell lost its leading 0
// (010-… → 1012345678); put the 0 back rather than printing a broken number.
function phone(info){
  const text=info.text;
  if(!text)return '';
  if(!info.type||info.type==='n'){
    const digits=String(Math.round(Number(text)));
    if(/^\d+$/.test(text)&&/^1\d{8,9}$/.test(digits))return '0'+digits;
  }
  return text;
}
// 등록일: an Excel date serial (the normal case) or a typed date text; anything else is kept as text.
function registered(info,epoch1904){
  const text=info.text;if(!text)return null;
  const n=Number(text);
  if((!info.type||info.type==='n')&&Number.isFinite(n)&&n>20000&&n<80000){
    const d=new Date(Date.UTC(epoch1904?1904:1899,epoch1904?0:11,epoch1904?1:30)+Math.round(n)*86400000);
    return {serial:Math.round(n)+(epoch1904?1462:0),iso:d.toISOString().slice(0,10),text:''};
  }
  const m=/^(\d{2,4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/.exec(text);
  if(m){
    const y=m[1].length===2?2000+Number(m[1]):Number(m[1]),mo=Number(m[2]),da=Number(m[3]);
    const d=new Date(Date.UTC(y,mo-1,da));
    if(d.getUTCMonth()===mo-1&&d.getUTCDate()===da)return {serial:Math.round((d-Date.UTC(1899,11,30))/86400000),iso:d.toISOString().slice(0,10),text:''};
  }
  return {serial:null,iso:'',text};
}
function pickSheet(template,grids){
  const score=i=>{const g=grids[i];for(let r=1;r<=30;r++)if(norm(cellInfo(g,template,1,r).text)==='No'&&norm(cellInfo(g,template,2,r).text)==='이름')return r;return 0;};
  const named=template.sheets.findIndex((s,i)=>/종합\s*입력/.test(s.name)&&score(i));
  if(named>=0)return named;
  const any=template.sheets.findIndex((s,i)=>!s.hidden&&score(i));
  return any;
}

/** @returns {{campus:string,sheetName:string,classes:{name:string,row:number,students:object[]}[],warnings:string[],issues:object[]}} */
export function parseRoster(bytes,env=globalThis){
  let template;
  try{template=openTemplate(bytes,env);}
  catch(error){throw new RosterError(`올바른 xlsx 파일이 아닙니다. ${error.message||''}`.trim());}
  const docs=template.sheets.map(s=>template.read(s.path)),grids=docs.map(doc=>indexSheet(doc));
  const index=pickSheet(template,grids);
  if(index<0)throw new RosterError('종합입력 헤더(No · 이름 · 학교 …)를 찾을 수 없습니다. 공식 종합입력 양식의 4행 헤더를 확인해주세요.');
  const grid=grids[index],doc=docs[index],sheetName=template.sheets[index].name;
  const at=(c,r)=>cellInfo(grid,template,c,r);
  let headerRow=0;
  for(let r=1;r<=30&&!headerRow;r++)if(norm(at(1,r).text)==='No'&&norm(at(2,r).text)==='이름')headerRow=r;
  const header=Array.from({length:LAST_COLUMN},(_,i)=>norm(at(i+1,headerRow).text));
  const expected=ROSTER_HEADERS.map(norm);
  const wrong=expected.map((name,i)=>header[i]===name?null:`${String.fromCharCode(65+i)}열 "${ROSTER_HEADERS[i]}"`).filter(Boolean);
  if(wrong.length)throw new RosterError(`종합입력 헤더가 공식 규격과 다릅니다: ${wrong.join(', ')} 위치를 확인해주세요.`);
  // 캠퍼스: "캠퍼스: 부천애니하이 입시본원" anywhere above the header.
  let campus='';
  for(let r=1;r<headerRow&&!campus;r++)for(let c=1;c<=LAST_COLUMN&&!campus;c++){
    const m=/캠퍼스\s*[:：]\s*(.+)$/.exec(at(c,r).text);if(m)campus=m[1].trim();
  }
  if(!campus)throw new RosterError('캠퍼스명을 찾을 수 없습니다. 헤더 위에 "캠퍼스: 캠퍼스명" 형식으로 입력해주세요.');
  const merges=all(doc,'mergeCell').map(n=>range(attr(n,'ref'),true));
  const mergedBar=r=>merges.some(m=>m.r===r&&m.end.r===r&&m.c===1&&m.end.c>=2);
  const lastRow=Math.max(headerRow,...[...grid.rows.keys()]);
  const classes=[],issues=[],warnings=[];let current=null;
  for(let r=headerRow+1;r<=lastRow;r++){
    const a=at(1,r),b=at(2,r),restEmpty=Array.from({length:LAST_COLUMN-1},(_,i)=>at(i+2,r).text).every(v=>!v);
    const aNumber=a.text!==''&&Number.isFinite(Number(a.text));
    if(!a.text&&restEmpty)continue;
    if(a.text&&!aNumber&&restEmpty){
      // A text-only row is a class bar. The official bar is A:U merged; an unmerged one is still read
      // (the text is unambiguous) but reported so the file can be fixed.
      if(!mergedBar(r))warnings.push(`${r}행 "${a.text}"은 병합되지 않은 반 구분 바입니다. 반으로 인식했습니다.`);
      current={name:a.text.replace(/\s+/g,' ').trim(),row:r,students:[]};classes.push(current);continue;
    }
    if(!current){issues.push({row:r,message:'첫 반 구분 바보다 위에 있는 행입니다. 반 구분 바 아래에 학생을 넣어주세요.'});continue;}
    if(!b.text){issues.push({row:r,message:'학생 이름(B열)이 비어 있습니다.'});continue;}
    if(!aNumber){issues.push({row:r,name:b.text,message:'No(A열)가 숫자가 아닙니다.'});continue;}
    const scheduleText=at(8,r).text;
    let schedule=null;
    try{schedule=parseSchedule(scheduleText);}
    catch(error){issues.push({row:r,name:b.text,message:error.message});}
    const student={row:r,no:Number(a.text),name:b.text,school:at(3,r).text,grade:at(4,r).text,
      studentPhone:phone(at(5,r)),parentPhone:phone(at(6,r)),registered:registered(at(7,r),template.epoch1904),
      scheduleText,schedule,note:at(21,r).text};
    if(schedule){
      // I:S marks disagreeing with the 수업요일 text are only a warning: the text is the source.
      const marked=CHECK_SLOTS.filter((_,i)=>at(9+i,r).text!=='');
      if(marked.length&&marked.join()!==schedule.slots.join())warnings.push(`${r}행 ${b.text}: 체크칸(${marked.join('')})과 수업요일(${schedule.slots.join('')})이 다릅니다. 수업요일 기준으로 만듭니다.`);
    }
    current.students.push(student);
  }
  if(!classes.length)throw new RosterError('반 구분 바를 하나도 찾지 못했습니다. A:U를 병합한 행의 A열에 반 이름을 넣어주세요.');
  for(const group of classes)if(!group.students.length)issues.push({row:group.row,message:`"${group.name}" 반 아래에 학생이 없습니다.`});
  return {campus,sheetName,classes,warnings,issues,studentCount:classes.reduce((n,g)=>n+g.students.length,0)};
}

import {zipSync,strToU8} from '../vendor/fflate-0.8.3.js';
import {sparseCalendars,validateSparse,sparseTargets,reshapeSparse} from './attendance-sparse.js?v=20260919-sparse-import';
import {openTemplate,calendarMonth,parseWeekdays,planPages,printDocument,all,child,children,
  attr,number,check,cellRef,range,address,textOf,indexSheet,areaFor,dateParts,putValue,
  mutableSheet,styleEngine,cellStyleId,mostCommon,updateTitle,ensureSheet,create,
  setNamedRange,namedRange,dimensions,colorHex,columnName,columnNumber,shiftRangeColumns} from './attendance-template.js?v=20260919-sparse-import';

export const RECOGNITION_ERROR='이 출석부 형식을 자동으로 인식하지 못했습니다.';
const rowValues=(grid,row,strings)=>[...grid.cells].filter(([ref])=>address(ref).r===row).map(([ref,c])=>({ref,c,value:textOf(c,strings).trim()}));
const chromatic=color=>{if(!/^#[\da-f]{6}$/i.test(color||''))return false;const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return Math.max(...rgb)-Math.min(...rgb)>15;};
const exceptionalMark=value=>/^(?:보|보강|결|결석|지각|조퇴|휴강|휴원|휴일|공휴일|취소)$/.test(value.trim());
const inactiveStudent=value=>/^(?:휴원|휴원중|휴원 중|퇴원)$/.test(value.trim());
const datedNote=value=>/연휴|휴원|휴강|휴일|보강|방학|개강|공휴|추석|설날/.test(value);
const monthText=(name)=>/(20\d{2}|\d{2})[.\-_년]\s*(\d{1,2})(?:월|(?=[._\s-]|$))/.exec(name);
export function nextMonth(year,month){return month===12?{year:year+1,month:1}:{year,month:month+1};}
export function attendanceFilename(name,year,month){
  const m=monthText(name),mm=String(month).padStart(2,'0');
  return m?name.replace(m[0],m[0].replace(m[1],m[1].length===2?String(year).slice(-2):String(year)).replace(/([.\-_년]\s*)\d{1,2}/,`$1${mm}`)):`${name.replace(/\.xlsx$/i,'')}_${year}.${mm}.xlsx`;
}
// A weekend day can occupy 2-3 columns instead of 1: either every column repeats the same day
// number/weekday text ('repeated' header), or only the left-most column is populated and the rest
// are covered by a horizontal mergeCell ('merged' header). Both must resolve to the same logical day.
function dateGrid(template,sheet,grid,area){
  const merges=all(sheet,'mergeCell').map(n=>range(attr(n,'ref')));
  const literal=(c,r)=>textOf(grid.cells.get(cellRef(c,r)),template.strings).trim();
  const mergeAt=(c,r)=>merges.find(m=>m.r===r&&c>=m.c&&c<=m.end.c);
  const text=(c,r)=>{const v=literal(c,r);if(v)return v;const m=mergeAt(c,r);return m?literal(m.c,m.r):'';};
  const isContinuation=(c,r)=>!literal(c,r)&&Boolean(mergeAt(c,r));
  const day=(c,r)=>{const v=text(c,r);return dateParts(v,template.epoch1904)?.day||Number(v.replace(/일$/,''))||0;};
  const found=[];
  for(let r=area.r;r<=Math.min(40,area.end.r);r++)for(let c=area.c;c<=area.end.c-27;c++){
    if(day(c,r)!==1||c>area.c&&day(c-1,r)===1)continue;
    let previous=0,anyMerged=false;const columns=[];
    for(let x=c;x<=area.end.c;x++){
      const d=day(x,r);if(d<1||d>31||(d!==previous&&d!==previous+1))break;
      if(d===previous&&isContinuation(x,r))anyMerged=true;
      columns.push({c:x,day:d,slot:d===previous?columns.at(-1).slot+1:0});previous=d;
    }
    if(previous<28)continue;
    // Some templates always reserve all 31 day-slots (blank/styled placeholders for days beyond the
    // current month's real length) — try to borrow those trailing blank cells so short months still
    // resolve to a familiar 31-slot layout. Other templates only ever lay out as many physical day
    // columns as the month being copied actually needs (28-30), with no day-31 placeholder to borrow
    // at all — for those, the run ending anywhere from day 28 to day 31 is itself the natural boundary
    // of the calendar (the next cell is occupied by something else, or the sheet simply ends there),
    // and downstream generation never depends on the source having a physical day-31 column (only
    // days 1-28 feed weekdaySlotPolicy; the target month's columns are rebuilt from scratch).
    for(let d=previous+1;d<=31;d++){
      const x=columns.at(-1).c+1,cell=grid.cells.get(cellRef(x,r));
      if(x>area.end.c||literal(x,r)||!cell)break;
      columns.push({c:x,day:d,slot:0});
    }
    const weekdayRow=[r+1,r-1].find(w=>w>=area.r&&columns.filter(d=>/^[일월화수목금토](?:요일)?$/.test(text(d.c,w))).length>=14)||0;
    const headerMode=anyMerged?'merged':columns.some(d=>d.slot>0)?'repeated':'single';
    found.push({dateRow:r,dateStart:c,dateColumns:columns,weekdayRow,headerMode});
  }
  return found;
}
function period(template,sheet,grid,m,filename,sourcePeriod){
  const candidates=[],yearCells=[],monthCells=[],titleCells=[];
  const fm=monthText(filename);if(fm)candidates.push({year:Number(fm[1])+(fm[1].length===2?2000:0),month:Number(fm[2])});
  let year=0,month=0;
  for(const [ref,c] of grid.cells){
    if(address(ref).r>=m.dateRow)continue;
    const value=textOf(c,template.strings);
    // Allow a short run of non-digit text between the year and "월" (e.g. "2026학년도 9월", not just
    // the bare "2026년 9월") — [^\d] keeps it from ever skipping past an unrelated number.
    const full=/(20\d{2})[^\d]{0,8}?(\d{1,2})\s*월|\b(20\d{2})[./-](\d{1,2})\b/.exec(value);
    if(full){candidates.push({year:Number(full[1]||full[3]),month:Number(full[2]||full[4])});titleCells.push(ref);continue;}
    const y=/(20\d{2})\s*(?:년|학년도)/.exec(value);if(y){year=Number(y[1]);yearCells.push(ref);}
  }
  if(year){
    const values=[...grid.cells].filter(([ref,c])=>address(ref).r<m.dateRow&&/^(?:0?[1-9]|1[0-2])(?:월)?$/.test(textOf(c,template.strings).trim()));
    if(values.length===1){month=Number(textOf(values[0][1],template.strings).replace(/월/,''));monthCells.push(values[0][0]);candidates.push({year,month});}
  }
  const serial=dateParts(textOf(grid.cells.get(cellRef(m.dateStart,m.dateRow)),template.strings),template.epoch1904);
  if(serial)candidates.push(serial);
  if(!candidates.length){
    if(!sourcePeriod){const error=Error('원본 출석부의 연도와 월을 확인해주세요.');error.code='SOURCE_PERIOD_REQUIRED';error.year=year||null;throw error;}
    calendarMonth(sourcePeriod.year,sourcePeriod.month);
    check(!year||year===sourcePeriod.year,'원본에 표시된 연도와 선택한 연도가 다릅니다.');
    candidates.push(sourcePeriod);
  }
  check(candidates.every(p=>p.year===candidates[0].year&&p.month===candidates[0].month),RECOGNITION_ERROR);
  const source=candidates[0];calendarMonth(source.year,source.month);
  if(m.weekdayRow){const cal=calendarMonth(source.year,source.month);check(m.dateColumns.every(d=>{
    const v=textOf(grid.cells.get(cellRef(d.c,m.weekdayRow)),template.strings).replace(/요일$/,'');
    return !v||!cal[d.day-1].active||v===cal[d.day-1].weekday;
  }),RECOGNITION_ERROR);}
  return {...source,yearCells,monthCells,titleCells,confirmed:!fm&&!monthCells.length&&!titleCells.length&&!serial&&Boolean(sourcePeriod)};
}
export function inferWeekdays(marked,calendar){
  const evidence=Array.from({length:7},(_,weekday)=>{
    const dates=calendar.filter(d=>d.active&&d.weekdayIndex===weekday);
    const hits=dates.filter(d=>marked.has(d.day)).length;
    return {weekday,hits,total:dates.length};
  });
  const weekdays=evidence.filter(e=>e.hits>=3&&e.hits/e.total>=0.7).map(e=>e.weekday);
  return {weekdays,needsReview:!weekdays.length||evidence.some(e=>e.hits>=2&&!weekdays.includes(e.weekday))};
}
// How many physical columns a given weekday gets, inferred from the source month (days 1-28 only,
// so every weekday has exactly four evenly-spread samples and a single holiday/closure exception
// can never outvote the regular pattern). Ties prefer the larger slot count.
export function weekdaySlotPolicy(dateColumns,calendar){
  const byDay=new Map();
  for(const d of dateColumns)if(d.day<=28)byDay.set(d.day,Math.max(byDay.get(d.day)||0,d.slot+1));
  const byWeekday=Array.from({length:7},()=>[]);
  for(const [day,slots] of byDay)byWeekday[calendar[day-1].weekdayIndex].push(slots);
  const policy={};
  for(let weekday=0;weekday<7;weekday++){
    const votes=new Map();for(const slots of byWeekday[weekday])votes.set(slots,(votes.get(slots)||0)+1);
    let best=1,bestVotes=-1;for(const [slots,count] of votes)if(count>bestVotes||count===bestVotes&&slots>best){best=slots;bestVotes=count;}
    policy[weekday]=best;
  }
  return policy;
}
// The physical calendar for the target month, built purely from weekday -> slot count. A day's
// column count never depends on which day-number it happens to be, only on its weekday; days past
// the target month's real length (28-31 depending on the month) are single filler columns.
export function targetCalendarColumns(year,month,policy){
  const calendar=calendarMonth(year,month),activeCount=calendar.filter(d=>d.active).length;
  const columns=[];
  for(const d of calendar){
    const slots=d.day<=activeCount?policy[d.weekdayIndex]:1;
    for(let slot=0;slot<slots;slot++)columns.push({day:d.day,slot,weekdayIndex:d.weekdayIndex,active:d.active});
  }
  return columns;
}
// One representative width/style sample per (weekday, slot) pair, read from the untouched source
// sheet before any column is inserted, moved or removed.
function sampleCalendarStyles(originalSheet,originalGrid,m,calendar){
  const byKey=new Map();
  for(const d of m.dateColumns){
    if(d.day>28)continue;
    const key=`${calendar[d.day-1].weekdayIndex}:${d.slot}`;
    if(byKey.has(key))continue;
    const dateCell=originalGrid.cells.get(cellRef(d.c,m.dateRow));
    const weekdayCell=m.weekdayRow?originalGrid.cells.get(cellRef(d.c,m.weekdayRow)):null;
    const defaults=child(originalSheet.documentElement,'sheetFormatPr');
    const colDef=all(originalSheet,'col').find(n=>number(n,'min',0)<=d.c&&number(n,'max',0)>=d.c);
    byKey.set(key,{
      width:attr(colDef,'hidden')==='1'?0:number(colDef,'width',number(defaults,'defaultColWidth',8.43)),
      colStyle:number(colDef,'style',0)||cellStyleId(originalSheet,dateCell,d.c),
      dateStyle:cellStyleId(originalSheet,dateCell,d.c),
      weekdayStyle:weekdayCell?cellStyleId(originalSheet,weekdayCell,d.c):0,
    });
  }
  return byKey;
}
// A reshape never rewrites formula text, only cell positions outside the calendar (and only in the
// trailing region — student-info columns before dateStart are never touched at all). So a formula is
// safe to leave exactly as-is only when BOTH its own cell and every cell/range it references resolve
// to a column strictly before dateStart: nothing about it moves or goes stale. Anything referencing
// another sheet, an external workbook, a table, or a named range (none of which this can resolve) is
// rejected, never guessed at. This never edits formula text — it only decides whether every formula
// on the sheet is already fully confined to the columns the reshape guarantees stay untouched.
function formulaConfinedBefore(text,limitColumn){
  if(/[![]/.test(text))return false;
  const refPattern=/(?:^|[^A-Za-z0-9_])\$?([A-Za-z]{1,3})\$?(\d{1,7})(?![A-Za-z0-9_(])/g;
  let match;
  while((match=refPattern.exec(text)))if(columnNumber(match[1].toUpperCase())>=limitColumn)return false;
  return true;
}
// Grows or shrinks the calendar's physical column span to match targetColumns.length, shifting
// everything to the right of the calendar (make-up/total/summary columns, their merges and named
// ranges) while leaving the student-info columns to the left of dateStart untouched. Column widths
// and styles for the (possibly new) calendar columns are rebuilt from the sampled (weekday,slot) map.
function drawingConfinedBefore(template,m,sheet){
  if(['legacyDrawing','tableParts','oleObjects','controls'].some(tag=>all(sheet,tag).length))return false;
  const descriptor=template.sheets.find(s=>s.index===m.index);
  const slash=descriptor.path.lastIndexOf('/'),directory=descriptor.path.slice(0,slash);
  const rels=template.read(`${directory}/_rels/${descriptor.path.slice(slash+1)}.rels`);
  return all(sheet,'drawing').every(node=>{
    const id=node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const rel=rels&&all(rels,'Relationship').find(r=>attr(r,'Id')===id);
    if(!rel||attr(rel,'TargetMode')||!attr(rel,'Type').endsWith('/drawing'))return false;
    const parts=attr(rel,'Target').startsWith('/')?[]:directory.split('/');
    for(const part of attr(rel,'Target').split('/')){if(part==='..'){if(!parts.length)return false;parts.pop();}else if(part&&part!=='.')parts.push(part);}
    const drawing=template.read(parts.join('/'));if(!drawing)return false;
    // Empty drawing parts and two-cell anchors wholly inside the unchanged student columns are safe.
    return children(drawing.documentElement,'twoCellAnchor').length===Array.from(drawing.documentElement.childNodes).filter(n=>n.nodeType===1).length&&children(drawing.documentElement,'twoCellAnchor').every(anchor=>{
      const from=child(child(anchor,'from'),'col'),to=child(child(anchor,'to'),'col');
      return from&&to&&[from,to].every(n=>/^\d+$/.test(n.textContent)&&Number(n.textContent)<m.dateStart-1);
    });
  });
}
function reshapeCalendar(sheet,workbook,m,targetColumns,styleMap,template){
  const oldWidth=m.dateColumns.length,newWidth=targetColumns.length,delta=newWidth-oldWidth;
  const oldCalEnd=m.dateStart+oldWidth-1,newCalEnd=m.dateStart+newWidth-1,at=oldCalEnd+1;
  const layoutChanged=delta!==0||targetColumns.some((d,i)=>d.day!==m.dateColumns[i].day||d.slot!==m.dateColumns[i].slot);
  if(layoutChanged){
    check(all(sheet,'f').every(f=>address(attr(f.parentNode,'r')).c<m.dateStart&&formulaConfinedBefore(f.textContent,m.dateStart)),'날짜 열 구조가 바뀌는 달에는 수식이 있는 양식을 지원하지 않습니다. Excel에서 수식 없는 복사본을 사용해주세요.');
    check(drawingConfinedBefore(template,m,sheet),'날짜 열 구조가 바뀌는 달에는 그림·표·개체가 있는 양식을 지원하지 않습니다.');
  }
  if(delta!==0){
    const mergeContainer=child(sheet.documentElement,'mergeCells');
    if(mergeContainer)for(const node of children(mergeContainer,'mergeCell').slice()){
      const ref=attr(node,'ref'),p=range(ref);
      if(p.end.c<m.dateStart)continue; // fully before the calendar (student-info columns), untouched
      if(p.c<=m.dateStart&&p.end.c>=oldCalEnd){node.setAttribute('ref',`${cellRef(p.c,p.r)}:${cellRef(p.end.c+delta,p.end.r)}`);continue;} // spans across (or exactly covers) the calendar, e.g. a title row: grows/shrinks with it
      if(p.c>=at){node.setAttribute('ref',shiftRangeColumns(ref,at,delta));continue;} // fully inside the trailing (make-up/total) region
      if(p.c>=m.dateStart&&p.end.c<=oldCalEnd&&p.end.r<m.firstStudentRow){
        if(p.r<m.dateRow){
          const start=m.dateColumns[p.c-m.dateStart],end=m.dateColumns[p.end.c-m.dateStart];
          const first=targetColumns.filter(d=>d.day===start.day),last=targetColumns.filter(d=>d.day===end.day);
          node.setAttribute('ref',`${cellRef(first[Math.min(start.slot,first.length-1)].c,p.r)}:${cellRef(last.at(-1).c,p.end.r)}`);
        }else mergeContainer.removeChild(node);
        continue;
      }
      if(p.c>=m.dateStart&&p.end.c<=oldCalEnd)check(false,'날짜 영역 안의 부분 병합은 Excel에서 확인해주세요. 원본 날짜칸 유지로 생성할 수 있습니다.');
      check(false,'날짜 영역과 겹치는 병합 셀 구조는 지원하지 않습니다. Excel에서 확인해주세요.');
    }
    for(const tag of ['conditionalFormatting','dataValidation'])for(const node of all(sheet,tag)){
      if(!node.hasAttribute('sqref'))continue;
      node.setAttribute('sqref',attr(node,'sqref').split(' ').map(ref=>{
        const p=range(ref,true);
        if(p.c<=m.dateStart&&p.end.c>=oldCalEnd)return `${cellRef(p.c,p.r)}:${cellRef(p.end.c===16384?16384:p.end.c+delta,p.end.r)}`;
        if(p.c>=at)return `${cellRef(p.c+delta,p.r)}:${cellRef(p.end.c===16384?16384:p.end.c+delta,p.end.r)}`;
        if(tag==='conditionalFormatting'&&p.end.c>=m.dateStart){
          const remap=(c,end)=>{
            if(c<m.dateStart)return c;
            if(c>oldCalEnd)return c===16384?c:c+delta;
            const d=m.dateColumns[c-m.dateStart],group=targetColumns.filter(t=>t.day===d.day);
            const sourceGroup=m.dateColumns.filter(t=>t.day===d.day);
            return end&&d.slot===sourceGroup.length-1?group.at(-1).c:group[Math.min(d.slot,group.length-1)].c;
          };
          return `${cellRef(remap(p.c,false),p.r)}:${cellRef(remap(p.end.c,true),p.end.r)}`;
        }
        check(p.end.c<m.dateStart,`날짜 영역과 겹치는 ${tag} 범위는 지원하지 않습니다.`);
        return ref;
      }).join(' '));
      if(tag==='conditionalFormatting'){
        const origin=attr(node,'sqref').split(/[ :]/)[0];
        for(const rule of all(node,'cfRule')){
          const literal=`"${attr(rule,'text').replace(/"/g,'""')}"`,type=attr(rule,'type');
          const expression={containsText:`NOT(ISERROR(SEARCH(${literal},${origin})))`,notContainsText:`ISERROR(SEARCH(${literal},${origin}))`,beginsWith:`LEFT(${origin},LEN(${literal}))=${literal}`,endsWith:`RIGHT(${origin},LEN(${literal}))=${literal}`}[type];
          if(expression){let formula=child(rule,'formula');if(!formula){formula=create(sheet,'formula');rule.appendChild(formula);}formula.textContent=expression;}
        }
      }
    }
    for(const node of all(sheet,'hyperlink'))if(node.hasAttribute('ref'))node.setAttribute('ref',shiftRangeColumns(attr(node,'ref'),at,delta));
    for(const row of all(sheet,'row'))for(const c of children(row,'c').slice()){
      const p=address(attr(c,'r'));
      if(delta<0&&p.c>newCalEnd&&p.c<=oldCalEnd){row.removeChild(c);continue;}
      if(p.c>=at)c.setAttribute('r',cellRef(p.c+delta,p.r));
    }
    for(const n of all(workbook,'definedName')){
      if(Number(attr(n,'localSheetId','-1'))!==m.index)continue;
      if(!['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(attr(n,'name')))continue;
      const [prefix,...rest]=n.textContent.split('!'),ref=rest.join('!');
      n.textContent=`${prefix}!${ref.split(',').map(part=>{
        if(/^\$?\d+:\$?\d+$/.test(part))return part;
        if(/^\$?[A-Z]+:\$?[A-Z]+$/.test(part))return part.replace(/\$?([A-Z]+)/g,(_ref,col)=>`$${columnName(columnNumber(col)>=at?columnNumber(col)+delta:columnNumber(col))}`);
        const p=range(part);
        if(p.c<=m.dateStart&&p.end.c>=oldCalEnd)return `$${columnName(p.c)}$${p.r}:$${columnName(p.end.c+delta)}$${p.end.r}`;
        if(p.c>=at)return shiftRangeColumns(part,at,delta);
        return part;
      }).join(',')}`;
    }
  }
  const colsEl=ensureSheet(sheet,'cols'),entries=[];
  for(const node of children(colsEl,'col')){
    const d={min:number(node,'min',1),max:number(node,'max',1)};
    if(d.max<m.dateStart){entries.push({min:d.min,make:()=>{const n=node.cloneNode(true);n.setAttribute('min',String(d.min));n.setAttribute('max',String(d.max));return n;}});continue;}
    if(d.min>=at){const min=d.min+delta,max=d.max+delta;entries.push({min,make:()=>{const n=node.cloneNode(true);n.setAttribute('min',String(min));n.setAttribute('max',String(max));return n;}});continue;}
    if(d.min<m.dateStart){const max=m.dateStart-1;entries.push({min:d.min,make:()=>{const n=node.cloneNode(true);n.setAttribute('min',String(d.min));n.setAttribute('max',String(max));return n;}});}
    if(d.max>=at){const min=at+delta,max=d.max+delta;entries.push({min,make:()=>{const n=node.cloneNode(true);n.setAttribute('min',String(min));n.setAttribute('max',String(max));return n;}});}
  }
  for(const target of targetColumns){
    const c=target.c,key=`${target.weekdayIndex}:${target.slot}`,s=styleMap.get(key)||styleMap.get(`${target.weekdayIndex}:0`);
    entries.push({min:c,make:()=>{const attrs={min:c,max:c};if(s){if(s.width)attrs.width=s.width;attrs.customWidth='1';if(s.colStyle)attrs.style=s.colStyle;}return create(sheet,'col',attrs);}});
  }
  while(colsEl.firstChild)colsEl.removeChild(colsEl.firstChild);
  for(const e of entries.sort((a,b)=>a.min-b.min))colsEl.appendChild(e.make());
  return {area:{...m.area,end:{...m.area.end,c:m.area.end.c+delta}},at,delta};
}
// Any cell reference recorded before the reshape (title/year/month cells outside the calendar)
// must be remapped the same way the sheet's own tail columns were shifted.
function remapRef(ref,at,delta){const p=address(ref);return p.c>=at?cellRef(p.c+delta,p.r):ref;}
function analyzeStudents(template,sheet,grid,m){
  const calendar=calendarMonth(m.period.year,m.period.month),styles=styleEngine(template.styles.cloneNode(true),template);
  const value=(c,r)=>textOf(grid.cells.get(cellRef(c,r)),template.strings).trim();
  const merges=all(sheet,'mergeCell').map(n=>range(attr(n,'ref')));
  const blocks=[];
  for(let r=m.firstStudentRow;r<=m.area.end.r;r++){
    const name=value(m.nameCol,r),merge=merges.find(b=>b.c===m.nameCol&&b.r===r);
    if(!name&&!merge)continue;
    const end=merge?.end.r||r;
    check(end<=m.area.end.r&&(!merge||merge.end.c<m.dateStart),RECOGNITION_ERROR);
    // Blank template blocks remain part of pagination but are not invented students.
    const block={id:`${m.index}:${r}`,name,start:r,end,weekdays:[],channels:[],needsReview:false};
    blocks.push(block);r=end;if(!name)continue;
    const statusMerge=merges.find(p=>p.r===block.start&&p.end.r===end&&p.c===m.dateStart&&p.end.c===m.dateColumns.at(-1).c&&inactiveStudent(value(p.c,p.r)));
    if(statusMerge||m.weekdayCol&&inactiveStudent(value(m.weekdayCol,block.start))){block.inactive=true;block.statusMerge=statusMerge||null;continue;}
    let explicit=[];if(m.weekdayCol){try{explicit=parseWeekdays(value(m.weekdayCol,block.start));}catch{block.needsReview=true;}}
    const marked=new Set();
    for(let row=block.start;row<=end;row++){
      const signal=d=>{const cell=grid.cells.get(cellRef(d.c,row)),v=value(d.c,row);return !child(cell,'f')&&v!==''&&v!=='0'&&!exceptionalMark(v);};
      const hasValues=m.dateColumns.some(d=>calendar[d.day-1].active&&signal(d));
      const colored=m.dateColumns.filter(d=>calendar[d.day-1].active&&!exceptionalMark(value(d.c,row))&&chromatic(styles.fillColor(number(styles.xf(cellStyleId(sheet,grid.cells.get(cellRef(d.c,row)),d.c)),'fillId',0))));
      const backgrounds=new Set(m.dateColumns.filter(d=>calendar[d.day-1].active).map(d=>styles.fillColor(number(styles.xf(cellStyleId(sheet,grid.cells.get(cellRef(d.c,row)),d.c)),'fillId',0))?.toUpperCase()||'#FFFFFF'));
      const useColor=colored.length>=3&&backgrounds.size>1;
      const rowMarks=new Set(),slots=new Map();
      for(const d of m.dateColumns){if(!calendar[d.day-1].active)continue;
        const cell=grid.cells.get(cellRef(d.c,row)),id=cellStyleId(sheet,cell,d.c),fill=number(styles.xf(id),'fillId',0);
        if(!exceptionalMark(value(d.c,row))&&(useColor?chromatic(styles.fillColor(fill)):hasValues&&signal(d))){rowMarks.add(d.day);marked.add(d.day);if(!slots.has(d.slot))slots.set(d.slot,new Set());slots.get(d.slot).add(d.day);}
      }
      const inferred=inferWeekdays(rowMarks,calendar);
      block.channels.push({offset:row-block.start,weekdays:inferred.weekdays,slots:[...slots].map(([slot,marks])=>({slot,weekdays:inferWeekdays(marks,calendar).weekdays}))});
    }
    const inferred=inferWeekdays(marked,calendar);
    block.weekdays=explicit.length?explicit:inferred.weekdays;
    block.needsReview=block.needsReview||!explicit.length&&inferred.needsReview;
    if(explicit.length)block.channels=block.channels.map(c=>({...c,weekdays:explicit}));
  }
  check(blocks.some(b=>b.name)&&blocks.filter(b=>b.name).length<=500,RECOGNITION_ERROR);
  return blocks;
}
function attendanceArea(template,descriptor,sheet,grid){
  const declared=areaFor(template.workbook,descriptor.index,sheet);
  const print=namedRange(template.workbook,descriptor.index,'_xlnm.Print_Area');
  const bound=print?range(print.textContent.split('!').at(-1)):{c:declared.c,r:declared.r,end:{c:declared.c,r:declared.r}};
  const xfs=children(child(template.styles.documentElement,'cellXfs'),'xf'),borders=children(child(template.styles.documentElement,'borders'),'border');
  const visibleStyles=new Set(xfs.flatMap((xf,i)=>{
    const border=borders[number(xf,'borderId',0)];
    return ['left','right','top','bottom'].some(side=>attr(child(border,side),'style'))?[i]:[];
  }));
  // Exporters often format 1,000 empty rows. Only actual content, visible borders and merges define
  // the printable form; all cells outside this bound still remain in the copied workbook.
  for(const [ref,c] of grid.cells){
    if(!textOf(c,template.strings).trim()&&!child(c,'f')&&!visibleStyles.has(cellStyleId(sheet,c,address(ref).c)))continue;
    const p=address(ref);bound.end.c=Math.max(bound.end.c,p.c);bound.end.r=Math.max(bound.end.r,p.r);
  }
  for(const n of all(sheet,'mergeCell')){const p=range(attr(n,'ref'));if(p.r<=bound.end.r){bound.end.r=Math.max(bound.end.r,p.end.r);bound.end.c=Math.max(bound.end.c,p.end.c);}}
  return bound;
}
export function analyzeWorkbook(template,filename='',options={}){
  const sheets=[];
  for(const descriptor of template.sheets){
    if(descriptor.hidden||options.sheetIndexes&&!options.sheetIndexes.includes(descriptor.index))continue;
    const sheet=template.read(descriptor.path),grid=indexSheet(sheet);
    const headers=[...grid.cells].filter(([ref,c])=>address(ref).r<=40&&/^(이름|학생명|성명)$/.test(textOf(c,template.strings).trim()));
    if(!headers.length)continue;
    const area=attendanceArea(template,descriptor,sheet,grid);
    let candidates=dateGrid(template,sheet,grid,area);
    if(!candidates.length)candidates=sparseCalendars(template,sheet,grid,area);
    check(candidates.length===1&&headers.length===1&&!all(sheet,'sheetProtection').length,RECOGNITION_ERROR);
    const m={index:descriptor.index,name:descriptor.name,area,...candidates[0],nameCol:address(headers[0][0]).c};
    if(m.sparse){const print=namedRange(template.workbook,descriptor.index,'_xlnm.Print_Area');if(print)m.area={...area,end:{...area.end,r:range(print.textContent.split('!').at(-1)).end.r}};}
    m.firstStudentRow=Math.max(m.dateRow,m.weekdayRow,address(headers[0][0]).r)+1;
    m.weekdayCol=0;
    for(let r=area.r;r<m.firstStudentRow;r++)for(const cell of rowValues(grid,r,template.strings)){
      if(address(cell.ref).c<m.dateStart&&/^(수업요일|요일|수업일)$/.test(cell.value.replace(/\s/g,'')))m.weekdayCol=address(cell.ref).c;
    }
    check(m.nameCol<m.dateStart,RECOGNITION_ERROR);
    const dims=dimensions(sheet,area);
    check([m.nameCol,...m.dateColumns.map(d=>d.c)].every(c=>dims.widths[c-area.c]>0),RECOGNITION_ERROR);
    // Unknown conditional expressions can change the next month's appearance, so any rule type we
    // don't understand still fails closed. Two shapes are understood as safe: a "cellIs equal
    // <literal>" rule (compares a cell to a fixed value/text — used to color-sample lesson days),
    // and Excel's built-in "text contains/begins with/ends with <literal>" rules (their formula is
    // an auto-generated SEARCH/FIND helper over the rule's own `text` attribute, never a reference
    // to another cell, so it stays meaningful no matter what a new month's blank cells later hold).
    check(all(sheet,'cfRule').every(rule=>{
      const type=attr(rule,'type');
      if(type==='cellIs')return attr(rule,'operator')==='equal'&&all(rule,'formula').length===1&&/^(?:"[^"\r\n]*"|\d+)$/.test(all(rule,'formula')[0].textContent);
      if(['containsText','notContainsText','beginsWith','endsWith'].includes(type))return rule.hasAttribute('text')&&attr(rule,'text').length<=200;
      return false;
    }),RECOGNITION_ERROR);
    m.period=period(template,sheet,grid,m,filename,options.sourcePeriods?.[descriptor.index]);
    if(m.sparse)validateSparse(m);
    m.studentBlocks=analyzeStudents(template,sheet,grid,m);sheets.push(m);
  }
  check(sheets.length&&(options.allowMixedPeriods||sheets.every(s=>s.period.year===sheets[0].period.year&&s.period.month===sheets[0].period.month)),RECOGNITION_ERROR);
  return {sheets,year:sheets[0].period.year,month:sheets[0].period.month};
}
// Inspect independently; the caller must explicitly select supported sheets. Other ZIP parts are retained.
export function inspectAttendanceSheets(template,filename='',sourcePeriods={}){
  return template.sheets.filter(s=>!s.hidden).map(s=>{
    try{
      const analysis=analyzeWorkbook(template,filename,{sheetIndexes:[s.index],sourcePeriods});
      return {index:s.index,name:s.name,status:'ready',mapping:analysis.sheets[0]};
    }catch(error){
      return {index:s.index,name:s.name,status:error.code==='SOURCE_PERIOD_REQUIRED'?'needs-period':'unsupported',year:error.year||null,message:error.message};
    }
  });
}
function scheduleFill(template,originalSheet,originalGrid,styles,m,block,row){
  const calendar=calendarMonth(m.period.year,m.period.month),selected=[],normal=[];
  for(const d of m.dateColumns){if(!calendar[d.day-1].active)continue;
    const c=originalGrid.cells.get(cellRef(d.c,row)),id=cellStyleId(originalSheet,c,d.c),fill=number(styles.xf(id),'fillId',0),v=textOf(c,template.strings);
    if(exceptionalMark(v))continue;
    const isLesson=block.weekdays.includes(calendar[d.day-1].weekdayIndex);
    (isLesson?selected:normal).push(fill);
    if(isLesson&&v)for(const cf of all(originalSheet,'conditionalFormatting')){
      if(!attr(cf,'sqref').split(' ').some(ref=>{const a=range(ref,true);return row>=a.r&&row<=a.end.r&&d.c>=a.c&&d.c<=a.end.c;}))continue;
      for(const rule of all(cf,'cfRule')){
        if(all(rule,'formula')[0]?.textContent.replace(/^"|"$/g,'')!==v)continue;
        const dxf=children(child(template.styles.documentElement,'dxfs'),'dxf')[number(rule,'dxfId',-1)];
        const color=colorHex(child(child(child(dxf,'fill'),'patternFill'),'fgColor'),template)||colorHex(child(child(child(dxf,'fill'),'patternFill'),'bgColor'),template);
        if(chromatic(color))selected.push(styles.addFill(`FF${color.slice(1)}`));
      }
    }
  }
  const colors=selected.filter(f=>chromatic(styles.fillColor(f))),candidate=colors.length?mostCommon(colors):undefined;
  return {plain:mostCommon(normal,0),lesson:candidate??styles.addFill('FFE8F0EC')};
}
function serialValue(year,month,day,epoch1904){return (Date.UTC(year,month-1,day)-Date.UTC(epoch1904?1904:1899,epoch1904?0:11,epoch1904?1:30))/86400000;}
// Keep the recurring appearance of each student's weekday/slot, including white free slots and
// gray unavailable slots. A one-off make-up mark must not override a row's regular lesson pattern.
function rowStyleSamples(sheet,grid,styles,m,calendar,row,template){
  const groups=new Map(),allSamples=[];
  for(const d of m.dateColumns){
    if(d.day>28||!calendar[d.day-1].active)continue;
    const cell=grid.cells.get(cellRef(d.c,row)),id=cellStyleId(sheet,cell,d.c),value=textOf(cell,template.strings);
    const sample={id,fill:number(styles.xf(id),'fillId',0),exception:exceptionalMark(value),edge:d.c===m.dateStart||d.c===m.dateColumns.at(-1).c};
    const key=`${calendar[d.day-1].weekdayIndex}:${d.slot}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sample);allSamples.push(sample);
  }
  const normal=allSamples.filter(s=>!s.exception&&!chromatic(styles.fillColor(s.fill)));
  const white=normal.filter(s=>!styles.fillColor(s.fill)||styles.fillColor(s.fill).toUpperCase()==='#FFFFFF');
  const plain=mostCommon((white.length?white:normal).map(s=>s.fill),0),byKey=new Map();
  for(const [key,group] of groups){
    const ordinary=group.filter(s=>!s.exception),samples=ordinary.length?ordinary:group;
    const color=s=>styles.fillColor(s.fill)?.toUpperCase()||'#FFFFFF';
    const dominant=mostCommon(samples.map(color));
    const same=samples.filter(s=>color(s)===dominant),interior=same.filter(s=>!s.edge);
    let id=mostCommon((interior.length?interior:same).map(s=>s.id));
    if(group.filter(s=>s.exception).length>=Math.ceil(group.length/2))id=styles.withFill(id,plain);
    byKey.set(key,id);
  }
  const first=cellStyleId(sheet,grid.cells.get(cellRef(m.dateStart,row)),m.dateStart);
  const lastColumn=m.dateColumns.at(-1).c,last=cellStyleId(sheet,grid.cells.get(cellRef(lastColumn,row)),lastColumn);
  return {byKey,plain,first,last};
}
function clearMonthNotes(sheet,grid,originalSheet,originalGrid,styles,m,columns,template){
  let cleared=0;const oldEnd=m.dateColumns.at(-1).c;
  const notes=[],merges=all(originalSheet,'mergeCell').map(n=>range(attr(n,'ref')));
  for(const [ref,cell] of originalGrid.cells){
    const p=address(ref);
    if(p.c<m.dateStart||p.c>oldEnd||p.r>=m.dateRow||m.period.titleCells.includes(ref)||m.period.yearCells.includes(ref)||m.period.monthCells.includes(ref)||!textOf(cell,template.strings).trim())continue;
    if(child(cell,'f')||!datedNote(textOf(cell,template.strings)))continue;
    const merge=merges.find(b=>b.c===p.c&&b.r===p.r);
    if(merge&&(merge.end.c>oldEnd||merge.end.r!==p.r))continue;
    notes.push(merge||{...p,end:p});cleared++;
  }
  for(const note of notes){
    const row=note.r;
    const candidates=m.dateColumns.map(d=>({id:cellStyleId(originalSheet,originalGrid.cells.get(cellRef(d.c,row)),d.c),cell:originalGrid.cells.get(cellRef(d.c,row))}));
    const neutral=candidates.filter(s=>!textOf(s.cell,template.strings).trim()&&!chromatic(styles.fillColor(number(styles.xf(s.id),'fillId',0))));
    const id=mostCommon((neutral.length?neutral:candidates).map(s=>s.id));
    const sourceDays=m.dateColumns.filter(d=>d.c>=note.c&&d.c<=note.end.c).map(d=>d.day);
    const target=columns.filter(d=>sourceDays.includes(d.day));
    // Clear both former and relocated positions; only empty styled cells or this exact note are touched.
    const noteText=textOf(originalGrid.cells.get(cellRef(note.c,row)),template.strings).trim();
    const positions=new Set([...target.map(d=>d.c),...columns.filter(d=>d.c>=note.c&&d.c<=note.end.c).map(d=>d.c)]);
    for(const c of positions){const cell=grid.cell(c,row),value=textOf(cell,template.strings).trim();if(child(cell,'f')||value&&value!==noteText)continue;putValue(cell,'',sheet);cell.setAttribute('s',String(id));}
    for(const merge of all(sheet,'mergeCell').slice()){const p=range(attr(merge,'ref'));if(p.r===row&&p.end.r===row&&(p.c===target[0].c&&p.end.c===target.at(-1).c||p.c===note.c&&p.end.c===note.end.c))merge.parentNode.removeChild(merge);}
  }
  return cleared;
}
function generateSheet(template,m,options,styles,workbook){
  const sheet=template.read(template.sheets[m.index].path),se=styleEngine(styles,template);
  const originalSheet=template.read(template.sheets[m.index].path),originalGrid=indexSheet(originalSheet);
  const calendar=calendarMonth(options.year,options.month),oldCalendar=calendarMonth(m.period.year,m.period.month);
  const policy=weekdaySlotPolicy(m.dateColumns,oldCalendar);
  const preserve=options.preserveColumns===true&&!m.sparse;
  if(preserve)check(m.dateColumns.at(-1).day===31,'원본 날짜칸 유지에는 31일 칸이 있는 양식이 필요합니다.');
  const sparse=m.sparse?sparseTargets(m,options.year,options.month):null;
  const targetColumns=sparse?sparse.filter(d=>!d.separator):preserve?m.dateColumns.map(d=>({...d,weekdayIndex:calendar[d.day-1].weekdayIndex,active:calendar[d.day-1].active})):targetCalendarColumns(options.year,options.month,policy);
  if(!sparse){let column=m.dateStart;for(const d of targetColumns)d.c=column++;}
  const styleMap=sampleCalendarStyles(originalSheet,originalGrid,m,oldCalendar);
  // reshapeCalendar mutates the raw sheet DOM (column inserts/deletes shift cell `r` attributes);
  // the mutable cell index must be built fresh afterwards, or it would resolve stale references.
  const {area,at,delta,sourceErrors=0}=sparse?reshapeSparse(sheet,workbook,m,sparse):preserve?{area:m.area,at:m.dateColumns.at(-1).c+1,delta:0}:reshapeCalendar(sheet,workbook,m,targetColumns,styleMap,template);
  const grid=mutableSheet(sheet);
  const differentMonth=options.year!==m.period.year||options.month!==m.period.month;
  const clearedNotes=differentMonth?clearMonthNotes(sheet,grid,originalSheet,originalGrid,se,m,targetColumns,template):0;
  for(const b of m.studentBlocks){
    const override=options.weekdays?.[b.id],weekdays=override?parseWeekdays(override):b.weekdays;
    check(!b.name||b.inactive||weekdays.length&&(!b.needsReview||override),'수업요일 확인이 필요한 학생이 있습니다.');
    for(let row=b.start;row<=b.end;row++){
      if(b.statusMerge){
        const source=originalGrid.cells.get(cellRef(m.dateStart,row));
        for(const d of targetColumns){const cell=grid.cell(d.c,row),c=d.c===m.dateStart?m.dateStart:d.c===targetColumns.at(-1).c?m.dateColumns.at(-1).c:m.dateStart+1;putValue(cell,'',sheet);cell.setAttribute('s',String(cellStyleId(originalSheet,originalGrid.cells.get(cellRef(c,row)),c)));}
        if(row===b.start){const cell=grid.cell(m.dateStart,row);if(source){if(source.hasAttribute('t'))cell.setAttribute('t',attr(source,'t'));for(const n of Array.from(source.childNodes))if(n.nodeType===1&&['v','is'].includes(n.localName))cell.appendChild(n.cloneNode(true));}}
        continue;
      }
      const fill=scheduleFill(template,originalSheet,originalGrid,se,m,{...b,weekdays},row);
      const samples=rowStyleSamples(originalSheet,originalGrid,se,m,oldCalendar,row,template);
      const channel=b.channels.find(c=>c.offset===row-b.start),days=override?weekdays:channel?.weekdays||[];
      for(const d of targetColumns){
        const cell=grid.cell(d.c,row),cal=calendar[d.day-1];
        if(child(cell,'f'))continue;
        putValue(cell,'',sheet);
        // Falling back to the channel's whole-row weekdays for slot 0 would wrongly highlight
        // slot 0 for a student whose actual mark lives at slot 1/2 of the same multi-slot day
        // (that row-level weekday list merges marks from every slot). Every slot, including 0,
        // must resolve through its own per-slot weekday list.
        const slotDays=override?days:channel?.slots.find(s=>s.slot===d.slot)?.weekdays||[];
        const selected=b.name&&!b.inactive&&slotDays.includes(cal.weekdayIndex)&&cal.active;
        let id=samples.byKey.get(`${cal.weekdayIndex}:${d.slot}`)??samples.byKey.get(`${cal.weekdayIndex}:0`)??samples.first;
        const sampledFill=number(se.xf(id),'fillId',0);
        const background=!cal.active?se.addFill('FFF1F1F1'):chromatic(se.fillColor(sampledFill))?samples.plain:sampledFill;
        id=se.withFill(id,selected?fill.lesson:background);
        if(!differentMonth&&cal.active){
          const source=m.dateColumns.find(s=>s.day===d.day&&s.slot===d.slot),original=source&&originalGrid.cells.get(cellRef(source.c,row));
          if(original&&!exceptionalMark(textOf(original,template.strings)))id=cellStyleId(originalSheet,original,source.c);
        }
        const edges={};if(d.c===m.dateStart)edges.left=samples.first;if(d.c===targetColumns.at(-1).c)edges.right=samples.last;
        cell.setAttribute('s',String(se.withEdges(id,edges)));
      }
    }
  }
  // Empty roster rows still must not carry last month's marks into the new workbook.
  const covered=new Set(m.studentBlocks.flatMap(b=>Array.from({length:b.end-b.start+1},(_,i)=>b.start+i)));
  for(let r=m.firstStudentRow;r<=area.end.r;r++)if(!covered.has(r))for(const d of targetColumns){const cell=grid.cell(d.c,r);if(!child(cell,'f'))putValue(cell,'',sheet);}
  const sourceDateSample=textOf(originalGrid.cells.get(cellRef(m.dateColumns[0].c,m.dateRow)),template.strings);
  const usesSerial=Boolean(dateParts(sourceDateSample,template.epoch1904)),usesDayWord=/일$/.test(sourceDateSample);
  const groups=new Map();for(const d of targetColumns){if(!groups.has(d.day))groups.set(d.day,[]);groups.get(d.day).push(d);}
  if(m.headerMode==='merged'&&!preserve){
    const mergeContainer=ensureSheet(sheet,'mergeCells');
    // Even equal-width months can put the weekend merges in different columns.
    for(const n of children(mergeContainer,'mergeCell').slice()){
      const p=range(attr(n,'ref'));
      if([m.dateRow,m.weekdayRow].includes(p.r)&&p.r===p.end.r&&p.c>=m.dateStart&&p.end.c<=targetColumns.at(-1).c)mergeContainer.removeChild(n);
    }
    for(const cols of groups.values()){
      if(cols.length<2)continue;
      const dateRef=`${cellRef(cols[0].c,m.dateRow)}:${cellRef(cols.at(-1).c,m.dateRow)}`;
      mergeContainer.appendChild(create(sheet,'mergeCell',{ref:dateRef}));
      if(m.weekdayRow)mergeContainer.appendChild(create(sheet,'mergeCell',{ref:`${cellRef(cols[0].c,m.weekdayRow)}:${cellRef(cols.at(-1).c,m.weekdayRow)}`}));
    }
    mergeContainer.setAttribute('count',String(children(mergeContainer,'mergeCell').length));
  }
  for(const [day,cols] of groups){
    const cal=calendar[day-1];
    cols.forEach((d,i)=>{
      const key=`${d.weekdayIndex}:${d.slot}`,s=styleMap.get(key)||styleMap.get(`${d.weekdayIndex}:0`);
      const anchor=m.headerMode==='merged'?i===0:true;
      const header=grid.cell(d.c,m.dateRow);
      if(!preserve&&s?.dateStyle)header.setAttribute('s',String(s.dateStyle));
      putValue(header,anchor&&cal.active?(usesSerial?serialValue(options.year,options.month,day,template.epoch1904):usesDayWord?`${day}일`:day):'',sheet);
      if(m.weekdayRow){
        const weekdayCell=grid.cell(d.c,m.weekdayRow);
        if(!preserve&&s?.weekdayStyle)weekdayCell.setAttribute('s',String(s.weekdayStyle));
        putValue(weekdayCell,anchor&&cal.active?cal.weekday:'',sheet);
      }
    });
  }
  for(const ref of m.period.titleCells){const cell=grid.cells.get(remapRef(ref,at,delta)),text=textOf(cell,template.strings);updateTitle(cell,text.replace(/20\d{2}([^\d]{0,8}?)\d{1,2}\s*월/,`${options.year}$1${options.month}월`).replace(/20\d{2}([./-])\d{1,2}/,`${options.year}$1${String(options.month).padStart(2,'0')}`),sheet,template);}
  for(const ref of m.period.yearCells){const cell=grid.cells.get(remapRef(ref,at,delta));updateTitle(cell,textOf(cell,template.strings).replace(/20\d{2}(\s*(?:년|학년도))/,`${options.year}$1${m.period.confirmed?` ${options.month}월`:''}`),sheet,template);}
  for(const ref of m.period.monthCells){const cell=grid.cells.get(remapRef(ref,at,delta));putValue(cell,/월/.test(textOf(cell,template.strings))?`${options.month}월`:options.month,sheet);}
  // Keep formulas, but never show cached prior-month totals as new results.
  for(const f of all(sheet,'f')){if(m.sparse&&address(attr(f.parentNode,'r')).r>m.area.end.r)continue;const v=child(f.parentNode,'v');if(v)v.parentNode.removeChild(v);}
  const plan=planPages(sheet,area,m,{start:area.r,end:area.end.r});
  if(!namedRange(workbook,m.index,'_xlnm.Print_Area'))setNamedRange(workbook,m.index,'_xlnm.Print_Area',`'${m.name.replace(/'/g,"''")}'!$${columnName(area.c)}$${area.r}:$${columnName(area.end.c)}$${area.end.r}`);
  const setup=ensureSheet(sheet,'pageSetup');if(!setup.hasAttribute('paperSize'))setup.setAttribute('paperSize','9');
  if(!setup.hasAttribute('orientation'))setup.setAttribute('orientation','landscape');
  if(plan.settings.fitWidth!==1||!plan.settings.fit&&plan.settings.scale>plan.width/plan.dimensions.width){
    setup.setAttribute('fitToWidth','1');setup.setAttribute('fitToHeight',plan.pages.length>1?'0':'1');
    const pr=ensureSheet(sheet,'sheetPr');let fit=child(pr,'pageSetUpPr');if(!fit){fit=create(sheet,'pageSetUpPr');pr.appendChild(fit);}fit.setAttribute('fitToPage','1');
  }
  if(plan.pages.length>1){
    const breaks=ensureSheet(sheet,'rowBreaks');while(breaks.firstChild)breaks.removeChild(breaks.firstChild);
    breaks.setAttribute('count',String(plan.pages.length-1));breaks.setAttribute('manualBreakCount',String(plan.pages.length-1));
    for(const page of plan.pages.slice(1))breaks.appendChild(create(sheet,'brk',{id:page.find(r=>r>=m.firstStudentRow)-1,min:area.c-1,max:area.end.c-1,man:1}));
    const quoted=`'${m.name.replace(/'/g,"''")}'`;
    const prior=namedRange(workbook,m.index,'_xlnm.Print_Titles')?.textContent||'';
    const repeatColumns=prior.split(',').filter(v=>/!\$?[A-Z]+:\$?[A-Z]+$/.test(v));
    setNamedRange(workbook,m.index,'_xlnm.Print_Titles',[`${quoted}!$${area.r}:$${m.firstStudentRow-1}`,...repeatColumns].join(','));
  }
  const colBreaks=child(sheet.documentElement,'colBreaks');if(colBreaks)colBreaks.parentNode.removeChild(colBreaks);
  const browserPrintSafe=plan.settings.paperSize===9&&!(preserve&&all(sheet,'f').length)&&!['drawing','legacyDrawing','picture','headerFooter'].some(tag=>all(sheet,tag).some(n=>n.attributes.length||n.childNodes.length));
  const mapping={...m,dateColumns:targetColumns.map(d=>({...d})),area,period:{...m.period,
    titleCells:m.period.titleCells.map(ref=>remapRef(ref,at,delta)),
    yearCells:m.period.yearCells.map(ref=>remapRef(ref,at,delta)),
    monthCells:m.period.monthCells.map(ref=>remapRef(ref,at,delta))}};
  const mergeContainer=child(sheet.documentElement,'mergeCells');if(mergeContainer)mergeContainer.setAttribute('count',String(children(mergeContainer,'mergeCell').length));
  return {sheet,styles,area,mapping,plan,template,year:options.year,month:options.month,browserPrintSafe,preserveColumns:preserve,clearedNotes,sourceErrors};
}
export function generateWorkbook(template,analysis,options){
  calendarMonth(options.year,options.month);
  const styles=template.styles.cloneNode(true),workbook=template.workbook.cloneNode(true),files={...template.entries};
  check(analysis.sheets.length,'생성할 출석부 시트를 선택해주세요.');
  const results=analysis.sheets.map(m=>generateSheet(template,m,options,styles,workbook));
  const serialize=doc=>strToU8(new template.env.XMLSerializer().serializeToString(doc));
  for(const result of results)files[template.sheets[result.mapping.index].path]=serialize(result.sheet);
  let calc=child(workbook.documentElement,'calcPr');if(!calc){calc=create(workbook,'calcPr');workbook.documentElement.appendChild(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
  files['xl/workbook.xml']=serialize(workbook);files['xl/styles.xml']=serialize(styles);
  if(analysis.sheets.some(m=>m.sparse)){
    // Excel rebuilds this derived index. Old entries can point to moved or replaced formulas.
    const rels=template.read('xl/_rels/workbook.xml.rels'),types=template.read('[Content_Types].xml');
    const chains=all(rels,'Relationship').filter(n=>attr(n,'Type').endsWith('/calcChain'));
    for(const rel of chains){
      const url=new URL(attr(rel,'Target'),'https://xlsx.local/xl/workbook.xml');
      check(!attr(rel,'TargetMode')&&url.origin==='https://xlsx.local','외부 계산 체인은 지원하지 않습니다.');
      const path=url.pathname.slice(1);
      check(template.read(path)?.documentElement.localName==='calcChain','계산 체인 연결이 올바르지 않습니다. Excel에서 다시 저장해주세요.');
      delete files[path];rel.parentNode.removeChild(rel);
      for(const node of all(types,'Override'))if(attr(node,'PartName')===url.pathname)node.parentNode.removeChild(node);
    }
    if(chains.length){files['xl/_rels/workbook.xml.rels']=serialize(rels);files['[Content_Types].xml']=serialize(types);}
  }
  return {bytes:zipSync(files,{level:6}),results,year:options.year,month:options.month};
}
export function printWorkbook(output){
  const docs=output.results.map(printDocument);
  // Named pages allow each sheet to keep its own orientation and margins.
  const styles=[],bodies=[];
  docs.forEach((doc,i)=>{
    let css=doc.match(/<style>([\s\S]*?)<\/style>/)[1];
    css=css.replace('@page{',`@page attendance${i}{`).replace(/\.at-print-page/g,`.at-book-${i} .at-print-page`).replace(/\.at-sheet/g,`.at-book-${i} .at-sheet`);
    styles.push(css+`.at-book-${i}{page:attendance${i};break-after:page}.at-book-${i}:last-child{break-after:auto}`);
    bodies.push(`<div class="at-book-${i}">${doc.match(/<body>([\s\S]*)<\/body>/)[1]}</div>`);
  });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>출석부</title><style>${styles.join('\n')}</style></head><body>${bodies.join('')}</body></html>`;
}
export {openTemplate};

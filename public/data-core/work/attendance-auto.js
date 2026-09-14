import {zipSync,strToU8} from '../vendor/fflate-0.8.3.js';
import {openTemplate,calendarMonth,parseWeekdays,planPages,printDocument,all,child,children,
  attr,number,check,cellRef,range,address,textOf,indexSheet,areaFor,dateParts,putValue,
  mutableSheet,styleEngine,cellStyleId,mostCommon,updateTitle,ensureSheet,create,
  setNamedRange,namedRange,dimensions,colorHex,columnName,shiftRangeColumns} from './attendance-template.js';

export const RECOGNITION_ERROR='이 출석부 형식을 자동으로 인식하지 못했습니다.';
const rowValues=(grid,row,strings)=>[...grid.cells].filter(([ref])=>address(ref).r===row).map(([ref,c])=>({ref,c,value:textOf(c,strings).trim()}));
const chromatic=color=>{if(!/^#[\da-f]{6}$/i.test(color||''))return false;const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return Math.max(...rgb)-Math.min(...rgb)>15;};
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
    // Only reuse existing blank, styled tail cells. Never consume a summary column.
    for(let d=previous+1;d<=31;d++){
      const x=columns.at(-1).c+1,cell=grid.cells.get(cellRef(x,r));
      if(x>area.end.c||literal(x,r)||!cell)break;
      columns.push({c:x,day:d,slot:0});
    }
    if(columns.at(-1).day!==31)continue;
    const weekdayRow=[r+1,r-1].find(w=>w>=area.r&&columns.filter(d=>/^[일월화수목금토](?:요일)?$/.test(text(d.c,w))).length>=14)||0;
    const headerMode=anyMerged?'merged':columns.some(d=>d.slot>0)?'repeated':'single';
    found.push({dateRow:r,dateStart:c,dateColumns:columns,weekdayRow,headerMode});
  }
  return found;
}
function period(template,sheet,grid,m,filename){
  const candidates=[],yearCells=[],monthCells=[],titleCells=[];
  const fm=monthText(filename);if(fm)candidates.push({year:Number(fm[1])+(fm[1].length===2?2000:0),month:Number(fm[2])});
  let year=0,month=0;
  for(const [ref,c] of grid.cells){
    if(address(ref).r>=m.dateRow)continue;
    const value=textOf(c,template.strings),full=/(20\d{2})\s*년\s*(\d{1,2})\s*월|\b(20\d{2})[./-](\d{1,2})\b/.exec(value);
    if(full){candidates.push({year:Number(full[1]||full[3]),month:Number(full[2]||full[4])});titleCells.push(ref);continue;}
    const y=/(20\d{2})\s*년/.exec(value);if(y){year=Number(y[1]);yearCells.push(ref);}
  }
  if(year){
    const values=[...grid.cells].filter(([ref,c])=>address(ref).r<m.dateRow&&/^(?:0?[1-9]|1[0-2])(?:월)?$/.test(textOf(c,template.strings).trim()));
    if(values.length===1){month=Number(textOf(values[0][1],template.strings).replace(/월/,''));monthCells.push(values[0][0]);candidates.push({year,month});}
  }
  const serial=dateParts(textOf(grid.cells.get(cellRef(m.dateStart,m.dateRow)),template.strings),template.epoch1904);
  if(serial)candidates.push(serial);
  check(candidates.length&&candidates.every(p=>p.year===candidates[0].year&&p.month===candidates[0].month),RECOGNITION_ERROR);
  const source=candidates[0];calendarMonth(source.year,source.month);
  if(m.weekdayRow){const cal=calendarMonth(source.year,source.month);check(m.dateColumns.every(d=>{
    const v=textOf(grid.cells.get(cellRef(d.c,m.weekdayRow)),template.strings).replace(/요일$/,'');
    return !v||!cal[d.day-1].active||v===cal[d.day-1].weekday;
  }),RECOGNITION_ERROR);}
  return {...source,yearCells,monthCells,titleCells};
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
// Grows or shrinks the calendar's physical column span to match targetColumns.length, shifting
// everything to the right of the calendar (make-up/total/summary columns, their merges and named
// ranges) while leaving the student-info columns to the left of dateStart untouched. Column widths
// and styles for the (possibly new) calendar columns are rebuilt from the sampled (weekday,slot) map.
function reshapeCalendar(sheet,workbook,m,targetColumns,styleMap){
  const oldWidth=m.dateColumns.length,newWidth=targetColumns.length,delta=newWidth-oldWidth;
  const oldCalEnd=m.dateStart+oldWidth-1,newCalEnd=m.dateStart+newWidth-1,at=oldCalEnd+1;
  if(delta!==0){
    check(!all(sheet,'f').length,'날짜 열 구조가 바뀌는 달에는 수식이 있는 양식을 지원하지 않습니다. Excel에서 수식 없는 복사본을 사용해주세요.');
    check(!['drawing','legacyDrawing','tableParts','oleObjects','controls'].some(tag=>all(sheet,tag).length),'날짜 열 구조가 바뀌는 달에는 그림·표·개체가 있는 양식을 지원하지 않습니다.');
    const mergeContainer=child(sheet.documentElement,'mergeCells');
    if(mergeContainer)for(const node of children(mergeContainer,'mergeCell').slice()){
      const ref=attr(node,'ref'),p=range(ref);
      if(p.end.c<m.dateStart)continue; // fully before the calendar (student-info columns), untouched
      if(p.c<=m.dateStart&&p.end.c>=oldCalEnd){node.setAttribute('ref',`${cellRef(p.c,p.r)}:${cellRef(p.end.c+delta,p.end.r)}`);continue;} // spans across (or exactly covers) the calendar, e.g. a title row: grows/shrinks with it
      if(p.c>=at){node.setAttribute('ref',shiftRangeColumns(ref,at,delta));continue;} // fully inside the trailing (make-up/total) region
      if(p.c>=m.dateStart&&p.end.c<=oldCalEnd){mergeContainer.removeChild(node);continue;} // fully inside the old calendar (date/weekday header merges) — rebuilt fresh below
      check(false,'날짜 영역과 겹치는 병합 셀 구조는 지원하지 않습니다. Excel에서 확인해주세요.');
    }
    for(const tag of ['conditionalFormatting','dataValidation'])for(const node of all(sheet,tag)){
      if(!node.hasAttribute('sqref'))continue;
      node.setAttribute('sqref',attr(node,'sqref').split(' ').map(ref=>{
        const p=range(ref);
        if(p.c<=m.dateStart&&p.end.c>=oldCalEnd)return `${cellRef(p.c,p.r)}:${cellRef(p.end.c+delta,p.end.r)}`;
        if(p.c>=at)return shiftRangeColumns(ref,at,delta);
        check(p.end.c<m.dateStart,`날짜 영역과 겹치는 ${tag} 범위는 지원하지 않습니다.`);
        return ref;
      }).join(' '));
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
    let explicit=[];if(m.weekdayCol){try{explicit=parseWeekdays(value(m.weekdayCol,block.start));}catch{block.needsReview=true;}}
    const marked=new Set();
    for(let row=block.start;row<=end;row++){
      const signal=d=>{const cell=grid.cells.get(cellRef(d.c,row)),v=value(d.c,row);return !child(cell,'f')&&v!==''&&v!=='0';};
      const hasValues=m.dateColumns.some(d=>calendar[d.day-1].active&&signal(d));
      const rowMarks=new Set(),slots=new Map();
      for(const d of m.dateColumns){if(!calendar[d.day-1].active)continue;
        const cell=grid.cells.get(cellRef(d.c,row)),id=cellStyleId(sheet,cell,d.c),fill=number(styles.xf(id),'fillId',0);
        if(hasValues?signal(d):chromatic(styles.fillColor(fill))){rowMarks.add(d.day);marked.add(d.day);if(!slots.has(d.slot))slots.set(d.slot,new Set());slots.get(d.slot).add(d.day);}
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
export function analyzeWorkbook(template,filename=''){
  const sheets=[];
  for(const descriptor of template.sheets){
    if(descriptor.hidden)continue;
    const sheet=template.read(descriptor.path),grid=indexSheet(sheet);
    const headers=[...grid.cells].filter(([ref,c])=>address(ref).r<=40&&/^(이름|학생명|성명)$/.test(textOf(c,template.strings).trim()));
    if(!headers.length)continue;
    const area=areaFor(template.workbook,descriptor.index,sheet),candidates=dateGrid(template,sheet,grid,area);
    check(candidates.length===1&&headers.length===1&&!all(sheet,'sheetProtection').length,RECOGNITION_ERROR);
    const m={index:descriptor.index,name:descriptor.name,area,...candidates[0],nameCol:address(headers[0][0]).c};
    m.firstStudentRow=Math.max(m.dateRow,m.weekdayRow,address(headers[0][0]).r)+1;
    m.weekdayCol=0;
    for(let r=area.r;r<m.firstStudentRow;r++)for(const cell of rowValues(grid,r,template.strings)){
      if(address(cell.ref).c<m.dateStart&&/^(수업요일|요일|수업일)$/.test(cell.value.replace(/\s/g,'')))m.weekdayCol=address(cell.ref).c;
    }
    check(m.nameCol<m.dateStart,RECOGNITION_ERROR);
    const dims=dimensions(sheet,area);check([m.nameCol,...m.dateColumns.map(d=>d.c)].every(c=>dims.widths[c-area.c]>0),RECOGNITION_ERROR);
    // Unknown conditional expressions can change the next month's appearance. Fail closed.
    check(all(sheet,'cfRule').every(rule=>attr(rule,'type')==='cellIs'&&attr(rule,'operator')==='equal'&&all(rule,'formula').length===1&&/^(?:"[^"\r\n]*"|\d+)$/.test(all(rule,'formula')[0].textContent)),RECOGNITION_ERROR);
    m.period=period(template,sheet,grid,m,filename);
    m.studentBlocks=analyzeStudents(template,sheet,grid,m);sheets.push(m);
  }
  check(sheets.length&&sheets.every(s=>s.period.year===sheets[0].period.year&&s.period.month===sheets[0].period.month),RECOGNITION_ERROR);
  return {sheets,year:sheets[0].period.year,month:sheets[0].period.month};
}
function scheduleFill(template,originalSheet,originalGrid,styles,m,block,row){
  const calendar=calendarMonth(m.period.year,m.period.month),selected=[],normal=[];
  for(const d of m.dateColumns){if(!calendar[d.day-1].active)continue;
    const c=originalGrid.cells.get(cellRef(d.c,row)),id=cellStyleId(originalSheet,c,d.c),fill=number(styles.xf(id),'fillId',0),v=textOf(c,template.strings);
    const isLesson=block.weekdays.includes(calendar[d.day-1].weekdayIndex);
    (isLesson?selected:normal).push(fill);
    if(isLesson&&v)for(const cf of all(originalSheet,'conditionalFormatting')){
      if(!attr(cf,'sqref').split(' ').some(ref=>{const a=range(ref);return row>=a.r&&row<=a.end.r&&d.c>=a.c&&d.c<=a.end.c;}))continue;
      for(const rule of all(cf,'cfRule')){
        if(all(rule,'formula')[0].textContent.replace(/^"|"$/g,'')!==v)continue;
        const dxf=children(child(template.styles.documentElement,'dxfs'),'dxf')[number(rule,'dxfId',-1)];
        const color=colorHex(child(child(child(dxf,'fill'),'patternFill'),'fgColor'),template)||colorHex(child(child(child(dxf,'fill'),'patternFill'),'bgColor'),template);
        if(chromatic(color))selected.push(styles.addFill(`FF${color.slice(1)}`));
      }
    }
  }
  const candidate=selected.find(f=>chromatic(styles.fillColor(f)));
  return {plain:mostCommon(normal,0),lesson:candidate??styles.addFill('FFE8F0EC')};
}
function serialValue(year,month,day,epoch1904){return (Date.UTC(year,month-1,day)-Date.UTC(epoch1904?1904:1899,epoch1904?0:11,epoch1904?1:30))/86400000;}
function generateSheet(template,m,options,styles,workbook){
  const sheet=template.read(template.sheets[m.index].path),se=styleEngine(styles,template);
  const originalSheet=template.read(template.sheets[m.index].path),originalGrid=indexSheet(originalSheet);
  const calendar=calendarMonth(options.year,options.month),oldCalendar=calendarMonth(m.period.year,m.period.month);
  const policy=weekdaySlotPolicy(m.dateColumns,oldCalendar);
  const targetColumns=targetCalendarColumns(options.year,options.month,policy);
  let column=m.dateStart;for(const d of targetColumns)d.c=column++;
  const styleMap=sampleCalendarStyles(originalSheet,originalGrid,m,oldCalendar);
  // reshapeCalendar mutates the raw sheet DOM (column inserts/deletes shift cell `r` attributes);
  // the mutable cell index must be built fresh afterwards, or it would resolve stale references.
  const {area,at,delta}=reshapeCalendar(sheet,workbook,m,targetColumns,styleMap);
  const grid=mutableSheet(sheet);
  for(const b of m.studentBlocks){
    const override=options.weekdays?.[b.id],weekdays=override?parseWeekdays(override):b.weekdays;
    check(!b.name||weekdays.length&&(!b.needsReview||override),'수업요일 확인이 필요한 학생이 있습니다.');
    for(let row=b.start;row<=b.end;row++){
      const fill=scheduleFill(template,originalSheet,originalGrid,se,m,{...b,weekdays},row);
      const channel=b.channels.find(c=>c.offset===row-b.start),days=override?weekdays:channel?.weekdays||[];
      for(const d of targetColumns){
        const cell=grid.cell(d.c,row),cal=calendar[d.day-1];
        putValue(cell,'',sheet);
        // Falling back to the channel's whole-row weekdays for slot 0 would wrongly highlight
        // slot 0 for a student whose actual mark lives at slot 1/2 of the same multi-slot day
        // (that row-level weekday list merges marks from every slot). Every slot, including 0,
        // must resolve through its own per-slot weekday list.
        const slotDays=override?days:channel?.slots.find(s=>s.slot===d.slot)?.weekdays||[];
        const selected=b.name&&slotDays.includes(cal.weekdayIndex)&&cal.active;
        cell.setAttribute('s',String(se.withFill(number(cell,'s',0),selected?fill.lesson:fill.plain)));
      }
    }
  }
  // Empty roster rows still must not carry last month's marks into the new workbook.
  const covered=new Set(m.studentBlocks.flatMap(b=>Array.from({length:b.end-b.start+1},(_,i)=>b.start+i)));
  for(let r=m.firstStudentRow;r<=area.end.r;r++)if(!covered.has(r))for(const d of targetColumns)putValue(grid.cell(d.c,r),'',sheet);
  const sourceDateSample=textOf(originalGrid.cells.get(cellRef(m.dateColumns[0].c,m.dateRow)),template.strings);
  const usesSerial=Boolean(dateParts(sourceDateSample,template.epoch1904)),usesDayWord=/일$/.test(sourceDateSample);
  const groups=new Map();for(const d of targetColumns){if(!groups.has(d.day))groups.set(d.day,[]);groups.get(d.day).push(d);}
  if(m.headerMode==='merged'){
    const mergeContainer=ensureSheet(sheet,'mergeCells');
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
      if(s?.dateStyle)header.setAttribute('s',String(s.dateStyle));
      putValue(header,anchor&&cal.active?(usesSerial?serialValue(options.year,options.month,day,template.epoch1904):usesDayWord?`${day}일`:day):'',sheet);
      if(m.weekdayRow){
        const weekdayCell=grid.cell(d.c,m.weekdayRow);
        if(s?.weekdayStyle)weekdayCell.setAttribute('s',String(s.weekdayStyle));
        putValue(weekdayCell,anchor&&cal.active?cal.weekday:'',sheet);
      }
    });
  }
  for(const ref of m.period.titleCells){const cell=grid.cells.get(remapRef(ref,at,delta)),text=textOf(cell,template.strings);updateTitle(cell,text.replace(/20\d{2}\s*년\s*\d{1,2}\s*월/,`${options.year}년 ${options.month}월`).replace(/20\d{2}([./-])\d{1,2}/,`${options.year}$1${String(options.month).padStart(2,'0')}`),sheet,template);}
  for(const ref of m.period.yearCells){const cell=grid.cells.get(remapRef(ref,at,delta));updateTitle(cell,textOf(cell,template.strings).replace(/20\d{2}(?=\s*년)/,String(options.year)),sheet,template);}
  for(const ref of m.period.monthCells){const cell=grid.cells.get(remapRef(ref,at,delta));putValue(cell,/월/.test(textOf(cell,template.strings))?`${options.month}월`:options.month,sheet);}
  // Keep formulas, but never show cached prior-month totals as new results.
  for(const f of all(sheet,'f')){const v=child(f.parentNode,'v');if(v)v.parentNode.removeChild(v);}
  const plan=planPages(sheet,area,m,{start:area.r,end:area.end.r});
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
  const browserPrintSafe=plan.settings.paperSize===9&&!['drawing','legacyDrawing','picture','headerFooter'].some(tag=>all(sheet,tag).some(n=>n.attributes.length||n.childNodes.length));
  const mapping={...m,dateColumns:targetColumns.map(d=>({...d})),area,period:{...m.period,
    titleCells:m.period.titleCells.map(ref=>remapRef(ref,at,delta)),
    yearCells:m.period.yearCells.map(ref=>remapRef(ref,at,delta)),
    monthCells:m.period.monthCells.map(ref=>remapRef(ref,at,delta))}};
  return {sheet,styles,area,mapping,plan,template,year:options.year,month:options.month,browserPrintSafe};
}
export function generateWorkbook(template,analysis,options){
  calendarMonth(options.year,options.month);
  const styles=template.styles.cloneNode(true),workbook=template.workbook.cloneNode(true),files={...template.entries};
  const results=analysis.sheets.map(m=>generateSheet(template,m,options,styles,workbook));
  const serialize=doc=>strToU8(new template.env.XMLSerializer().serializeToString(doc));
  for(const result of results)files[template.sheets[result.mapping.index].path]=serialize(result.sheet);
  let calc=child(workbook.documentElement,'calcPr');if(!calc){calc=create(workbook,'calcPr');workbook.documentElement.appendChild(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
  files['xl/workbook.xml']=serialize(workbook);files['xl/styles.xml']=serialize(styles);
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

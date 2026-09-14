import {zipSync,strToU8} from '../vendor/fflate-0.8.3.js';
import {openTemplate,calendarMonth,parseWeekdays,planPages,printDocument,all,child,children,
  attr,number,check,cellRef,range,address,textOf,indexSheet,areaFor,dateParts,putValue,
  mutableSheet,styleEngine,cellStyleId,mostCommon,updateTitle,ensureSheet,create,
  setNamedRange,namedRange,dimensions,colorHex} from './attendance-template.js';

export const RECOGNITION_ERROR='이 출석부 형식을 자동으로 인식하지 못했습니다.';
const rowValues=(grid,row,strings)=>[...grid.cells].filter(([ref])=>address(ref).r===row).map(([ref,c])=>({ref,c,value:textOf(c,strings).trim()}));
const chromatic=color=>{if(!/^#[\da-f]{6}$/i.test(color||''))return false;const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return Math.max(...rgb)-Math.min(...rgb)>15;};
const monthText=(name)=>/(20\d{2}|\d{2})[.\-_년]\s*(\d{1,2})(?:월|(?=[._\s-]|$))/.exec(name);
export function nextMonth(year,month){return month===12?{year:year+1,month:1}:{year,month:month+1};}
export function attendanceFilename(name,year,month){
  const m=monthText(name),mm=String(month).padStart(2,'0');
  return m?name.replace(m[0],m[0].replace(m[1],m[1].length===2?String(year).slice(-2):String(year)).replace(/([.\-_년]\s*)\d{1,2}/,`$1${mm}`)):`${name.replace(/\.xlsx$/i,'')}_${year}.${mm}.xlsx`;
}
function dateGrid(template,sheet,grid,area){
  const value=(c,r)=>textOf(grid.cells.get(cellRef(c,r)),template.strings).trim();
  const day=(c,r)=>dateParts(value(c,r),template.epoch1904)?.day||Number(value(c,r).replace(/일$/,''));
  const found=[];
  for(let r=area.r;r<=Math.min(40,area.end.r);r++)for(let c=area.c;c<=area.end.c-27;c++){
    if(day(c,r)!==1||c>area.c&&day(c-1,r)===1)continue;
    let previous=0;const columns=[];
    for(let x=c;x<=area.end.c;x++){
      const d=day(x,r);if(d<1||d>31||(d!==previous&&d!==previous+1))break;
      columns.push({c:x,day:d,slot:d===previous?columns.at(-1).slot+1:0});previous=d;
    }
    if(previous<28)continue;
    // Only reuse existing blank, styled tail cells. Never consume a summary column.
    for(let d=previous+1;d<=31;d++){
      const x=columns.at(-1).c+1,cell=grid.cells.get(cellRef(x,r));
      if(x>area.end.c||value(x,r)||!cell)break;
      columns.push({c:x,day:d,slot:0});
    }
    if(columns.at(-1).day!==31)continue;
    const weekdayRow=[r+1,r-1].find(w=>w>=area.r&&columns.filter(d=>/^[일월화수목금토](?:요일)?$/.test(value(d.c,w))).length>=14)||0;
    found.push({dateRow:r,dateStart:c,dateColumns:columns,weekdayRow});
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
function scheduleFill(template,sheet,grid,styles,m,block,row){
  const calendar=calendarMonth(m.period.year,m.period.month),selected=[],normal=[];
  for(const d of m.dateColumns){if(!calendar[d.day-1].active)continue;
    const c=grid.cells.get(cellRef(d.c,row)),id=cellStyleId(sheet,c,d.c),fill=number(styles.xf(id),'fillId',0),v=textOf(c,template.strings);
    const isLesson=block.weekdays.includes(calendar[d.day-1].weekdayIndex);
    (isLesson?selected:normal).push(fill);
    if(isLesson&&v)for(const cf of all(sheet,'conditionalFormatting')){
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
function generateSheet(template,m,options,styles,workbook){
  const sheet=template.read(template.sheets[m.index].path),grid=mutableSheet(sheet),se=styleEngine(styles,template);
  const originalSheet=template.read(template.sheets[m.index].path),originalGrid=indexSheet(originalSheet);
  const calendar=calendarMonth(options.year,options.month),oldCalendar=calendarMonth(m.period.year,m.period.month);
  for(const b of m.studentBlocks){
    const override=options.weekdays?.[b.id],weekdays=override?parseWeekdays(override):b.weekdays;
    check(!b.name||weekdays.length&&(!b.needsReview||override),'수업요일 확인이 필요한 학생이 있습니다.');
    for(let row=b.start;row<=b.end;row++){
      const fill=scheduleFill(template,sheet,grid,se,m,{...b,weekdays},row);
      const channel=b.channels.find(c=>c.offset===row-b.start),days=override?weekdays:channel?.weekdays||[];
      for(const d of m.dateColumns){
        const cell=grid.cell(d.c,row),cal=calendar[d.day-1];
        putValue(cell,'',sheet);
        const slotDays=override?days:d.slot===0?days:channel?.slots.find(s=>s.slot===d.slot)?.weekdays||[];
        const selected=b.name&&slotDays.includes(cal.weekdayIndex)&&cal.active;
        cell.setAttribute('s',String(se.withFill(number(cell,'s',0),selected?fill.lesson:fill.plain)));
      }
    }
  }
  // Empty roster rows still must not carry last month's marks into the new workbook.
  const covered=new Set(m.studentBlocks.flatMap(b=>Array.from({length:b.end-b.start+1},(_,i)=>b.start+i)));
  for(let r=m.firstStudentRow;r<=m.area.end.r;r++)if(!covered.has(r))for(const d of m.dateColumns)putValue(grid.cell(d.c,r),'',sheet);
  for(const d of m.dateColumns){
    const cal=calendar[d.day-1],header=grid.cell(d.c,m.dateRow),old=textOf(header,template.strings);
    const serial=dateParts(old,template.epoch1904);
    putValue(header,cal.active?(serial?(Date.UTC(options.year,options.month-1,d.day)-Date.UTC(template.epoch1904?1904:1899,template.epoch1904?0:11,template.epoch1904?1:30))/86400000:/일$/.test(old)?`${d.day}일`:d.day):'',sheet);
    if(m.weekdayRow){const cell=grid.cell(d.c,m.weekdayRow);
      const sample=m.dateColumns.find(col=>oldCalendar[col.day-1].active&&oldCalendar[col.day-1].weekdayIndex===cal.weekdayIndex);
      if(sample){const sampleCell=originalGrid.cells.get(cellRef(sample.c,m.weekdayRow));cell.setAttribute('s',String(cellStyleId(originalSheet,sampleCell,sample.c)));}
      putValue(cell,cal.active?cal.weekday:'',sheet);
    }
  }
  for(const ref of m.period.titleCells){const cell=grid.cells.get(ref),text=textOf(cell,template.strings);updateTitle(cell,text.replace(/20\d{2}\s*년\s*\d{1,2}\s*월/,`${options.year}년 ${options.month}월`).replace(/20\d{2}([./-])\d{1,2}/,`${options.year}$1${String(options.month).padStart(2,'0')}`),sheet,template);}
  for(const ref of m.period.yearCells){const cell=grid.cells.get(ref);updateTitle(cell,textOf(cell,template.strings).replace(/20\d{2}(?=\s*년)/,String(options.year)),sheet,template);}
  for(const ref of m.period.monthCells){const cell=grid.cells.get(ref);putValue(cell,/월/.test(textOf(cell,template.strings))?`${options.month}월`:options.month,sheet);}
  // Keep formulas, but never show cached prior-month totals as new results.
  for(const f of all(sheet,'f')){const v=child(f.parentNode,'v');if(v)v.parentNode.removeChild(v);}
  const plan=planPages(sheet,m.area,m,{start:m.area.r,end:m.area.end.r});
  const setup=ensureSheet(sheet,'pageSetup');if(!setup.hasAttribute('paperSize'))setup.setAttribute('paperSize','9');
  if(!setup.hasAttribute('orientation'))setup.setAttribute('orientation','landscape');
  if(plan.settings.fitWidth!==1||!plan.settings.fit&&plan.settings.scale>plan.width/plan.dimensions.width){
    setup.setAttribute('fitToWidth','1');setup.setAttribute('fitToHeight',plan.pages.length>1?'0':'1');
    const pr=ensureSheet(sheet,'sheetPr');let fit=child(pr,'pageSetUpPr');if(!fit){fit=create(sheet,'pageSetUpPr');pr.appendChild(fit);}fit.setAttribute('fitToPage','1');
  }
  if(plan.pages.length>1){
    const breaks=ensureSheet(sheet,'rowBreaks');while(breaks.firstChild)breaks.removeChild(breaks.firstChild);
    breaks.setAttribute('count',String(plan.pages.length-1));breaks.setAttribute('manualBreakCount',String(plan.pages.length-1));
    for(const page of plan.pages.slice(1))breaks.appendChild(create(sheet,'brk',{id:page.find(r=>r>=m.firstStudentRow)-1,min:m.area.c-1,max:m.area.end.c-1,man:1}));
    const quoted=`'${m.name.replace(/'/g,"''")}'`;
    const prior=namedRange(workbook,m.index,'_xlnm.Print_Titles')?.textContent||'';
    const repeatColumns=prior.split(',').filter(v=>/!\$?[A-Z]+:\$?[A-Z]+$/.test(v));
    setNamedRange(workbook,m.index,'_xlnm.Print_Titles',[`${quoted}!$${m.area.r}:$${m.firstStudentRow-1}`,...repeatColumns].join(','));
  }
  const colBreaks=child(sheet.documentElement,'colBreaks');if(colBreaks)colBreaks.parentNode.removeChild(colBreaks);
  const browserPrintSafe=plan.settings.paperSize===9&&!['drawing','legacyDrawing','picture','headerFooter'].some(tag=>all(sheet,tag).some(n=>n.attributes.length||n.childNodes.length));
  return {sheet,styles,area:m.area,mapping:m,plan,template,year:options.year,month:options.month,browserPrintSafe};
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

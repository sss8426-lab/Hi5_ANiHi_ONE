// 반별 출석부 Excel: one sheet per class, in the order the classes appear in the 종합입력 file, all in
// the official blue print design (출석부_출력용_A4가로). Written as plain OOXML so every style, border
// and print setting is exact; nothing is copied from the uploaded file except the data.
import {zipSync,strToU8} from '../vendor/fflate-0.8.3.js';
import {columnName} from './attendance-template.js?v=20260919-sparse-import';
import {monthColumns,plannedColumns,lessonCount,SLOT_ORDER} from './attendance-roster-schedule.js?v=20260924-roster';
import {holidaySummary} from './attendance-holidays.js?v=20260924-roster';

export const OUTPUT_HEADERS=['No','이름','학교','학년','학생연락처','학부모연락처','등록일','수업요일','일수'];
const INFO_WIDTHS=[3.5,6.5,7.5,3.5,8.5,9,6.5,10,4.5],DATE_WIDTH=2;
export const COLORS={title:'1F4E78',header:'5B9BD5',dateHeader:'D9EAF7',weekendHeader:'BDD7EE',planned:'B7CCE3',holiday:'8497B0',holidayBody:'D5DDE7',weekendBody:'F1F6FB',subtitle:'EAF2F8',text:'17365D',headerLine:'2F4A63',bodyLine:'8FA3B8',strongLine:'1F4E78',white:'FFFFFF',note:'4F6D8C'};
export const PRINT={paperSize:9,orientation:'landscape',fitToWidth:1,fitToHeight:0,margins:{left:0.15,right:0.15,top:0.22,bottom:0.22,header:0.1,footer:0.1},titleRows:[3,4]};
const FIRST_DATE_COLUMN=10,HEADER_ROWS=[3,4],FIRST_STUDENT_ROW=5;
// XML 1.0 forbids C0 control characters; drop them rather than write an unreadable workbook.
// eslint-disable-next-line no-control-regex
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');

/** Excel sheet names: ≤31 chars, none of : \ / ? * [ ], not starting/ending with ', unique (…(2)). */
export function sheetNames(names){
  const used=new Set(),out=[];
  for(const raw of names){
    let base=String(raw??'').replace(/[:\\/?*[\]]/g,'').replace(/^'+|'+$/g,'').replace(/\s+/g,' ').trim()||'반';
    base=[...base].slice(0,31).join('');
    let name=base,n=2;
    while(used.has(name.toLowerCase())){const suffix=`(${n++})`;name=[...base].slice(0,31-suffix.length).join('').trimEnd()+suffix;}
    used.add(name.toLowerCase());out.push(name);
  }
  return out;
}

/** Everything a sheet shows, shared by the Excel writer and the on-screen preview. */
export function planRosterWorkbook(roster,{year,month,holidays=new Map()}){
  const names=sheetNames(roster.classes.map(c=>c.name));
  const sheets=roster.classes.map((group,i)=>{
    const used=new Set(group.students.flatMap(s=>s.schedule?.slots||[]));
    const columns=monthColumns(year,month,SLOT_ORDER.filter(s=>used.has(s)),holidays);
    const students=group.students.map(s=>{const planned=plannedColumns(s.schedule,columns);return {...s,planned,count:lessonCount(s.schedule,planned)};});
    return {name:names[i],className:group.name,columns,students};
  });
  return {campus:roster.campus,year,month,holidays,sheets,holidayNote:holidaySummary(holidays)};
}

function styleBook(){
  const fonts=['<font><sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>'],fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'];
  const borders=['<border><left/><right/><top/><bottom/><diagonal/></border>'],xfs=['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index=(list,xml)=>{let i=list.indexOf(xml);if(i<0){list.push(xml);i=list.length-1;}return i;};
  const cache=new Map();
  function style({size=7,bold=false,italic=false,color=COLORS.text,fill=null,border=null,numFmt=0,h='center',wrap=false,shrink=false}={}){
    const key=JSON.stringify([size,bold,italic,color,fill,border,numFmt,h,wrap,shrink]);
    if(cache.has(key))return cache.get(key);
    const font=index(fonts,`<font>${bold?'<b/>':''}${italic?'<i/>':''}<sz val="${size}"/><color rgb="FF${color}"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>`);
    const fillId=fill?index(fills,`<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor indexed="64"/></patternFill></fill>`):0;
    const side=(name,s)=>s?`<${name} style="${s[0]}"><color rgb="FF${s[1]}"/></${name}>`:`<${name}/>`;
    const borderId=border?index(borders,`<border>${side('left',border.l)}${side('right',border.r)}${side('top',border.t)}${side('bottom',border.b)}<diagonal/></border>`):0;
    const align=`<alignment horizontal="${h}" vertical="center"${wrap?' wrapText="1"':''}${shrink?' shrinkToFit="1"':''}/>`;
    xfs.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
    cache.set(key,xfs.length-1);return xfs.length-1;
  }
  function xml(){
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="176" formatCode="yy\\-mm\\-dd"/><numFmt numFmtId="177" formatCode=";;;"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FF${COLORS.planned}"/><bgColor rgb="FF${COLORS.planned}"/></patternFill></fill></dxf></dxfs></styleSheet>`;
  }
  return {style,xml};
}

// Every table cell gets all four borders. Header lines are darker than body lines; the I|J edge
// (student info | dates) and the table's outline are one step heavier.
function borderFor(c,r,{lastColumn,lastRow}){
  const header=r<=HEADER_ROWS[1],line=header?COLORS.headerLine:COLORS.bodyLine,thin=['thin',line],strong=['medium',COLORS.strongLine];
  return {l:c===1||c===FIRST_DATE_COLUMN?strong:thin,r:c===lastColumn||c===FIRST_DATE_COLUMN-1?strong:thin,t:r===HEADER_ROWS[0]?strong:thin,b:r===lastRow?strong:header&&r===HEADER_ROWS[1]?['thin',COLORS.headerLine]:thin};
}

function sheetXml(sheet,plan,styles,sheetIndex){
  const {columns,students}=sheet,lastColumn=FIRST_DATE_COLUMN+columns.length-1,lastRow=FIRST_STUDENT_ROW+Math.max(students.length,1)-1;
  const last=columnName(lastColumn),rows=[],merges=[];
  const cell=(c,r,value,s,type)=>{
    const ref=`${columnName(c)}${r}`;
    if(value===null||value===undefined||value==='')return `<c r="${ref}" s="${s}"/>`;
    if(type==='formula')return `<c r="${ref}" s="${s}" t="str"><f>${esc(value.formula)}</f><v>${esc(value.cached)}</v></c>`;
    if(typeof value==='number')return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  };
  const row=(r,height,cells)=>rows.push(`<row r="${r}" ht="${height}" customHeight="1">${cells.join('')}</row>`);
  const span=(r,value,s)=>Array.from({length:lastColumn},(_,i)=>cell(i+1,r,i?null:value,s));
  const titleStyle=styles.style({size:15,bold:true,color:COLORS.white,fill:COLORS.title,border:{l:['medium',COLORS.strongLine],r:['medium',COLORS.strongLine],t:['medium',COLORS.strongLine],b:['medium',COLORS.strongLine]}});
  row(1,24,span(1,`${plan.year}년 ${plan.month}월 ${sheet.className} 출석부`,titleStyle));merges.push(`A1:${last}1`);
  const subStyle=styles.style({size:8,bold:true,fill:COLORS.subtitle,h:'left',border:{l:['thin',COLORS.headerLine],r:['thin',COLORS.headerLine],t:['thin',COLORS.headerLine],b:['thin',COLORS.headerLine]}});
  row(2,14,span(2,`${plan.campus}  |  학생 ${students.length}명`,subStyle));merges.push(`A2:${last}2`);
  for(const r of HEADER_ROWS){
    const cells=[];
    OUTPUT_HEADERS.forEach((title,i)=>cells.push(cell(i+1,r,r===HEADER_ROWS[0]?title:null,styles.style({size:7,bold:true,color:COLORS.white,fill:COLORS.header,wrap:true,border:borderFor(i+1,r,{lastColumn,lastRow})}))));
    columns.forEach((col,i)=>{
      const c=FIRST_DATE_COLUMN+i,fill=col.holiday?COLORS.holiday:col.weekend?COLORS.weekendHeader:COLORS.dateHeader;
      const s=styles.style({size:6.5,bold:true,color:col.holiday?COLORS.white:COLORS.text,fill,shrink:true,border:borderFor(c,r,{lastColumn,lastRow})});
      cells.push(cell(c,r,r===HEADER_ROWS[0]?col.day:col.holiday?'휴':col.label,s));
    });
    row(r,11,cells);
  }
  for(let i=1;i<=9;i++)merges.push(`${columnName(i)}${HEADER_ROWS[0]}:${columnName(i)}${HEADER_ROWS[1]}`);
  const range=`$${columnName(FIRST_DATE_COLUMN)}{r}:$${last}{r}`;
  students.forEach((s,index)=>{
    const r=FIRST_STUDENT_ROW+index,b=c=>borderFor(c,r,{lastColumn,lastRow});
    const text=(c,h='center')=>styles.style({size:7,h,shrink:true,border:b(c)});
    const reg=s.registered;
    // 일수 is a live formula (4주 기준 ± 이 달의 실제 예정수업) with the same value cached, so it opens
    // correct and stays correct when a planned cell is changed by hand.
    const tokens=SLOT_ORDER.map(t=>`--ISNUMBER(SEARCH("${t}",$H${r}))`).join('+'),count=`COUNTIF(${range.replaceAll('{r}',r)},1)`;
    const formula=`TEXT(4*(${tokens}),"0")&IF(${count}=4*(${tokens}),"",IF(${count}>4*(${tokens}),"+","")&TEXT(${count}-4*(${tokens}),"0"))`;
    const cells=[cell(1,r,s.no,text(1)),cell(2,r,s.name,text(2)),cell(3,r,s.school,text(3)),cell(4,r,s.grade,text(4)),
      cell(5,r,s.studentPhone,text(5)),cell(6,r,s.parentPhone,text(6)),
      reg?.serial?cell(7,r,reg.serial,styles.style({size:7,numFmt:176,shrink:true,border:b(7)})):cell(7,r,reg?.text||'',text(7)),
      cell(8,r,s.schedule?.slots.join('')||s.scheduleText,text(8)),
      cell(9,r,{formula,cached:s.count.label},styles.style({size:7,bold:true,color:COLORS.title,shrink:true,border:b(9)}),'formula')];
    columns.forEach((col,i)=>{
      const c=FIRST_DATE_COLUMN+i;
      // A planned lesson: value 1 (counted by 일수) hidden by the ";;;" format — only the blue shows.
      if(s.planned[i])cells.push(cell(c,r,1,styles.style({size:6,numFmt:177,fill:COLORS.planned,border:b(c)})));
      else cells.push(cell(c,r,null,styles.style({size:6,fill:col.holiday?COLORS.holidayBody:col.weekend?COLORS.weekendBody:null,border:b(c)})));
    });
    row(r,11,cells);
  });
  if(!students.length)row(FIRST_STUDENT_ROW,11,Array.from({length:lastColumn},(_,i)=>cell(i+1,FIRST_STUDENT_ROW,null,styles.style({size:7,border:borderFor(i+1,FIRST_STUDENT_ROW,{lastColumn,lastRow})}))));
  const noteStyle=styles.style({size:6.5,italic:true,color:COLORS.note,h:'left'});
  let noteRow=lastRow+1;
  row(noteRow,11,span(noteRow,'파란색 = 예정 수업 · 일수 = 4주 기준 수업수 ± 이 달 실제 예정 수업 차이 · A4 가로 1페이지 폭, 학생이 많으면 세로 다음 장',noteStyle));merges.push(`A${noteRow}:${last}${noteRow}`);
  if(plan.holidayNote){noteRow++;row(noteRow,11,span(noteRow,`공휴일·휴무: ${plan.holidayNote}`,noteStyle));merges.push(`A${noteRow}:${last}${noteRow}`);}
  const cols=[...INFO_WIDTHS.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`),columns.length?`<col min="${FIRST_DATE_COLUMN}" max="${lastColumn}" width="${DATE_WIDTH}" customWidth="1"/>`:''].join('');
  const plannedRef=`${columnName(FIRST_DATE_COLUMN)}${FIRST_STUDENT_ROW}:${last}${lastRow}`;
  const m=PRINT.margins;
  return {lastColumn,lastRow:noteRow,xml:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${noteRow}"/><sheetViews><sheetView showGridLines="0"${sheetIndex===0?' tabSelected="1"':''} workbookViewId="0"><pane xSplit="9" ySplit="4" topLeftCell="${columnName(FIRST_DATE_COLUMN)}${FIRST_STUDENT_ROW}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${columnName(FIRST_DATE_COLUMN)}${FIRST_STUDENT_ROW}" sqref="${columnName(FIRST_DATE_COLUMN)}${FIRST_STUDENT_ROW}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="11"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${columns.length?`<conditionalFormatting sqref="${plannedRef}"><cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>1</formula></cfRule></conditionalFormatting>`:''}<printOptions horizontalCentered="1"/><pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/><pageSetup paperSize="${PRINT.paperSize}" orientation="${PRINT.orientation}" fitToWidth="${PRINT.fitToWidth}" fitToHeight="${PRINT.fitToHeight}"/></worksheet>`};
}

const quoteSheet=name=>`'${name.replace(/'/g,"''")}'`;
/** @returns {{bytes:Uint8Array,filename:string,plan:object}} */
export function buildRosterWorkbook(roster,options){
  const plan=planRosterWorkbook(roster,options),styles=styleBook();
  const sheets=plan.sheets.map((sheet,i)=>({...sheetXml(sheet,plan,styles,i),name:sheet.name}));
  const defined=sheets.flatMap((s,i)=>[
    `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(quoteSheet(s.name))}!$A$1:$${columnName(s.lastColumn)}$${s.lastRow}</definedName>`,
    `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoteSheet(s.name))}!$${PRINT.titleRows[0]}:$${PRINT.titleRows[1]}</definedName>`]).join('');
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    'docProps/app.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HI5·ANiHi CORE</Application></Properties>',
    'docProps/core.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(`${plan.campus} ${plan.year}년 ${plan.month}월 반별 출석부`)}</dc:title><dc:creator>HI5·ANiHi CORE</dc:creator></cp:coreProperties>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${esc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${defined}</definedNames><calcPr calcId="191029"/></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':styles.xml(),
  };
  sheets.forEach((s,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=s.xml;});
  const bytes=zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])),{level:6});
  const safeCampus=String(plan.campus).replace(/[\\/:*?"<>|]/g,'').trim()||'캠퍼스';
  return {bytes,filename:`${safeCampus}_${plan.year}년${String(plan.month).padStart(2,'0')}월_반별출석부.xlsx`,plan};
}

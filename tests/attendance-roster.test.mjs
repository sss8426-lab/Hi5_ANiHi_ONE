import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {unzipSync,strFromU8,strToU8,zipSync} from '../public/data-core/vendor/fflate-0.8.3.js';
import {rosterFixture,defaultClasses} from './helpers/attendance-roster-fixture.mjs';
import {parseRoster,RosterError} from '../public/data-core/work/attendance-roster-parser.js';
import {parseSchedule,monthColumns,plannedColumns,lessonCount,ScheduleError} from '../public/data-core/work/attendance-roster-schedule.js';
import {buildRosterWorkbook,planRosterWorkbook,sheetNames,OUTPUT_HEADERS,COLORS,PRINT} from '../public/data-core/work/attendance-roster-export.js';
import {holidayDates,fetchHolidays,holidaySummary} from '../public/data-core/work/attendance-holidays.js';
import {columnName} from '../public/data-core/work/attendance-template.js';

const env={DOMParser,XMLSerializer};
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const student=(name,schedule,extra={})=>({name,schedule,school:'가상고',grade:'1',studentPhone:'010-0000-0000',parentPhone:'010-1111-1111',registered:46027,...extra});
const parse=options=>parseRoster(rosterFixture(options).bytes,env);

// ---------- reading the generated workbook ----------
function openOutput(bytes){
  const files=unzipSync(bytes),xml=p=>new DOMParser().parseFromString(strFromU8(files[p]),'text/xml');
  const els=(doc,name)=>[...doc.getElementsByTagNameNS(MAIN,name)];
  const styles=xml('xl/styles.xml'),workbook=xml('xl/workbook.xml');
  const numFmts=new Map(els(styles,'numFmt').map(n=>[n.getAttribute('numFmtId'),n.getAttribute('formatCode')]));
  const fills=els(els(styles,'fills')[0],'fill').map(f=>els(f,'fgColor')[0]?.getAttribute('rgb')||null);
  const borders=els(els(styles,'borders')[0],'border').map(b=>Object.fromEntries(['left','right','top','bottom'].map(s=>{const e=els(b,s)[0];return [s,e?.getAttribute('style')||null];})));
  const xfs=els(els(styles,'cellXfs')[0],'xf').map(x=>({numFmt:numFmts.get(x.getAttribute('numFmtId'))??x.getAttribute('numFmtId'),fill:fills[Number(x.getAttribute('fillId'))],border:borders[Number(x.getAttribute('borderId'))]}));
  const sheets=els(workbook,'sheet').map((s,i)=>{
    const doc=xml(`xl/worksheets/sheet${i+1}.xml`),cells=new Map();
    for(const c of els(doc,'c')){
      const t=c.getAttribute('t'),v=els(c,'v')[0]?.textContent,is=els(c,'t')[0]?.textContent;
      cells.set(c.getAttribute('r'),{value:t==='inlineStr'?is:v??'',formula:els(c,'f')[0]?.textContent||'',style:xfs[Number(c.getAttribute('s')||0)]});
    }
    const setup=els(doc,'pageSetup')[0],fit=els(doc,'pageSetUpPr')[0];
    return {name:s.getAttribute('name'),doc,cells,setup,fit,at:ref=>cells.get(ref)};
  });
  const defined=els(workbook,'definedName').map(d=>({name:d.getAttribute('name'),sheet:Number(d.getAttribute('localSheetId')),ref:d.textContent}));
  return {sheets,defined,files};
}

// ---------- parsing ----------
test('10 class bars become 10 classes in input order, each with its own students', ()=>{
  const classes=defaultClasses(10,10),roster=parse({classes});
  assert.equal(roster.campus,'SYNTHETIC 캠퍼스');
  assert.equal(roster.classes.length,10);
  assert.deepEqual(roster.classes.map(c=>c.name),classes.map(c=>c.name));
  roster.classes.forEach((c,i)=>assert.deepEqual(c.students.map(s=>s.name),classes[i].students.map(s=>s.name)));
  assert.equal(roster.studentCount,100);
  assert.deepEqual(roster.issues,[]);assert.deepEqual(roster.warnings,[]);
});

test('students are split by the bar above them, with uneven class sizes', ()=>{
  const roster=parse({classes:[{name:'A반',students:[student('가','월')]},{name:'B반',students:[student('나','화'),student('다','수'),student('라','목')]},{name:'C반',students:[student('마','금'),student('바','토1')]}]});
  assert.deepEqual(roster.classes.map(c=>[c.name,c.students.map(s=>s.name)]),[['A반',['가']],['B반',['나','다','라']],['C반',['마','바']]]);
});

test('phone numbers keep their leading 0, as text or as a numeric cell Excel stripped', ()=>{
  const roster=parse({classes:[{name:'A반',students:[
    student('가','월',{studentPhone:'010-1234-5678',parentPhone:'01098765432'}),
    student('나','월',{studentPhone:1012345678,parentPhone:1098765432}),
  ]}]});
  const [a,b]=roster.classes[0].students;
  assert.equal(a.studentPhone,'010-1234-5678');assert.equal(a.parentPhone,'01098765432');
  assert.equal(b.studentPhone,'01012345678');assert.equal(b.parentPhone,'01098765432');
  const out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9}).bytes).sheets[0];
  assert.equal(out.at('E5').value,'010-1234-5678');assert.equal(out.at('E6').value,'01012345678');assert.equal(out.at('F6').value,'01098765432');
});

test('등록일 stays a real date shown as yy-mm-dd', ()=>{
  const roster=parse({classes:[{name:'A반',students:[student('가','월',{registered:46027}),student('나','월',{registered:'2026.02.14'})]}]});
  assert.equal(roster.classes[0].students[0].registered.iso,'2026-01-05');
  assert.equal(roster.classes[0].students[1].registered.iso,'2026-02-14');
  const out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9}).bytes).sheets[0];
  assert.equal(out.at('G5').value,'46027');assert.equal(out.at('G5').style.numFmt,'yy\\-mm\\-dd');
});

// ---------- 수업요일 ----------
test('수업요일 reads exact slots; weekends need their time number', ()=>{
  assert.deepEqual(parseSchedule('화목토2일1').slots,['화','목','토2','일1']);
  assert.deepEqual(parseSchedule('토1토3').slots,['토1','토3']);
  assert.deepEqual(parseSchedule('금, 월 수').slots,['월','수','금']);
  for(const bad of ['토','토토','일일','일','토4','화목토','월월','','월x']){
    assert.throws(()=>parseSchedule(bad),ScheduleError,bad);
  }
  assert.throws(()=>parseSchedule('토토'),/타임 번호/);
  assert.throws(()=>parseSchedule('토4'),/타임 번호/);
});

test('화목토2일1 marks only 화·목·토2·일1 columns', ()=>{
  const schedule=parseSchedule('화목토2일1'),columns=monthColumns(2026,9,schedule.slots);
  assert.deepEqual([...new Set(columns.filter(c=>c.weekend).map(c=>c.slot))],['토2','일1']);
  const planned=plannedColumns(schedule,columns);
  const slots=[...new Set(columns.filter((_,i)=>planned[i]).map(c=>c.slot))].sort();
  assert.deepEqual(slots,['목','일1','토2','화'].sort());
  assert.ok(columns.every((c,i)=>!['월','수','금'].includes(c.slot)||!planned[i]));
});

test('토1토3 leaves 토2 unplanned even when a classmate uses 토2', ()=>{
  const roster=parse({classes:[{name:'주말반',students:[student('가','토1토3'),student('나','토2')]}]});
  const sheet=planRosterWorkbook(roster,{year:2026,month:9}).sheets[0];
  assert.deepEqual([...new Set(sheet.columns.filter(c=>c.weekend).map(c=>c.slot))],['토1','토2','토3']);
  const [a,b]=sheet.students,slotsOf=s=>[...new Set(sheet.columns.filter((_,i)=>s.planned[i]).map(c=>c.slot))];
  assert.deepEqual(slotsOf(a),['토1','토3']);assert.deepEqual(slotsOf(b),['토2']);
  // A class without 토2 users gets no 토2 column at all.
  const only=planRosterWorkbook(parse({classes:[{name:'주말반',students:[student('가','토1토3')]}]}),{year:2026,month:9}).sheets[0];
  assert.ok(!only.columns.some(c=>c.slot==='토2'));
  assert.equal(only.columns.filter(c=>c.day===5).map(c=>c.label).join(),'토1,토3');
});

test('일수 is the 4-week base with the month difference: 12, 12+2, 12-1', ()=>{
  // September 2026 with 9/24(목) as a holiday: 월4 금4 토4 → 12, 화5 수5 토4 → 14, 목3 금4 토4 → 11.
  const holidays=new Map([['2026-09-24','SYNTHETIC 휴무']]);
  const roster=parse({classes:[{name:'A반',students:[student('가','월금토1'),student('나','화수토1'),student('다','목금토1')]}]});
  const plan=planRosterWorkbook(roster,{year:2026,month:9,holidays});
  assert.deepEqual(plan.sheets[0].students.map(s=>s.count.label),['12','12+2','12-1']);
  assert.deepEqual(lessonCount({weekly:3},[true,true]),{base:12,actual:2,diff:-10,label:'12-10'});
  const out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9,holidays}).bytes).sheets[0];
  assert.deepEqual(['I5','I6','I7'].map(r=>out.at(r).value),['12','12+2','12-1']);
  assert.match(out.at('I5').formula,/^TEXT\(4\*\(/);assert.match(out.at('I5').formula,/COUNTIF\(\$J5:\$[A-Z]+5,1\)/);
});

test('holidays come from CORE calendar events: no planned lesson, a blue-gray 휴 header', async()=>{
  const events=[
    {campusId:null,title:'추석 연휴',metadata:{eventType:'holiday',startDate:'2026-09-24',endDate:'2026-09-26'}},
    {campusId:'campus-a',title:'캠퍼스 휴무',metadata:{eventType:'holiday',startDate:'2026-09-07'}},
    {campusId:'campus-b',title:'다른 캠퍼스',metadata:{eventType:'holiday',startDate:'2026-09-08'}},
    {campusId:null,title:'시험',metadata:{eventType:'exam',startDate:'2026-09-10'}},
    {campusId:null,title:'지난달',metadata:{eventType:'holiday',startDate:'2026-08-30',endDate:'2026-09-01'}},
  ];
  const map=holidayDates(events,{year:2026,month:9,campusId:'campus-a'});
  assert.deepEqual([...map.keys()].sort(),['2026-09-01','2026-09-07','2026-09-24','2026-09-25','2026-09-26']);
  assert.equal(holidaySummary(map),'9/1 지난달 · 9/7 캠퍼스 휴무 · 9/24~26 추석 연휴');
  const calls=[];
  const fetchImpl=async url=>{calls.push(url);const page=calls.length;return {ok:true,json:async()=>page===1?{events:events.slice(0,2),hasMore:true,nextCursor:'c1'}:{events:events.slice(2),hasMore:false}};};
  const fetched=await fetchHolidays({year:2026,month:9,campusId:'campus-a',fetchImpl});
  assert.equal(calls.length,2);assert.match(calls[0],/from=2026-09-01&to=2026-09-30&eventType=holiday/);assert.match(calls[1],/cursor=c1/);
  assert.deepEqual([...fetched.keys()].sort(),[...map.keys()].sort());
  await assert.rejects(fetchHolidays({year:2026,month:9,fetchImpl:async()=>({ok:false,json:async()=>({error:'권한 없음'})})}),/권한 없음/);

  const roster=parse({classes:[{name:'A반',students:[student('가','목금토1토2')]}]});
  const out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9,holidays:map}).bytes).sheets[0];
  const plan=planRosterWorkbook(roster,{year:2026,month:9,holidays:map}).sheets[0];
  plan.columns.forEach((col,i)=>{
    const ref=`${columnName(10+i)}`;
    if(!col.holiday)return;
    assert.equal(out.at(ref+'4').value,'휴');assert.equal(out.at(ref+'4').style.fill,'FF'+COLORS.holiday);
    assert.equal(out.at(ref+'5').value,'',`${col.date} ${col.slot} must not be planned`);
  });
  assert.equal(plan.columns.filter(c=>c.day===26).length,2,'휴 Saturday keeps both used slots');
  assert.match([...out.cells.values()].map(c=>c.value).join('|'),/공휴일·휴무: 9\/1 지난달/);
});

// ---------- workbook structure ----------
test('one sheet per class, in input order, with the official headers', ()=>{
  const classes=defaultClasses(10,10),roster=parse({classes});
  const {bytes,filename}=buildRosterWorkbook(roster,{year:2026,month:9});
  assert.equal(filename,'SYNTHETIC 캠퍼스_2026년09월_반별출석부.xlsx');
  const out=openOutput(bytes);
  assert.equal(out.sheets.length,10);
  assert.deepEqual(out.sheets.map(s=>s.name),classes.map(c=>c.name));
  for(const [i,sheet] of out.sheets.entries()){
    assert.equal(sheet.at('A1').value,`2026년 9월 ${classes[i].name} 출석부`);
    assert.equal(sheet.at('A1').style.fill,'FF'+COLORS.title);
    assert.deepEqual(OUTPUT_HEADERS.map((_,c)=>sheet.at(`${columnName(c+1)}3`).value),['No','이름','학교','학년','학생연락처','학부모연락처','등록일','수업요일','일수']);
    assert.equal(sheet.at('A3').style.fill,'FF'+COLORS.header);
    assert.equal(sheet.at('J3').value,'1');assert.equal(sheet.at('J4').value,'화');
    assert.equal(sheet.at('J3').style.fill,'FF'+COLORS.dateHeader);
    const days=[...sheet.cells.entries()].filter(([ref])=>/^[A-Z]+3$/.test(ref)).map(([,c])=>Number(c.value)).filter(Number.isFinite);
    assert.equal(days[0],1);assert.equal(Math.max(...days),30);
    // Student rows follow the input order.
    classes[i].students.forEach((s,k)=>assert.equal(sheet.at(`B${5+k}`).value,s.name));
  }
  // Weekend headers use the weekend color and carry their slot label.
  const weekend=planRosterWorkbook(roster,{year:2026,month:9}).sheets[0].columns.findIndex(c=>c.weekend);
  const ref=columnName(10+weekend);
  assert.equal(out.sheets[0].at(ref+'3').style.fill,'FF'+COLORS.weekendHeader);assert.match(out.sheets[0].at(ref+'4').value,/^[토일][1-3]$/);
});

test('planned cells hold a hidden 1 (;;; format) on the blue fill; unplanned cells are empty', ()=>{
  const roster=parse({classes:[{name:'A반',students:[student('가','화목토2일1')]}]});
  const plan=planRosterWorkbook(roster,{year:2026,month:9}).sheets[0],out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9}).bytes).sheets[0];
  plan.columns.forEach((col,i)=>{
    const c=out.at(`${columnName(10+i)}5`);
    if(plan.students[0].planned[i]){assert.equal(c.value,'1');assert.equal(c.style.numFmt,';;;');assert.equal(c.style.fill,'FF'+COLORS.planned);}
    else{assert.equal(c.value,'');assert.notEqual(c.style.fill,'FF'+COLORS.planned);}
  });
  assert.equal(plan.students[0].planned.filter(Boolean).length,[...out.cells.values()].filter(c=>c.value==='1'&&c.style.numFmt===';;;').length);
});

test('every table cell has all four borders; the I|J edge and outline are heavier', ()=>{
  const roster=parse({classes:defaultClasses(2,7)});
  const out=openOutput(buildRosterWorkbook(roster,{year:2026,month:9}).bytes);
  for(const sheet of out.sheets){
    const lastColumn=Math.max(...[...sheet.cells.keys()].filter(r=>/^[A-Z]+3$/.test(r)).map(r=>r.slice(0,-1)).map(n=>[...n].reduce((a,ch)=>a*26+ch.charCodeAt(0)-64,0)));
    for(let r=1;r<=4+7;r++)for(let c=1;c<=lastColumn;c++){
      const ref=columnName(c)+r,cell=sheet.at(ref);
      assert.ok(cell,`${sheet.name}!${ref} exists`);
      for(const side of ['left','right','top','bottom'])assert.ok(cell.style.border[side],`${sheet.name}!${ref} ${side}`);
    }
    assert.equal(sheet.at('I5').style.border.right,'medium');assert.equal(sheet.at('J5').style.border.left,'medium');
    assert.equal(sheet.at('A6').style.border.left,'medium');assert.equal(sheet.at(columnName(lastColumn)+'6').style.border.right,'medium');
    assert.equal(sheet.at('C11').style.border.bottom,'medium');assert.equal(sheet.at('C3').style.border.top,'medium');
    assert.equal(sheet.at('C6').style.border.left,'thin');
  }
});

test('A4 landscape, 1 page wide, open height, rows 3–4 repeated, no horizontal page split', ()=>{
  const roster=parse({classes:[...defaultClasses(3,5),{name:'대형반',students:Array.from({length:60},(_,i)=>student(`대형${i+1}`,'월화수목금토1토2토3일1일2일3'))}]});
  const {bytes}=buildRosterWorkbook(roster,{year:2026,month:8});
  const out=openOutput(bytes);
  out.sheets.forEach((sheet,i)=>{
    assert.equal(sheet.setup.getAttribute('paperSize'),'9');
    assert.equal(sheet.setup.getAttribute('orientation'),'landscape');
    assert.equal(sheet.setup.getAttribute('fitToWidth'),'1');
    assert.equal(sheet.setup.getAttribute('fitToHeight'),'0');
    assert.equal(sheet.fit.getAttribute('fitToPage'),'1');
    const margins=sheet.doc.getElementsByTagNameNS(MAIN,'pageMargins')[0];
    assert.deepEqual(['left','right','top','bottom'].map(k=>Number(margins.getAttribute(k))),[0.15,0.15,0.22,0.22]);
    assert.equal(sheet.doc.getElementsByTagNameNS(MAIN,'colBreaks').length,0,'no manual vertical page breaks');
    const titles=out.defined.find(d=>d.name==='_xlnm.Print_Titles'&&d.sheet===i);
    assert.equal(titles.ref,`'${sheet.name}'!$3:$4`);
    const area=out.defined.find(d=>d.name==='_xlnm.Print_Area'&&d.sheet===i);
    assert.match(area.ref,new RegExp(`^'${sheet.name}'!\\$A\\$1:\\$[A-Z]+\\$\\d+$`));
  });
  assert.deepEqual(PRINT,{paperSize:9,orientation:'landscape',fitToWidth:1,fitToHeight:0,margins:{left:0.15,right:0.15,top:0.22,bottom:0.22,header:0.1,footer:0.1},titleRows:[3,4]});
  // The widest possible month (31 days, every weekend slot) stays narrow enough for 1-page-wide fitting.
  const cols=[...out.sheets[3].doc.getElementsByTagNameNS(MAIN,'col')].reduce((n,c)=>n+(Number(c.getAttribute('max'))-Number(c.getAttribute('min'))+1)*Number(c.getAttribute('width')),0);
  assert.ok(cols<400,`total width ${cols}`);
  assert.equal(out.sheets[3].at('B64').value,'대형60');
});

test('sheet names are Excel-safe: ≤31 chars, no : \\ / ? * [ ], duplicates numbered', ()=>{
  assert.deepEqual(sheetNames(['A/B반','A:B반','[주말]반?','가'.repeat(40),'가'.repeat(40),'  ','반']),['AB반','AB반(2)','주말반','가'.repeat(31),'가'.repeat(28)+'(2)','반','반(2)']);
  const roster=parse({classes:[{name:'토/일 반',students:[student('가','토1')]},{name:'토일 반',students:[student('나','토1')]}]});
  assert.deepEqual(openOutput(buildRosterWorkbook(roster,{year:2026,month:9}).bytes).sheets.map(s=>s.name),['토일 반','토일 반(2)']);
});

// ---------- errors ----------
test('clear errors for broken input files', ()=>{
  assert.throws(()=>parseRoster(strToU8('not a zip'),env),e=>e instanceof RosterError&&/xlsx/.test(e.message));
  const wrongHeader=[...defaultClasses(1,1)];
  assert.throws(()=>parse({headers:['No','이름','학교']}),e=>e instanceof RosterError&&/헤더/.test(e.message));
  assert.throws(()=>parse({headers:['No','이름','학교','학년','학생 전화번호','학부모 전화번호','등록일','요일','월','화','수','목','금','토(1)','토(2)','토(3)','일(1)','일(2)','일(3)','총횟수','비고']}),/H열 "수업요일"/);
  assert.throws(()=>parse({campus:null,classes:wrongHeader}),e=>e instanceof RosterError&&/캠퍼스명/.test(e.message));
  assert.throws(()=>parse({classes:[]}),e=>e instanceof RosterError&&/반 구분 바/.test(e.message));
  // A workbook with no 종합입력 header anywhere.
  const files=unzipSync(rosterFixture().bytes);
  files['xl/worksheets/sheet1.xml']=strToU8(`<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>메모</t></is></c></row></sheetData></worksheet>`);
  assert.throws(()=>parseRoster(zipSync(files),env),/헤더/);
});

test('row problems are listed with their row numbers instead of silently guessing', ()=>{
  const roster=parse({classes:[
    {name:'A반',students:[student('가','토'),student('나','토토'),student('다','일일'),student('라','토4'),student('','월'),student('마','화목')]},
    {name:'빈반',students:[]},
    {name:'C반',students:[student('바','수')]},
  ]});
  const messages=roster.issues.map(i=>`${i.name||''}:${i.message}`);
  assert.equal(roster.issues.length,6,messages.join('\n'));
  assert.match(messages[0],/^가:.*타임 번호/);assert.match(messages[1],/^나:.*타임 번호/);assert.match(messages[2],/^다:.*타임 번호/);
  assert.match(messages[3],/^라:.*토4/);assert.match(messages[4],/이름\(B열\)이 비어/);
  assert.match(messages[5],/"빈반" 반 아래에 학생이 없습니다/);
  assert.ok(roster.issues.every(i=>Number.isInteger(i.row)&&i.row>4));
  assert.deepEqual(roster.classes.find(c=>c.name==='A반').students.at(-1).schedule.slots,['화','목']);
});

test('an unmerged class bar still reads, with a warning; check marks that disagree only warn', ()=>{
  const roster=parse({mergeBars:false,classes:[{name:'A반',students:[student('가','월')]}]});
  assert.equal(roster.classes.length,1);assert.match(roster.warnings[0],/병합되지 않은 반 구분 바/);
  const files=unzipSync(rosterFixture({classes:[{name:'A반',students:[student('가','월수')]}]}).bytes);
  const xml=strFromU8(files['xl/worksheets/sheet1.xml']).replace(/<c r="K6"[^>]*>.*?<\/c>/,'').replace('</row></sheetData>','<c r="L6"><v>1</v></c></row></sheetData>');
  files['xl/worksheets/sheet1.xml']=strToU8(xml);
  const checked=parseRoster(zipSync(files),env);
  assert.deepEqual(checked.issues,[]);assert.match(checked.warnings.join(),/체크칸\(월목\)과 수업요일\(월수\)/);
  assert.deepEqual(checked.classes[0].students[0].schedule.slots,['월','수']);
});

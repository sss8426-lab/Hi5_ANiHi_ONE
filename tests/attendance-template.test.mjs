import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {attendanceFixture} from './helpers/attendance-fixture.mjs';
import {openTemplate,analyzeSheet,templateStudents,generateAttendance,calendarMonth,parseWeekdays,renderTable,printDocument} from '../public/data-core/work/attendance-template.js';
import {unzipSync,zipSync,strFromU8,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';

const env={DOMParser,XMLSerializer};
const list=(doc,tag)=>Array.from(doc.getElementsByTagNameNS('*',tag));
const cell=(doc,ref)=>list(doc,'c').find(n=>n.getAttribute('r')===ref);
const value=(doc,ref)=>list(cell(doc,ref),'t').map(n=>n.textContent).join('')||list(cell(doc,ref),'v')[0]?.textContent||'';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(fixture={},options={})=>{const source=attendanceFixture(fixture),t=openTemplate(source,env),m=analyzeSheet(t,0);return {source,t,m,r:generateAttendance(t,m,{year:2026,month:10,...options})};};
const mutate=(source,path,change)=>{const files=unzipSync(source);files[path]=strToU8(change(strFromU8(files[path])));return zipSync(files);};

test('20/30 students: clone original workbook, fixed 31 columns, A4 single page and original style/print preservation',()=>{
  for(const students of [20,30]){
    const source=attendanceFixture({students,formula:true}),before=hash(source),t=openTemplate(source,env),m=analyzeSheet(t,0);
    const r=generateAttendance(t,m,{year:2026,month:10});const after=openTemplate(r.bytes,env);
    assert.equal(hash(source),before);assert.equal(hash(t.bytes),before);
    assert.equal(r.plan.pages.length,1);assert.equal(value(r.sheet,'C2'),'1');assert.equal(value(r.sheet,'AG2'),'31');assert.equal(value(r.sheet,'C3'),'목');assert.equal(value(r.sheet,'D3'),'금');
    assert.match(renderTable(r),/>학생명</);assert.match(renderTable(r),/>수업요일</);assert.ok(!renderTable(r).includes('NaN'));
    const old=t.read(t.sheets[0].path);for(const tag of ['cols','mergeCells','pageMargins','pageSetup'])assert.equal(list(old,tag)[0].toString(),list(r.sheet,tag)[0].toString());
    assert.deepEqual(list(old,'row').map(n=>n.getAttribute('ht')),list(r.sheet,'row').map(n=>n.getAttribute('ht')));
    assert.equal(value(r.sheet,'A4'),'SYNTHETIC_001');assert.equal(value(r.sheet,`A${students+3}`),`SYNTHETIC_${String(students).padStart(3,'0')}`);
    assert.equal(value(r.sheet,'C4'),'✓');assert.equal(value(r.sheet,'A1'),'2026년 10월 SYNTHETIC 출석부');
    assert.equal(list(t.workbook,'definedNames')[0].toString(),list(after.workbook,'definedNames')[0].toString());
    for(const [path,bytes] of Object.entries(t.entries))if(!['xl/worksheets/sheet1.xml','xl/workbook.xml','xl/styles.xml'].includes(path))assert.equal(hash(after.entries[path]),hash(bytes),path);
    for(const tag of ['fonts','borders','numFmts'])assert.equal(list(t.styles,tag)[0].toString(),list(r.styles,tag)[0].toString());
    const xfs=list(r.styles,'cellXfs')[0].getElementsByTagName('xf');
    assert.equal(xfs[Number(cell(r.sheet,'C4').getAttribute('s'))].getAttribute('fillId'),'0');
    assert.equal(xfs[Number(cell(r.sheet,'D4').getAttribute('s'))].getAttribute('fillId'),'2');
    assert.match(printDocument(r),/@page\{size:A4 landscape/);assert.ok(renderTable(r).includes('data-cell="AG2"'));
  }
});
test('overflow copies student row dimensions; every vertical page retains all 31 dates, headers and existing repeat columns',()=>{
  const {t,m}=run({students:30});const students=templateStudents(t,m);
  students.push(...Array.from({length:30},(_,i)=>({name:`SYNTHETIC_NEW_${i}`,weekdays:'화목'})));
  const r=generateAttendance(t,m,{year:2026,month:10,students});
  assert.equal(r.plan.pages.length,2);assert.equal(list(r.sheet,'row').length,63);assert.equal(cell(r.sheet,'AG63').getAttribute('r'),'AG63');
  assert.equal(list(r.sheet,'row').at(-1).getAttribute('ht'),'15');
  const after=openTemplate(r.bytes,env);assert.match(list(after.workbook,'definedNames')[0].textContent,/\$AG\$63/);assert.match(list(after.workbook,'definedNames')[0].textContent,/\$A:\$B/);
  assert.equal(list(r.sheet,'pageSetup')[0].getAttribute('fitToWidth'),'1');assert.equal(list(r.sheet,'pageSetup')[0].getAttribute('fitToHeight'),'0');
  assert.equal(list(r.sheet,'brk').length,1);
  for(const page of r.plan.pages){const html=renderTable(r,page);assert.match(html,/data-cell="A2"/);assert.match(html,/data-cell="AG2"/);assert.equal(page.filter(n=>n<=3).length,3);}
  assert.deepEqual(r.plan.pages.flatMap(p=>p.filter(n=>n>=4)),Array.from({length:60},(_,i)=>i+4));
});
test('February and leap years keep 31 physical columns, deactivate 29-31; closures and student makeup use existing cells',()=>{
  const {t,m}=run();const originalCount=list(t.read(t.sheets[0].path),'c').length;
  for(const [year,days] of [[2027,28],[2028,29]]){
    const r=generateAttendance(t,m,{year,month:2,closures:[1],makeups:{0:[2]},clearMarks:true});
    assert.equal(list(r.sheet,'c').length,originalCount);assert.equal(value(r.sheet,'AG2'),'');assert.equal(value(r.sheet,'AG4'),'');assert.equal(value(r.sheet,'AE2'),days===29?'29':'');
    assert.equal(value(r.sheet,'C4'),'');assert.notEqual(cell(r.sheet,'C4').getAttribute('s'),cell(r.sheet,'D4').getAttribute('s'));
    assert.equal(calendarMonth(year,2).filter(d=>d.active).length,days);
  }
  assert.throws(()=>generateAttendance(t,m,{year:2027,month:2,closures:[29]}),/휴원일/);
});
test('alternate column offset, portrait, blank rows, removal and footer preservation',()=>{
  const {r,t,m}=run({students:20,capacity:30,offset:2,orientation:'portrait'});
  assert.equal(m.dateStart,5);assert.equal(r.plan.pages.length,1);assert.match(printDocument(r),/A4 portrait/);
  const students=templateStudents(t,m);students[1]={name:'',weekdays:''};const smaller=generateAttendance(t,m,{year:2026,month:11,students});
  assert.equal(list(smaller.sheet,'row').length,33);assert.equal(value(smaller.sheet,'A5'),'');assert.equal(value(smaller.sheet,'A6'),'SYNTHETIC_003');
  const f=run({students:20,footer:true});const many=templateStudents(f.t,f.m);many.push({name:'SYNTHETIC_ADDED',weekdays:'월'});
  const grown=generateAttendance(f.t,f.m,{year:2026,month:10,students:many});assert.equal(value(grown.sheet,'A25'),'SYNTHETIC FOOTER');assert.ok(list(grown.sheet,'mergeCell').some(n=>n.getAttribute('ref')==='A25:AG25'));
});
test('malformed/unsupported templates fail safely; XSS and formula text in editable names remain text',()=>{
  assert.throws(()=>openTemplate(new Uint8Array([1,2,3]),env),/xlsx/);
  assert.throws(()=>parseWeekdays('아무때나'),/수업요일/);assert.deepEqual(parseWeekdays('월요일 / 수요일, 금요일'),[1,3,5]);
  assert.throws(()=>run({conditional:true}),/조건부/);
  const {t,m}=run();const students=templateStudents(t,m);students[0].name='<img src=x onerror=alert(1)>';students[1].name='=HYPERLINK("https://example.invalid")';
  const r=generateAttendance(t,m,{year:2026,month:10,students});assert.ok(renderTable(r).includes('&lt;img'));assert.equal(list(cell(r.sheet,'A5'),'f').length,0);
  const drawing=run({drawing:true});assert.equal(drawing.r.browserPrintSafe,false);assert.throws(()=>printDocument(drawing.r),/Excel 다운로드/);
  const bad=mutate(attendanceFixture(),'xl/workbook.xml',s=>'<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///secret">]>'+s);assert.throws(()=>openTemplate(bad,env),/엔터티/);
});

test('reopening February restores inactive columns for March without changing column structure',()=>{
  const feb=run({}, {year:2027,month:2,clearMarks:true});
  const t=openTemplate(feb.r.bytes,env),m=analyzeSheet(t,0),r=generateAttendance(t,m,{year:2027,month:3});
  assert.equal(value(r.sheet,'AG2'),'31');assert.equal(value(r.sheet,'AG3'),'수');
  const fills=list(r.styles,'cellXfs')[0].getElementsByTagName('xf');
  const fill=ref=>fills[Number(cell(r.sheet,ref).getAttribute('s'))].getAttribute('fillId');
  assert.equal(fill('AG2'),fill('AD2'));assert.equal(fill('AG4'),'2');
  assert.equal(list(t.read(t.sheets[0].path),'cols')[0].toString(),list(r.sheet,'cols')[0].toString());
});

test('shared-string rich title retains run fonts while updating month; sharedStrings bytes are unchanged',()=>{
  const files=unzipSync(attendanceFixture());
  files['xl/sharedStrings.xml']=strToU8('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><r><rPr><b/><color rgb="FFFF0000"/></rPr><t>2026년 9월</t></r><r><rPr><i/></rPr><t> SYNTHETIC 출석부</t></r></si></sst>');
  files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace(/<c r="A1"[^>]*>[\s\S]*?<\/c>/,'<c r="A1" s="3" t="s"><v>0</v></c>'));
  const t=openTemplate(zipSync(files),env),m=analyzeSheet(t,0),r=generateAttendance(t,m,{year:2026,month:10});
  assert.equal(value(r.sheet,'A1'),'2026년 10월 SYNTHETIC 출석부');
  assert.equal(list(cell(r.sheet,'A1'),'rPr').length,2);assert.equal(list(cell(r.sheet,'A1'),'color')[0].getAttribute('rgb'),'FFFF0000');
  assert.equal(hash(openTemplate(r.bytes,env).entries['xl/sharedStrings.xml']),hash(files['xl/sharedStrings.xml']));
});

test('incorrect mapping, source period and cross-sheet formula row expansion are blocked before producing a workbook',()=>{
  const {t,m}=run();
  assert.throws(()=>generateAttendance(t,{...m,dateRow:1},{year:2026,month:10}),/연속된 날짜/);
  assert.throws(()=>generateAttendance(t,{...m,sourceMonth:13},{year:2026,month:10}),/원본 월/);
  const f=run({formula:true}),students=templateStudents(f.t,f.m);students.push({name:'SYNTHETIC_EXTRA',weekdays:'월'});
  assert.throws(()=>generateAttendance(f.t,f.m,{year:2026,month:10,students}),/다른 시트 수식/);
});

test('inherited row style and indexed class fill survive date highlighting; horizontal print centering is retained',()=>{
  let bytes=mutate(attendanceFixture(),'xl/worksheets/sheet1.xml',s=>s.replace('<row r="4"','<row s="1" customFormat="1" r="4"').replace('<c r="C4" s="1"','<c r="C4"'));
  bytes=mutate(bytes,'xl/styles.xml',s=>s.replace('rgb="FFFFF2CC"','indexed="26"'));
  const t=openTemplate(bytes,env),m=analyzeSheet(t,0),r=generateAttendance(t,m,{year:2026,month:10});
  const xfs=list(r.styles,'cellXfs')[0].getElementsByTagName('xf');
  assert.equal(xfs[Number(cell(r.sheet,'C4').getAttribute('s'))].getAttribute('borderId'),'1');
  assert.equal(xfs[Number(cell(r.sheet,'D4').getAttribute('s'))].getAttribute('fillId'),'2');
  assert.match(renderTable(r),/background:#FFFFCC/);assert.equal(r.plan.settings.horizontalCentered,true);
  assert.match(printDocument(r),/position:absolute;left:[1-9]/);
});

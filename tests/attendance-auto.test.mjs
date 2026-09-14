import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {autoFixture} from './helpers/attendance-auto-fixture.mjs';
import {attendanceFixture} from './helpers/attendance-fixture.mjs';
import {analyzeWorkbook,openTemplate,generateWorkbook,nextMonth,attendanceFilename,printWorkbook} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,textOf,indexSheet,cellRef,number,calendarMonth} from '../public/data-core/work/attendance-template.js';
import {unzipSync,zipSync,strFromU8,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';
const env={DOMParser,XMLSerializer},hash=b=>createHash('sha256').update(b).digest('hex');
const read=opts=>{const source=autoFixture(opts),t=openTemplate(source,env),a=analyzeWorkbook(t,'출석부26.09_.xlsx');return {source,t,a};};
const serialize=doc=>new XMLSerializer().serializeToString(doc);
const fill=(r,c,row)=>{const cell=indexSheet(r.sheet).cells.get(cellRef(c,row));return number(all(child(r.styles.documentElement,'cellXfs'),'xf')[number(cell,'s',0)],'fillId',0);};
const changed=(input,path,fn)=>{const files=unzipSync(input);files[path]=strToU8(fn(strFromU8(files[path])));return zipSync(files);};

test('automatic two-sheet recognition, blocks and duplicate date columns; duplicate names retain distinct identities',()=>{
  const {a}=read();assert.deepEqual(a.sheets.map(s=>s.name),['입시','심화']);assert.deepEqual(a.sheets.map(s=>s.dateColumns.length),[31,39]);
  assert.deepEqual(a.sheets.map(s=>s.studentBlocks[0].end-s.studentBlocks[0].start+1),[3,1]);
  for(const s of a.sheets){const [a,b,c,d]=s.studentBlocks;assert.equal(a.name,b.name);assert.notEqual(a.id,b.id);
    assert.deepEqual(a.weekdays,[1,3,5]);assert.deepEqual(b.weekdays,[2,4]);assert.deepEqual(c.weekdays,[6]);assert.equal(d.needsReview,true);
    assert.equal(a.needsReview,false);assert.equal(b.needsReview,false);assert.equal(c.needsReview,false);
  }
});
test('all sheets generated; unknown attendance values removed; style, geometry and original ZIP parts preserved',()=>{
  const {source,t,a}=read(),before=hash(source);
  assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10}),/수업요일 확인/);
  const weekdays=Object.fromEntries(a.sheets.flatMap(s=>s.studentBlocks.filter(b=>b.needsReview).map(b=>[b.id,'월수금'])));
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays}),reopened=openTemplate(g.bytes,env);
  assert.equal(hash(source),before);assert.equal(hash(t.bytes),before);
  assert.deepEqual(reopened.entries['xl/worksheets/sheet3.xml'],t.entries['xl/worksheets/sheet3.xml']);
  for(const r of g.results){
    const s=r.mapping,old=t.read(t.sheets[s.index].path),grid=indexSheet(r.sheet);
    for(const tag of ['cols','mergeCells','pageSetup','pageMargins','conditionalFormatting'])assert.deepEqual(all(r.sheet,tag).map(serialize),all(old,tag).map(serialize),tag);
    assert.deepEqual(all(r.sheet,'row').map(n=>attr(n,'ht')),all(old,'row').map(n=>attr(n,'ht')));
    for(const b of s.studentBlocks)for(let row=b.start;row<=b.end;row++)for(const d of s.dateColumns)assert.equal(textOf(grid.cells.get(cellRef(d.c,row)),t.strings),'');
    assert.equal(textOf(grid.cells.get(cellRef(s.dateColumns.at(-1).c,s.dateRow)),t.strings),'31');
    assert.equal(textOf(grid.cells.get(s.period.monthCells[0]),t.strings),'10');assert.equal(r.plan.pages.length,1);
    const mwf=s.studentBlocks[0];assert.notEqual(fill(r,s.dateColumns.find(d=>d.day===2).c,mwf.start),fill(r,s.dateColumns.find(d=>d.day===1).c,mwf.start));
  }
  const next=analyzeWorkbook(reopened,'출석부26.10_.xlsx');assert.equal(next.month,10);assert.deepEqual(next.sheets[0].studentBlocks[0].weekdays,[1,3,5]);
  assert.match(printWorkbook(g),/@page attendance0/);assert.match(printWorkbook(g),/@page attendance1/);
});
test('month boundaries and February keep physical date columns; matching filename preserved',()=>{
  assert.deepEqual(nextMonth(2026,12),{year:2027,month:1});
  assert.equal(attendanceFilename('출석부26.09_.xlsx',2026,10),'출석부26.10_.xlsx');assert.equal(attendanceFilename('출석부26.12_.xlsx',2027,1),'출석부27.01_.xlsx');
  const {t,a}=read({review:false});
  for(const [year,month,days] of [[2027,2,28],[2028,2,29],[2026,10,31]]){
    const g=generateWorkbook(t,a,{year,month});
    for(const r of g.results){const grid=indexSheet(r.sheet);for(const d of r.mapping.dateColumns)assert.equal(textOf(grid.cells.get(cellRef(d.c,r.mapping.dateRow)),t.strings),d.day<=days?String(d.day):'');}
    const again=analyzeWorkbook(openTemplate(g.bytes,env),attendanceFilename('출석부26.09_.xlsx',year,month));assert.equal(again.month,month);
  }
});
test('single-row explicit-weekday engine remains automatic and privacy-safe',()=>{
  for(const students of [20,30]){const t=openTemplate(attendanceFixture({students}),env),a=analyzeWorkbook(t,'SYNTHETIC.xlsx');
    assert.equal(a.sheets.length,1);assert.equal(a.sheets[0].studentBlocks.length,students);assert.equal(a.sheets[0].studentBlocks.some(s=>s.needsReview),false);
    const g=generateWorkbook(t,a,{year:2026,month:10});assert.equal(g.results[0].plan.pages.length,1);
  }
});
test('student blocks remain together on vertical pages and all dates repeat',()=>{
  const {t,a}=read({students:45,review:false,fit:false});const g=generateWorkbook(t,a,{year:2026,month:10});
  const r=g.results[0];assert.ok(r.plan.pages.length>1);
  for(const page of r.plan.pages){assert.ok(page.includes(r.mapping.dateRow));for(const b of r.mapping.studentBlocks)if(page.includes(b.start))assert.ok(page.includes(b.end));}
  assert.match(printWorkbook(g),/31/);
});
test('ambiguous source periods, damaged date runs, unsupported rules fail safely, never partially generate',()=>{
  const bytes=autoFixture({review:false});
  assert.throws(()=>analyzeWorkbook(openTemplate(bytes,env),'출석부26.08_.xlsx'),/자동으로 인식/);
  for(const change of [s=>s.replace('<v>15</v>','<v>19</v>'),s=>s.replace('type="cellIs" operator="equal"','type="expression"')]){
    const bad=changed(bytes,'xl/worksheets/sheet2.xml',change);assert.throws(()=>analyzeWorkbook(openTemplate(bad,env),'출석부26.09_.xlsx'),/자동으로 인식/);
  }
});
test('one-off unknown mark is not a weekly schedule, and all dates use calendar calculations',()=>{
  const {a}=read();for(const s of a.sheets){assert.equal(s.studentBlocks[0].weekdays.includes(2),false);assert.deepEqual(s.studentBlocks[3].weekdays,[]);}
  assert.equal(calendarMonth(2026,10)[0].weekday,'목');
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {openTemplate,inspectAttendanceSheets,generateWorkbook} from '../public/data-core/work/attendance-auto.js';
import {indexSheet,textOf,cellRef,calendarMonth,all,child,attr,address} from '../public/data-core/work/attendance-template.js';

// Explicit local-only acceptance. Never persist workbooks, student cells, filenames, or source paths.
const source=process.env.ATTENDANCE_PRIVATE_SOURCE;
assert.ok(source,'ATTENDANCE_PRIVATE_SOURCE required');
const env={DOMParser,XMLSerializer},hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(source),before=hash(bytes),t=openTemplate(bytes,env),items=inspectAttendanceSheets(t,'2026.09.xlsx');
assert.equal(items.length,7);assert.ok(items.every(s=>s.status==='ready'));
const sheets=items.map(s=>s.mapping),weekdays=Object.fromEntries(sheets.flatMap(s=>s.studentBlocks.filter(b=>b.needsReview).map(b=>[b.id,'화목'])));
const results=[];
for(const [year,month] of [[2026,10],[2027,2],[2028,2]]){
 const g=generateWorkbook(t,{sheets},{year,month,weekdays}),out=openTemplate(g.bytes,env),calendar=calendarMonth(year,month);
 assert.equal(inspectAttendanceSheets(out,`${year}.${String(month).padStart(2,'0')}.xlsx`).filter(s=>s.status==='ready').length,7);
 for(const r of g.results){
  const m=r.mapping,grid=indexSheet(r.sheet),original=indexSheet(t.read(t.sheets[m.index].path));
  for(const b of m.studentBlocks)assert.equal(textOf(grid.cells.get(cellRef(m.nameCol,b.start)),t.strings),textOf(original.cells.get(cellRef(m.nameCol,b.start)),t.strings),'Student identity changed');
  assert.deepEqual([...new Set(m.dateColumns.map(d=>d.day))],calendar.filter(d=>d.active&&m.sparse.policy[d.weekdayIndex]).map(d=>d.day));
  for(const d of m.dateColumns)if(!d.slot){assert.equal(textOf(grid.cells.get(cellRef(d.c,m.dateRow)),t.strings),String(d.day));assert.equal(textOf(grid.cells.get(cellRef(d.c,m.weekdayRow)),t.strings),calendar[d.day-1].weekday);}
  assert.ok(all(r.sheet,'f').filter(f=>address(attr(f.parentNode,'r')).r<=m.area.end.r).every(f=>!attr(f,'si')&&!child(f.parentNode,'v')));
  const serialize=n=>new XMLSerializer().serializeToString(n);
  for(const [ref,cell] of original.cells)if(address(ref).r>m.area.end.r)assert.equal(serialize(grid.cells.get(ref)),serialize(cell),'Record outside print area changed');
 }
 const touched=new Set(['xl/workbook.xml','xl/styles.xml','xl/calcChain.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml',...sheets.map(m=>t.sheets[m.index].path)]);
 assert.equal(out.entries['xl/calcChain.xml'],undefined);
 for(const [key,value] of Object.entries(t.entries))if(!touched.has(key))assert.equal(hash(out.entries[key]),hash(value),'Unrelated ZIP part changed');
 results.push({year,month,sheets:g.results.length,pages:g.results.map(r=>r.plan.pages.length),sourceFormulaWarnings:g.results.map(r=>r.sourceErrors)});
}
assert.equal(hash(await readFile(source)),before);assert.equal(hash(t.bytes),before);
console.log(JSON.stringify({recognized:items.length,students:sheets.reduce((n,s)=>n+s.studentBlocks.filter(b=>b.name).length,0),correctedDateLabels:sheets.reduce((n,s)=>n+s.sparse.correctedDates,0),testOnlyWeekdayConfirmations:Object.keys(weekdays).length,originalUnchanged:true,results}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {sparseFixture} from './helpers/attendance-sparse-fixture.mjs';
import {openTemplate,analyzeWorkbook,generateWorkbook,inspectAttendanceSheets} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,indexSheet,textOf,cellRef,calendarMonth,dimensions,putValue,create,columnName,namedRange} from '../public/data-core/work/attendance-template.js';
import {zipSync,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';
const env={DOMParser,XMLSerializer},hash=b=>createHash('sha256').update(b).digest('hex');
function setup(options={}){const f=sparseFixture(options),t=openTemplate(f.bytes,env),a=analyzeWorkbook(t);return {f,t,a};}
test('omitted closed weekdays and narrow weekly separators are recognized without archived rows',()=>{
 const {a}=setup();const m=a.sheets[0];assert.equal(m.studentBlocks.filter(b=>b.name).length,6);assert.equal(m.sparse.policy[1],0);assert.equal(m.sparse.policy[0],0);assert.equal(m.sparse.policy[6],3);assert.equal(m.area.end.r,10);
});
test('October sparse regeneration retains week separators, multi-slot Saturdays, source width and COUNTIF references',()=>{
 const {t,a}=setup(),g=generateWorkbook(t,a,{year:2026,month:10}),r=g.results[0],grid=indexSheet(r.sheet),m=r.mapping;
 const dates=[...new Set(m.dateColumns.map(d=>d.day))];
 assert.deepEqual(dates,calendarMonth(2026,10).filter(d=>d.active&&![0,1].includes(d.weekdayIndex)).map(d=>d.day));
 for(const day of [3,10,17,24,31])assert.equal(m.dateColumns.filter(d=>d.day===day).length,3);
 for(const d of m.dateColumns){assert.equal(child(grid.cells.get(cellRef(d.c,2)),'f').textContent,`COUNTIF(${cellRef(d.c,5)}:${cellRef(d.c,10)},"1")`);assert.equal(textOf(grid.cells.get(cellRef(d.c,4)),t.strings),d.slot?'':calendarMonth(2026,10)[d.day-1].weekday);}
 const end=m.dateColumns.at(-1).c;assert.equal(child(grid.cells.get('D5'),'f').textContent,`COUNTIF(E5:${cellRef(end,5)},"1")`);
 assert.ok(all(r.sheet,'f').every(f=>!attr(f,'si')&&!child(f.parentNode,'v')));
 const widths=dimensions(r.sheet,r.area).widths;const selected=new Set(m.dateColumns.map(d=>d.c));for(let c=m.dateStart;c<end;c++)assert.equal(widths[c-1],selected.has(c)?17:3);
 assert.equal(textOf(grid.cells.get(cellRef(end+1,5)),t.strings),'SYNTHETIC_TAIL');assert.equal(r.plan.pages.length,1);
});
test('sparse output can be reuploaded, including a February whose last operating date is 27',()=>{
 const {t,a}=setup();for(const [year,month]of [[2026,10],[2027,2],[2028,2],[2026,8]]){
  const g=generateWorkbook(t,a,{year,month});const next=inspectAttendanceSheets(openTemplate(g.bytes,env),`${year}.${String(month).padStart(2,'0')}.xlsx`);assert.equal(next[0].status,'ready',`${year}-${month}`);
 }
});
test('bounded stale week numbers are identified using explicit weekday anchors and reported',()=>{
 const {t,a}=setup({sundaySlots:3,weekdaySlots:3,staleDates:true});assert.equal(a.sheets[0].sparse.correctedDates,5);assert.equal(generateWorkbook(t,a,{year:2026,month:10}).results.length,1);
});
test('sparse generation leaves original bytes and untouched ZIP parts intact; pre-existing REF errors remain flagged',()=>{
 const {f,t,a}=setup({brokenFormula:true}),before=hash(f.bytes),g=generateWorkbook(t,a,{year:2026,month:10}),out=openTemplate(g.bytes,env);
 assert.equal(hash(t.bytes),before);assert.equal(hash(f.bytes),before);assert.equal(g.results[0].sourceErrors,1);
 for(const [key,bytes]of Object.entries(t.entries))if(!['xl/styles.xml','xl/workbook.xml','xl/worksheets/sheet1.xml'].includes(key))assert.equal(hash(out.entries[key]),hash(bytes));
 assert.equal(textOf(indexSheet(g.results[0].sheet).cells.get('B14'),t.strings),'SYNTHETIC_OUTSIDE_PRINT');
 assert.equal(textOf(indexSheet(g.results[0].sheet).cells.get('G14'),t.strings),'SYNTHETIC_ARCHIVED_MARK');
});
test('unknown formulas and missing nonseparator dates fail safely',()=>{
 const {t,a}=setup({unknownFormula:true});assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10}),/수식/);
 const safe=setup(),sheet=safe.t.read('xl/worksheets/sheet1.xml');putValue(indexSheet(sheet).cells.get('F3'),'',sheet);
 const changed=openTemplate(zipSync({...safe.t.entries,'xl/worksheets/sheet1.xml':strToU8(new XMLSerializer().serializeToString(sheet))}),env);
 assert.equal(inspectAttendanceSheets(changed)[0].status,'unsupported');
});
test('cached sequential date formulas are replaced by actual target dates instead of blocking generation',()=>{
 const {t}=setup(),sheet=t.read('xl/worksheets/sheet1.xml'),grid=indexSheet(sheet);
 const f=create(sheet,'f');f.textContent='F3+1';grid.cells.get('G3').appendChild(f);
 const source=openTemplate(zipSync({...t.entries,'xl/worksheets/sheet1.xml':strToU8(new XMLSerializer().serializeToString(sheet))}),env);
 const out=generateWorkbook(source,analyzeWorkbook(source),{year:2026,month:10}).results[0];
 for(const d of out.mapping.dateColumns)assert.equal(child(indexSheet(out.sheet).cells.get(cellRef(d.c,3)),'f'),undefined);
});
test('stale calculation chain is removed only from generated copy with consistent package relationships',()=>{
 const {t}=setup(),rels=t.read('xl/_rels/workbook.xml.rels'),types=t.read('[Content_Types].xml');
 const rel=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');
 for(const [key,value]of Object.entries({Id:'rIdChain',Type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',Target:'calcChain.xml'}))rel.setAttribute(key,value);
 rels.documentElement.appendChild(rel);
 const type=types.createElementNS(types.documentElement.namespaceURI,'Override');type.setAttribute('PartName','/xl/calcChain.xml');type.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml');types.documentElement.appendChild(type);
 const serialize=n=>strToU8(new XMLSerializer().serializeToString(n));
 const bytes=zipSync({...t.entries,'xl/_rels/workbook.xml.rels':serialize(rels),'[Content_Types].xml':serialize(types),'xl/calcChain.xml':strToU8('<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="F3" i="1"/></calcChain>')});
 const source=openTemplate(bytes,env),before=hash(bytes),g=generateWorkbook(source,analyzeWorkbook(source),{year:2026,month:10}),out=openTemplate(g.bytes,env);
 assert.equal(out.entries['xl/calcChain.xml'],undefined);assert.ok(source.entries['xl/calcChain.xml']);assert.equal(hash(source.bytes),before);
 assert.ok(all(out.read('xl/_rels/workbook.xml.rels'),'Relationship').every(n=>!attr(n,'Type').endsWith('/calcChain')));
 assert.ok(all(out.read('[Content_Types].xml'),'Override').every(n=>attr(n,'PartName')!=='/xl/calcChain.xml'));
});
test('print width stays within source print area while unprinted tail data and column styles survive',()=>{
 const {t,f}=setup(),workbook=t.workbook.cloneNode(true);
 namedRange(workbook,0,'_xlnm.Print_Area').textContent=`'SYNTHETIC'!$A$1:$${columnName(f.last)}$10`;
 const source=openTemplate(zipSync({...t.entries,'xl/workbook.xml':strToU8(new XMLSerializer().serializeToString(workbook))}),env);
 const out=generateWorkbook(source,analyzeWorkbook(source),{year:2026,month:10}).results[0],last=out.mapping.dateColumns.at(-1).c;
 assert.equal(out.area.end.c,last);assert.equal(textOf(indexSheet(out.sheet).cells.get(cellRef(last+1,5)),source.strings),'SYNTHETIC_TAIL');
 assert.ok(all(out.sheet,'col').some(n=>Number(attr(n,'min'))===last+1&&Number(attr(n,'width'))===5));
});

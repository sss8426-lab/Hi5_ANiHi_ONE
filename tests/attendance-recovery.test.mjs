import assert from 'node:assert/strict';
import test from 'node:test';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {unzipSync,zipSync,strFromU8,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';
import {autoFixture} from './helpers/attendance-auto-fixture.mjs';
import {realWorldFixture} from './helpers/attendance-real-world-fixture.mjs';
import {openTemplate,analyzeWorkbook,inspectAttendanceSheets,generateWorkbook} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,textOf,indexSheet} from '../public/data-core/work/attendance-template.js';

const env={DOMParser,XMLSerializer},serialize=n=>new XMLSerializer().serializeToString(n);
function edit(bytes,fn){const files=unzipSync(bytes);fn(files);return zipSync(files);}
const patch=(files,key,fn)=>{files[key]=strToU8(fn(strFromU8(files[key])));};
const sheet='xl/worksheets/sheet1.xml';
const weekdays=a=>Object.fromEntries(a.sheets.flatMap(s=>s.studentBlocks.filter(b=>b.needsReview).map(b=>[b.id,'월수금'])));

test('mixed monthly archives are inspected separately and only explicitly selected sheets change',()=>{
  const bytes=edit(autoFixture({review:false}),files=>{
    files['xl/worksheets/sheet2.xml']=unzipSync(autoFixture({review:false,month:4}))['xl/worksheets/sheet2.xml'];
  });
  const t=openTemplate(bytes,env),items=inspectAttendanceSheets(t);
  assert.equal(items.filter(s=>s.status==='ready').length,2);
  assert.deepEqual(items.slice(0,2).map(s=>s.mapping.period.month),[9,4]);
  assert.throws(()=>analyzeWorkbook(t),/자동으로 인식/);
  const a=analyzeWorkbook(t,'',{sheetIndexes:[0]});
  const g=generateWorkbook(t,a,{year:2026,month:10});
  const out=openTemplate(g.bytes,env);
  assert.equal(g.results.length,1);
  for(const p of ['xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml'])assert.deepEqual(out.entries[p],t.entries[p]);
  assert.deepEqual(t.bytes,bytes);
});

test('unsupported sheet is reported and preserved, never silently accepted as attendance',()=>{
  const bytes=edit(autoFixture({review:false}),files=>patch(files,'xl/worksheets/sheet2.xml',s=>s.replace('<v>15</v>','<v>19</v>')));
  const t=openTemplate(bytes,env),items=inspectAttendanceSheets(t,'SYNTHETIC26.09.xlsx');
  assert.equal(items[0].status,'ready');assert.equal(items[1].status,'unsupported');
  assert.throws(()=>analyzeWorkbook(t,'SYNTHETIC26.09.xlsx'),/자동으로 인식/);
  const g=generateWorkbook(t,{sheets:[items[0].mapping]},{year:2026,month:10});
  assert.deepEqual(openTemplate(g.bytes,env).entries['xl/worksheets/sheet2.xml'],t.entries['xl/worksheets/sheet2.xml']);
});

test('missing source month requires explicit confirmation and validates source year/weekday evidence',()=>{
  const bytes=realWorldFixture({titleText:'2026년 출석부'}),t=openTemplate(bytes,env);
  assert.equal(inspectAttendanceSheets(t)[0].status,'needs-period');
  assert.throws(()=>analyzeWorkbook(t),e=>e.code==='SOURCE_PERIOD_REQUIRED');
  assert.throws(()=>analyzeWorkbook(t,'',{sourcePeriods:{0:{year:2025,month:9}}}),/연도/);
  assert.throws(()=>analyzeWorkbook(t,'',{sourcePeriods:{0:{year:2026,month:10}}}),/자동으로 인식/);
  const a=analyzeWorkbook(t,'',{sourcePeriods:{0:{year:2026,month:9}}});
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays:weekdays(a)});
  const out=openTemplate(g.bytes,env);
  assert.equal(analyzeWorkbook(out).month,10);
  assert.match(textOf(indexSheet(g.results[0].sheet).cells.get('A1'),t.strings),/2026년 10월/);
  assert.deepEqual(t.bytes,bytes);
});

function drawingFixture({overlap=false,external=false,missing=false,wholeColumn=false}={}){
  return edit(realWorldFixture({cfRuleType:wholeColumn?'cellIs':null}),files=>{
    patch(files,sheet,s=>s.replace('<worksheet ','<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ').replace('</worksheet>','<drawing r:id="rDraw"/></worksheet>').replace('sqref="D4:AG6"','sqref="A1:XFD1048576"'));
    files['xl/worksheets/_rels/sheet1.xml.rels']=strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDraw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml" ${external?'TargetMode="External"':''}/></Relationships>`);
    if(!missing)files['xl/drawings/drawing1.xml']=strToU8(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:to><xdr:col>${overlap?6:2}</xdr:col><xdr:row>5</xdr:row></xdr:to><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`);
  });
}
test('drawings anchored wholly before the calendar and sheetwide conditional ranges are preserved',()=>{
  const bytes=drawingFixture({wholeColumn:true}),t=openTemplate(bytes,env),a=analyzeWorkbook(t);
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays:weekdays(a)}),out=openTemplate(g.bytes,env);
  assert.equal(g.results[0].mapping.dateColumns.length,31);
  for(const p of ['xl/drawings/drawing1.xml','xl/worksheets/_rels/sheet1.xml.rels'])assert.deepEqual(out.entries[p],t.entries[p]);
  assert.equal(attr(all(g.results[0].sheet,'conditionalFormatting')[0],'sqref'),'A1:XFD1048576');
  assert.equal(g.results[0].browserPrintSafe,false);
});
test('unresolved, external, or overlapping drawing anchors remain blocked during reshape',()=>{
  for(const spec of [{overlap:true},{external:true},{missing:true}]){
    const t=openTemplate(drawingFixture(spec),env),a=analyzeWorkbook(t);
    assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10,weekdays:weekdays(a)}),/그림·표·개체/);
  }
});

test('explicit original-column mode preserves formulas, widths and merges while updating dates',()=>{
  const bytes=edit(autoFixture({review:false}),files=>patch(files,'xl/worksheets/sheet2.xml',s=>s.replace('<row r="1" ht="28" customHeight="1">','<row r="1" ht="28" customHeight="1"><c r="P1"><f>COUNT(P4:P7)</f><v>99</v></c>')));
  const t=openTemplate(bytes,env),a=analyzeWorkbook(t,'SYNTHETIC26.09.xlsx');
  assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10}),/수식/);
  const g=generateWorkbook(t,a,{year:2026,month:10,preserveColumns:true});
  const r=g.results[1],old=t.read('xl/worksheets/sheet2.xml');
  for(const tag of ['col','mergeCell'])assert.deepEqual(all(r.sheet,tag).map(serialize),all(old,tag).map(serialize));
  assert.equal(all(r.sheet,'f')[0].textContent,'COUNT(P4:P7)');
  assert.equal(child(all(r.sheet,'f')[0].parentNode,'v'),undefined);
  assert.equal(textOf(indexSheet(r.sheet).cells.get('AS2'),t.strings),'31');
  assert.equal(r.mapping.dateColumns.length,39);
  assert.deepEqual(t.bytes,bytes);
});
test('original-column mode cannot omit day 31 when original lacks that column',()=>{
  const t=openTemplate(realWorldFixture(),env),a=analyzeWorkbook(t);
  assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10,preserveColumns:true}),/31일 칸/);
});
test('academic-year title is updated during generation, not only recognized',()=>{
  const t=openTemplate(realWorldFixture({titleText:'2026학년도 9월 출석부'}),env),a=analyzeWorkbook(t);
  const g=generateWorkbook(t,a,{year:2027,month:10,weekdays:weekdays(a)});
  const out=openTemplate(g.bytes,env);assert.equal(analyzeWorkbook(out).year,2027);assert.equal(analyzeWorkbook(out).month,10);
});

test('format-only export tails do not become 1,000 generated attendance rows',()=>{
  const bytes=edit(realWorldFixture({students:20}),files=>patch(files,sheet,s=>s.replace('ref="A1:AG23"','ref="A1:AG1000"').replace('</sheetData>','<row r="1000"><c r="AG1000" s="1"/></row></sheetData>')));
  const t=openTemplate(bytes,env),a=analyzeWorkbook(t);
  assert.equal(a.sheets[0].area.end.r,23);
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays:weekdays(a)}),r=g.results[0];
  assert.equal(r.plan.pages.length,1);
  assert.ok(all(r.sheet,'c').length<1000,'No blank matrix allocated to row 1000');
  assert.ok(indexSheet(r.sheet).cells.has('AG1000'),'Original format-only tail preserved');
  assert.match(all(openTemplate(g.bytes,env).workbook,'definedName').find(n=>attr(n,'name')==='_xlnm.Print_Area').textContent,/\$23$/);
});

test('partial text conditional rules follow day ranges and regenerate their relative origin',()=>{
  const bytes=edit(realWorldFixture({cfRuleType:'containsText',cfRuleText:'출석'}),files=>patch(files,sheet,s=>s.replace('sqref="D4:AG6"','sqref="H4:J6"')));
  const t=openTemplate(bytes,env),a=analyzeWorkbook(t),g=generateWorkbook(t,a,{year:2026,month:10,weekdays:weekdays(a)});
  const cf=all(g.results[0].sheet,'conditionalFormatting')[0];
  assert.equal(attr(cf,'sqref'),'H4:J6');
  assert.equal(all(cf,'formula')[0].textContent,'NOT(ISERROR(SEARCH("출석",H4)))');
});

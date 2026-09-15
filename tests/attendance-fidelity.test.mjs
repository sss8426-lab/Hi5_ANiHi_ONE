import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {fidelityFixture} from './helpers/attendance-fidelity-fixture.mjs';
import {zipSync,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';
import {openTemplate,analyzeWorkbook,generateWorkbook} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,children,cellRef,indexSheet,textOf,styleEngine,cellStyleId,number,renderTable,dimensions,putValue,create} from '../public/data-core/work/attendance-template.js';

const env={DOMParser,XMLSerializer},xml=n=>n?new XMLSerializer().serializeToString(n):'',hash=b=>createHash('sha256').update(b).digest('hex');
function setup(options){const f=fidelityFixture(options),t=openTemplate(f.bytes,env),a=analyzeWorkbook(t),g=generateWorkbook(t,a,{year:2026,month:10}),r=g.results[0];return {f,t,a,g,r,grid:indexSheet(r.sheet),se:styleEngine(r.styles,t)};}
function color(s,row,day,slot=0){const col=s.r.mapping.dateColumns.find(d=>d.day===day&&d.slot===slot);return s.se.fillColor(number(s.se.xf(cellStyleId(s.r.sheet,s.grid.cells.get(cellRef(col.c,row)),col.c)),'fillId',0))?.toUpperCase()||'#FFFFFF';}

test('weekday/slot styles retain white free slots, gray unavailable days, and orange scheduled slots',()=>{
  const s=setup();
  for(const day of [3,10,17,24,31]){
    assert.equal(color(s,5,day,0),'#F7CAAC');assert.equal(color(s,5,day,1),'#F7CAAC');assert.equal(color(s,5,day,2),'#FFFFFF');
    assert.equal(color(s,6,day,0),'#FFFFFF');assert.equal(color(s,6,day,1),'#F7CAAC');assert.equal(color(s,6,day,2),'#F7CAAC');
  }
  for(const day of [4,5,11,12])assert.equal(color(s,5,day),'#999999');
  assert.equal(color(s,6,1),'#FFFFFF');
});
test('make-up text no longer suppresses regular colored lessons and is not carried to the next month',()=>{
  const s=setup();assert.equal(s.a.sheets[0].studentBlocks[2].needsReview,false);
  for(const day of [1,6,8,13,15,20,22,27,29])assert.equal(color(s,7,day),'#F7CAAC');
  for(const day of [2,9,16,23,30])assert.equal(color(s,7,day),'#FFFFFF');
  assert.ok(s.r.mapping.dateColumns.every(d=>!textOf(s.grid.cells.get(cellRef(d.c,7)),s.t.strings)));
});
test('inactive student merged label and status survive without invented weekdays or review prompts',()=>{
  const s=setup(),b=s.a.sheets[0].studentBlocks[3];assert.equal(b.inactive,true);assert.equal(b.needsReview,false);
  assert.equal(textOf(s.grid.cells.get(cellRef(s.f.start,8)),s.t.strings),'휴원');
  assert.ok(all(s.r.sheet,'mergeCell').some(n=>attr(n,'ref')===`${cellRef(s.f.start,8)}:${cellRef(s.r.mapping.dateColumns.at(-1).c,8)}`));
  assert.equal(color(s,8,3),'#FFFFFF');
});
test('only new-copy calendar note is cleared on month change; source and same-month annotation remain',()=>{
  const s=setup(),before=hash(s.f.bytes);assert.equal(s.r.clearedNotes,1);
  assert.ok(!xml(s.r.sheet).includes('SYNTHETIC 연휴'));
  const same=generateWorkbook(s.t,s.a,{year:2026,month:9}).results[0];assert.ok(xml(same.sheet).includes('SYNTHETIC 연휴'));assert.equal(same.clearedNotes,0);
  assert.ok(all(same.sheet,'mergeCell').some(n=>attr(n,'ref').endsWith('2')&&attr(n,'ref').startsWith(cellRef(s.f.columns.find(d=>d.day===24).c,2)+':')));
  const sameState={...s,r:same,grid:indexSheet(same.sheet),se:styleEngine(same.styles,s.t)};assert.equal(color(sameState,5,24),'#999999');
  assert.equal(hash(s.t.bytes),before);assert.equal(hash(s.f.bytes),before);
});
test('calendar body borders are sampled by row/slot and only outer right edge follows the last day',()=>{
  const s=setup();const borders=children(child(s.r.styles.documentElement,'borders'),'border');
  const edge=(row,d,side)=>{const n=s.grid.cells.get(cellRef(d.c,row)),id=number(s.se.xf(cellStyleId(s.r.sheet,n)),'borderId',0);return attr(child(borders[id],side),'style');};
  const last=s.r.mapping.dateColumns.at(-1);
  for(const d of s.r.mapping.dateColumns){assert.equal(edge(6,d,'bottom'),'thin');assert.equal(edge(5,d,'top'),'medium');assert.equal(edge(30,d,'bottom'),'medium');if(d.c!==last.c)assert.notEqual(edge(6,d,'right'),'medium');}
  assert.equal(edge(6,last,'right'),'medium');
});
test('original info columns/row heights/tail and rich title survive; preview uses OOXML column pixel conversion',()=>{
  const s=setup(),original=s.t.read('xl/worksheets/sheet1.xml'),old=indexSheet(original);
  for(let r=3;r<=s.f.end;r++)for(let c=1;c<s.f.start;c++)assert.equal(xml(s.grid.cells.get(cellRef(c,r))),xml(old.cells.get(cellRef(c,r))));
  assert.deepEqual(all(s.r.sheet,'row').filter(r=>old.rows.has(Number(attr(r,'r')))).map(r=>attr(r,'ht')),all(original,'row').map(r=>attr(r,'ht')));
  const html=renderTable(s.r);assert.match(html,/font-size:20pt/);assert.match(html,/2026년 10월 SYNTHETIC/);
  const width=dimensions(original,s.a.sheets[0].area).widths[s.f.start-1];assert.equal(width,19);
  assert.equal(s.r.plan.pages.length,1);
  const reopened=openTemplate(s.g.bytes,env);assert.equal(hash(reopened.entries['xl/worksheets/sheet2.xml']),hash(s.t.entries['xl/worksheets/sheet2.xml']));
});
test('February keeps 31 day positions with inactive fillers, valid borders and intact inactive row',()=>{
  const s=setup(),g=generateWorkbook(s.t,s.a,{year:2027,month:2}),r=g.results[0],grid=indexSheet(r.sheet);
  for(const d of r.mapping.dateColumns.filter(d=>d.day>28))assert.equal(textOf(grid.cells.get(cellRef(d.c,r.mapping.dateRow)),s.t.strings),'');
  assert.equal(r.mapping.dateColumns.at(-1).day,31);assert.equal(textOf(grid.cells.get(cellRef(s.f.start,8)),s.t.strings),'휴원');
});
test('unknown header labels are preserved and partial body merges are never silently deleted',()=>{
  const s=setup(),sheet=s.t.read('xl/worksheets/sheet1.xml'),grid=indexSheet(sheet);
  putValue(grid.cells.get(cellRef(s.f.start,2)),'SYNTHETIC_FIXED_LABEL',sheet);
  const read=()=>openTemplate(zipSync({...s.t.entries,'xl/worksheets/sheet1.xml':strToU8(xml(sheet))}),env);
  let t=read();assert.ok(xml(generateWorkbook(t,analyzeWorkbook(t),{year:2026,month:10}).results[0].sheet).includes('SYNTHETIC_FIXED_LABEL'));
  child(sheet.documentElement,'mergeCells').appendChild(create(sheet,'mergeCell',{ref:`${cellRef(s.f.start,5)}:${cellRef(s.f.start+1,5)}`}));
  t=read();assert.throws(()=>generateWorkbook(t,analyzeWorkbook(t),{year:2026,month:10}),/부분 병합/);
});

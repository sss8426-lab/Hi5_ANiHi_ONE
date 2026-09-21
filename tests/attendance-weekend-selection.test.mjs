import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {multiSlotFixture} from './helpers/attendance-multi-slot-fixture.mjs';
import {autoFixture} from './helpers/attendance-auto-fixture.mjs';
import {sparseFixture} from './helpers/attendance-sparse-fixture.mjs';
import {openTemplate,analyzeWorkbook,generateWorkbook} from '../public/data-core/work/attendance-auto.js';
import {reviewSchedule,confirmedCounts} from '../public/data-core/work/attendance-schedule.js';
import {indexSheet,cellRef,styleEngine,calendarMonth,child,textOf} from '../public/data-core/work/attendance-template.js';

const env={DOMParser,XMLSerializer};
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=bytes=>{const t=openTemplate(bytes,env);return {t,a:analyzeWorkbook(t,'2026.09.xlsx')};};
function marked(result,block,day){
  const grid=indexSheet(result.sheet),styles=styleEngine(result.styles,result.template);
  return result.mapping.dateColumns.filter(d=>d.day===day).flatMap(d=>Array.from({length:block.end-block.start+1},(_,offset)=>{
    const id=styles.fillId(grid.cells.get(cellRef(d.c,block.start+offset)));
    return styles.fillColor(id);
  })).filter(color=>color==='#E8F0EC').length;
}

test('confirmation accepts zero to three weekend lessons and validates counts',()=>{
  for(let sat=0;sat<=3;sat++)for(let sun=0;sun<=3;sun++){
    const value=reviewSchedule([1,...Array(sat).fill(6),...Array(sun).fill(0)]);
    assert.equal(confirmedCounts(value)[6],sat);assert.equal(confirmedCounts(value)[0],sun);
  }
  assert.throws(()=>reviewSchedule([]),/선택/);
  assert.throws(()=>reviewSchedule([6,6,6,6]),/3타임/);
  assert.throws(()=>confirmedCounts({counts:{6:3}}),/선택/);
  assert.equal(confirmedCounts('월수금'),null);
});

test('single-column source expands to exact weekend counts, preserves original bytes and reopens',()=>{
  const bytes=multiSlotFixture({saturdaySlots:1,sundaySlots:1,needsReview:true,students:4}).bytes;
  const {t,a}=read(bytes),before=hash(bytes),blocks=a.sheets[0].studentBlocks;
  const weekdays=Object.fromEntries(blocks.map((b,i)=>[b.id,reviewSchedule([1,...Array(i).fill(6),...Array(3-i).fill(0)])]));
  for(const month of [9,10,2]){
    const g=generateWorkbook(t,a,{year:2026,month,weekdays}),r=g.results[0];
    const calendar=calendarMonth(2026,month);
    for(const d of calendar.filter(d=>d.active)){
      if(d.weekdayIndex===6||d.weekdayIndex===0){
        assert.equal(r.mapping.dateColumns.filter(c=>c.day===d.day).length,3);
        blocks.forEach((b,i)=>assert.equal(marked(r,b,d.day),d.weekdayIndex===6?i:3-i));
      }
      if(d.weekdayIndex===1)blocks.forEach(b=>assert.equal(marked(r,b,d.day),1));
    }
    assert.equal(r.plan.pages.length,1);
    assert.equal(analyzeWorkbook(openTemplate(g.bytes,env),`2026.${month}.xlsx`).month,month);
  }
  assert.equal(hash(bytes),before);assert.equal(hash(t.bytes),before);
});

test('existing three-row student blocks reuse rows without multiplying lessons',()=>{
  const {t,a}=read(autoFixture()),weekdays={};
  for(const m of a.sheets)for(const b of m.studentBlocks.filter(b=>b.needsReview))weekdays[b.id]=reviewSchedule([1,6,6,6,0,0]);
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays});
  for(const r of g.results){
    const b=r.mapping.studentBlocks.find(b=>b.needsReview);
    assert.equal(marked(r,b,3),3);assert.equal(marked(r,b,4),2);assert.equal(marked(r,b,5),1);
  }
  assert.equal(g.results[0].mapping.dateColumns.filter(d=>d.day===3).length,1);
});

test('unconfirmed students retain inferred slots while confirmed students use counts',()=>{
  const {t,a}=read(multiSlotFixture({saturdaySlots:3,sundaySlots:2}).bytes);
  const baseline=generateWorkbook(t,a,{year:2026,month:10}).results[0];
  const b=a.sheets[0].studentBlocks[0];
  const actual=generateWorkbook(t,a,{year:2026,month:10,weekdays:{[b.id]:reviewSchedule([6,6,0])}}).results[0];
  assert.equal(marked(actual,b,3),2);assert.equal(marked(actual,b,4),1);
  for(const student of a.sheets[0].studentBlocks.slice(1))for(const day of [3,4,5])assert.equal(marked(actual,student,day),marked(baseline,student,day));
});

test('sparse weekly form expands existing weekends and explicitly selected omitted Sunday',()=>{
  const {t,a}=read(sparseFixture().bytes),b=a.sheets[0].studentBlocks[0];
  const g=generateWorkbook(t,a,{year:2026,month:10,weekdays:{[b.id]:reviewSchedule([6,6,0,0,0])}}),r=g.results[0];
  assert.equal(r.mapping.dateColumns.filter(d=>d.day===4).length,3);
  assert.equal(marked(r,b,3),2);assert.equal(marked(r,b,4),3);
  const grid=indexSheet(r.sheet);
  for(const d of r.mapping.dateColumns.filter(d=>d.day===4))assert.equal(child(grid.cells.get(cellRef(d.c,2)),'f').textContent,`COUNTIF(${cellRef(d.c,5)}:${cellRef(d.c,10)},"1")`);
  assert.equal(analyzeWorkbook(openTemplate(g.bytes,env),'2026.10.xlsx').month,10);
  assert.equal(textOf(grid.cells.get(cellRef(r.mapping.dateColumns.at(-1).c+1,5)),t.strings),'SYNTHETIC_TAIL');
});

test('preserve-columns mode rejects insufficient slots rather than silently dropping lessons',()=>{
  const {t,a}=read(multiSlotFixture({saturdaySlots:1,sundaySlots:1}).bytes),b=a.sheets[0].studentBlocks[0];
  assert.throws(()=>generateWorkbook(t,a,{year:2026,month:10,preserveColumns:true,weekdays:{[b.id]:reviewSchedule([6,6,6])}}),/수업 횟수.*부족/);
});

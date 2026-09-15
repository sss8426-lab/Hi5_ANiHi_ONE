import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {basename} from 'node:path';
import {openTemplate,analyzeWorkbook,generateWorkbook,nextMonth,attendanceFilename} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,indexSheet,textOf,cellRef,range,calendarMonth} from '../public/data-core/work/attendance-template.js';

// Read-only, opt-in local validation. Never writes a workbook, and the only things this script ever
// prints are: success/failure, whether the original bytes changed, anonymized sheet indexes, the
// target months checked, and which checks ran — never a real file path, sheet name, student name or
// cell value. `path`/`filename` below are used only to open/derive filenames internally.
const path=process.env.ATTENDANCE_PRIVATE_SOURCE;
if(!path)throw Error('ATTENDANCE_PRIVATE_SOURCE is required');
const env={DOMParser,XMLSerializer};
const hash=b=>createHash('sha256').update(b).digest('hex');
const attrs=(doc,tag)=>all(doc,tag).map(n=>Array.from(n.attributes).map(a=>[a.name,a.value]));
const source=await readFile(path),before=hash(source),filename=basename(path);

function finish(stage,body){
  console.log(JSON.stringify({stage,...body}));
  process.exitCode=body.success?0:1;
}

// Derived independently of weekdaySlotPolicy()/targetCalendarColumns() in attendance-auto.js: this
// re-implements the same "majority vote over days 1-28" rule from scratch, purely from the *source*
// file's own recognized dateColumns, so the check below never simply compares the product's output
// against itself. calendarMonth() (a plain calendar utility, not part of the recognition/generation
// logic) supplies the independent weekday ground truth.
function independentSourcePolicy(dateColumns,sourceCalendar){
  const bestSlotsByDay=new Map();
  for(const d of dateColumns){
    if(d.day>28)continue;
    bestSlotsByDay.set(d.day,Math.max(bestSlotsByDay.get(d.day)||0,d.slot+1));
  }
  const votesByWeekday=Array.from({length:7},()=>new Map());
  for(const [day,slots] of bestSlotsByDay){
    const weekday=sourceCalendar[day-1].weekdayIndex,votes=votesByWeekday[weekday];
    votes.set(slots,(votes.get(slots)||0)+1);
  }
  return votesByWeekday.map(votes=>{
    let best=1,bestCount=-1;
    for(const [slots,count] of votes)if(count>bestCount||count===bestCount&&slots>best){best=slots;bestCount=count;}
    return best;
  });
}

function printAreaRanges(workbook,sheetIndex){
  return all(workbook,'definedName')
    .filter(n=>attr(n,'name')==='_xlnm.Print_Area'&&Number(attr(n,'localSheetId','-1'))===sheetIndex)
    .map(n=>{const ref=n.textContent.split('!').slice(1).join('!');return range(ref.replace(/\$/g,''));});
}

let template,analysis;
try{
  template=openTemplate(source,env);
  analysis=analyzeWorkbook(template,filename);
}catch(error){
  finish('recognition_failed',{success:false,originalUnchanged:hash(source)===before,reason:error.message});
  process.exit();
}

const reviewBlocks=analysis.sheets.flatMap(s=>s.studentBlocks.filter(b=>b.needsReview));
if(reviewBlocks.length){
  finish('weekday_confirmation_required',{
    success:false,originalUnchanged:true,sheets:analysis.sheets.length,
    studentsNeedingReview:reviewBlocks.length,
    reason:'Manual schedule confirmation required before private validation can run (no arbitrary weekday overrides are applied here).',
  });
  process.exit();
}

// Never fixed to two hardcoded past months: the immediate next month after the source (the normal
// path), a February a year out from it (28/29-day boundary), and the same month one year later
// (a full annual cycle back to the same weekday alignment as the source).
const next=nextMonth(analysis.year,analysis.month);
const testMonths=[
  next,
  {year:next.year+1,month:2},
  {year:analysis.year+1,month:analysis.month},
];

const summary=[];
try{
  for(const target of testMonths){
    const targetCalendar=calendarMonth(target.year,target.month);
    const output=generateWorkbook(template,analysis,target);
    const reopened=openTemplate(output.bytes,env);
    for(const result of output.results){
      const m=result.mapping,original=analysis.sheets.find(s=>s.index===m.index);
      const old=template.read(template.sheets[m.index].path),oldGrid=indexSheet(old),nextGrid=indexSheet(result.sheet);
      const sourceCalendar=calendarMonth(analysis.year,analysis.month);
      const policy=independentSourcePolicy(original.dateColumns,sourceCalendar);
      const oldCalEnd=original.dateColumns.at(-1).c,newCalEnd=m.dateColumns.at(-1).c,delta=newCalEnd-oldCalEnd;

      // Rows/margins are never touched by a column reshape.
      for(const tag of ['row','pageMargins'])assert.deepEqual(attrs(result.sheet,tag),attrs(old,tag),`${tag} unchanged`);

      // 1) Target month date/weekday/slot-count correctness, checked against calendar math and the
      //    independently-derived source policy — never against the product's own generated output.
      const byDay=new Map();for(const d of m.dateColumns){if(!byDay.has(d.day))byDay.set(d.day,[]);byDay.get(d.day).push(d);}
      const activeCount=targetCalendar.filter(d=>d.active).length;
      for(const day of targetCalendar.map(d=>d.day)){
        const cols=(byDay.get(day)||[]).slice().sort((a,b)=>a.c-b.c);
        const expectedSlots=day<=activeCount?policy[targetCalendar[day-1].weekdayIndex]:1;
        assert.equal(cols.length,expectedSlots,`day ${day} physical column count matches independent weekday policy`);
        cols.forEach((d,slot)=>assert.equal(d.slot,slot,`day ${day} slot index sequential`));
      }
      assert.equal(m.dateColumns.length,newCalEnd-m.dateStart+1,'calendar column count matches its own span');

      // 2) Student info columns (left of the calendar) and block order/bounds preserved verbatim;
      //    prior attendance marks never carried into the new, still-blank month.
      const originalBlocksByStart=new Map(original.studentBlocks.map(b=>[b.start,b]));
      for(const b of m.studentBlocks){
        const sourceBlock=originalBlocksByStart.get(b.start);
        assert.ok(sourceBlock,'student block start row preserved');
        assert.equal(b.end,sourceBlock.end,'student block end row preserved');
        assert.equal(b.name,sourceBlock.name,'student identity unchanged');
        for(let row=b.start;row<=b.end;row++)for(let c=m.area.c;c<m.dateStart;c++){
          assert.equal(textOf(nextGrid.cells.get(cellRef(c,row)),template.strings),textOf(oldGrid.cells.get(cellRef(c,row)),template.strings),'student info column unchanged');
        }
        for(let row=b.start;row<=b.end;row++)for(const d of m.dateColumns){
          assert.equal(textOf(nextGrid.cells.get(cellRef(d.c,row)),template.strings),'','prior attendance mark cleared');
        }
      }
      assert.equal(m.studentBlocks.length,original.studentBlocks.length,'student block count preserved');

      // 3) The calendar's right-hand region (make-up/total/summary columns) moved by exactly delta,
      //    with its literal content and column widths intact — never asserted to be byte-identical to
      //    the un-shifted original, since the whole point of the reshape is that it moves.
      const oldColWidth=c=>{const n=all(old,'col').find(x=>Number(attr(x,'min'))<=c&&Number(attr(x,'max'))>=c);return n?Number(attr(n,'width')):0;};
      const newColWidth=c=>{const n=all(result.sheet,'col').find(x=>Number(attr(x,'min'))<=c&&Number(attr(x,'max'))>=c);return n?Number(attr(n,'width')):0;};
      // Title/year/month indicator cells are the one documented exception: generation deliberately
      // rewrites them to the target period, wherever in the sheet (including the trailing region)
      // they happen to sit. Everything else in the trailing region must be untouched apart from the shift.
      const periodRefs=new Set([...original.period.titleCells,...original.period.yearCells,...original.period.monthCells]);
      for(let r=original.area.r;r<=original.area.end.r;r++)for(let c=oldCalEnd+1;c<=original.area.end.c;c++){
        if(periodRefs.has(cellRef(c,r)))continue;
        assert.equal(textOf(nextGrid.cells.get(cellRef(c+delta,r)),template.strings),textOf(oldGrid.cells.get(cellRef(c,r)),template.strings),'trailing region content shifted, not altered');
      }
      for(let c=1;c<original.dateStart;c++)assert.equal(newColWidth(c),oldColWidth(c),`pre-calendar column ${c} width unchanged`);
      for(let c=oldCalEnd+1;c<=original.area.end.c;c++)assert.equal(newColWidth(c+delta),oldColWidth(c),'trailing column width shifted, not altered');
      assert.equal(m.area.end.c,original.area.end.c+delta,'sheet area grows/shrinks by exactly delta');

      // 4) Merges: fully before the calendar are untouched; merges spanning the whole calendar
      //    (e.g. a title row) grow/shrink their end column by delta; merges fully in the trailing
      //    region shift by delta. Merges rebuilt inside the calendar itself are a legitimate part of
      //    this month's header (merged/repeated), so they are not required to match the old ones.
      const oldMerges=all(old,'mergeCell').map(n=>range(attr(n,'ref'))),newMerges=all(result.sheet,'mergeCell').map(n=>range(attr(n,'ref')));
      const sameRange=(a,b)=>a.r===b.r&&a.c===b.c&&a.end.r===b.end.r&&a.end.c===b.end.c;
      for(const om of oldMerges){
        if(om.end.c<original.dateStart){assert.ok(newMerges.some(nm=>sameRange(nm,om)),'pre-calendar merge preserved');continue;}
        if(om.c<=original.dateStart&&om.end.c>=oldCalEnd){assert.ok(newMerges.some(nm=>nm.r===om.r&&nm.c===om.c&&nm.end.r===om.end.r&&nm.end.c===om.end.c+delta),'calendar-spanning merge grows/shrinks with delta');continue;}
        if(om.c>oldCalEnd){assert.ok(newMerges.some(nm=>nm.r===om.r&&nm.end.r===om.end.r&&nm.c===om.c+delta&&nm.end.c===om.end.c+delta),'trailing merge shifted by delta');}
      }

      // 5) Print area grows/shrinks with the calendar — never asserted to stay byte-identical, since
      //    a wider/narrower calendar legitimately needs a wider/narrower print area.
      const oldPrintAreas=printAreaRanges(template.workbook,m.index),newPrintAreas=printAreaRanges(reopened.workbook,m.index);
      assert.equal(newPrintAreas.length,oldPrintAreas.length,'print area count unchanged');
      for(let i=0;i<oldPrintAreas.length;i++){
        const op=oldPrintAreas[i],np=newPrintAreas.find(n=>n.r===op.r&&n.c===op.c&&n.end.r===op.end.r);
        assert.ok(np,'print area start unchanged');
        assert.equal(np.end.c,op.end.c<oldCalEnd?op.end.c:op.end.c+delta,'print area end column follows the calendar delta only when it covered the calendar');
      }

      // 6) Formulas kept verbatim, but never showing a cached prior-month total.
      assert.deepEqual(all(result.sheet,'f').map(n=>n.textContent),all(old,'f').map(n=>n.textContent),'formula text unchanged');
      assert.ok(all(result.sheet,'f').every(n=>!child(n.parentNode,'v')),'stale formula cache removed');

      // 7) The generated workbook must itself still be auto-recognizable and resolve to the target
      //    month — a real re-open check, not just "some <c> nodes exist".
      const reopenedAnalysis=analyzeWorkbook(reopened,attendanceFilename(filename,target.year,target.month));
      assert.equal(reopenedAnalysis.year,target.year,'reopened workbook resolves to the target year');
      assert.equal(reopenedAnalysis.month,target.month,'reopened workbook resolves to the target month');

      summary.push({
        sheetIndex:m.index,year:target.year,month:target.month,
        studentsChecked:m.studentBlocks.filter(b=>b.name).length,
        calendarColumns:m.dateColumns.length,
        checks:['dateWeekdaySlotCounts','studentInfoPreserved','trailingRegionShifted','mergesAndPrintArea','priorMarksCleared','formulaCacheCleared','reopenRecognized'],
      });
    }
    // Unrelated ZIP parts (other sheets, media, etc.) must be byte-identical.
    const touchedPaths=template.sheets.filter(s=>analysis.sheets.some(a=>a.index===s.index)).map(s=>s.path);
    for(const [key,bytes] of Object.entries(template.entries)){
      if(['xl/styles.xml','xl/workbook.xml',...touchedPaths].includes(key))continue;
      assert.equal(hash(reopened.entries[key]),hash(bytes),'unrelated ZIP part unchanged');
    }
  }
}catch(error){
  finish('validation_failed',{success:false,originalUnchanged:hash(source)===before,reason:error.message});
  process.exit();
}

const after=hash(await readFile(path));
assert.equal(after,before,'original file bytes unchanged on disk');
assert.equal(hash(template.bytes),before,'in-memory template bytes unchanged');

finish('success',{
  success:true,originalUnchanged:true,
  sheetsChecked:analysis.sheets.length,
  monthsChecked:testMonths.map(t=>`${t.year}-${String(t.month).padStart(2,'0')}`),
  results:summary,
});

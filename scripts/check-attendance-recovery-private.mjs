import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {openTemplate,inspectAttendanceSheets,generateWorkbook,nextMonth} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,textOf,indexSheet,cellRef,calendarMonth} from '../public/data-core/work/attendance-template.js';

// Opt-in local read-only acceptance. No real names, source paths, cell values or output workbooks leave memory.
const directory=process.env.ATTENDANCE_PRIVATE_DIRECTORY;
if(!directory)throw Error('ATTENDANCE_PRIVATE_DIRECTORY required');
const hash=b=>createHash('sha256').update(b).digest('hex');
let index=0;
for(const filename of (await readdir(directory)).filter(n=>n.endsWith('.xlsx')).sort()){
  const fileIndex=++index,sourcePath=path.join(directory,filename),source=await readFile(sourcePath),before=hash(source);
  const t=openTemplate(source,{DOMParser,XMLSerializer}),items=inspectAttendanceSheets(t,filename);
  const ready=items.filter(s=>s.status==='ready'),latest=Math.max(...ready.map(s=>s.mapping.period.year*12+s.mapping.period.month));
  const sheets=ready.filter(s=>s.mapping.period.year*12+s.mapping.period.month===latest).map(s=>s.mapping);
  console.log(JSON.stringify({fileIndex,stage:'inspected',ready:ready.length,needsPeriod:items.filter(s=>s.status==='needs-period').length,unsupported:items.filter(s=>s.status==='unsupported').length,selected:sheets.length}));
  try{
    assert.ok(sheets.length,'No ready sheet');
    const a={sheets},period=sheets[0].period,options={...nextMonth(period.year,period.month),weekdays:Object.fromEntries(sheets.flatMap(s=>s.studentBlocks.filter(b=>b.needsReview).map(b=>[b.id,'월수금'])))};
    // Test-only weekday confirmations, not changes to real student schedules or claims about their actual days.
    let g,preserveColumns=false;
    try{g=generateWorkbook(t,a,options);}catch(error){
      if(!/수식|그림·표·개체/.test(error.message))throw error;
      preserveColumns=true;g=generateWorkbook(t,a,{...options,preserveColumns});
    }
    const out=openTemplate(g.bytes,{DOMParser,XMLSerializer});
    const touched=new Set(['xl/workbook.xml','xl/styles.xml',...sheets.map(m=>t.sheets[m.index].path)]);
    for(const [key,bytes] of Object.entries(t.entries))if(!touched.has(key))assert.equal(hash(out.entries[key]),hash(bytes),'Unselected ZIP entry changed');
    for(const result of g.results){
      const m=result.mapping,grid=indexSheet(result.sheet),old=t.read(t.sheets[m.index].path),oldGrid=indexSheet(old);
      for(const block of m.studentBlocks)assert.equal(textOf(grid.cells.get(cellRef(m.nameCol,block.start)),t.strings),textOf(oldGrid.cells.get(cellRef(m.nameCol,block.start)),t.strings),'Student identity changed');
      const calendar=calendarMonth(options.year,options.month);
      for(const d of m.dateColumns.filter(d=>d.slot===0))assert.equal(textOf(grid.cells.get(cellRef(d.c,m.weekdayRow)),t.strings),m.weekdayRow&&calendar[d.day-1].active?calendar[d.day-1].weekday:'','Weekday mismatch');
      assert.deepEqual(all(result.sheet,'f').map(f=>f.textContent),all(old,'f').map(f=>f.textContent),'Formula text changed');
      assert.ok(all(result.sheet,'f').every(f=>!child(f.parentNode,'v')),'Stale formula cache');
      if(preserveColumns)assert.deepEqual(all(result.sheet,'col').map(n=>Array.from(n.attributes).map(a=>[a.name,a.value])),all(old,'col').map(n=>Array.from(n.attributes).map(a=>[a.name,a.value])),'Column geometry changed');
      assert.ok(all(result.sheet,'mergeCell').every(n=>attr(n,'ref')));
    }
    assert.equal(hash(await readFile(sourcePath)),before,'Original disk bytes changed');assert.equal(hash(t.bytes),before,'Original memory bytes changed');
    console.log(JSON.stringify({fileIndex,stage:'generated',success:true,sheets:sheets.length,preserveColumns,originalUnchanged:true,unselectedPartsUnchanged:true,formulaTextPreserved:true,testOnlyWeekdayConfirmation:true}));
  }catch(error){
    console.log(JSON.stringify({fileIndex,stage:'failed',success:false,originalUnchanged:hash(await readFile(sourcePath))===before,reason:error.message}));process.exitCode=1;
  }
}

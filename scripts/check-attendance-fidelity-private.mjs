import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {openTemplate,inspectAttendanceSheets,generateWorkbook,nextMonth} from '../public/data-core/work/attendance-auto.js';
import {all,attr,indexSheet,cellRef,styleEngine,cellStyleId,number,textOf,calendarMonth,range,renderTable,TABLE_CSS,planPages,putValue,updateTitle,address} from '../public/data-core/work/attendance-template.js';

const directory=process.env.ATTENDANCE_PRIVATE_DIRECTORY;
if(!directory)throw Error('ATTENDANCE_PRIVATE_DIRECTORY required');
const hash=b=>createHash('sha256').update(b).digest('hex'),env={DOMParser,XMLSerializer};
let verified=0;
for(const filename of (await fs.readdir(directory)).filter(n=>n.endsWith('.xlsx')).sort()){
  const file=path.join(directory,filename),bytes=await fs.readFile(file),before=hash(bytes),t=openTemplate(bytes,env);
  for(const item of inspectAttendanceSheets(t,filename).filter(s=>s.status==='ready'&&s.mapping.studentBlocks.some(b=>b.inactive))){
    const m=item.mapping,original=t.read(t.sheets[m.index].path),old=indexSheet(original),options=nextMonth(m.period.year,m.period.month);
    const r=generateWorkbook(t,{sheets:[m]},options).results[0],grid=indexSheet(r.sheet),oldStyles=styleEngine(t.styles,t),newStyles=styleEngine(r.styles,t);
    const sourceCal=calendarMonth(m.period.year,m.period.month),targetCal=calendarMonth(options.year,options.month);
    const notes=all(original,'mergeCell').map(n=>range(attr(n,'ref'))).filter(p=>p.c>=m.dateStart&&p.r<m.dateRow&&textOf(old.cells.get(cellRef(p.c,p.r)),t.strings).trim());
    const fill=(styles,sheet,g,c,row)=>styles.fillColor(number(styles.xf(cellStyleId(sheet,g.cells.get(cellRef(c,row)),c)),'fillId',0))?.toUpperCase()||'#FFFFFF';
    let checkedCells=0,unknownCells=0;
    for(const b of m.studentBlocks){
      assert.equal(textOf(grid.cells.get(cellRef(m.nameCol,b.start)),t.strings),textOf(old.cells.get(cellRef(m.nameCol,b.start)),t.strings),'Student field changed');
      if(b.inactive){assert.equal(textOf(grid.cells.get(cellRef(m.dateStart,b.start)),t.strings),'휴원');continue;}
      for(let row=b.start;row<=b.end;row++)for(const target of r.mapping.dateColumns){
        if(!targetCal[target.day-1].active)continue;
        const candidates=m.dateColumns.filter(d=>d.day<=28&&d.slot===target.slot&&sourceCal[d.day-1].weekdayIndex===targetCal[target.day-1].weekdayIndex&&!notes.some(p=>d.c>=p.c&&d.c<=p.end.c)&&!textOf(old.cells.get(cellRef(d.c,row)),t.strings).trim());
        if(candidates.length<2){unknownCells++;continue;}
        const counts=new Map();for(const d of candidates){const color=fill(oldStyles,original,old,d.c,row);counts.set(color,(counts.get(color)||0)+1);}
        const votes=[...counts].sort((a,b)=>b[1]-a[1]);if(votes[0][1]<2||votes[1]?.[1]===votes[0][1]){unknownCells++;continue;}
        assert.equal(fill(newStyles,r.sheet,grid,target.c,row),votes[0][0],'Recurring cell color mismatch');checkedCells++;
      }
    }
    assert.ok(checkedCells>500);assert.equal(hash(await fs.readFile(file)),before);assert.equal(hash(t.bytes),before);
    console.log(JSON.stringify({verifiedSheet:++verified,checkedCells,unknownCells,originalUnchanged:true,inactivePreserved:true}));
    if(process.env.ATTENDANCE_RENDER_ANONYMIZED==='1'){
      // Replace ALL non-calendar text before rendering. Never persist the private workbook or raw HTML.
      const anonymous=result=>{
        const copy={...result,sheet:result.sheet.cloneNode(true)};
        for(const cell of all(copy.sheet,'c')){
          const p=address(attr(cell,'r')),value=textOf(cell,t.strings);if(!value)continue;
          if(result.mapping.period.titleCells.includes(attr(cell,'r'))){updateTitle(cell,`${result.year}년 ${result.month}월 검증용 출석부`,copy.sheet,t);continue;}
          if(p.c===m.nameCol&&p.r>=m.firstStudentRow){putValue(cell,`학생${String(p.r-m.firstStudentRow+1).padStart(2,'0')}`,copy.sheet);continue;}
          if(/^[-+?\d.\s]+$/.test(value)||/^(?:[월화수목금토일]+|휴원|보|보강|이름|학교|학년|수업요일|정규횟수|총횟수|5주차|No)$/.test(value.replace(/\s/g,'')))continue;
          putValue(cell,p.c<m.dateStart&&p.r>=m.firstStudentRow?'검증학교':'검증용',copy.sheet);
        }
        return copy;
      };
      const source={sheet:original,styles:t.styles,template:t,area:m.area,mapping:m,year:m.period.year,month:m.period.month,plan:planPages(original,m.area,m,{start:m.area.r,end:m.area.end.r})};
      const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browser=await chromium.launch({channel:'chrome',headless:true});
      try{
        const out=path.resolve('outputs/attendance-fidelity-anonymous');await fs.mkdir(out,{recursive:true});
        for(const [label,result] of [['source',source],['result',r]]){
          const page=await browser.newPage({viewport:{width:1920,height:1280}});await page.route('**/*',route=>route.abort());
          const safe=anonymous(result),scale=1900/safe.plan.dimensions.width;
          await page.setContent(`<style>${TABLE_CSS}body{margin:8px}.at-sheet{transform:scale(${scale});transform-origin:top left}</style>${renderTable(safe)}`);
          await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,`${verified}-${label}.png`),fullPage:true});await page.close();
        }
      }finally{await browser.close();}
    }
  }
}
assert.ok(verified,'No matching inactive-row template; no private fidelity claim made');

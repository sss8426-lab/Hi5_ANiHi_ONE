import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {basename} from 'node:path';
import {openTemplate,analyzeWorkbook,generateWorkbook} from '../public/data-core/work/attendance-auto.js';
import {all,attr,child,indexSheet,textOf,cellRef} from '../public/data-core/work/attendance-template.js';

// Read-only, opt-in local validation. Never writes a workbook, names, paths or previews.
const path=process.env.ATTENDANCE_PRIVATE_SOURCE;
if(!path)throw Error('ATTENDANCE_PRIVATE_SOURCE is required');
const hash=b=>createHash('sha256').update(b).digest('hex'),source=await readFile(path),before=hash(source);
const template=openTemplate(source,{DOMParser,XMLSerializer}),analysis=analyzeWorkbook(template,basename(path));
const summary=[];
assert.equal(analysis.sheets.some(s=>s.studentBlocks.some(b=>b.needsReview)),false,'Manual schedule review required; no arbitrary overrides in private verification');
for(const [year,month] of [[2026,10],[2027,2]]){
  const output=generateWorkbook(template,analysis,{year,month});
  const reopened=openTemplate(output.bytes,{DOMParser,XMLSerializer});
  for(const result of output.results){
    const m=result.mapping,old=template.read(template.sheets[m.index].path),oldGrid=indexSheet(old),nextGrid=indexSheet(result.sheet);
    for(const tag of ['col','row','mergeCell','pageMargins'])assert.deepEqual(all(result.sheet,tag).map(n=>Array.from(n.attributes).map(a=>[a.name,a.value])),all(old,tag).map(n=>Array.from(n.attributes).map(a=>[a.name,a.value])),tag);
    for(const b of m.studentBlocks){
      assert.equal(textOf(nextGrid.cells.get(cellRef(m.nameCol,b.start)),template.strings),textOf(oldGrid.cells.get(cellRef(m.nameCol,b.start)),template.strings),'Student identity changed');
      for(let row=b.start;row<=b.end;row++)for(const d of m.dateColumns)assert.equal(textOf(nextGrid.cells.get(cellRef(d.c,row)),template.strings),'','Prior attendance retained');
    }
    assert.ok(all(reopened.read(template.sheets[m.index].path),'c').length);
    assert.deepEqual(all(result.sheet,'f').map(n=>n.textContent),all(old,'f').map(n=>n.textContent));
    assert.ok(all(result.sheet,'f').every(n=>!child(n.parentNode,'v')),'Old formula total shown');
    summary.push({sheet:m.name,year,month,students:m.studentBlocks.filter(b=>b.name).length,pages:result.plan.pages.length,originalGeometry:true,priorMarksCleared:true});
  }
  for(const [key,bytes] of Object.entries(template.entries))if(!['xl/styles.xml','xl/workbook.xml',...template.sheets.filter(s=>analysis.sheets.some(a=>a.index===s.index)).map(s=>s.path)].includes(key))assert.equal(hash(reopened.entries[key]),hash(bytes),'Unrelated ZIP part changed');
  const oldAreas=all(template.workbook,'definedName').filter(n=>attr(n,'name')==='_xlnm.Print_Area').map(n=>n.textContent);
  assert.deepEqual(all(reopened.workbook,'definedName').filter(n=>attr(n,'name')==='_xlnm.Print_Area').map(n=>n.textContent),oldAreas);
}
assert.equal(hash(await readFile(path)),before);assert.equal(hash(template.bytes),before);
console.log(JSON.stringify({readOnly:true,originalUnchanged:true,sheets:summary,serverRequests:0,filesWritten:0}));

import {attendanceFixture} from './attendance-fixture.mjs';
import {unzipSync,zipSync,strToU8} from '../../public/data-core/vendor/fflate-0.8.3.js';
import {calendarMonth,cellRef,columnName} from '../../public/data-core/work/attendance-template.js';

export function sparseFixture({saturdaySlots=3,sundaySlots=0,weekdaySlots=1,staleDates=false,brokenFormula=false,unknownFormula=false}={}){
  const files=unzipSync(attendanceFixture()),columns=[],merges=[],rows=[];let c=5;
  for(const d of calendarMonth(2026,9).filter(d=>d.active&&d.weekdayIndex!==1&&(sundaySlots||d.weekdayIndex!==0))){
    if(columns.length&&d.weekdayIndex===2)columns.push({c:c++,separator:true});
    const slots=d.weekdayIndex===6?saturdaySlots:d.weekdayIndex===0?sundaySlots:weekdaySlots;
    const start=c;
    for(let slot=0;slot<slots;slot++)columns.push({...d,c:c++,slot});
    if(slots>1)for(const row of [3,4])merges.push(`${cellRef(start,row)}:${cellRef(c-1,row)}`);
  }
  const last=c-1,end=10,tail=last+1;
  merges.push(`A1:${columnName(tail)}1`,'A3:A4','B3:B4','C3:C4','D3:D4');
  const cell=(col,row,value='',style=1)=>`<c r="${cellRef(col,row)}" s="${style}"${typeof value==='number'?'':' t="inlineStr"'}>${typeof value==='number'?`<v>${value}</v>`:`<is><t>${value}</t></is>`}</c>`;
  rows.push(`<row r="1" ht="28">${cell(1,1,'2026년 9월 SYNTHETIC',3)}</row>`);
  rows.push(`<row r="2" ht="15">${columns.map(d=>`<c r="${cellRef(d.c,2)}" s="1"><f${d.c===5?' t="shared" si="0" ref="E2:F2"':d.c===6?' t="shared" si="0"':''}>${d.c===6?'':unknownFormula?'INDIRECT(&quot;E5&quot;)':`COUNTIF(${cellRef(d.c,5)}:${cellRef(d.c,end)},&quot;1&quot;)`}</f><v>9</v></c>`).join('')}</row>`);
  rows.push(`<row r="3" ht="15">${cell(1,3,'No')}${cell(2,3,'이름')}${cell(3,3,'수업요일')}${cell(4,3,'총횟수')}${columns.map(d=>cell(d.c,3,d.separator||d.slot?'':staleDates&&d.day>=16&&d.day<=20?d.day-13:d.day)).join('')}${cell(tail,3,'보강')}</row>`);
  rows.push(`<row r="4" ht="15">${columns.map(d=>cell(d.c,4,d.separator||d.slot?'':d.weekday)).join('')}</row>`);
  for(let row=5;row<=end;row++){
    const slot=(row-5)%saturdaySlots;
    rows.push(`<row r="${row}" ht="19">${cell(1,row,row-4)}${cell(2,row,`SYNTHETIC_${row}`)}${cell(3,row,'화목토')}<c r="D${row}" s="1"><f>COUNTIF(${brokenFormula&&row===5?'#REF!':`E${row}:${cellRef(last,row)}`},&quot;1&quot;)</f><v>12</v></c>${columns.map(d=>cell(d.c,row,d.separator?'':(d.weekdayIndex===2||d.weekdayIndex===4)&&!d.slot||d.weekdayIndex===6&&d.slot===slot?1:'')).join('')}${cell(tail,row,'SYNTHETIC_TAIL')}</row>`);
  }
  rows.push(`<row r="14">${cell(2,14,'SYNTHETIC_OUTSIDE_PRINT')}${cell(7,14,'SYNTHETIC_ARCHIVED_MARK')}</row>`);
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  files['xl/worksheets/sheet1.xml']=strToU8(`<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${columnName(tail)}14"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="4"/><col min="2" max="3" width="12"/><col min="4" max="4" width="0.6"/>${columns.map(d=>`<col min="${d.c}" max="${d.c}" width="${d.separator?0.5:2.5}"/>`).join('')}<col min="${tail}" max="${tail}" width="5"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><conditionalFormatting sqref="E5:${cellRef(last,end)}"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0"><formula>1</formula></cfRule></conditionalFormatting><pageMargins left="0.2" right="0.2" top="0.2" bottom="0.2" header="0" footer="0"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/></worksheet>`);
  files['xl/workbook.xml']=strToU8(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SYNTHETIC" sheetId="1" r:id="rId1"/><sheet name="보존" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'SYNTHETIC'!$A$1:$${columnName(tail)}$${end}</definedName><definedName name="_xlnm._FilterDatabase" localSheetId="0">'SYNTHETIC'!$A$3:$D$4</definedName></definedNames></workbook>`);
  return {bytes:zipSync(files),columns,last,end,tail};
}

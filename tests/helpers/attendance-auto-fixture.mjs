import {attendanceFixture} from './attendance-fixture.mjs';
import {unzipSync,zipSync,strToU8,strFromU8} from '../../public/data-core/vendor/fflate-0.8.3.js';
import {columnName} from '../../public/data-core/work/attendance-template.js';

// Structural counterpart of the privately inspected workbook. No source cells or names copied.
export function autoFixture({students=4,review=true,year=2026,month=9,fit=true,blocks=true}={}){
  const files=unzipSync(attendanceFixture());
  const cell=(c,r,value='',s=1)=>`<c r="${columnName(c)}${r}" s="${s}"${typeof value==='number'?'':' t="inlineStr"'}>${typeof value==='number'?`<v>${value}</v>`:`<is><t>${value}</t></is>`}</c>`;
  function sheet(multi){
    const start=multi?4:7,columns=[],merges=[];let c=start;
    for(let day=1;day<=31;day++)for(let slot=0;slot<(multi?1:[5,12,19,26].includes(day)?3:1);slot++)columns.push({day,c:c++,slot});
    const last=c-1,rows=[],height=multi&&blocks?3:1,end=3+students*height;
    rows.push(`<row r="1" ht="28" customHeight="1">${cell(1,1,`${year}년 ${multi?'입시':'심화'} 출석부`,3)}${cell(last+1,1,month)}</row>`);
    merges.push(`A1:${columnName(last)}1`);
    rows.push(`<row r="2" ht="15" customHeight="1">${columns.map(d=>cell(d.c,2,d.day<=new Date(Date.UTC(year,month,0)).getUTCDate()?d.day:'')).join('')}</row>`);
    rows.push(`<row r="3" ht="15" customHeight="1">${cell(2,3,'이름')}${cell(3,3,'학교,학년')}${columns.map(d=>cell(d.c,3,d.day<=new Date(Date.UTC(year,month,0)).getUTCDate()?'일월화수목금토'[new Date(Date.UTC(year,month-1,d.day)).getUTCDay()]:'')).join('')}</row>`);
    for(let i=0;i<students;i++){
      const r=4+i*height,days=i%4===0?[1,3,5]:i%4===1?[2,4]:i%4===2?[6]:review?[]:[1,3,5];
      if(height>1)for(const name of ['A','B','C'])merges.push(`${name}${r}:${name}${r+height-1}`);
      for(let offset=0;offset<height;offset++){
        const row=r+offset;
        rows.push(`<row r="${row}" ht="15" customHeight="1">${offset===0?cell(1,row,i+1)+cell(2,row,i<2?'SYNTHETIC_DUPLICATE':`SYNTHETIC_${i}`)+cell(3,row,'SYNTHETIC_GRADE'):''}${columns.map(d=>{
          const valid=d.day<=new Date(Date.UTC(year,month,0)).getUTCDate(),wd=new Date(Date.UTC(year,month-1,d.day)).getUTCDay();
          const regular=valid&&days.includes(wd),exception=valid&&d.day===1&&(i%4===0||i%4===3&&review);
          return cell(d.c,row,regular?(multi?`${String(month).padStart(2,'0')}월`:1):exception?'정':'');
        }).join('')}</row>`);
      }
    }
    return {last,end,xml:`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="${fit?'1':'0'}"/></sheetPr><dimension ref="A1:${columnName(last+1)}${end}"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="3.6"/><col min="2" max="3" width="10"/><col min="4" max="${last+1}" width="2.4"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><conditionalFormatting sqref="${columnName(start)}4:${columnName(last)}${end}"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0"><formula>${multi?`&quot;${String(month).padStart(2,'0')}월&quot;`:'1'}</formula></cfRule></conditionalFormatting><pageMargins left="0.1968503937" right="0.1968503937" top="0.1968503937" bottom="0.1968503937" header="0" footer="0"/><pageSetup paperSize="9" orientation="landscape" scale="80"${fit?' fitToWidth="1" fitToHeight="1"':''}/></worksheet>`};
  }
  const exams=sheet(true),advanced=sheet(false);
  files['xl/worksheets/sheet3.xml']=files['xl/worksheets/sheet2.xml'];
  files['xl/worksheets/sheet1.xml']=strToU8(exams.xml);files['xl/worksheets/sheet2.xml']=strToU8(advanced.xml);
  files['xl/workbook.xml']=strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="입시" sheetId="1" r:id="rId1"/><sheet name="심화" sheetId="2" r:id="rId2"/><sheet name="보존" sheetId="3" r:id="rId4"/></sheets><definedNames>${[exams,advanced].map((s,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${i?'심화':'입시'}'!$A$1:$${columnName(s.last+1)}$${s.end}</definedName>`).join('')}</definedNames></workbook>`);
  files['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace('</Relationships>','<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'));
  files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace('</Types>','<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
  files['xl/styles.xml']=strToU8(strFromU8(files['xl/styles.xml']).replace('</styleSheet>','<dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></dxf></dxfs></styleSheet>'));
  return zipSync(files);
}

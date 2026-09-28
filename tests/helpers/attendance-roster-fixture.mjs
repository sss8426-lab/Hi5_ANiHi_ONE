// Synthetic 출석부 종합입력 (official layout): title, "캠퍼스: …" line, header row 4 (A No … U 비고),
// then per class a big A:U merged bar with the class name in A, followed by its students. No real
// student data: names, schools and numbers are all synthetic.
import {zipSync,strToU8} from '../../public/data-core/vendor/fflate-0.8.3.js';
import {columnName} from '../../public/data-core/work/attendance-template.js';
import {ROSTER_HEADERS} from '../../public/data-core/work/attendance-roster-parser.js';
import {parseSchedule} from '../../public/data-core/work/attendance-roster-schedule.js';

const SLOT_COLUMNS=['월','화','수','목','금','토1','토2','토3','일1','일2','일3'];
const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** 10 classes × 10 students, schedules cycling through valid 수업요일 texts. */
export function defaultClasses(count=10,students=10){
  const schedules=['월수금','화목토1','화목토2일1','토1토3','수금토1토2','일1일2','월화수목금','목토2','화수토1','금일1'];
  return Array.from({length:count},(_,c)=>({name:`SYNTHETIC반${c+1}`,students:Array.from({length:students},(_,s)=>({
    name:`학생${c+1}-${s+1}`,school:`가상고${(s%3)+1}`,grade:String((s%3)+1),
    studentPhone:`010-0000-${String(c*100+s).padStart(4,'0')}`,parentPhone:`010-9999-${String(c*100+s).padStart(4,'0')}`,
    registered:46027+c*7+s,schedule:schedules[(c+s)%schedules.length],
  }))}));
}
/**
 * @param {object} o
 * @param {{name:string,students:object[]}[]} [o.classes]
 * @param {string|null} [o.campus]  null → no campus line
 * @param {string[]} [o.headers]
 * @param {boolean} [o.mergeBars]
 * @param {string} [o.sheetName]
 */
export function rosterFixture({classes=defaultClasses(),campus='SYNTHETIC 캠퍼스',headers=ROSTER_HEADERS,mergeBars=true,sheetName='종합입력',marks=true}={}){
  const rows=[],merges=[];let r=1;
  const cell=(c,row,value,style=0)=>{
    if(value===''||value===null||value===undefined)return '';
    if(typeof value==='number')return `<c r="${columnName(c)}${row}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${columnName(c)}${row}" s="${style}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  };
  rows.push(`<row r="${r}">${cell(1,r,'출석부 종합입력')}</row>`);merges.push(`A${r}:U${r}`);r++;
  if(campus!==null)rows.push(`<row r="${r}">${cell(1,r,`캠퍼스: ${campus}`)}</row>`);r++;
  r++;
  const headerRow=r;rows.push(`<row r="${r}">${headers.map((h,i)=>cell(i+1,r,h)).join('')}</row>`);r++;
  for(const group of classes){
    rows.push(`<row r="${r}">${cell(1,r,group.name)}</row>`);if(mergeBars)merges.push(`A${r}:U${r}`);r++;
    group.students.forEach((s,i)=>{
      const slots=marks&&/^[월화수목금토일123]+$/.test(s.schedule||'')?(s.schedule.match(/[월화수목금]|[토일][1-3]/g)||[]):[];
      const values=[s.no??i+1,s.name??'',s.school??'',s.grade??'',s.studentPhone??'',s.parentPhone??'',s.registered??'',s.schedule??'',
        ...SLOT_COLUMNS.map(slot=>slots.includes(slot)?1:''),slots.length?slots.length*4:'',s.note??''];
      rows.push(`<row r="${r}">${values.map((v,c)=>cell(c+1,r,v,c===6&&typeof v==='number'?1:0)).join('')}</row>`);r++;
    });
  }
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:U${r-1}"/><sheetData>${rows.join('')}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:''}</worksheet>`;
  const entries={
    '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet,
    'xl/styles.xml':`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  return {bytes:zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)]))),headerRow};
}

/** Synthetic A:AE form with three selectable times for each weekday. */
export function expandedRosterFixture({classes=[{name:'SYNTHETIC 확장반',students:[
  {name:'가상학생1',school:'가상고1',grade:'1',studentPhone:'010-0000-0001',parentPhone:'010-9999-0001',registered:46027,schedule:'월1.2 수3 금1.2.3 토1.2 일2.3'},
  {name:'가상학생2',school:'가상고2',grade:'2',studentPhone:'010-0000-0002',parentPhone:'010-9999-0002',registered:46028,schedule:'화3'},
]}],campus='SYNTHETIC 캠퍼스'}={}){
  const rows=[],merges=['A1:AE1','A2:J2'];let r=1;
  const cell=(c,row,value)=>value===null||value===undefined||value===''?'':typeof value==='number'
    ?`<c r="${columnName(c)}${row}"><v>${value}</v></c>`
    :`<c r="${columnName(c)}${row}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  const addRow=(row,values)=>rows.push(`<row r="${row}">${values.map((value,i)=>cell(i+1,row,value)).join('')}</row>`);
  addRow(r,[`출석부 종합입력`]);r++;
  addRow(r,[`캠퍼스: ${campus}`]);r+=2;
  const headers=ROSTER_HEADERS.slice(0,8),header=[...headers,...Array(23).fill(null)];
  const subheader=Array(31).fill(null);
  for(let i=0;i<7;i++){
    const c=9+i*3;header[c-1]='월화수목금토일'[i];
    subheader[c-1]=1;subheader[c]=2;subheader[c+1]=3;
    merges.push(`${columnName(c)}4:${columnName(c+2)}4`);
  }
  header[29]='총횟수';header[30]='비고';
  for(let c=1;c<=8;c++)merges.push(`${columnName(c)}4:${columnName(c)}5`);
  merges.push('AD4:AD5','AE4:AE5');
  addRow(4,header);addRow(5,subheader);r=6;
  const dayIndex={월:0,화:1,수:2,목:3,금:4,토:5,일:6};
  for(const group of classes){
    addRow(r,[group.name]);merges.push(`A${r}:AE${r}`);r++;
    group.students.forEach((student,i)=>{
      const schedule=parseSchedule(student.schedule),values=[i+1,student.name,student.school,student.grade,
        student.studentPhone,student.parentPhone,student.registered,student.schedule,...Array(21).fill(null)];
      for(const slot of schedule.slots){const c=9+dayIndex[slot[0]]*3+Number(slot.slice(1))-1;values[c-1]=1;}
      values[29]=schedule.slots.length;values[30]=student.note||'';
      addRow(r,values);r++;
    });
  }
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:AE${r-1}"/><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`;
  const entries={
    '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="종합입력" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet,
    'xl/styles.xml':`<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
  };
  return {bytes:zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)])))};
}

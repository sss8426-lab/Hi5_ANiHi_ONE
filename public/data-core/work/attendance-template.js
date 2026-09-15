import {unzipSync, zipSync, strFromU8, strToU8} from '../vendor/fflate-0.8.3.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAX_ROWS = 1000, MAX_COLS = 128;
const DAYS = '일월화수목금토';
const elements = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const children = (node, tag) => elements(node).filter(n => n.localName === tag);
const child = (node, tag) => children(node, tag)[0];
const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
const attr = (node, key, fallback = '') => node?.getAttribute(key) || fallback;
const number = (node, key, fallback) => node?.hasAttribute(key) ? Number(node.getAttribute(key)) : fallback;
const check = (condition, message) => { if (!condition) throw Error(message); };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const columnName = n => { let s=''; for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s; return s; };
export const columnNumber = s => /^[A-Z]{1,3}$/i.test(s) ? [...s.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0) : 0;
export function address(ref) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref || '');
  check(m, '셀 위치는 A1 형식으로 입력해주세요.');
  const c=columnNumber(m[1]), r=Number(m[2]);
  check(c<=MAX_COLS && r>=1 && r<=MAX_ROWS, '지원 범위는 128열, 1,000행까지입니다.'); return {c,r};
}
const cellRef = (c,r) => `${columnName(c)}${r}`;
function range(ref) { const [a,b=a]=ref.split(':'); return {...address(a), end:address(b)}; }
function xml(text, env) {
  check(!/<!DOCTYPE|<!ENTITY/i.test(text), '외부 엔터티가 포함된 파일은 사용할 수 없습니다.');
  const doc=new env.DOMParser().parseFromString(text,'application/xml');
  check(doc.documentElement && !all(doc,'parsererror').length, 'Excel XML을 읽지 못했습니다.'); return doc;
}
const create = (doc, name, attrs={}) => { const n=doc.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n; };
const SHEET_ORDER = ['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
function ensureSheet(doc, tag) {
  let n=child(doc.documentElement,tag); if(n)return n;
  n=create(doc,tag);const i=SHEET_ORDER.indexOf(tag);
  doc.documentElement.insertBefore(n,elements(doc.documentElement).find(el=>SHEET_ORDER.indexOf(el.localName)>i)||null);return n;
}
function namedRange(workbook, sheetIndex, kind) { return all(workbook,'definedName').find(n=>attr(n,'name')===kind && Number(attr(n,'localSheetId','-1'))===sheetIndex); }
function areaFor(workbook,index,sheet) {
  const text=namedRange(workbook,index,'_xlnm.Print_Area')?.textContent;
  let declared;
  if(text) {
    const m=/^('(?:[^']|'')+'|[^!]+)!([^!,]+)$/.exec(text);
    check(m,'인쇄 영역이 여러 구간입니다. 연속된 출석부 영역을 지정한 양식이 필요합니다.');declared=range(m[2]);
  } else declared=range(attr(child(sheet.documentElement,'dimension'),'ref','A1'));
  // Both the Print_Area name and the sheet's own <dimension> tag are metadata that some tools fail to
  // recompute after edits, so either can go stale and report a smaller used range than the sheet's
  // real cells. Never shrink below what cells actually exist — but keep trusting the declared range
  // where it reports MORE than the real cells, since templates commonly pre-format blank rows/columns
  // below current data for future months.
  let maxR=declared.end.r,maxC=declared.end.c;
  for(const c of all(sheet,'c')){
    const {c:col,r:row}=address(attr(c,'r'));
    if(row>maxR)maxR=row;
    if(col>maxC)maxC=col;
  }
  return maxR===declared.end.r&&maxC===declared.end.c?declared:{...declared,end:{r:maxR,c:maxC}};
}
function textOf(cell, shared) {
  if(!cell)return '';
  const t=attr(cell,'t');
  if(t==='s')return shared[Number(child(cell,'v')?.textContent)] || '';
  if(t==='inlineStr')return all(cell,'t').map(n=>n.textContent).join('');
  return child(cell,'v')?.textContent || '';
}
function indexSheet(doc) { const rows=new Map(),cells=new Map(); for(const r of all(doc,'row')){rows.set(Number(attr(r,'r')),r);for(const c of children(r,'c'))cells.set(attr(c,'r').replace(/\$/g,''),c);}return {rows,cells}; }
export function parseWeekdays(text) {
  const value=String(text).trim().replace(/요일/g,'').replace(/[\s,·/|+()-]/g,'');
  if(value==='매일')return [0,1,2,3,4,5,6]; if(value==='평일')return [1,2,3,4,5]; if(value==='주말')return [0,6];
  check(!value || /^[월화수목금토일]+$/.test(value),'수업요일을 확인해주세요. 예: 월수금, 화/목, 평일');
  return [...new Set([...value].map(v=>DAYS.indexOf(v)))];
}
export function calendarMonth(year,month) {
  check(Number.isInteger(year)&&year>=1901&&year<=2100&&Number.isInteger(month)&&month>=1&&month<=12,'연도와 월을 확인해주세요.');
  const count=new Date(Date.UTC(year,month,0)).getUTCDate();
  return Array.from({length:31},(_,i)=>({day:i+1,active:i<count,weekday:DAYS[new Date(Date.UTC(year,month-1,i+1)).getUTCDay()],weekdayIndex:new Date(Date.UTC(year,month-1,i+1)).getUTCDay()}));
}
function dateParts(value, epoch1904=false) {
  const n=Number(value); if(!Number.isFinite(n)||n<30000||n>80000)return null;
  const d=new Date(Date.UTC(epoch1904?1904:1899,epoch1904?0:11,epoch1904?1:30)+n*86400000);
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
export function openTemplate(input,env=globalThis) {
  const bytes=new Uint8Array(input).slice();check(bytes.length<=20*1024*1024,'Excel 파일은 20MB 이하로 올려주세요.');
  let total=0,count=0;
  let entries;
  try { entries=unzipSync(bytes,{filter:f=>{total+=f.originalSize;count++;check(total<=100*1024*1024&&count<=2048,'Excel 압축 해제 크기가 너무 큽니다.');check(!f.name.startsWith('/')&&!f.name.split('/').includes('..'),'잘못된 Excel 경로입니다.');return true;}}); }
  catch { throw Error('암호화되지 않은 .xlsx 파일을 선택해주세요. 오래된 .xls 파일은 Excel에서 .xlsx로 저장해주세요.'); }
  check(entries['xl/workbook.xml']&&entries['xl/styles.xml'],'출석부 .xlsx 파일을 확인해주세요.');
  check(!Object.keys(entries).some(k=>/vbaProject|_xmlsignatures/i.test(k)),'매크로·전자서명 파일은 원본을 보존하기 위해 지원하지 않습니다. .xlsx 복사본을 사용해주세요.');
  const read = path => entries[path] ? xml(strFromU8(entries[path]),env) : null;
  const workbook=read('xl/workbook.xml'),rels=read('xl/_rels/workbook.xml.rels');
  const shared=read('xl/sharedStrings.xml');
  const strings=shared?all(shared,'si').map(si=>all(si,'t').map(t=>t.textContent).join('')):[];
  const sheets=all(workbook,'sheet').map((s,index)=>{
    const rel=all(rels,'Relationship').find(r=>attr(r,'Id')===s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
    check(rel&&!attr(rel,'TargetMode'),'외부 시트는 지원하지 않습니다.');
    const target=attr(rel,'Target'); const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;
    check(entries[path]&&!path.split('/').includes('..'),'시트 경로를 확인해주세요.');
    return {name:attr(s,'name'),index,path,hidden:attr(s,'state','visible')!=='visible'};
  });
  return {bytes,entries,workbook,shared,styles:read('xl/styles.xml'),theme:read('xl/theme/theme1.xml'),strings,sheets,env,read,epoch1904:attr(child(workbook.documentElement,'workbookPr'),'date1904')==='1'};
}
export function analyzeSheet(template,index) {
  const descriptor=template.sheets[index];check(descriptor&&!descriptor.hidden,'표시된 출석부 시트를 선택해주세요.');
  const sheet=template.read(descriptor.path),idx=indexSheet(sheet),area=areaFor(template.workbook,index,sheet);
  check(area.end.c<=MAX_COLS&&area.end.r<=MAX_ROWS,'출석부 범위가 너무 큽니다.');
  const value=(c,r)=>textOf(idx.cells.get(cellRef(c,r)),template.strings);
  const candidates=[];
  for(let r=area.r;r<=Math.min(area.end.r,40);r++)for(let c=area.c;c<=area.end.c-27;c++) {
    const first=value(c,r),serial=dateParts(first,template.epoch1904);
    if(Number(first)!==1&&first!=='1일'&&serial?.day!==1)continue;
    if(Array.from({length:28},(_,i)=>serial?dateParts(value(c+i,r),template.epoch1904)?.day===i+1:Number(value(c+i,r).replace(/일$/,''))===i+1).every(Boolean))candidates.push({r,c,serial});
  }
  const candidate=candidates[0];
  const dateRow=candidate?.r||0,dateStart=candidate?.c||0;
  let nameCol=0,weekdayCol=0,titleCell='',sourceYear=candidate?.serial?.year||0,sourceMonth=candidate?.serial?.month||0;
  for(const [ref,cell] of idx.cells) {
    const p=address(ref),v=textOf(cell,template.strings);
    if(p.r>Math.max(dateRow+1,10))continue;
    if(/^(학생명|이름|성명)$/.test(v.trim()))nameCol=p.c;
    if(/^(수업요일|요일|수업일)$/.test(v.replace(/\s/g,'')))weekdayCol=p.c;
    const m=/(20\d{2})\s*년\s*(\d{1,2})\s*월|\b(20\d{2})[.\-/]\s*(\d{1,2})\b/.exec(v);
    if(m&&!titleCell){sourceYear=Number(m[1]||m[3]);sourceMonth=Number(m[2]||m[4]);titleCell=ref;}
    else if(!titleCell&&/출석/.test(v)&&/(\d{1,2})\s*월/.test(v)){sourceMonth=Number(/(\d{1,2})\s*월/.exec(v)[1]);titleCell=ref;}
  }
  let weekdayRow=0;
  if(dateRow && Array.from({length:7},(_,i)=>value(dateStart+i,dateRow+1)).filter(v=>/^[일월화수목금토]([요]일)?$/.test(v)).length>=5)weekdayRow=dateRow+1;
  const firstStudentRow=(weekdayRow||dateRow)+1;
  let lastStudentRow=firstStudentRow;
  if(dateStart)for(let r=firstStudentRow;r<=area.end.r;r++) {
    const n=Array.from({length:31},(_,i)=>idx.cells.has(cellRef(dateStart+i,r))).filter(Boolean).length;
    if(n>=28)lastStudentRow=r;
  }
  return {index,name:descriptor.name,area,dateRow,dateStart,nameCol,weekdayCol,weekdayRow,firstStudentRow,lastStudentRow,titleCell,yearCell:'',monthCell:'',sourceYear,sourceMonth,ambiguous:candidates.length!==1};
}
function validateMapping(m,area) {
  for(const k of ['dateRow','dateStart','nameCol','weekdayCol','firstStudentRow','lastStudentRow'])check(Number.isInteger(m[k])&&m[k]>0, '양식의 날짜·학생·요일 위치를 확인해주세요.');
  check(m.dateStart+30<=MAX_COLS&&m.nameCol<m.dateStart&&m.weekdayCol<m.dateStart&&m.nameCol!==m.weekdayCol,'학생명·수업요일 다음에 날짜 31열이 있어야 합니다.');
  check(m.firstStudentRow>(m.weekdayRow||m.dateRow)&&m.lastStudentRow>=m.firstStudentRow&&m.lastStudentRow<=area.end.r,'학생 시작·마지막 행을 확인해주세요.');
  check(!m.weekdayRow||(m.weekdayRow>m.dateRow&&m.weekdayRow<m.firstStudentRow),'요일 행 위치를 확인해주세요.');
  check(m.dateRow>=area.r&&m.nameCol>=area.c&&m.weekdayCol>=area.c,'학생명·요일·날짜가 인쇄 영역 안에 있어야 합니다.');
  check(!m.sourceYear||Number.isInteger(m.sourceYear)&&m.sourceYear>=1901&&m.sourceYear<=2100,'원본 연도를 확인해주세요.');
  check(!m.sourceMonth||Number.isInteger(m.sourceMonth)&&m.sourceMonth>=1&&m.sourceMonth<=12,'원본 월을 확인해주세요.');
  for(const key of ['titleCell','yearCell','monthCell','lessonStyleCell','plainStyleCell'])if(m[key])address(m[key]);
  for(const key of ['titleCell','yearCell','monthCell'])if(m[key]){
    const p=address(m[key]);
    check(p.r<m.firstStudentRow&&!(p.c>=m.dateStart&&p.c<=m.dateStart+30&&[m.dateRow,m.weekdayRow].includes(p.r)),'제목·연도·월 위치는 학생 행이나 날짜 셀과 겹칠 수 없습니다.');
  }
}
export function templateStudents(template,m) {
  const sheet=template.read(template.sheets[m.index].path),idx=indexSheet(sheet);
  validateMapping(m,areaFor(template.workbook,m.index,sheet));
  return Array.from({length:m.lastStudentRow-m.firstStudentRow+1},(_,i)=>{
    const row=m.firstStudentRow+i;
    return {name:textOf(idx.cells.get(cellRef(m.nameCol,row)),template.strings),weekdays:textOf(idx.cells.get(cellRef(m.weekdayCol,row)),template.strings)};
  });
}
function putValue(cell,value,doc) {
  for(const c of elements(cell))if(['f','v','is'].includes(c.localName))cell.removeChild(c);
  cell.removeAttribute('t');
  if(value===''||value===null)return;
  if(typeof value==='number'){const v=create(doc,'v');v.textContent=String(value);cell.appendChild(v);}
  else {cell.setAttribute('t','inlineStr');const is=create(doc,'is'),t=create(doc,'t');t.setAttribute('xml:space','preserve');t.textContent=value;is.appendChild(t);cell.appendChild(is);}
}
function cellStyleId(sheet,cell,c) {
  if(cell?.hasAttribute('s'))return Number(attr(cell,'s'));
  if(cell?.parentNode?.localName==='row'&&cell.parentNode.hasAttribute('s'))return Number(attr(cell.parentNode,'s'));
  const column=c||address(attr(cell,'r')).c;
  const col=all(sheet,'col').find(n=>number(n,'min',0)<=column&&number(n,'max',0)>=column);
  return number(col,'style',0);
}
function mutableSheet(doc) {
  const idx=indexSheet(doc),data=child(doc.documentElement,'sheetData');
  const cell=(c,r)=>{
    const ref=cellRef(c,r); if(idx.cells.has(ref)){const existing=idx.cells.get(ref);if(!existing.hasAttribute('s'))existing.setAttribute('s',String(cellStyleId(doc,existing,c)));return existing;}
    let row=idx.rows.get(r);if(!row){row=create(doc,'row',{r});data.insertBefore(row,children(data,'row').find(n=>Number(attr(n,'r'))>r)||null);idx.rows.set(r,row);}
    const n=create(doc,'c',{r:ref});row.insertBefore(n,children(row,'c').find(n=>address(attr(n,'r')).c>c)||null);n.setAttribute('s',String(cellStyleId(doc,n,c)));idx.cells.set(ref,n);return n;
  };return {...idx,cell};
}
function colorHex(node,template) {
  if(!node)return null;const rgb=attr(node,'rgb');if(/^[A-Fa-f0-9]{6,8}$/.test(rgb))return `#${rgb.slice(-6)}`;
  const indexed=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
  if(node.hasAttribute('indexed')){const custom=all(template.styles,'indexedColors')[0];const rgb=attr(elements(custom)[Number(attr(node,'indexed'))],'rgb');if(/^[A-Fa-f0-9]{6,8}$/.test(rgb))return `#${rgb.slice(-6)}`;}
  if(node.hasAttribute('indexed'))return indexed[Number(attr(node,'indexed'))]?`#${indexed[Number(attr(node,'indexed'))]}`:null;
  if(node.hasAttribute('theme')&&template.theme) {
    const scheme=all(template.theme,'clrScheme')[0];const order=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
    const c=elements(child(scheme,order[Number(attr(node,'theme'))]))[0];const base=attr(c,'lastClr',attr(c,'val'));if(!/^[\da-f]{6}$/i.test(base))return null;
    const tint=number(node,'tint',0);return '#'+[0,2,4].map(i=>{const n=parseInt(base.slice(i,i+2),16);return Math.round(tint<0?n*(1+tint):n+(255-n)*tint).toString(16).padStart(2,'0');}).join('');
  }return null;
}
function styleEngine(doc,template) {
  const xfs=child(doc.documentElement,'cellXfs'),fills=child(doc.documentElement,'fills');
  check(xfs&&fills,'Excel 셀 스타일을 확인해주세요.');
  const xf=id=>children(xfs,'xf')[id]||children(xfs,'xf')[0];
  const fillId=cell=>number(xf(number(cell,'s',0)),'fillId',0);
  const fillColor=id=>colorHex(child(child(children(fills,'fill')[id],'patternFill'),'fgColor'),template);
  const addFill=hex=>{const found=children(fills,'fill').findIndex(f=>attr(child(f,'patternFill'),'patternType')==='solid'&&attr(child(child(f,'patternFill'),'fgColor'),'rgb')===hex);if(found>=0)return found;const f=create(doc,'fill'),p=create(doc,'patternFill',{patternType:'solid'});p.appendChild(create(doc,'fgColor',{rgb:hex}));p.appendChild(create(doc,'bgColor',{indexed:64}));f.appendChild(p);fills.appendChild(f);fills.setAttribute('count',String(children(fills,'fill').length));return children(fills,'fill').length-1;};
  const cache=new Map();
  const withFill=(id,fill)=>{if(number(xf(id),'fillId',0)===fill)return id;const key=`${id}:${fill}`;if(cache.has(key))return cache.get(key);const n=xf(id).cloneNode(true);n.setAttribute('fillId',String(fill));n.setAttribute('applyFill','1');xfs.appendChild(n);const next=children(xfs,'xf').length-1;xfs.setAttribute('count',String(next+1));cache.set(key,next);return next;};
  return {xf,fillId,fillColor,addFill,withFill};
}
function mostCommon(values,fallback=0) { const counts=new Map();values.forEach(v=>counts.set(v,(counts.get(v)||0)+1));return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??fallback; }
function shiftRange(ref,at,delta) {
  return ref.split(' ').map(part=>{const p=range(part);return `${cellRef(p.c,p.r>=at?p.r+delta:p.r)}:${cellRef(p.end.c,p.end.r>=at?p.end.r+delta:p.end.r)}`;}).join(' ');
}
// Column analog of shiftRange, used when the calendar's physical width changes between months.
export function shiftRangeColumns(ref,at,delta) {
  return ref.split(' ').map(part=>{const p=range(part);return `${cellRef(p.c>=at?p.c+delta:p.c,p.r)}:${cellRef(p.end.c>=at?p.end.c+delta:p.end.c,p.end.r)}`;}).join(' ');
}
function growRows(doc,workbook,m,extra) {
  if(!extra)return;
  // Arbitrary formula/drawing references cannot be safely shifted by a table adapter.
  check(!all(doc,'f').length&&!['drawing','legacyDrawing','tableParts','conditionalFormatting','dataValidations'].some(tag=>all(doc,tag).length),'이 양식의 수식·그림·조건부 영역은 자동 행 확장을 지원하지 않습니다. Excel에서 학생 빈 행을 늘린 복사본을 사용해주세요.');
  const at=m.lastStudentRow+1,data=child(doc.documentElement,'sheetData'),sample=children(data,'row').find(r=>Number(attr(r,'r'))===m.lastStudentRow);
  check(sample,'복사할 학생 행을 확인해주세요.');
  for(const row of children(data,'row').reverse())if(Number(attr(row,'r'))>=at){row.setAttribute('r',String(Number(attr(row,'r'))+extra));for(const c of children(row,'c')){const p=address(attr(c,'r'));c.setAttribute('r',cellRef(p.c,p.r+extra));}}
  for(let i=0;i<extra;i++){const row=sample.cloneNode(true),r=at+i;row.setAttribute('r',String(r));for(const c of children(row,'c')){c.setAttribute('r',cellRef(address(attr(c,'r')).c,r));putValue(c,'',doc);}data.insertBefore(row,children(data,'row').find(n=>Number(attr(n,'r'))>r)||null);}
  for(const tag of ['mergeCell','autoFilter','dimension','hyperlink'])for(const n of all(doc,tag))if(n.hasAttribute('ref'))n.setAttribute('ref',shiftRange(attr(n,'ref'),at,extra));
  for(const n of all(doc,'brk'))if(Number(attr(n,'id'))>=at)n.setAttribute('id',String(Number(attr(n,'id'))+extra));
  for(const n of all(workbook,'definedName'))if(Number(attr(n,'localSheetId','-1'))===m.index&&attr(n,'name')==='_xlnm.Print_Area'){const [prefix,ref]=n.textContent.split('!');n.textContent=`${prefix}!${shiftRange(ref,at,extra)}`;}
}
function setNamedRange(workbook,index,name,text) {
  let list=child(workbook.documentElement,'definedNames');if(!list){list=create(workbook,'definedNames');workbook.documentElement.insertBefore(list,child(workbook.documentElement,'calcPr')||null);}
  let n=namedRange(workbook,index,name);if(!n){n=create(workbook,'definedName',{name,localSheetId:index});list.appendChild(n);}n.textContent=text;
}
function updateTitle(cell,value,doc,template) {
  // Keep rich-text runs and their font records; only replace text inside the matched date span.
  if(attr(cell,'t')==='s'){
    const si=all(template.shared,'si')[Number(child(cell,'v')?.textContent)];
    check(si,'제목의 공유 문자열을 확인해주세요.');
    const content=create(doc,'is');for(const node of elements(si))content.appendChild(doc.importNode(node,true));
    for(const node of elements(cell))if(['v','is','f'].includes(node.localName))cell.removeChild(node);
    cell.setAttribute('t','inlineStr');cell.appendChild(content);
  }
  if(attr(cell,'t')!=='inlineStr'||all(cell,'t').length<2){putValue(cell,value,doc);return;}
  const texts=all(cell,'t'),old=texts.map(t=>t.textContent).join('');let prefix=0,suffix=0;
  while(prefix<old.length&&old[prefix]===value[prefix])prefix++;
  while(suffix<old.length-prefix&&old[old.length-1-suffix]===value[value.length-1-suffix])suffix++;
  let offset=0,inserted=false;const end=old.length-suffix;
  for(const node of texts){const text=node.textContent,start=offset;offset+=text.length;if(offset<=prefix||start>=end)continue;node.textContent=text.slice(0,Math.max(0,prefix-start))+(!inserted?value.slice(prefix,value.length-suffix):'')+text.slice(Math.max(0,end-start));inserted=true;}
}
function settings(sheet) {
  const root=sheet.documentElement,setup=child(root,'pageSetup'),margins=child(root,'pageMargins'),print=child(root,'printOptions');
  return {orientation:attr(setup,'orientation')==='portrait'?'portrait':'landscape',paperSize:number(setup,'paperSize',9),scale:number(setup,'scale',100)/100,
    horizontalCentered:['1','true'].includes(attr(print,'horizontalCentered')),verticalCentered:['1','true'].includes(attr(print,'verticalCentered')),
    fit:!setup||attr(child(child(root,'sheetPr'),'pageSetUpPr'),'fitToPage')==='1'||attr(child(child(root,'sheetPr'),'pageSetUpPr'),'fitToPage')==='true',
    fitWidth:number(setup,'fitToWidth',1),fitHeight:number(setup,'fitToHeight',1),
    margins:{left:number(margins,'left',0.25),right:number(margins,'right',0.25),top:number(margins,'top',0.3),bottom:number(margins,'bottom',0.3)}};
}
function dimensions(sheet,area) {
  const defaults=child(sheet.documentElement,'sheetFormatPr'),idx=indexSheet(sheet),cols=all(sheet,'col');
  const widths=Array.from({length:area.end.c-area.c+1},(_,i)=>{const c=area.c+i,n=cols.find(col=>number(col,'min',0)<=c&&number(col,'max',0)>=c);return attr(n,'hidden')==='1'?0:Math.floor(number(n,'width',number(defaults,'defaultColWidth',8.43))*7+5);});
  const height=r=>attr(idx.rows.get(r),'hidden')==='1'?0:number(idx.rows.get(r),'ht',number(defaults,'defaultRowHeight',15))*4/3;
  return {widths,height,width:widths.reduce((a,b)=>a+b,0)};
}
export function planPages(sheet,area,m,originalRows) {
  const s=settings(sheet),d=dimensions(sheet,area),landscape=s.orientation!=='portrait';
  const width=(landscape?297:210)*96/25.4-(s.margins.left+s.margins.right)*96;
  const height=(landscape?210:297)*96/25.4-(s.margins.top+s.margins.bottom)*96;
  check(width>150&&height>150,'원본 인쇄 여백을 확인해주세요.');
  const header=Array.from({length:m.firstStudentRow-area.r},(_,i)=>area.r+i);
  const rows=Array.from({length:area.end.r-m.firstStudentRow+1},(_,i)=>m.firstStudentRow+i);
  const originalHeight=Array.from({length:originalRows.end-originalRows.start+1},(_,i)=>d.height(originalRows.start+i)).reduce((a,b)=>a+b,0);
  // Collapsed outer borders and printer rounding need a small physical safety margin.
  let scale=Math.min(1,(width-2)/(d.width+2),s.fit?1:s.scale);
  if(s.fit&&s.fitHeight===1)scale=Math.min(scale,(height-3)/(originalHeight+2));
  const headerHeight=header.reduce((n,r)=>n+d.height(r),0),available=height/scale-headerHeight;
  const pages=[];let page=[],used=0;
  for(let i=0;i<rows.length;){
    const row=rows[i],block=m.studentBlocks?.find(b=>b.start===row);
    const group=block?rows.slice(i,i+block.end-block.start+1):[row];
    const h=group.reduce((n,r)=>n+d.height(r),0);
    check(h<=available+0.5,'학생 한 명의 영역이 한 페이지보다 큽니다. Excel 인쇄 설정을 확인해주세요.');
    if(page.length&&used+h>available+0.5){pages.push([...header,...page]);page=[];used=0;}
    page.push(...group);used+=h;i+=group.length;
  }
  if(page.length)pages.push([...header,...page]);
  check(pages.length<=50,'인쇄 페이지가 너무 많습니다. 학생 범위를 확인해주세요.');
  const merges=all(sheet,'mergeCell').map(n=>range(attr(n,'ref')));
  for(const pageRows of pages)for(const merge of merges)if(merge.r>=m.firstStudentRow&&pageRows.includes(merge.r))check(pageRows.includes(merge.end.r),'페이지 경계에 병합된 학생 행이 있습니다. Excel에서 인쇄 영역을 확인해주세요.');
  return {pages,scale,width,height,settings:s,dimensions:d};
}
export function generateAttendance(template,m,options) {
  const descriptor=template.sheets[m.index],sheet=template.read(descriptor.path),workbook=template.read('xl/workbook.xml'),styles=template.read('xl/styles.xml');
  const initialArea=areaFor(workbook,m.index,sheet);validateMapping(m,initialArea);
  const originalGrid=indexSheet(sheet);
  check(Array.from({length:28},(_,i)=>{
    const text=textOf(originalGrid.cells.get(cellRef(m.dateStart+i,m.dateRow)),template.strings);
    return Number(text.replace(/일$/,''))===i+1||dateParts(text,template.epoch1904)?.day===i+1;
  }).every(Boolean),'선택한 날짜 행에서 1일부터 28일까지의 연속된 날짜를 확인할 수 없습니다.');
  for(let day=29;day<=31;day++){
    const text=textOf(originalGrid.cells.get(cellRef(m.dateStart+day-1,m.dateRow)),template.strings);
    check(!text||Number(text.replace(/일$/,''))===day||dateParts(text,template.epoch1904)?.day===day,'29~31일 위치에 다른 내용이 있습니다. 날짜 영역을 확인해주세요.');
  }
  for(const merge of all(sheet,'mergeCell').map(n=>range(attr(n,'ref')))) {
    check(!(merge.r<=m.dateRow&&merge.end.r>=m.dateRow&&merge.end.c>=m.dateStart&&merge.c<=m.dateStart+30),'날짜 영역의 병합 셀은 별도 양식 검수가 필요합니다.');
    check(!(merge.r<=m.lastStudentRow&&merge.end.r>=m.firstStudentRow),'학생 영역의 병합 셀은 별도 양식 검수가 필요합니다.');
  }
  const dims=dimensions(sheet,{...initialArea,end:{...initialArea.end,c:Math.max(initialArea.end.c,m.dateStart+30)}});
  for(const c of [m.nameCol,m.weekdayCol,...Array.from({length:31},(_,i)=>m.dateStart+i)])check(dims.widths[c-initialArea.c]>0,'학생명·요일·날짜 열이 숨겨져 있습니다. Excel에서 숨김을 해제한 복사본을 사용해주세요.');
  const calendar=calendarMonth(options.year,options.month),students=options.students || templateStudents(template,m);
  check(students.length&&students.length<=500,'학생 행은 최대 500명까지 생성할 수 있습니다.');
  students.forEach(s=>{check(String(s.name).length<=100&&String(s.weekdays).length<=80,'학생명·수업요일 길이를 확인해주세요.');if(s.name)parseWeekdays(s.weekdays);});
  check(!all(sheet,'sheetProtection').length,'보호된 시트는 Excel에서 보호를 해제한 복사본을 올려주세요.');
  check(!all(sheet,'conditionalFormatting').length,'조건부 서식이 있는 양식은 날짜 색상과 충돌할 수 있습니다. 실제 양식에 맞는 추가 검수가 필요합니다.');
  const extra=Math.max(0,students.length-(m.lastStudentRow-m.firstStudentRow+1));
  check(initialArea.end.r+extra<=MAX_ROWS,'학생 행이 너무 많습니다.');
  if(extra){
    const otherFormula=template.sheets.some(s=>s.index!==m.index&&all(template.read(s.path),'f').length);
    const references=all(workbook,'definedName').some(n=>!['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(attr(n,'name')));
    const linkedParts=Object.keys(template.entries).some(path=>/^xl\/(charts|externalLinks|pivotTables)\//.test(path));
    check(!otherFormula&&!references&&!linkedParts,'다른 시트 수식·이름 정의·차트가 연결된 양식입니다. Excel에서 학생 빈 행을 늘린 복사본을 사용해주세요.');
  }
  growRows(sheet,workbook,m,extra);
  const current={...m,lastStudentRow:m.lastStudentRow+extra};
  const area={...initialArea,end:{c:Math.max(initialArea.end.c,m.dateStart+30),r:initialArea.end.r+extra}};
  const grid=mutableSheet(sheet),se=styleEngine(styles,template),warnings=[];
  if(template.entries['xl/externalLinks/externalLink1.xml'])warnings.push('외부 연결은 실행하지 않습니다. Excel에서 연결 값을 확인해주세요.');
  const originalStyles=[];const scheduled=[],normal=[];
  for(let r=m.firstStudentRow;r<=m.lastStudentRow;r++) {
    const days=parseWeekdays(textOf(grid.cell(m.weekdayCol,r),template.strings));
    for(let i=0;i<31;i++){const c=grid.cell(m.dateStart+i,r),fill=se.fillId(c);originalStyles.push(fill);
      if(m.sourceYear&&m.sourceMonth&&i<new Date(Date.UTC(m.sourceYear,m.sourceMonth,0)).getUTCDate())(days.includes(new Date(Date.UTC(m.sourceYear,m.sourceMonth-1,i+1)).getUTCDay())?scheduled:normal).push(fill);
    }
  }
  const plain=m.plainStyleCell?se.fillId(grid.cells.get(m.plainStyleCell)):mostCommon(normal.length?normal:originalStyles);
  const candidate=mostCommon(scheduled,plain);
  for(const key of ['plainStyleCell','lessonStyleCell'])if(m[key])check(grid.cells.has(m[key]),'색상 샘플 셀을 확인해주세요.');
  if(!m.lessonStyleCell&&(!m.sourceYear||!m.sourceMonth)&&originalStyles.some(f=>f!==plain&&se.fillColor(f)))throw Error('원본 연도·월 또는 수업일 색상 샘플 셀을 지정해주세요.');
  const lesson=m.lessonStyleCell?se.fillId(grid.cells.get(m.lessonStyleCell)):(candidate!==plain&&se.fillColor(candidate)&&!['#FFFFFF','#000000'].includes(se.fillColor(candidate).toUpperCase())?candidate:se.addFill('FFE8F0EC'));
  const inactive=se.addFill('FFF1F1F1'),closed=se.addFill('FFF4E4E4'),makeup=se.addFill('FFE3ECF8');
  const closures=new Set(options.closures||[]),makeups=options.makeups||{};
  for(const day of closures)check(Number.isInteger(day)&&day>=1&&day<=31&&calendar[day-1].active,'휴원일이 선택한 월의 날짜인지 확인해주세요.');
  for(const [row,days] of Object.entries(makeups)){check(/^\d+$/.test(row)&&Number(row)<students.length&&Array.isArray(days),'보강 대상 행을 확인해주세요.');for(const day of days)check(Number.isInteger(day)&&day>=1&&day<=31&&calendar[day-1].active,'보강일이 선택한 월의 날짜인지 확인해주세요.');}
  const serialHeaders=dateParts(textOf(grid.cell(m.dateStart,m.dateRow),template.strings),template.epoch1904);
  for(const d of calendar) {
    const header=grid.cell(m.dateStart+d.day-1,m.dateRow),old=textOf(header,template.strings),serial=dateParts(old,template.epoch1904)||serialHeaders;
    const oldInvalid=m.sourceYear&&m.sourceMonth&&d.day>new Date(Date.UTC(m.sourceYear,m.sourceMonth,0)).getUTCDate();
    if(oldInvalid&&d.active){header.setAttribute('s',String(se.withFill(number(header,'s',0),se.fillId(grid.cell(m.dateStart+27,m.dateRow)))));if(m.weekdayRow){const w=grid.cell(m.dateStart+d.day-1,m.weekdayRow);w.setAttribute('s',String(se.withFill(number(w,'s',0),se.fillId(grid.cell(m.dateStart+27,m.weekdayRow)))));}}
    const value=d.active?(serial?(Date.UTC(options.year,options.month-1,d.day)-Date.UTC(template.epoch1904?1904:1899,template.epoch1904?0:11,template.epoch1904?1:30))/86400000:/일$/.test(old)?`${d.day}일`:d.day):'';
    putValue(header,value,sheet);if(!d.active)header.setAttribute('s',String(se.withFill(number(header,'s',0),inactive)));
    if(m.weekdayRow){const w=grid.cell(m.dateStart+d.day-1,m.weekdayRow);putValue(w,d.active?d.weekday:'',sheet);if(!d.active)w.setAttribute('s',String(se.withFill(number(w,'s',0),inactive)));}
  }
  for(let r=m.firstStudentRow;r<=current.lastStudentRow;r++) {
    const student=students[r-m.firstStudentRow]||{name:'',weekdays:''},days=student.name?parseWeekdays(student.weekdays):[];
    const oldDays=m.sourceYear&&m.sourceMonth?new Date(Date.UTC(m.sourceYear,m.sourceMonth,0)).getUTCDate():31;
    const rowPlain=mostCommon(Array.from({length:oldDays},(_,i)=>se.fillId(grid.cell(m.dateStart+i,r))).filter(f=>f!==lesson),plain);
    for(const [c,value] of [[m.nameCol,student.name],[m.weekdayCol,student.weekdays]]){const cell=grid.cell(c,r);if(textOf(cell,template.strings)!==value)putValue(cell,value,sheet);}
    for(const d of calendar){const c=grid.cell(m.dateStart+d.day-1,r),id=number(c,'s',0),oldFill=se.fillId(c);let fill=oldFill===lesson?rowPlain:oldFill;
      if(m.sourceYear&&m.sourceMonth&&d.day>oldDays)fill=rowPlain;
      if(!d.active)fill=inactive;
      else if(student.name&&makeups[r-m.firstStudentRow]?.includes(d.day))fill=makeup;
      else if(student.name&&closures.has(d.day))fill=closed;
      else if(days.includes(d.weekdayIndex))fill=lesson;
      c.setAttribute('s',String(se.withFill(id,fill)));if(!d.active||options.clearMarks)putValue(c,'',sheet);
    }
  }
  if(m.titleCell){const p=address(m.titleCell),cell=grid.cell(p.c,p.r),old=textOf(cell,template.strings);let next=old.replace(/20\d{2}\s*년\s*\d{1,2}\s*월/,`${options.year}년 ${options.month}월`).replace(/\b20\d{2}([.\-/])\s*\d{1,2}\b/,`${options.year}$1${String(options.month).padStart(2,'0')}`);if(!/20\d{2}/.test(old))next=old.replace(/\d{1,2}\s*월/,`${options.month}월`);check(next!==old||old.includes(String(options.year))||old.includes(`${options.month}월`),'제목의 연도·월 셀을 확인해주세요.');updateTitle(cell,next,sheet,template);}
  for(const [key,value] of [['yearCell',options.year],['monthCell',options.month]])if(m[key]){const p=address(m[key]);putValue(grid.cell(p.c,p.r),value,sheet);}
  if(!m.titleCell&&!m.yearCell&&!m.monthCell)warnings.push('연도·월 제목 위치가 지정되지 않았습니다. 날짜와 요일만 갱신했습니다.');
  const quoted=`'${descriptor.name.replace(/'/g,"''")}'`;
  const printName=namedRange(workbook,m.index,'_xlnm.Print_Area');
  if(!printName||extra||area.end.c!==initialArea.end.c)setNamedRange(workbook,m.index,'_xlnm.Print_Area',`${quoted}!$${columnName(area.c)}$${area.r}:$${columnName(area.end.c)}$${area.end.r}`);
  const plan=planPages(sheet,area,current,{start:initialArea.r,end:initialArea.end.r});
  const setup=ensureSheet(sheet,'pageSetup');if(!setup.hasAttribute('paperSize'))setup.setAttribute('paperSize','9');if(!setup.hasAttribute('orientation'))setup.setAttribute('orientation','landscape');
  const widthSplit=plan.settings.fitWidth!==1 || !plan.settings.fit && plan.settings.scale>plan.width/plan.dimensions.width;
  if(widthSplit||!setup.hasAttribute('fitToWidth')||plan.pages.length>1){setup.setAttribute('fitToWidth','1');setup.setAttribute('fitToHeight',plan.pages.length>1?'0':'1');let pr=ensureSheet(sheet,'sheetPr'),fit=child(pr,'pageSetUpPr');if(!fit){fit=create(sheet,'pageSetUpPr');pr.appendChild(fit);}fit.setAttribute('fitToPage','1');}
  if(plan.pages.length>1){const breaks=ensureSheet(sheet,'rowBreaks');while(breaks.firstChild)breaks.removeChild(breaks.firstChild);breaks.setAttribute('count',String(plan.pages.length-1));breaks.setAttribute('manualBreakCount',String(plan.pages.length-1));for(const page of plan.pages.slice(1)){const first=page.find(r=>r>=current.firstStudentRow);breaks.appendChild(create(sheet,'brk',{id:first-1,min:area.c-1,max:area.end.c-1,man:1}));}
    const prior=namedRange(workbook,m.index,'_xlnm.Print_Titles')?.textContent||'';const cols=prior.split(',').filter(v=>/!\$?[A-Z]+:\$?[A-Z]+$/.test(v));setNamedRange(workbook,m.index,'_xlnm.Print_Titles',[`${quoted}!$${area.r}:$${m.firstStudentRow-1}`,...cols].join(','));
  }
  child(sheet.documentElement,'colBreaks')?.parentNode.removeChild(child(sheet.documentElement,'colBreaks'));
  const dimension=ensureSheet(sheet,'dimension'),used=range(attr(dimension,'ref',`${cellRef(area.c,area.r)}:${cellRef(area.end.c,area.end.r)}`));
  if(used.end.c<area.end.c||used.end.r<area.end.r||!dimension.hasAttribute('ref'))dimension.setAttribute('ref',`${cellRef(Math.min(used.c,area.c),Math.min(used.r,area.r))}:${cellRef(Math.max(used.end.c,area.end.c),Math.max(used.end.r,area.end.r))}`);
  let calc=child(workbook.documentElement,'calcPr');if(!calc){calc=create(workbook,'calcPr');workbook.documentElement.appendChild(calc);}calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
  const browserPrintSafe=!['drawing','legacyDrawing','headerFooter','picture'].some(tag=>all(sheet,tag).some(n=>elements(n).length||n.attributes.length));
  if(!browserPrintSafe)warnings.push('그림·머리글·바닥글은 Excel에서 보존됩니다. 이 양식은 Excel 다운로드 후 인쇄해주세요.');
  if(all(sheet,'f').length)warnings.push('수식은 Excel에서 다시 계산됩니다. 웹에서는 원본의 저장된 수식 값을 표시합니다.');
  if(plan.settings.paperSize!==9)warnings.push('원본 용지 설정은 A4가 아닙니다. Excel 인쇄 설정을 확인해주세요.');
  const files={...template.entries},serialize=doc=>strToU8(new template.env.XMLSerializer().serializeToString(doc));
  files[descriptor.path]=serialize(sheet);files['xl/styles.xml']=serialize(styles);files['xl/workbook.xml']=serialize(workbook);
  return {bytes:zipSync(files,{level:6}),sheet,styles,area,mapping:current,plan,warnings,browserPrintSafe:browserPrintSafe&&plan.settings.paperSize===9,template,year:options.year,month:options.month};
}

function cssStyle(result,cell) {
  const doc=result.styles,xf=children(child(doc.documentElement,'cellXfs'),'xf')[cell?cellStyleId(result.sheet,cell):0];
  const font=children(child(doc.documentElement,'fonts'),'font')[number(xf,'fontId',0)];
  const border=children(child(doc.documentElement,'borders'),'border')[number(xf,'borderId',0)];
  const fill=children(child(doc.documentElement,'fills'),'fill')[number(xf,'fillId',0)],alignment=child(xf,'alignment');
  const face=attr(child(font,'name'),'val','Arial').replace(/[^\p{L}\p{N} ,_-]/gu,'');
  const css=[`font-family:'${face}',sans-serif`,`font-size:${Math.min(72,Math.max(5,number(child(font,'sz'),'val',11)))}pt`,`font-weight:${child(font,'b')?'700':'400'}`,`font-style:${child(font,'i')?'italic':'normal'}`];
  const color=colorHex(child(font,'color'),result.template),bg=colorHex(child(child(fill,'patternFill'),'fgColor'),result.template);if(color)css.push(`color:${color}`);if(bg)css.push(`background:${bg}`);
  const horizontal=attr(alignment,'horizontal','general'),vertical=attr(alignment,'vertical','bottom');
  css.push(`text-align:${['left','center','right','justify'].includes(horizontal)?horizontal:attr(cell,'t')==='inlineStr'||attr(cell,'t')==='s'?'left':'right'}`,`vertical-align:${vertical==='center'?'middle':['top','bottom'].includes(vertical)?vertical:'bottom'}`);
  if(child(font,'u'))css.push('text-decoration:underline');
  for(const side of ['left','right','top','bottom']){const n=child(border,side),style=attr(n,'style');if(style){const width=style==='thick'?2:style.startsWith('medium')?1.5:0.75;css.push(`border-${side}:${width}pt ${style==='double'?'double':style.toLowerCase().includes('dash')?'dashed':style==='dotted'?'dotted':'solid'} ${colorHex(child(n,'color'),result.template)||'#222222'}`);}}
  return css.join(';');
}
export function renderTable(result,rows=null) {
  const {area,sheet,template,plan}=result,idx=indexSheet(sheet),merges=all(sheet,'mergeCell').map(n=>range(attr(n,'ref')));
  const selected=rows||Array.from({length:area.end.r-area.r+1},(_,i)=>area.r+i);
  const cols=plan.dimensions.widths.map(w=>`<col style="width:${w}px">`).join('');
  const body=selected.map(r=>{
    const cells=[];for(let c=area.c;c<=area.end.c;c++) {
      const merge=merges.find(m=>r>=m.r&&r<=m.end.r&&c>=m.c&&c<=m.end.c);
      if(merge&&(r!==merge.r||c!==merge.c))continue;
      const node=idx.cells.get(cellRef(c,r));let text=textOf(node,template.strings);
      if(r===result.mapping.dateRow){const serial=dateParts(text,template.epoch1904);if(serial)text=String(serial.day);}
      const xf=children(child(result.styles.documentElement,'cellXfs'),'xf')[node?cellStyleId(sheet,node,c):0],wrap=attr(child(xf,'alignment'),'wrapText')==='1';
      const height=merge?Array.from({length:merge.end.r-merge.r+1},(_,i)=>plan.dimensions.height(merge.r+i)).reduce((a,b)=>a+b,0):plan.dimensions.height(r);
      cells.push(`<td data-cell="${cellRef(c,r)}" ${merge?`colspan="${merge.end.c-merge.c+1}" rowspan="${merge.end.r-merge.r+1}"`:''} style="${escapeHtml(cssStyle(result,node))}"><div style="max-height:${Math.max(0,height-2)}px;white-space:${wrap?'pre-wrap':'pre'}">${escapeHtml(text)}</div></td>`);
    }return `<tr style="height:${plan.dimensions.height(r)}px">${cells.join('')}</tr>`;
  }).join('');
  return `<table class="at-sheet" style="width:${plan.dimensions.width}px"><colgroup>${cols}</colgroup><tbody>${body}</tbody></table>`;
}
export const TABLE_CSS='.at-sheet{border-collapse:collapse;table-layout:fixed;background:white;color:#111;letter-spacing:0}.at-sheet td{padding:0 1px;box-sizing:border-box;overflow:hidden}.at-sheet td>div{overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.1}.at-sheet tr{break-inside:avoid}';
export function sourcePreview(template,index) {
  const sheet=template.read(template.sheets[index].path),area=areaFor(template.workbook,index,sheet);
  return renderTable({sheet,area,styles:template.styles,template,mapping:analyzeSheet(template,index),plan:{dimensions:dimensions(sheet,area)}});
}
export function printDocument(result) {
  check(result.browserPrintSafe,'이 양식은 Excel 다운로드 후 원본 설정으로 인쇄해주세요.');
  const p=result.plan,m=p.settings.margins;
  const left=p.settings.horizontalCentered?Math.max(0,(p.width-(p.dimensions.width+2)*p.scale)/2):0;
  const pages=p.pages.map(rows=>{
    const height=rows.reduce((n,r)=>n+p.dimensions.height(r),0)+2;
    const top=p.settings.verticalCentered?Math.max(0,(p.height-3-height*p.scale)/2):0;
    return `<section class="at-print-page" style="--at-print-top:${top}px">${renderTable(result,rows)}</section>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>출석부</title><style>${TABLE_CSS}@page{size:A4 ${p.settings.orientation};margin:${m.top}in ${m.right}in ${m.bottom}in ${m.left}in}html,body{padding:0;margin:0}.at-print-page{width:${p.width}px;height:${Math.floor(p.height)-2}px;position:relative;overflow:hidden;break-after:page;page-break-after:always}.at-print-page:last-child{break-after:auto;page-break-after:auto}.at-sheet{position:absolute;left:${left}px;top:var(--at-print-top);transform:scale(${p.scale});transform-origin:top left}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${pages}</body></html>`;
}

// Shared OOXML primitives for automatic recognition; the original template adapter remains available.
export {all,child,children,attr,number,check,cellRef,range,textOf,indexSheet,areaFor,
  dateParts,putValue,mutableSheet,styleEngine,cellStyleId,mostCommon,updateTitle,
  ensureSheet,create,setNamedRange,namedRange,dimensions,colorHex};

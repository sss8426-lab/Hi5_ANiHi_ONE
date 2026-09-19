import {all,child,children,attr,number,check,range,address,cellRef,textOf,indexSheet,calendarMonth,
  create,ensureSheet,columnName} from './attendance-template.js?v=20260919-sparse-import';

const width=(sheet,c)=>number(all(sheet,'col').find(n=>number(n,'min',1)<=c&&number(n,'max',1)>=c),'width',8.43);

// Some academy forms omit closed weekdays entirely and separate weeks with narrow, blank columns.
// Only accept explicit date/weekday anchors and narrow separators, never arbitrary missing cells.
export function sparseCalendars(template,sheet,grid,area){
  const merges=all(sheet,'mergeCell').map(n=>range(attr(n,'ref'))),found=[];
  const text=(c,r)=>textOf(grid.cells.get(cellRef(c,r)),template.strings).trim();
  for(let r=area.r;r<=Math.min(40,area.end.r-1);r++){
    const anchors=[];
    for(let c=area.c;c<=area.end.c;c++){
      const v=text(c,r),w=text(c,r+1);
      if(!/^(?:[1-9]|[12]\d|3[01])(?:일)?$/.test(v)||! /^[일월화수목금토](?:요일)?$/.test(w))continue;
      const merge=merges.find(m=>m.c===c&&m.r===r&&m.end.r===r);
      const end=merge?.end.c||c;
      anchors.push({day:Number(v.replace('일','')),c,end,weekday:'일월화수목금토'.indexOf(w[0])});
    }
    if(anchors.length<16||anchors[0].day>3||anchors.at(-1).day<25)continue;
    const corrections=[];
    // A copied week may contain stale day numbers. Adjacent weekday anchors uniquely locate dates;
    // require a strong majority of matching numbers and matching first/last anchors.
    for(let i=1;i<anchors.length;i++){
      const previous=anchors[i-1],a=anchors[i],day=previous.day+(a.weekday-previous.weekday+7)%7;
      if(day===previous.day||day-previous.day>3){corrections.push(-1);break;}
      if(day!==a.day){corrections.push(a.c);a.day=day;}
    }
    if(corrections.includes(-1)||corrections.length>Math.floor(anchors.length/4)||corrections.includes(anchors.at(-1).c)||anchors.at(-1).day>31)continue;
    const columns=anchors.flatMap(a=>Array.from({length:a.end-a.c+1},(_,slot)=>({c:a.c+slot,day:a.day,slot})));
    const start=anchors[0].c,end=anchors.at(-1).end,used=new Set(columns.map(d=>d.c));
    const normal=Math.max(...columns.map(d=>width(sheet,d.c)));
    const separators=[];let valid=true;
    for(let c=start;c<=end;c++)if(!used.has(c)){
      if(text(c,r)||text(c,r+1)||width(sheet,c)>=normal*0.6||merges.some(m=>m.r<=r+1&&m.end.r>=r&&c>=m.c&&c<=m.end.c)){valid=false;break;}
      separators.push(c);
    }
    if(!valid||!separators.length)continue;
    found.push({dateRow:r,weekdayRow:r+1,dateStart:start,dateColumns:columns,headerMode:columns.some(d=>d.slot)?'merged':'single',sparse:{separators,end,correctedDates:corrections.length}});
  }
  return found;
}

export function validateSparse(m){
  const calendar=calendarMonth(m.period.year,m.period.month),days=new Set(m.dateColumns.map(d=>d.day));
  const policy={};
  for(let weekday=0;weekday<7;weekday++){
    const dates=calendar.slice(0,28).filter(d=>d.weekdayIndex===weekday);
    const present=dates.filter(d=>days.has(d.day));
    check(!present.length||present.length===4,'생략된 날짜의 요일이 일정하지 않습니다. 원본 날짜와 요일을 확인해주세요.');
    const sizes=present.map(d=>m.dateColumns.filter(c=>c.day===d.day).length);
    policy[weekday]=sizes.length?Math.max(...sizes.filter(n=>sizes.filter(v=>v===n).length===Math.max(...sizes.map(v=>sizes.filter(x=>x===v).length)))):0;
  }
  const before=m.sparse.separators.map(c=>calendar[m.dateColumns.find(d=>d.c>c).day-1].weekdayIndex);
  check(new Set(before).size===1,'주간 구분 열의 위치가 일정하지 않습니다. 원본 양식을 확인해주세요.');
  check(calendar.filter(d=>d.active&&policy[d.weekdayIndex]).every(d=>days.has(d.day)),'원본 월의 수업 날짜가 누락되어 있습니다. 날짜 영역을 확인해주세요.');
  m.sparse={...m.sparse,policy,weekStart:before[0]};
}

// Strict local formula grammar: COUNTIF ranges/literals and numeric/reference arithmetic only.
// Shared formulas are expanded before copying; unknown formulas never become plausible wrong totals.
function tokens(text){
  const result=[];let rest=text;
  while(rest){
    const match=/^("(?:[^"]|"")*"|#REF!|\$?[A-Z]{1,3}\$?\d+(?![A-Z0-9_])|COUNTIF(?=\()|\d+(?:\.\d+)?|[\s()+,:*/-])/.exec(rest);
    check(match,'이 양식에 자동 이동할 수 없는 수식이 있습니다. Excel에서 수식을 확인해주세요.');
    result.push(match[0]);rest=rest.slice(match[0].length);
  }
  return result;
}
const isRef=t=>/^\$?[A-Z]{1,3}\$?\d+$/.test(t);
function formulaRefs(text,map){return tokens(text).map(t=>isRef(t)?map(t):t).join('');}
function refAt(ref,c,r){check(c>=1&&c<=128&&r>=1&&r<=1000,'이동한 수식이 지원 범위를 벗어났습니다.');return `${ref.startsWith('$')?'$':''}${columnName(c)}${/\$\d+$/.test(ref)?'$':''}${r}`;}
function expandFormulas(sheet,maxRow){
  const masters=new Map();
  for(const f of all(sheet,'f'))if(attr(f,'t')==='shared'&&f.textContent)masters.set(attr(f,'si'),{text:f.textContent,p:address(attr(f.parentNode,'r'))});
  for(const f of all(sheet,'f')){
    if(address(attr(f.parentNode,'r')).r>maxRow)continue;
    if(attr(f,'t')==='shared'){
      check(!all(sheet,'f').some(other=>attr(other,'t')==='shared'&&attr(other,'si')===attr(f,'si')&&address(attr(other.parentNode,'r')).r>maxRow),'인쇄 영역 밖으로 이어지는 공유 수식은 Excel에서 확인해주세요.');
      const master=masters.get(attr(f,'si')),p=address(attr(f.parentNode,'r'));
      check(master,'공유 수식의 원본을 찾지 못했습니다. Excel에서 다시 저장한 파일을 사용해주세요.');
      f.textContent=formulaRefs(master.text,ref=>{const a=address(ref);return refAt(ref,a.c+(ref.startsWith('$')?0:p.c-master.p.c),a.r+(/\$\d+$/.test(ref)?0:p.r-master.p.r));});
      for(const key of ['t','si','ref'])f.removeAttribute(key);
    }else check(!attr(f,'t')||attr(f,'t')==='normal','배열 수식이 있는 주간 양식은 Excel에서 확인해주세요.');
    tokens(f.textContent);
  }
}

export function sparseTargets(m,year,month){
  const result=[],calendar=calendarMonth(year,month),sourceCalendar=calendarMonth(m.period.year,m.period.month);
  const samples=new Map();
  for(const d of m.dateColumns.filter(d=>d.day<=28)){
    const weekday=sourceCalendar[d.day-1].weekdayIndex,key=`${weekday}:${d.slot}`;
    if(!samples.has(key))samples.set(key,d.c);
  }
  for(const d of calendar.filter(d=>d.active&&m.sparse.policy[d.weekdayIndex])){
    if(result.length&&d.weekdayIndex===m.sparse.weekStart)result.push({separator:true,sourceC:m.sparse.separators[0]});
    for(let slot=0;slot<m.sparse.policy[d.weekdayIndex];slot++)result.push({...d,slot,sourceC:samples.get(`${d.weekdayIndex}:${slot}`)});
  }
  let c=m.dateStart;return result.map(d=>({...d,c:c++}));
}

export function reshapeSparse(sheet,workbook,m,targets){
  check(!['drawing','legacyDrawing','tableParts','oleObjects','controls','dataValidation','hyperlink'].some(tag=>all(sheet,tag).length),'주간 양식의 그림·표·연결 개체는 Excel에서 확인해주세요.');
  expandFormulas(sheet,m.area.end.r);
  const original=indexSheet(sheet),oldEnd=m.sparse.end,newEnd=targets.at(-1).c,delta=newEnd-oldEnd;
  check(newEnd+(m.area.end.c-oldEnd)<=128,'생성할 출석부가 128열을 초과합니다.');
  const oldByCol=new Map(m.dateColumns.map(d=>[d.c,d]));
  const mapColumn=(c,end=false)=>{
    if(c<m.dateStart)return c;if(c>oldEnd)return c+delta;
    if(c===m.dateStart)return m.dateStart;if(c===oldEnd)return newEnd;
    if(m.sparse.separators.includes(c)){
      const preceding=m.dateColumns.filter(d=>d.c<c).at(-1),following=m.dateColumns.find(d=>d.c>c);
      return mapColumn(end?preceding.c:following.c,end);
    }
    const day=oldByCol.get(c),group=day?targets.filter(t=>!t.separator&&t.day===day.day):[];
    if(group.length)return end?group.at(-1).c:group[Math.min(day.slot,group.length-1)].c;
    // A closed date has no target column. Only ranges may use its nearest inward boundary.
    const next=day&&targets.filter(t=>!t.separator&&(end?t.day<=day.day:t.day>=day.day));
    check(next?.length,'생략된 날짜를 직접 참조하는 수식은 Excel에서 확인해주세요.');
    return end?next.at(-1).c:next[0].c;
  };
  const mappedRange=ref=>{
    const p=range(ref,true);
    return `${cellRef(mapColumn(p.c),p.r)}:${cellRef(p.end.c===16384?16384:mapColumn(p.end.c,true),p.end.r)}`;
  };
  const mapFormula=(text,sourceC,targetC)=>{
    const ts=tokens(text);
    return ts.map((t,i)=>{
      if(!isRef(t))return t;const p=address(t);
      // Vertical daily COUNTIFs travel with their own date/slot, including absolute references.
      const local=sourceC>=m.dateStart&&sourceC<=oldEnd&&p.c===sourceC;
      check(local||ts[i-1]===':'||ts[i+1]===':'||p.c<m.dateStart||p.c>oldEnd||targets.some(d=>d.day===oldByCol.get(p.c)?.day),`생략된 날짜의 단일 셀을 참조하는 수식은 Excel에서 확인해주세요. (${columnName(sourceC)}: ${t})`);
      const c=local?targetC:mapColumn(p.c,ts[i-1]===':');
      return refAt(t,c,p.r);
    }).join('');
  };
  const cloneCell=(source,c)=>{
    const cell=source.cloneNode(true),p=address(attr(source,'r'));cell.setAttribute('r',cellRef(c,p.r));
    const f=child(cell,'f');
    // Date header formulas (previous date + 1) are replaced by the target calendar below.
    if(f&&p.c>=m.dateStart&&p.c<=oldEnd&&[m.dateRow,m.weekdayRow].includes(p.r))cell.removeChild(f);
    else if(f)f.textContent=mapFormula(f.textContent,p.c,c);
    return cell;
  };
  for(const row of all(sheet,'row')){
    const r=number(row,'r',1),cells=[];
    if(r>m.area.end.r)continue;
    for(const cell of children(row,'c')){const c=address(attr(cell,'r')).c;if(c<m.dateStart||c>oldEnd)cells.push(cloneCell(cell,c>oldEnd?c+delta:c));}
    for(const target of targets){
      const source=original.cells.get(cellRef(target.sourceC,r));
      if(source)cells.push(cloneCell(source,target.c));
    }
    for(const cell of children(row,'c').slice())row.removeChild(cell);
    for(const cell of cells.sort((a,b)=>address(attr(a,'r')).c-address(attr(b,'r')).c))row.appendChild(cell);
  }
  const columns=all(sheet,'col').map(n=>n.cloneNode(true)),container=ensureSheet(sheet,'cols');
  while(container.firstChild)container.removeChild(container.firstChild);
  const finalEnd=m.area.end.c+delta;
  for(let c=1;c<=finalEnd;c++){
    const sourceC=c<m.dateStart?c:c>newEnd?c-delta:targets[c-m.dateStart].sourceC;
    const source=columns.find(n=>number(n,'min',1)<=sourceC&&number(n,'max',1)>=sourceC);
    const n=source?source.cloneNode(true):create(sheet,'col');n.setAttribute('min',String(c));n.setAttribute('max',String(c));container.appendChild(n);
  }
  for(const node of all(sheet,'mergeCell').slice()){
    const p=range(attr(node,'ref'));
    if(p.end.c<m.dateStart)continue;
    if(p.c>=m.dateStart&&p.end.c<=oldEnd&&[m.dateRow,m.weekdayRow].includes(p.r)&&p.r===p.end.r){node.parentNode.removeChild(node);continue;}
    check(p.end.c<m.dateStart||p.c>oldEnd||p.c<=m.dateStart&&p.end.c>=oldEnd,'주간 양식 안의 부분 병합은 Excel에서 확인해주세요.');
    node.setAttribute('ref',mappedRange(attr(node,'ref')));
  }
  // Preserve per-slot conditional styles by copying their exact source column membership.
  for(const node of all(sheet,'conditionalFormatting')){
    const refs=attr(node,'sqref').trim().split(/\s+/).map(r=>range(r,true)),parts=[];
    for(const p of refs){
      if(p.c<m.dateStart)parts.push(`${cellRef(p.c,p.r)}:${cellRef(Math.min(p.end.c,m.dateStart-1),p.end.r)}`);
      for(const t of targets)if(t.sourceC>=p.c&&t.sourceC<=p.end.c)parts.push(`${cellRef(t.c,p.r)}:${cellRef(t.c,p.end.r)}`);
      if(p.end.c>oldEnd)parts.push(`${cellRef(Math.max(p.c,oldEnd+1)+delta,p.r)}:${cellRef(p.end.c===16384?16384:p.end.c+delta,p.end.r)}`);
    }
    if(!parts.length){node.parentNode.removeChild(node);continue;}
    node.setAttribute('sqref',[...new Set(parts)].join(' '));
    for(const rule of all(node,'cfRule')){
      const type=attr(rule,'type'),literal=`"${attr(rule,'text').replace(/"/g,'""')}"`,origin=parts[0].split(':')[0];
      const expression={containsText:`NOT(ISERROR(SEARCH(${literal},${origin})))`,notContainsText:`ISERROR(SEARCH(${literal},${origin}))`,beginsWith:`LEFT(${origin},LEN(${literal}))=${literal}`,endsWith:`RIGHT(${origin},LEN(${literal}))=${literal}`}[type];
      if(expression)child(rule,'formula').textContent=expression;
    }
  }
  for(const n of all(workbook,'definedName')){
    if(Number(attr(n,'localSheetId','-1'))!==m.index)continue;
    check(['_xlnm.Print_Area','_xlnm.Print_Titles','_xlnm._FilterDatabase'].includes(attr(n,'name')),'사용자 정의 이름이 있는 주간 양식은 Excel에서 확인해주세요.');
    n.textContent=n.textContent.replace(/(\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)/g,ref=>mappedRange(ref));
  }
  for(const node of all(sheet,'autoFilter'))node.setAttribute('ref',mappedRange(attr(node,'ref')));
  const dimension=child(sheet.documentElement,'dimension');if(dimension)dimension.setAttribute('ref',`${cellRef(m.area.c,m.area.r)}:${cellRef(finalEnd,m.area.end.r)}`);
  const sourceErrors=all(sheet,'f').filter(f=>f.textContent.includes('#REF!')).length;
  return {area:{...m.area,end:{...m.area.end,c:finalEnd}},at:oldEnd+1,delta,sourceErrors};
}

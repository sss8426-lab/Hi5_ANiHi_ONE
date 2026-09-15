import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {zipSync,strToU8} from '../../public/data-core/vendor/fflate-0.8.3.js';
import {multiSlotFixture} from './attendance-multi-slot-fixture.mjs';
import {openTemplate,all,child,children,attr,create,cellRef,putValue,mutableSheet,styleEngine,columnName,calendarMonth} from '../../public/data-core/work/attendance-template.js';

// Anonymous structural counterpart: three Saturday slots, white free slots, gray closed weekdays,
// orange lessons, exceptional make-ups, a merged inactive row, calendar edges and a separate tail.
export function fidelityFixture({year=2026,month=9,students=26}={}){
  const base=multiSlotFixture({year,month,students}),env={DOMParser,XMLSerializer};
  const t=openTemplate(base.bytes,env),sheet=t.read('xl/worksheets/sheet1.xml'),styles=t.styles.cloneNode(true);
  const monthDays=calendarMonth(year,month).filter(d=>d.active).length;
  const columns=base.columns.filter(d=>d.day<=monthDays),start=base.start,last=columns.at(-1).c,end=students+4;
  // Insert a note row under the title and omit inactive source-day filler columns.
  for(const row of all(sheet,'row')){
    const r=Number(attr(row,'r'));if(r>1)row.setAttribute('r',String(r+1));
    for(const c of children(row,'c')){const ref=attr(c,'r'),col=/^[A-Z]+/.exec(ref)[0];if(r>1)c.setAttribute('r',`${col}${r+1}`);}
  }
  const merges=child(sheet.documentElement,'mergeCells');
  for(const n of children(merges,'mergeCell'))n.setAttribute('ref',attr(n,'ref').replace(/\d+/g,v=>String(Number(v)>1?Number(v)+1:Number(v))));
  const grid=mutableSheet(sheet),se=styleEngine(styles,t);
  const fills={white:se.addFill('FFFFFFFF'),gray:se.addFill('FF999999'),lesson:se.addFill('FFF7CAAC'),makeup:se.addFill('FFFFF2CC')};
  const xfs=child(styles.documentElement,'cellXfs'),borders=child(styles.documentElement,'borders');
  function borderStyle(baseId,edges){
    const b=children(borders,'border')[Number(attr(se.xf(baseId),'borderId','0'))].cloneNode(true);
    for(const [side,value] of Object.entries(edges)){let n=child(b,side);if(!n){n=create(styles,side);b.appendChild(n);}n.setAttribute('style',value);}
    const id=children(borders,'border').length;borders.appendChild(b);borders.setAttribute('count',String(id+1));
    const xf=se.xf(baseId).cloneNode(true);xf.setAttribute('borderId',String(id));const next=children(xfs,'xf').length;xfs.appendChild(xf);xfs.setAttribute('count',String(next+1));return next;
  }
  const normal=se.withFill(1,fills.white),top=borderStyle(normal,{top:'medium'}),bottom=borderStyle(normal,{bottom:'medium'});
  const right=borderStyle(normal,{right:'medium'}),left=borderStyle(normal,{left:'medium'}),tail=borderStyle(normal,{bottom:'medium'});
  const cal=calendarMonth(year,month);
  putValue(grid.cell(3,4),'수업요일',sheet);
  for(let i=0;i<students;i++){
    const row=i+5,kind=i%4,weekdays=kind===0?'화수목금토':kind===1?'토':kind===2?'화목':'휴원';
    putValue(grid.cell(3,row),weekdays,sheet);
    for(const d of columns){
      const w=cal[d.day-1].weekdayIndex;
      let fill=[0,1].includes(w)?fills.gray:fills.white;
      const lesson=kind===0&&([2,3,4,5].includes(w)||w===6&&d.slot<2)||kind===1&&w===6&&d.slot>0||kind===2&&[2,4].includes(w);
      if(lesson)fill=fills.lesson;
      const makeup=kind===2&&w===5&&d.day<24;
      if(makeup)fill=fills.makeup;
      if(month===9&&d.day>=24&&d.day<=27)fill=fills.gray;
      if(kind===3)fill=fills.white;
      let style=i===0||i===10?top:i===students-1?bottom:normal;
      if(d.c===start)style=se.withEdges(style,{left});if(d.c===last)style=se.withEdges(style,{right});
      const cell=grid.cell(d.c,row);putValue(cell,makeup?'보':'',sheet);cell.setAttribute('s',String(se.withFill(style,fill)));
    }
    if(kind===3){merges.appendChild(create(sheet,'mergeCell',{ref:`${cellRef(start,row)}:${cellRef(last,row)}`}));putValue(grid.cell(start,row),'휴원',sheet);}
  }
  // Tail boxes must never become the new month's last-date borders.
  for(let row=3;row<=end;row++)for(let c=last+1;c<=last+3;c++){const cell=grid.cell(c,row);putValue(cell,row===3&&c===last+1?'보강':'',sheet);cell.setAttribute('s',String(tail));}
  merges.appendChild(create(sheet,'mergeCell',{ref:`${cellRef(last+1,3)}:${cellRef(last+3,4)}`}));
  const note=columns.filter(d=>d.day>=24&&d.day<=27);
  if(note.length){merges.appendChild(create(sheet,'mergeCell',{ref:`${cellRef(note[0].c,2)}:${cellRef(note.at(-1).c,2)}`}));putValue(grid.cell(note[0].c,2),'SYNTHETIC 연휴',sheet);}
  for(const d of columns){const cell=grid.cell(d.c,2);cell.setAttribute('s',String(se.withFill(0,note.includes(d)?fills.lesson:fills.white)));}
  // Title uses a single rich run; its large font must survive updating and web preview.
  const title=grid.cell(1,1);putValue(title,'',sheet);title.setAttribute('t','inlineStr');
  const is=create(sheet,'is'),run=create(sheet,'r'),pr=create(sheet,'rPr');pr.appendChild(create(sheet,'rFont',{val:'Arial'}));pr.appendChild(create(sheet,'sz',{val:'20'}));pr.appendChild(create(sheet,'b'));run.appendChild(pr);
  const text=create(sheet,'t');text.textContent=`${year}년 ${month}월 SYNTHETIC 출석부`;run.appendChild(text);is.appendChild(run);title.appendChild(is);
  const cols=child(sheet.documentElement,'cols');for(const n of children(cols,'col'))if(Number(attr(n,'min'))===start)n.setAttribute('max',String(last));
  cols.appendChild(create(sheet,'col',{min:last+1,max:last+3,width:3.5}));
  for(const n of all(sheet,'col'))if(Number(attr(n,'min'))===start)n.setAttribute('width','2.7109375');
  for(const row of all(sheet,'row'))row.setAttribute('ht',Number(attr(row,'r'))===1?'28':'18');
  child(sheet.documentElement,'dimension').setAttribute('ref',`A1:${cellRef(last+3,end)}`);
  merges.setAttribute('count',String(children(merges,'mergeCell').length));
  const workbook=t.workbook.cloneNode(true);all(workbook,'definedName')[0].textContent=`'출석부'!$A$1:$${columnName(last+3)}$${end}`;
  const entries={...t.entries},xml=doc=>strToU8(new XMLSerializer().serializeToString(doc));
  entries['xl/worksheets/sheet1.xml']=xml(sheet);entries['xl/styles.xml']=xml(styles);entries['xl/workbook.xml']=xml(workbook);
  return {bytes:zipSync(entries),columns,start,last,end,fills};
}

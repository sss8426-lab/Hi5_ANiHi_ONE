import {openTemplate,analyzeSheet,templateStudents,generateAttendance,renderTable,printDocument,sourcePreview,TABLE_CSS,columnName,columnNumber,escapeHtml as h} from './attendance-template.js';

const icon=name=>`<svg class="at-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"/></svg>`;
const dayList=value=>String(value||'').trim()?String(value).split(/[\s,]+/).filter(Boolean).map(Number):[];
export function mountAttendance(host,{campusName=''}) {
  let template=null,mapping=null,students=[],result=null,disposed=false,busy=false,ticket=0;
  const urls=new Set(),frames=new Set();
  const now=new Date();now.setMonth(now.getMonth()+1,1);
  host.innerHTML=`<section class="at-app">
    <form id="atForm"><fieldset id="atPeriod" class="at-period"><legend>출석부 연도 · 월</legend><div class="at-month-controls">
    <label>연도<select id="atYear" required>${Array.from({length:200},(_,i)=>`<option value="${1901+i}"${1901+i===now.getFullYear()?' selected':''}>${1901+i}년</option>`).join('')}</select></label>
    <label>월<select id="atMonth" required>${Array.from({length:12},(_,i)=>`<option value="${i+1}"${i===now.getMonth()?' selected':''}>${i+1}월</option>`).join('')}</select></label>
    <div class="at-month-nav" role="group" aria-label="월 이동"><button type="button" id="atPreviousMonth" title="이전 달" aria-label="이전 달">${icon('ChevronLeft')}</button><button type="button" id="atThisMonth">이번 달</button><button type="button" id="atNextMonth" title="다음 달" aria-label="다음 달">${icon('ChevronRight')}</button></div></div></fieldset>
    <label class="at-upload">기존 Excel 출석부<input id="atFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    <p class="at-privacy">파일은 이 브라우저에서만 처리하며 서버에 업로드하지 않습니다.</p>
    <fieldset id="atTemplateControls" disabled><legend>양식 · 수업 설정</legend><label class="at-sheet-select">시트<select id="atSheet"><option value="">Excel 양식 선택 전</option></select></label>
    <details id="atMapping"><summary>양식 영역 확인</summary><div class="at-fields" id="atFields"></div><button type="button" id="atReadRows">학생 행 불러오기</button></details>
    <details><summary>원본 미리보기</summary><div class="at-preview" id="atSource" tabindex="0" aria-label="원본 Excel 미리보기"></div></details>
    <details id="atRoster"><summary>학생 · 수업요일 · 보강일 <span id="atStudentCount"></span></summary><div id="atStudents"></div><button type="button" id="atAdd">학생 추가</button></details>
    <label>휴원일<input id="atClosures" placeholder="예: 3, 9" inputmode="numeric"></label>
    <label class="at-check"><input type="checkbox" id="atClear">이전 출석 표시 비우기</label>
    <label class="at-check"><input type="checkbox" id="atConfirm" required>시트와 날짜·학생 영역을 확인했습니다.</label>
    <button type="submit" id="atGenerate" class="at-primary">선택 월 출석부 만들기</button></fieldset></form>
    <p id="atStatus" role="status" aria-live="polite">기존 Excel 양식이 필요합니다.</p>
    <div class="at-actions"><div role="group" aria-label="미리보기 크기"><button type="button" id="atFit" aria-pressed="true" disabled>화면 맞춤</button><button type="button" id="atActual" aria-pressed="false" disabled>실제 크기</button></div><button type="button" id="atDownload" disabled>Excel 다운로드</button><button type="button" id="atPrint" disabled>${icon('Printer')}인쇄</button></div>
    <section id="atResult" hidden><strong id="atEstimate"></strong><ul id="atWarnings"></ul><div class="at-preview" id="atPreview" tabindex="0" aria-label="출석부 미리보기"><div id="atPaper"><div id="atTable"></div></div></div></section></section>`;
  const $=id=>host.querySelector(`#${id}`),status=text=>{if(!disposed)$('atStatus').textContent=text;};
  const fields=[['dateRow','날짜 행','row'],['dateStart','1일 열','col'],['weekdayRow','요일 행 (없으면 0)','row'],['nameCol','학생명 열','col'],['weekdayCol','수업요일 열','col'],['firstStudentRow','첫 학생 행','row'],['lastStudentRow','마지막 학생·빈 행','row'],['titleCell','연도·월 제목 셀','cell'],['yearCell','별도 연도 셀','cell'],['monthCell','별도 월 셀','cell'],['sourceYear','원본 연도 (미확인 0)','year'],['sourceMonth','원본 월 (미확인 0)','row'],['lessonStyleCell','수업일 색상 샘플 셀','cell'],['plainStyleCell','기본 색상 샘플 셀','cell']];
  function syncControls(){
    $('atPeriod').disabled=busy;$('atFile').disabled=busy;$('atTemplateControls').disabled=busy||!template;
    const year=Number($('atYear').value),month=Number($('atMonth').value);
    $('atPreviousMonth').disabled=year===1901&&month===1;$('atNextMonth').disabled=year===2100&&month===12;
    for(const id of ['atFit','atActual','atDownload'])$(id).disabled=busy||!result;
    $('atPrint').disabled=busy||!result?.browserPrintSafe;
    $('atAdd').disabled=!mapping||students.length>=500;$('atReadRows').disabled=!mapping;$('atGenerate').disabled=!mapping;
    $('atStudentCount').textContent=template?`${students.filter(s=>s.name).length}명`:'';
  }
  function invalidate(){result=null;$('atResult').hidden=true;$('atTable').replaceChildren();$('atConfirm').checked=false;for(const url of urls)URL.revokeObjectURL(url);urls.clear();syncControls();status(template?'설정 확인 후 선택 월 출석부를 만들어주세요.':'기존 Excel 양식이 필요합니다.');}
  function changeMonth(year,month){
    if(busy||year<1901||year>2100)return;
    $('atYear').value=String(year);$('atMonth').value=String(month);invalidate();
  }
  function stepMonth(delta){const date=new Date(Number($('atYear').value),Number($('atMonth').value)-1+delta,1);changeMonth(date.getFullYear(),date.getMonth()+1);}
  $('atPreviousMonth').onclick=()=>stepMonth(-1);$('atNextMonth').onclick=()=>stepMonth(1);
  $('atThisMonth').onclick=()=>{const today=new Date();changeMonth(today.getFullYear(),today.getMonth()+1);};
  function readMapping(){return {...mapping,...Object.fromEntries(fields.map(([key,,type])=>{const v=host.querySelector(`[data-map="${key}"]`).value.trim().toUpperCase();return [key,type==='col'?columnNumber(v):['row','year'].includes(type)?Number(v):v];}))};}
  function drawStudents(){
    $('atStudents').innerHTML=students.map((s,i)=>`<div class="at-student"><span>${i+1}</span><label>학생명<input data-student="${i}" data-field="name" maxlength="100" value="${h(s.name)}"></label><label>수업요일<input data-student="${i}" data-field="weekdays" maxlength="80" value="${h(s.weekdays)}"></label><label>보강일<input data-student="${i}" data-field="makeup" inputmode="numeric" value="${h(s.makeup||'')}"></label><button type="button" data-clear-row="${i}" title="학생 정보 비우기" aria-label="${i+1}행 학생 정보 비우기">${icon('X')}</button></div>`).join('');
  }
  function readRows(){const next=readMapping(),rows=templateStudents(template,next);mapping=next;students=rows;drawStudents();invalidate();status(`학생 ${students.filter(s=>s.name).length}명 · 양식 ${students.length}행`);}
  function selectSheet(){
    mapping=null;students=[];$('atSource').replaceChildren();$('atFields').replaceChildren();drawStudents();invalidate();
    mapping=analyzeSheet(template,Number($('atSheet').value));
    $('atSource').innerHTML=`<style>${TABLE_CSS}</style>${sourcePreview(template,mapping.index)}`;
    $('atFields').innerHTML=fields.map(([key,label,type])=>`<label>${label}<input data-map="${key}" ${['row','year'].includes(type)?`type="number" min="0" max="${type==='year'?2100:1000}"`:'type="text"'} value="${h(type==='col'?columnName(mapping[key]||0):mapping[key]??'')}"></label>`).join('');
    $('atMapping').open=true;invalidate();students=[];drawStudents();
    try{readRows();$('atMapping').open=Boolean(mapping.ambiguous);}catch{status('날짜와 학생 영역을 지정한 뒤 학생 행 불러오기를 눌러주세요.');}
    if(mapping.ambiguous)status('날짜 영역을 자동 확정하지 못했습니다. 시트와 셀 위치를 확인해주세요.');
  }
  const blobUrl=blob=>{const u=URL.createObjectURL(blob);urls.add(u);return u;};
  $('atFile').onchange=async e=>{
    const file=e.target.files[0];const current=++ticket;template=null;mapping=null;students=[];
    $('atSource').replaceChildren();$('atFields').replaceChildren();$('atSheet').innerHTML='<option value="">Excel 양식 선택 전</option>';drawStudents();$('atClosures').value='';$('atClear').checked=false;invalidate();if(!file)return;
    status('양식을 읽는 중...');
    if(file.size>20*1024*1024){status('Excel 파일은 20MB 이하로 올려주세요.');return;}
    busy=true;syncControls();
    try{const bytes=await file.arrayBuffer();if(disposed||ticket!==current)return;template=openTemplate(new Uint8Array(bytes));$('atSheet').innerHTML=template.sheets.filter(s=>!s.hidden).map(s=>`<option value="${s.index}">${h(s.name)}</option>`).join('');$('atSheet').value=String(template.sheets.find(s=>!s.hidden&&/출석/.test(s.name))?.index??template.sheets.find(s=>!s.hidden)?.index);selectSheet();}
    catch(error){if(disposed||ticket!==current)return;template=null;mapping=null;students=[];$('atSource').replaceChildren();$('atFields').replaceChildren();$('atSheet').innerHTML='<option value="">Excel 양식 선택 전</option>';drawStudents();invalidate();status(error.message);}
    finally{if(!disposed&&ticket===current){busy=false;syncControls();}}
  };
  $('atSheet').onchange=()=>{try{selectSheet();}catch(error){status(error.message);}};
  $('atReadRows').onclick=()=>{try{readRows();}catch(error){status(error.message);}};
  $('atAdd').onclick=()=>{if(students.length>=500)return;students.push({name:'',weekdays:'',makeup:''});drawStudents();invalidate();$('atRoster').open=true;};
  $('atStudents').oninput=e=>{const {student,field}=e.target.dataset;if(student!==undefined){students[Number(student)][field]=e.target.value;invalidate();}};
  $('atStudents').onclick=e=>{const b=e.target.closest('[data-clear-row]');if(!b)return;students[Number(b.dataset.clearRow)]={name:'',weekdays:'',makeup:''};drawStudents();invalidate();};
  $('atForm').addEventListener('input',e=>{if(!['atConfirm','atFile','atSheet'].includes(e.target.id))invalidate();});
  $('atForm').addEventListener('change',e=>{if(!['atConfirm','atFile','atSheet'].includes(e.target.id))invalidate();});
  $('atForm').onsubmit=async e=>{
    e.preventDefault();if(busy||!template||!mapping||!$('atConfirm').checked)return;
    busy=true;const fileTicket=ticket;syncControls();status('원본 양식으로 생성 중...');
    try{await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));if(disposed||fileTicket!==ticket)return;
      const next=readMapping();if(['dateRow','dateStart','weekdayRow','nameCol','weekdayCol','firstStudentRow','lastStudentRow'].some(k=>next[k]!==mapping[k]))throw Error('양식 영역이 변경되었습니다. 학생 행 불러오기를 먼저 눌러주세요.');
      const year=Number($('atYear').value),month=Number($('atMonth').value);
      result=generateAttendance(template,next,{year,month,students,closures:dayList($('atClosures').value),makeups:Object.fromEntries(students.map((s,i)=>[i,dayList(s.makeup)])),clearMarks:$('atClear').checked});
      $('atResult').hidden=false;$('atEstimate').textContent=result.plan.settings.paperSize===9?`출력 예상: A4 ${result.plan.settings.orientation==='portrait'?'세로':'가로'} ${result.plan.pages.length}장${result.plan.pages.length>1?' (날짜 1~31 전체 반복)':''}`:'원본 용지가 A4가 아닙니다. Excel 인쇄 설정을 확인해주세요.';
      $('atWarnings').innerHTML=result.warnings.map(w=>`<li>${h(w)}</li>`).join('');$('atPrint').disabled=!result.browserPrintSafe;
      $('atTable').innerHTML=`<style>${TABLE_CSS}</style>${renderTable(result)}`;fit(true);status('생성 완료 · 원본 파일은 변경하지 않았습니다.');
    }catch(error){result=null;$('atResult').hidden=true;status(error.message);}
    finally{busy=false;if(!disposed)syncControls();}
  };
  let fitted=true;
  function fit(value=fitted){fitted=value;if(!result||disposed)return;const w=result.plan.dimensions.width,table=$('atTable'),preview=$('atPreview'),scale=value?Math.min(1,(preview.clientWidth-2)/w):1;table.style.width=`${w}px`;table.style.transform=`scale(${scale})`;$('atPaper').style.width=`${w*scale}px`;$('atPaper').style.height=`${table.getBoundingClientRect().height}px`;$('atFit').setAttribute('aria-pressed',String(value));$('atActual').setAttribute('aria-pressed',String(!value));}
  $('atFit').onclick=()=>fit(true);$('atActual').onclick=()=>fit(false);
  const observer=new ResizeObserver(()=>fit());observer.observe($('atPreview'));
  $('atDownload').onclick=()=>{if(!result)return;const link=document.createElement('a');link.href=blobUrl(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));link.download=`${campusName.replace(/[<>:"/\\|?*]/g,'_')||'학원'}_${result.year}년_${result.month}월_출석부.xlsx`;link.click();};
  $('atPrint').onclick=async()=>{
    if(!result||busy||!result.browserPrintSafe)return;const output=result;busy=true;syncControls();
    try{const frame=document.createElement('iframe');frame.className='at-print-frame';frame.title='출석부 인쇄';frame.setAttribute('sandbox','allow-same-origin allow-modals');frames.add(frame);
      const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(Error('인쇄 화면을 열지 못했습니다.'));});frame.srcdoc=printDocument(output);document.body.append(frame);await loaded;await frame.contentDocument.fonts.ready;if(disposed)return;
      frame.contentWindow.addEventListener('afterprint',()=>{frames.delete(frame);frame.remove();},{once:true});frame.contentWindow.focus();frame.contentWindow.print();
    }catch(error){status(error.message);}finally{busy=false;if(!disposed)syncControls();}
  };
  syncControls();
  return ()=>{disposed=true;ticket++;template=null;result=null;students=[];observer.disconnect();for(const url of urls)URL.revokeObjectURL(url);for(const frame of frames)frame.remove();};
}

import {openTemplate,inspectAttendanceSheets,nextMonth,generateWorkbook,attendanceFilename,printWorkbook,RECOGNITION_ERROR} from './attendance-auto.js?v=20260915-template-recovery';
import {renderTable,TABLE_CSS,escapeHtml as h} from './attendance-template.js';

const icon=name=>`<svg class="at-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"/></svg>`;
const monthValue=({year,month})=>`${year}-${String(month).padStart(2,'0')}`;
export function mountAttendance(host){
  let template=null,analysis=null,result=null,filename='',disposed=false,busy=false,ticket=0,active=0,fitted=true;
  const overrides={},urls=new Set(),frames=new Set();
  let inspected=[];
  const selected=new Set(),sourcePeriods={};
  const now=new Date();
  host.innerHTML=`<section class="at-app">
    <form id="atForm">
      <label class="at-upload">지난달 출석부 업로드<input id="atFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <div id="atRecognized" hidden></div>
      <fieldset id="atSheetSelection" hidden><legend>생성할 출석부</legend><div id="atSourceSheets"></div><small>선택하지 않은 시트는 다운로드 파일에 원본 그대로 남습니다.</small></fieldset>
      <label class="at-period">다음 출석부<input id="atMonth" type="month" min="1901-01" max="2100-12" value="${monthValue(nextMonth(now.getFullYear(),now.getMonth()+1))}" required></label>
      <div id="atLayoutOption" hidden><label class="at-check"><input id="atPreserveColumns" type="checkbox">원본 날짜칸 유지</label><small>수식이 복잡한 양식에서 사용합니다. 주말 수업칸은 재배치하지 않고 원본 위치와 개수를 유지합니다.</small></div>
      <div id="atReviewPrompt" hidden><span id="atReviewCount"></span> <button type="button" id="atReview">확인</button></div>
      <button type="submit" id="atGenerate" class="at-primary" disabled>출석부 만들기</button>
    </form>
    <p id="atStatus" role="status" aria-live="polite"></p>
    <section id="atResult" hidden>
      <h2 id="atResultTitle"></h2>
      <p id="atLayoutNotice" hidden>원본 날짜칸을 유지했습니다. 주말 다중 수업칸은 재배치되지 않으므로 Excel에서 확인해주세요.</p>
      <div id="atTabs" role="tablist" aria-label="출석부 시트"></div>
      <div class="at-result-heading"><span id="atEstimate"></span><button type="button" id="atSize" aria-pressed="false" title="실제 크기">${icon('ZoomIn')}</button></div>
      <div class="at-preview" id="atPreview" role="tabpanel" tabindex="0" aria-label="생성된 출석부 미리보기"><div id="atPaper"><div id="atTable"></div></div></div>
      <div class="at-actions"><button type="button" id="atAgain">${icon('RotateCcw')}다시 만들기</button><button type="button" id="atDownload">Excel 다운로드</button><button type="button" id="atPrint">${icon('Printer')}인쇄</button></div>
      <p id="atPrintNotice" hidden>이 양식은 Excel 다운로드 후 원본 설정으로 인쇄해주세요.</p>
    </section>
    <dialog id="atReviewDialog" aria-labelledby="atReviewTitle"><form method="dialog"><h2 id="atReviewTitle">수업요일 확인</h2><div id="atReviewStudents"></div><p id="atReviewError" role="status"></p><div class="at-actions"><button value="cancel">취소</button><button type="button" id="atReviewSave" class="at-primary">확인</button></div></form></dialog>
  </section>`;
  const $=id=>host.querySelector(`#${id}`),status=text=>{if(!disposed)$('atStatus').textContent=text;};
  const pending=()=>analysis?.sheets.flatMap(s=>s.studentBlocks.filter(b=>b.name&&b.needsReview&&!overrides[b.id]).map(b=>({...b,sheet:s.name})))||[];
  function sync(){
    $('atFile').disabled=busy;$('atMonth').disabled=busy;$('atPreserveColumns').disabled=busy;$('atGenerate').disabled=busy||!analysis?.sheets.length||pending().length>0;
    $('atSheetSelection').disabled=busy;
    $('atGenerate').textContent=busy?'처리 중...':`${Number($('atMonth').value.slice(5))||''}월 출석부 만들기`;
    $('atReviewPrompt').hidden=!pending().length;$('atReviewCount').textContent=`수업요일 확인이 필요한 학생이 ${pending().length}명 있습니다.`;
    $('atPrint').disabled=busy||!result?.results.every(r=>r.browserPrintSafe);$('atDownload').disabled=busy||!result;
  }
  function invalidate(){result=null;$('atResult').hidden=true;$('atTable').replaceChildren();for(const url of urls)URL.revokeObjectURL(url);urls.clear();sync();}
  function selectSheets(){
    const sheets=inspected.filter(s=>s.status==='ready'&&selected.has(s.index)).map(s=>s.mapping);
    const latest=sheets.reduce((p,s)=>!p||s.period.year*12+s.period.month>p.year*12+p.month?s.period:p,null);
    analysis=sheets.length?{sheets,year:latest.year,month:latest.month}:null;
    $('atRecognized').innerHTML=`<strong>${h(filename)}</strong><span>${sheets.length}개 출석부 확인 · 학생 ${sheets.reduce((n,s)=>n+s.studentBlocks.filter(b=>b.name).length,0)}명</span>`;
    $('atRecognized').hidden=false;invalidate();
  }
  function sourceList(){
    $('atSheetSelection').hidden=inspected.length===1&&inspected[0].status==='ready';
    $('atLayoutOption').hidden=!inspected.some(s=>s.status==='ready');
    $('atSourceSheets').innerHTML=inspected.map(s=>`<div class="at-source-sheet"><label class="at-check"><input type="checkbox" data-source-sheet="${s.index}" ${selected.has(s.index)?'checked':''} ${s.status!=='ready'?'disabled':''}><span>${h(s.name)}${s.status==='ready'?` · ${s.mapping.period.year}년 ${s.mapping.period.month}월`:''}</span></label>${s.status==='needs-period'?`<label>원본 출석부 연도·월<input type="month" data-source-period="${s.index}" aria-label="${h(s.name)} 원본 연도·월" min="1901-01" max="2100-12" value="${sourcePeriods[s.index]?monthValue(sourcePeriods[s.index]):''}"></label><button type="button" data-confirm-period="${s.index}">원본 월 확인</button>`:s.status==='unsupported'?`<small>${h(s.message)} 이 시트는 원본을 유지합니다.</small>`:''}</div>`).join('');
  }
  $('atSourceSheets').onchange=e=>{
    if(!e.target.matches('[data-source-sheet]'))return;
    const i=Number(e.target.dataset.sourceSheet);if(e.target.checked)selected.add(i);else selected.delete(i);
    selectSheets();status('');
  };
  $('atSourceSheets').onclick=e=>{
    const button=e.target.closest('[data-confirm-period]');if(!button||busy)return;
    const i=Number(button.dataset.confirmPeriod),input=host.querySelector(`[data-source-period="${i}"]`);
    if(!input.value||!input.checkValidity()){status('원본 출석부의 연도와 월을 선택해주세요.');return;}
    const [year,month]=input.value.split('-').map(Number);sourcePeriods[i]={year,month};
    inspected=inspectAttendanceSheets(template,filename,sourcePeriods);
    const item=inspected.find(s=>s.index===i);
    if(item.status==='ready'){selected.add(i);$('atMonth').value=monthValue(nextMonth(year,month));status('');}
    else {delete sourcePeriods[i];const message=item.message;inspected=inspectAttendanceSheets(template,filename,sourcePeriods);status(message);}
    sourceList();selectSheets();
  };
  $('atFile').onchange=async e=>{
    const file=e.target.files[0],epoch=++ticket;template=null;analysis=null;Object.keys(overrides).forEach(k=>delete overrides[k]);
    inspected=[];selected.clear();Object.keys(sourcePeriods).forEach(k=>delete sourcePeriods[k]);$('atPreserveColumns').checked=false;
    $('atRecognized').hidden=true;$('atRecognized').replaceChildren();$('atSourceSheets').replaceChildren();$('atSheetSelection').hidden=true;$('atLayoutOption').hidden=true;invalidate();if(!file){status('');return;}
    filename=file.name;busy=true;sync();status('출석부를 확인하는 중...');
    try{
      if(file.size>20*1024*1024)throw Error('Excel 파일은 20MB 이하로 올려주세요.');
      const bytes=await file.arrayBuffer();if(disposed||ticket!==epoch)return;
      template=openTemplate(bytes);inspected=inspectAttendanceSheets(template,filename);
      const ready=inspected.filter(s=>s.status==='ready'),latest=Math.max(...ready.map(s=>s.mapping.period.year*12+s.mapping.period.month));
      for(const s of ready)if(s.mapping.period.year*12+s.mapping.period.month===latest)selected.add(s.index);
      sourceList();selectSheets();
      if(analysis)$('atMonth').value=monthValue(nextMonth(analysis.year,analysis.month));
      status(analysis?'':inspected.some(s=>s.status==='needs-period')?'원본 연도·월을 확인하면 계속할 수 있습니다.':inspected[0]?.message||RECOGNITION_ERROR);
    }catch(error){template=null;analysis=null;status(`${error?.message||RECOGNITION_ERROR} 다른 파일을 선택해주세요.`);}
    finally{busy=false;if(!disposed&&ticket===epoch)sync();}
  };
  $('atMonth').oninput=()=>{invalidate();status('');};
  $('atPreserveColumns').onchange=()=>{invalidate();status('');};
  $('atReview').onclick=()=>{
    $('atReviewStudents').innerHTML=pending().map(b=>`<fieldset data-review="${h(b.id)}"><legend>${h(b.name)} <small>${h(b.sheet)}</small></legend><div class="at-weekdays">${[1,2,3,4,5,6,0].map(d=>`<label><input type="checkbox" value="${d}"${b.weekdays.includes(d)?' checked':''}><span>${'일월화수목금토'[d]}</span></label>`).join('')}</div></fieldset>`).join('');
    $('atReviewError').textContent='';$('atReviewDialog').showModal();
  };
  $('atReviewSave').onclick=()=>{
    const values=[...host.querySelectorAll('[data-review]')].map(el=>[el.dataset.review,[...el.querySelectorAll('input:checked')].map(c=>'일월화수목금토'[Number(c.value)]).join('')]);
    if(values.some(([,v])=>!v)){$('atReviewError').textContent='학생별 수업요일을 선택해주세요.';return;}
    Object.assign(overrides,Object.fromEntries(values));$('atReviewDialog').close();sync();$('atGenerate').focus();
  };
  $('atForm').onsubmit=async e=>{
    e.preventDefault();if(busy||!analysis?.sheets.length||pending().length)return;
    busy=true;sync();status('다음 달 출석부를 만드는 중...');
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));if(disposed)return;
      const [year,month]=$('atMonth').value.split('-').map(Number);
      result=generateWorkbook(template,analysis,{year,month,weekdays:overrides,preserveColumns:$('atPreserveColumns').checked});active=0;
      $('atResultTitle').textContent=`${year}년 ${month}월 출석부`;
      $('atLayoutNotice').hidden=!result.results.some(r=>r.preserveColumns&&r.mapping.dateColumns.some(d=>d.slot>0));
      $('atTabs').innerHTML=result.results.map((r,i)=>`<button type="button" role="tab" id="atTab${i}" aria-controls="atPreview" data-sheet="${i}">${h(r.mapping.name)}</button>`).join('');
      $('atResult').hidden=false;$('atForm').hidden=true;$('atPrintNotice').hidden=result.results.every(r=>r.browserPrintSafe);showSheet();status('');
    }catch(error){invalidate();$('atForm').hidden=false;status(`${error?.message||'출석부를 만들지 못했습니다.'}${/수식|그림·표·개체/.test(error?.message||'')?' 원본 날짜칸 유지를 선택하거나 해당 시트를 제외한 뒤 다시 만들어주세요.':''}`);}
    finally{busy=false;if(!disposed)sync();}
  };
  function fit(){
    if(!result||disposed)return;const w=result.results[active].plan.dimensions.width,table=$('atTable'),preview=$('atPreview');
    const scale=fitted?Math.min(1,(preview.clientWidth-2)/w):1;
    table.style.width=`${w}px`;table.style.transform=`scale(${scale})`;$('atPaper').style.width=`${w*scale}px`;$('atPaper').style.height=`${table.getBoundingClientRect().height}px`;
    $('atSize').setAttribute('aria-pressed',String(!fitted));$('atSize').title=fitted?'실제 크기':'화면 맞춤';$('atSize').setAttribute('aria-label',$('atSize').title);
  }
  function showSheet(){
    const r=result.results[active];
    host.querySelectorAll('[data-sheet]').forEach(b=>{b.setAttribute('aria-selected',String(Number(b.dataset.sheet)===active));b.tabIndex=Number(b.dataset.sheet)===active?0:-1;});
    $('atPreview').setAttribute('aria-labelledby',`atTab${active}`);
    $('atEstimate').textContent=r.plan.settings.paperSize===9?`출력 예상: A4 ${r.plan.settings.orientation==='portrait'?'세로':'가로'} ${r.plan.pages.length}장${r.plan.pages.length>1?' (날짜 1~31 전체 반복)':''}`:'원본 용지 설정 유지 · Excel에서 인쇄';
    $('atTable').innerHTML=`<style>${TABLE_CSS}</style>${renderTable(r)}`;fit();
  }
  $('atTabs').onclick=e=>{const b=e.target.closest('[data-sheet]');if(b){active=Number(b.dataset.sheet);showSheet();}};
  $('atTabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!result)return;e.preventDefault();active=e.key==='Home'?0:e.key==='End'?result.results.length-1:(active+(e.key==='ArrowRight'?1:-1)+result.results.length)%result.results.length;showSheet();$(`atTab${active}`).focus();};
  $('atSize').onclick=()=>{fitted=!fitted;fit();};
  $('atAgain').onclick=()=>{invalidate();$('atForm').hidden=false;$('atMonth').focus();};
  const observer=new ResizeObserver(fit);observer.observe($('atPreview'));
  $('atDownload').onclick=()=>{
    if(!result)return;const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));urls.add(url);
    const link=document.createElement('a');link.href=url;link.download=attendanceFilename(filename,result.year,result.month);link.click();
  };
  $('atPrint').onclick=async()=>{
    if(!result||busy||!result.results.every(r=>r.browserPrintSafe))return;busy=true;sync();
    const frame=document.createElement('iframe');frame.className='at-print-frame';frame.title='출석부 인쇄';frame.setAttribute('sandbox','allow-same-origin allow-modals');frames.add(frame);
    try{
      const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;});frame.srcdoc=printWorkbook(result);document.body.append(frame);
      await loaded;await frame.contentDocument.fonts.ready;if(disposed)return;
      frame.contentWindow.addEventListener('afterprint',()=>{frames.delete(frame);frame.remove();},{once:true});frame.contentWindow.focus();frame.contentWindow.print();
    }catch{frames.delete(frame);frame.remove();status('인쇄 화면을 열지 못했습니다. Excel 다운로드 후 인쇄해주세요.');}
    finally{busy=false;if(!disposed)sync();}
  };
  sync();
  return ()=>{disposed=true;ticket++;template=null;analysis=null;result=null;observer.disconnect();$('atReviewDialog').close();for(const url of urls)URL.revokeObjectURL(url);for(const frame of frames)frame.remove();};
}

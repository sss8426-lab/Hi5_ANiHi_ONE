// 종합 출석부 업로드 → 반별 출석부 Excel. One official 종합입력 file becomes one workbook with a sheet
// per class (input order), in the official blue A4-landscape design. 공휴일·휴무 come from CORE's calendar.
import {parseRoster,RosterError} from './attendance-roster-parser.js?v=20260924-roster';
import {buildRosterWorkbook} from './attendance-roster-export.js?v=20260924-class-days';
import {fetchMonthHolidays,addHolidayClass,removeHolidayClass,holidaySummary} from './attendance-holidays.js?v=20260924-class-days';
import {escapeHtml as h} from './attendance-template.js?v=20260919-sparse-import';

const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function mountRosterAttendance(host,{campusId='',campusName=''}={}){
  let roster=null,result=null,busy=false,disposed=false,ticket=0,controller=null;
  let month=null,monthTicket=0,monthController=null,saving=false;
  const urls=new Set(),now=new Date();
  const next=now.getMonth()===11?{year:now.getFullYear()+1,month:1}:{year:now.getFullYear(),month:now.getMonth()+2};
  const years=[next.year-1,next.year,next.year+1];
  host.innerHTML=`<section class="at-app ar-app">
    <p class="ar-lead">종합입력 양식 하나를 올리면 반마다 시트가 나뉜 출석부 Excel을 만듭니다. A4 가로로 바로 인쇄할 수 있습니다.</p>
    <form id="arForm">
      <label class="at-upload">종합 출석부 업로드<input id="arFile" type="file" accept=".xlsx,${XLSX_TYPE}"></label>
      <div id="arSummary" hidden></div>
      <div id="arIssues" role="alert" hidden></div>
      <details id="arWarnings" hidden><summary></summary><ul></ul></details>
      <div class="ar-period"><label>연도<select id="arYear">${years.map(y=>`<option value="${y}"${y===next.year?' selected':''}>${y}년</option>`).join('')}</select></label>
        <label>월<select id="arMonth">${Array.from({length:12},(_,i)=>`<option value="${i+1}"${i+1===next.month?' selected':''}>${i+1}월</option>`).join('')}</select></label></div>
      <fieldset id="arDaysOff" class="ar-days-off" hidden><legend>이 달 공휴일·휴무</legend>
        <small>공휴일이어도 수업하는 날은 체크하세요. 체크한 날은 이 캠퍼스 출석부에 휴로 표시하지 않고 정상 수업일로 만듭니다.</small>
        <ul id="arDaysOffList"></ul></fieldset>
      <button type="submit" id="arGenerate" class="at-primary" disabled>반별 출석부 Excel 생성</button>
    </form>
    <p id="arStatus" role="status" aria-live="polite"></p>
    <section id="arResult" hidden>
      <h2 id="arResultTitle"></h2>
      <p id="arHolidays"></p>
      <div class="ar-table-wrap"><table class="ar-table"><thead><tr><th>시트(반)</th><th>학생</th><th>날짜칸</th><th>일수</th></tr></thead><tbody id="arSheets"></tbody></table></div>
      <p class="ar-note">A4 가로 · 가로 1페이지 맞춤 · 3~4행 제목 반복 인쇄 · 파란 칸 = 예정 수업</p>
      <div class="at-actions"><button type="button" id="arDownload" class="at-primary">Excel 다운로드</button></div>
    </section>
  </section>`;
  const $=id=>host.querySelector(`#${id}`),status=text=>{if(!disposed)$('arStatus').textContent=text;};
  const blocked=()=>!roster||roster.issues.length>0;
  function sync(){
    $('arFile').disabled=busy;$('arYear').disabled=busy;$('arMonth').disabled=busy;
    host.querySelectorAll('[data-day-off]').forEach(input=>{input.disabled=busy||saving;});
    $('arGenerate').disabled=busy||blocked();$('arGenerate').textContent=busy?'처리 중...':'반별 출석부 Excel 생성';
    $('arDownload').disabled=busy||!result;
  }
  function invalidate(){result=null;$('arResult').hidden=true;$('arSheets').replaceChildren();for(const url of urls)URL.revokeObjectURL(url);urls.clear();sync();}
  function showRoster(fileName){
    const mismatch=campusName&&roster.campus.replace(/\s+/g,'')!==campusName.replace(/\s+/g,'');
    $('arSummary').innerHTML=`<strong>${h(fileName)}</strong>
      <dl class="ar-facts"><div><dt>캠퍼스</dt><dd>${h(roster.campus)}</dd></div><div><dt>반</dt><dd>${roster.classes.length}개</dd></div><div><dt>학생</dt><dd>${roster.studentCount}명</dd></div></dl>
      <ol class="ar-classes">${roster.classes.map(c=>`<li><span>${h(c.name)}</span><span>${c.students.length}명</span></li>`).join('')}</ol>
      ${mismatch?`<small>파일의 캠퍼스(${h(roster.campus)})가 선택한 캠퍼스(${h(campusName)})와 다릅니다. 공휴일·휴무는 선택한 캠퍼스 일정으로 반영합니다.</small>`:''}`;
    $('arSummary').hidden=false;
    $('arIssues').hidden=!roster.issues.length;
    $('arIssues').innerHTML=roster.issues.length?`<strong>종합입력에서 고칠 곳이 ${roster.issues.length}개 있습니다. 수정 후 다시 올려주세요.</strong><ul>${roster.issues.map(i=>`<li>${i.row}행${i.name?` ${h(i.name)}`:''}: ${h(i.message)}</li>`).join('')}</ul>`:'';
    $('arWarnings').hidden=!roster.warnings.length;
    $('arWarnings').querySelector('summary').textContent=`확인하면 좋은 점 ${roster.warnings.length}개`;
    $('arWarnings').querySelector('ul').innerHTML=roster.warnings.map(w=>`<li>${h(w)}</li>`).join('');
  }
  function clearRoster(){roster=null;$('arSummary').hidden=true;$('arSummary').replaceChildren();$('arIssues').hidden=true;$('arIssues').replaceChildren();$('arWarnings').hidden=true;invalidate();}
  $('arFile').onchange=async e=>{
    const file=e.target.files[0],epoch=++ticket;clearRoster();if(!file){status('');return;}
    busy=true;sync();status('종합 출석부를 확인하는 중...');
    try{
      if(!/\.xlsx$/i.test(file.name))throw new RosterError('xlsx 파일만 올릴 수 있습니다. Excel에서 "Excel 통합 문서(*.xlsx)"로 저장해주세요.');
      if(file.size>20*1024*1024)throw new RosterError('Excel 파일은 20MB 이하로 올려주세요.');
      const bytes=await file.arrayBuffer();if(disposed||ticket!==epoch)return;
      roster=parseRoster(bytes);showRoster(file.name);
      status(roster.issues.length?'':`${roster.classes.length}개 반 · 학생 ${roster.studentCount}명을 확인했습니다. 연도와 월을 고른 뒤 생성해주세요.`);
    }catch(error){
      if(disposed||ticket!==epoch)return;roster=null;
      status(`${error instanceof RosterError?error.message:'종합 출석부를 읽지 못했습니다.'} 파일을 확인한 뒤 다시 올려주세요.`);
    }finally{if(!disposed&&ticket===epoch){busy=false;sync();}}
  };
  const WEEKDAY='일월화수목금토';
  function renderDaysOff(){
    const box=$('arDaysOff');box.hidden=!month;if(!month)return;
    const days=[...month.all].sort(([a],[b])=>a.localeCompare(b));
    $('arDaysOffList').innerHTML=days.length?days.map(([date,name])=>{
      const [,m,d]=date.split('-').map(Number),w=WEEKDAY[new Date(date+'T00:00:00Z').getUTCDay()],teach=month.classes.has(date);
      return `<li><label class="at-check"><input type="checkbox" data-day-off="${date}" data-name="${h(name)}"${teach?' checked':''}><span>${m}/${d}(${w}) ${h(name)} <em>${teach?'수업함':'휴'}</em></span></label></li>`;
    }).join(''):'<li class="ar-empty">이 달에는 공휴일·휴무가 없습니다.</li>';
    sync();
  }
  // The month's days off and this campus's 공휴일 수업 choices, shown before generating.
  async function loadDaysOff(){
    const year=Number($('arYear').value),m=Number($('arMonth').value),epoch=++monthTicket;
    monthController?.abort();monthController=new AbortController();month=null;renderDaysOff();
    try{
      const loaded=await fetchMonthHolidays({year,month:m,campusId,signal:monthController.signal});
      if(disposed||epoch!==monthTicket)return;month={year,month:m,...loaded};renderDaysOff();
    }catch(error){if(!disposed&&epoch===monthTicket&&error?.name!=='AbortError')status(error.message||'공휴일·휴무 일정을 불러오지 못했습니다.');}
  }
  $('arDaysOffList').onchange=async e=>{
    const input=e.target.closest('[data-day-off]');if(!input||!month||saving)return;
    const date=input.dataset.dayOff,name=input.dataset.name,current=month;
    saving=true;sync();invalidate();
    try{
      if(input.checked)current.classes.set(date,await addHolidayClass({date,name,campusId}));
      else{await removeHolidayClass({id:current.classes.get(date)});current.classes.delete(date);}
      const label=`${Number(date.slice(5,7))}/${Number(date.slice(8))} ${name}`;
      status(input.checked?`${label}: 이 캠퍼스는 수업하는 날로 저장했습니다.`:`${label}: 다시 휴로 표시합니다.`);
    }catch(error){input.checked=!input.checked;status(error.message);}
    finally{saving=false;if(!disposed&&month===current)renderDaysOff();}
  };
  $('arYear').onchange=$('arMonth').onchange=()=>{invalidate();status('');void loadDaysOff();};
  $('arForm').onsubmit=async e=>{
    e.preventDefault();if(busy||blocked())return;
    const year=Number($('arYear').value),month=Number($('arMonth').value),epoch=++ticket;
    invalidate();busy=true;sync();status(`${year}년 ${month}월 공휴일·휴무 일정을 확인하는 중...`);
    controller?.abort();controller=new AbortController();
    try{
      const loaded=await fetchMonthHolidays({year,month,campusId,signal:controller.signal}),holidays=loaded.holidays;
      const classDays=new Map([...loaded.all].filter(([date])=>loaded.classes.has(date)));
      if(disposed||ticket!==epoch)return;
      status('반별 출석부를 만드는 중...');
      await new Promise(resolve=>setTimeout(resolve,0));if(disposed||ticket!==epoch)return;
      result=buildRosterWorkbook(roster,{year,month,holidays,classDays});
      const plan=result.plan;
      $('arResultTitle').textContent=`${year}년 ${month}월 반별 출석부 · ${plan.sheets.length}개 시트`;
      $('arHolidays').textContent=holidays.size?`공휴일·휴무 반영: ${holidaySummary(holidays)}`:'이 달에는 휴로 표시할 날이 없습니다. (공휴일은 자동 등록되며, 학원 자체 휴무는 업무 캘린더에 "휴일" 일정으로 넣으면 반영됩니다)';
      if(classDays.size)$('arHolidays').textContent+=` · 공휴일 수업(정상 수업): ${holidaySummary(classDays)}`;
      $('arSheets').innerHTML=plan.sheets.map(s=>{
        const labels=[...new Set(s.students.map(st=>st.count.label))];
        return `<tr><th scope="row">${h(s.name)}</th><td>${s.students.length}명</td><td>${s.columns.length}칸</td><td>${h(labels.join(' · '))}</td></tr>`;
      }).join('');
      $('arResult').hidden=false;status('');
    }catch(error){
      if(disposed||ticket!==epoch||error?.name==='AbortError')return;
      invalidate();status(`${error?.message||'출석부를 만들지 못했습니다.'} 잠시 후 다시 시도해주세요.`);
    }finally{if(!disposed&&ticket===epoch){busy=false;sync();}}
  };
  $('arDownload').onclick=()=>{
    if(!result)return;const url=URL.createObjectURL(new Blob([result.bytes],{type:XLSX_TYPE}));urls.add(url);
    const link=document.createElement('a');link.href=url;link.download=result.filename;link.click();
  };
  sync();void loadDaysOff();
  return ()=>{disposed=true;ticket++;monthTicket++;controller?.abort();monthController?.abort();roster=null;result=null;for(const url of urls)URL.revokeObjectURL(url);};
}

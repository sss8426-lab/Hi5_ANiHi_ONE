// 종합 출석부 업로드 → 반별 출석부 Excel. One official 종합입력 file becomes one workbook with a sheet
// per class (input order), in the official blue A4-landscape design. 공휴일·휴무 come from CORE's calendar.
import {parseRoster,RosterError} from './attendance-roster-parser.js?v=20260924-roster';
import {buildRosterWorkbook} from './attendance-roster-export.js?v=20260924-roster';
import {fetchHolidays,holidaySummary} from './attendance-holidays.js?v=20260924-roster';
import {escapeHtml as h} from './attendance-template.js?v=20260919-sparse-import';

const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function mountRosterAttendance(host,{campusId='',campusName=''}={}){
  let roster=null,result=null,busy=false,disposed=false,ticket=0,controller=null;
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
  $('arYear').onchange=$('arMonth').onchange=()=>{invalidate();status('');};
  $('arForm').onsubmit=async e=>{
    e.preventDefault();if(busy||blocked())return;
    const year=Number($('arYear').value),month=Number($('arMonth').value),epoch=++ticket;
    invalidate();busy=true;sync();status(`${year}년 ${month}월 공휴일·휴무 일정을 확인하는 중...`);
    controller?.abort();controller=new AbortController();
    try{
      const holidays=await fetchHolidays({year,month,campusId,signal:controller.signal});
      if(disposed||ticket!==epoch)return;
      status('반별 출석부를 만드는 중...');
      await new Promise(resolve=>setTimeout(resolve,0));if(disposed||ticket!==epoch)return;
      result=buildRosterWorkbook(roster,{year,month,holidays});
      const plan=result.plan;
      $('arResultTitle').textContent=`${year}년 ${month}월 반별 출석부 · ${plan.sheets.length}개 시트`;
      $('arHolidays').textContent=holidays.size?`공휴일·휴무 반영: ${holidaySummary(holidays)}`:'이 달에 등록된 공휴일·휴무 일정이 없습니다. (업무 캘린더에 "휴무" 일정을 넣으면 자동 반영됩니다)';
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
  sync();
  return ()=>{disposed=true;ticket++;controller?.abort();roster=null;result=null;for(const url of urls)URL.revokeObjectURL(url);};
}

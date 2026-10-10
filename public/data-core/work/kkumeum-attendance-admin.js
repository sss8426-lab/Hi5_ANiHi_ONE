// 꿈이음 출결 설정 (원장·관리자): 명단 정리, 출결 반영 출석부, 출결기 연결, 타임 시간(자동 지각), 반별 담당 선생님,
// 등하원 번호와 보호자 연결.
// Mounted by kkumeum-mobile.js on view=attendance-settings. Every change is checked again on the server.
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { campusId:'', kiosks:[], pairing:null, settings:null, teachers:null, students:[], issued:new Map(), q:'', roster:null, review:null, editKey:'', rq:'', busy:false, version:0 };
  let ctx = null;
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const json = (method, body) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const q = () => `campusId=${encodeURIComponent(st.campusId)}`;
  const say = text => { const el=document.getElementById('kaFeedback'); if(el){el.textContent=text;el.hidden=!text;} };
  const ago = iso => { if(!iso)return '아직 사용 전'; const m=Math.round((Date.now()-Date.parse(iso))/60000); return m<1?'방금':m<60?`${m}분 전`:m<1440?`${Math.round(m/60)}시간 전`:new Date(iso).toLocaleDateString('ko-KR'); };
  const smsHref = (phone, body) => { const d=String(phone||'').replace(/\D/g,''); return d.length>=9?`sms:${d}?&body=${encodeURIComponent(body)}`:''; };
  const inviteText = (name, code) => `[꿈이음 안내]\n${name} 학생의 등·하원 알림과 수업 소식을 꿈이음 앱에서 받아보실 수 있습니다.\n아래 주소를 누르고 '시작하기'를 눌러 주세요.\n${location.origin}/family/#code=${encodeURIComponent(code)}\n인증키: ${code}`;

  const STATUS_LABEL = {active:'재원',leave:'휴원',withdrawn:'퇴원',moved:'이동',graduated:'졸업'};
  const REASON = {ambiguous:'꿈이음에 같은 이름 학생이 여러 명 있습니다. 어느 학생인지 골라 주세요.',inactive:'꿈이음에서 휴원·퇴원 상태인 학생입니다.',missing:'꿈이음에 없는 학생입니다.'};
  const DAYS = ['월','화','수','목','금','토','일'];
  const slotLabel = slots => DAYS.map(d=>{const t=(slots||[]).filter(x=>x[0]===d).map(x=>x.slice(1));return t.length?d+t.join('.'):'';}).filter(Boolean).join(' ')||'—';
  const monthLabel = m => `${Number(String(m).slice(5))}월`;
  const SHEET_MODULE = '/data-core/work/kkumeum-attendance-sheet.js?v=20261010-marks';
  function rosterHtml() {
    const r=st.roster?.rosters||[], cur=r[0];
    return `<section class="ka-panel ka-roster"><h3>지금 출석체크에 쓰이는 출석부</h3><p>${cur?`<b>${monthLabel(cur.month)} 출석부</b> · ${h(new Date(cur.updatedAt).toLocaleDateString('ko-KR'))} 업데이트 · ${cur.students}명`:'아직 연동된 출석부가 없습니다.'} <a href="/data-core/work/attendance">출석부 만들기·업데이트</a></p>
      ${r.length?`<div class="ka-row ka-sheet"><select id="kaSheetMonth" aria-label="출석부 월">${r.map(x=>`<option value="${h(x.month)}">${h(x.month.slice(0,4))}년 ${monthLabel(x.month)}</option>`).join('')}</select><button type="button" class="ka-primary" data-ka-sheet>출결 반영 출석부 다운로드</button></div>
      <small class="ka-hint">반별 출석부 양식 그대로, 날짜 칸에 ○ 출석 · 지 지각 · 조 조퇴 · 결 결석 · 보 보강이 채워진 Excel입니다.</small>`:''}</section>`;
  }
  function reviewHtml() {
    const rv=st.review;
    if(!rv)return '<section class="ka-panel"><h3>명단 정리</h3><p class="km-state">불러오는 중...</p></section>';
    if(!rv.month)return '<section class="ka-panel"><h3>명단 정리</h3><p class="km-state">출석부를 연동하면 반·학생 명단을 여기서 정리할 수 있습니다.</p></section>';
    const fix=rv.rows.filter(r=>r.reason==='ambiguous'||r.reason==='inactive'||r.reason==='missing');
    const fixHtml=fix.map(r=>`<div class="ka-fix"><div><b>${h(r.className)} · ${h(r.name)}</b><small>${h(REASON[r.reason])}</small></div><span>${r.candidates.map(c=>`<button type="button" data-ka-link="${h(r.key)}" data-sid="${h(c.id)}" data-reactivate="${c.status!=='active'?'1':''}">${h(c.className||'반 없음')} · ${h(STATUS_LABEL[c.status]||c.status)} 학생${c.status!=='active'?'(재원으로 되돌리기)':''}과 연결</button>`).join('')}<button type="button" data-ka-create="${h(r.key)}">새 학생으로 등록</button></span></div>`).join('');
    const away=rv.notInRoster.map(s=>`<li><span><b>${h(s.name)}</b><small>${h(s.className||'반 없음')}</small></span><span><button type="button" data-ka-left="${h(s.id)}" data-status="leave" data-name="${h(s.name)}">휴원</button><button type="button" class="ka-danger" data-ka-left="${h(s.id)}" data-status="withdrawn" data-name="${h(s.name)}">퇴원</button></span></li>`).join('');
    const term=st.rq.replace(/\s+/g,'');
    const rows=rv.rows.filter(r=>!term||r.name.replace(/\s+/g,'').includes(term)||r.className.replace(/\s+/g,'').includes(term)).map(r=>{
      const badge=r.status&&r.status!=='active'?`<em class="ka-left">${h(STATUS_LABEL[r.status]||r.status)}</em>`:'';
      if(st.editKey!==r.key)return `<tr><td>${h(r.className)}</td><td>${h(r.name)} ${badge}</td><td>${h(slotLabel(r.slots))}</td><td><button type="button" data-ka-edit="${h(r.key)}">변경</button></td></tr>`;
      const options=rv.classNames.map(n=>`<option ${n===r.className?'selected':''}>${h(n)}</option>`).join('');
      const chips=DAYS.map(d=>`<span class="ka-slot-day"><b>${d}</b>${['1','2','3'].map(t=>`<label><input type="checkbox" data-ka-slot value="${d}${t}" ${r.slots.includes(d+t)?'checked':''}>${t}</label>`).join('')}</span>`).join('');
      const status=r.studentId?`<label>상태<select id="kaEditStatus">${['active','leave','withdrawn'].map(v=>`<option value="${v}" ${(r.status||'active')===v?'selected':''}>${STATUS_LABEL[v]}</option>`).join('')}</select></label>`:'<small>꿈이음 학생과 연결한 뒤 상태를 바꿀 수 있습니다.</small>';
      return `<tr class="ka-editing"><td colspan="4"><b>${h(r.name)}</b><div class="ka-edit"><label>반<select id="kaEditClass">${options}</select></label>${status}</div>
        <div class="ka-slots" role="group" aria-label="수업요일">${chips}</div><small class="ka-hint">이 달 출석부와 꿈이음 반이 함께 바뀝니다. 다음 달은 종합입력에도 바꿔 주세요.</small>
        <div class="ka-row"><button type="button" class="ka-primary" data-ka-edit-save="${h(r.key)}">저장</button><button type="button" data-ka-edit-cancel>취소</button></div></td></tr>`;
    }).join('');
    return `<section class="ka-panel ka-review"><h3>명단 정리<small>휴원·퇴원 처리하면 출석체크와 출결기에서 바로 빠지고 보호자 출결 알림도 멈춥니다</small></h3>
      ${rv.months.length>1?`<div class="ka-row"><label>기준 출석부 <select id="kaReviewMonth">${rv.months.map(m=>`<option value="${h(m)}" ${m===rv.month?'selected':''}>${h(m.slice(0,4))}년 ${monthLabel(m)}</option>`).join('')}</select></label></div>`:''}
      <h4>확인이 필요한 학생 ${fix.length}명</h4>${fixHtml||'<p class="ka-ok">출석부 학생이 모두 꿈이음 학생과 연결되어 있습니다.</p>'}
      <h4>${monthLabel(rv.month)} 출석부에 없는 재원 학생 ${rv.notInRoster.length}명</h4>${away?`<ul class="ka-away">${away}</ul>`:'<p class="ka-ok">없습니다.</p>'}
      <h4>반 이동 · 수업요일 · 상태</h4><input id="kaReviewSearch" type="search" value="${h(st.rq)}" placeholder="이름·반으로 찾기" aria-label="명단에서 학생 찾기">
      <div class="ka-table-wrap"><table class="ka-table"><thead><tr><th>반</th><th>학생</th><th>수업요일</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="km-state">학생이 없습니다.</td></tr>'}</tbody></table></div></section>`;
  }
  function kiosksHtml() {
    const rows=st.kiosks.filter(k=>k.paired).map(k=>`<div class="ka-dev"><span><b>${h(k.label)}</b><small>마지막 사용 ${h(ago(k.lastSeenAt))} · 오늘 ${k.todayCount}건</small></span><button type="button" data-ka-revoke="${h(k.id)}">연결 끊기</button></div>`).join('');
    const pair=st.pairing?`<div class="ka-pair-code"><small>새 태블릿에서 <b>${h(location.origin)}/kiosk</b> 를 열고 아래 번호를 누르세요</small><b class="ka-pair-num">${h(st.pairing.pairingCode)}</b><small>${h(st.pairing.label)} · ${new Date(st.pairing.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}까지 사용 (10분)</small></div>`:'';
    return `<section class="ka-panel"><h3>출결기 (태블릿)<small>직원 로그인 없이 등하원 번호만 누르는 화면</small></h3>${rows||'<p class="km-state">아직 연결된 출결기가 없습니다.</p>'}
      <form class="ka-row" id="kaPairForm"><input id="kaKioskLabel" maxlength="40" placeholder="출결기 이름 (예: 입시반 출결기)" aria-label="출결기 이름"><button type="submit" class="ka-primary">연결번호 만들기</button></form>${pair}
      <details class="ka-help"><summary>태블릿 준비 방법</summary><ol><li>태블릿 Chrome에서 <b>${h(location.origin)}/kiosk</b> 열기</li><li>위의 6자리 연결번호 누르고 [연결하기]</li><li>Chrome 메뉴(⋮) › <b>홈 화면에 추가</b> → 홈 화면의 "꿈이음 출결기"로 열기 (전체 화면)</li><li>설정 › 디스플레이 › 화면 자동 꺼짐을 가장 길게, 충전기 연결</li><li>설정 › 보안 › <b>앱 고정</b>을 켜 두면 학생이 다른 화면으로 나가지 못합니다</li></ol><small>제목(출결기 이름)을 1.5초 누르면 전체 화면·새로고침·연결 해제 메뉴가 열립니다.</small></details></section>`;
  }
  function timesHtml() {
    const s=st.settings||{weekday:{},weekend:{},lateMinutes:10};
    const input=(group,k)=>`<label>${k}타임<input type="time" data-ka-time="${group}:${k}" value="${h(s[group]?.[k]||'')}"></label>`;
    return `<section class="ka-panel"><h3>타임 시간<small>비워 두면 그 타임은 자동 지각을 쓰지 않습니다</small></h3>
      <div class="ka-times"><b>평일</b>${['1','2','3'].map(k=>input('weekday',k)).join('')}</div>
      <div class="ka-times"><b>토·일</b>${['1','2','3'].map(k=>input('weekend',k)).join('')}</div>
      <div class="ka-row"><label class="ka-late">시작 <input type="number" id="kaLate" min="0" max="120" value="${h(s.lateMinutes)}"> 분 뒤부터 등원하면 <b>지각</b></label><button type="button" class="ka-primary" data-ka-save-times>저장</button></div></section>`;
  }
  function teachersHtml() {
    const t=st.teachers; if(!t)return '<section class="ka-panel"><h3>반별 담당 선생님</h3><p class="km-state">불러오는 중...</p></section>';
    if(!t.classes.length)return '<section class="ka-panel"><h3>반별 담당 선생님</h3><p class="km-state">반이 없습니다. 출석부를 연동하면 반이 만들어집니다.</p></section>';
    return `<section class="ka-panel"><h3>반별 담당 선생님<small>선생님 계정은 담당 반 학생만 출석체크합니다</small></h3>${t.classes.map(c=>`<div class="ka-class"><b>${h(c.name)}</b><span>${t.staff.map(s=>`<label class="ka-chip"><input type="checkbox" data-ka-teacher="${h(c.id)}" value="${h(s.id)}" ${c.teacherIds.includes(s.id)?'checked':''}>${h(s.name)}</label>`).join('')||'<small>캠퍼스 교직원 계정이 없습니다</small>'}</span></div>`).join('')}</section>`;
  }
  function studentsHtml() {
    const term=st.q.replace(/\s+/g,'');
    const list=st.students.filter(s=>!term||s.name.replace(/\s+/g,'').includes(term)||s.code.startsWith(term)||s.className.includes(st.q.trim()));
    const unlinked=st.students.filter(s=>!s.guardians).length;
    const rows=list.map(s=>{
      const issued=st.issued.get(s.id), sms=issued?smsHref(s.parentPhone,inviteText(s.name,issued)):'';
      const action=s.guardians?'':issued?`${sms?`<a class="ka-sms" href="${h(sms)}">문자 보내기</a>`:''}<button type="button" data-ka-copy="${h(s.id)}">안내문 복사</button><code>${h(issued)}</code>`:'';
      return `<tr><td>${h(s.className)}</td><td><input class="ka-code" data-ka-code="${h(s.id)}" value="${h(s.code)}" inputmode="numeric" maxlength="6" aria-label="${h(s.name)} 등하원 번호"></td><td>${h(s.name)}</td><td class="${s.guardians?'ka-ok':'ka-ng'}">${s.guardians?`연결됨 ${s.guardians}명`:'미연결'}</td><td>${action}</td></tr>`;
    }).join('');
    return `<section class="ka-panel"><h3>등하원 번호 · 보호자 연결<small>번호는 4자리·중복 없이 자동, 칸을 눌러 바꿀 수 있습니다</small></h3>
      <div class="ka-row"><input id="kaSearch" type="search" value="${h(st.q)}" placeholder="이름·번호·반으로 찾기" aria-label="학생 찾기">
        <button type="button" class="ka-primary" data-ka-invites ${unlinked?'':'disabled'}>미연결 보호자 ${unlinked}명 인증키 한꺼번에 발급</button>
        <button type="button" data-ka-print>번호표 인쇄</button><button type="button" data-ka-csv>CSV 받기</button></div>
      ${st.issued.size?'<p class="ka-note">발급한 인증키는 이 화면을 닫으면 다시 볼 수 없습니다. [문자 보내기]를 누르면 휴대폰 문자 앱에 학부모 번호와 안내문이 채워집니다.</p>':''}
      <div class="ka-table-wrap"><table class="ka-table"><thead><tr><th>반</th><th>번호</th><th>학생</th><th>보호자</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="km-state">학생이 없습니다.</td></tr>'}</tbody></table></div></section>`;
  }
  function paint() {
    const content=document.getElementById('kmContent'); if(!content||ctx.route().view!=='attendance-settings')return;
    const focus=document.activeElement?.id, sheetMonth=document.getElementById('kaSheetMonth')?.value;
    content.innerHTML=`<button type="button" class="km-back" data-view="attendance">출석체크로 돌아가기</button><h2>출결 설정</h2>
      <p id="kaFeedback" class="km-att-feedback" role="status" hidden></p>
      ${rosterHtml()}${reviewHtml()}${kiosksHtml()}${timesHtml()}${teachersHtml()}${studentsHtml()}`;
    if(sheetMonth&&document.getElementById('kaSheetMonth'))document.getElementById('kaSheetMonth').value=sheetMonth;
    if(focus==='kaSearch'||focus==='kaReviewSearch'){const b=document.getElementById(focus);b.focus();b.setSelectionRange(b.value.length,b.value.length);}
  }
  async function load() {
    const v=++st.version;st.campusId=ctx.state.campusId;st.issued=new Map();st.pairing=null;paint();
    try{
      const [kiosks,settings,teachers,students,roster,review]=await Promise.all([
        api(`/api/kkumeum/attendance/kiosks?${q()}`),api(`/api/kkumeum/attendance/settings?${q()}`),api(`/api/kkumeum/attendance/teachers?${q()}`),
        api(`/api/kkumeum/attendance/students?${q()}`),api(`/api/kkumeum/attendance/roster?${q()}`),api(`/api/kkumeum/attendance/roster-review?${q()}`)]);
      if(v!==st.version)return;
      st.kiosks=kiosks.kiosks;st.settings=settings.settings;st.teachers=teachers;st.students=students.students;st.roster=roster;st.review=review;st.editKey='';paint();
    }catch(e){if(v===st.version){const c=document.getElementById('kmContent');if(c)c.innerHTML=`<button type="button" class="km-back" data-view="attendance">출석체크로 돌아가기</button><p class="km-state">${h(e.message)}</p>`;}}
  }
  async function run(work, done) {
    if(st.busy)return; st.busy=true;
    try{ const r=await work(); if(done)say(typeof done==='function'?done(r):done); }
    catch(e){ say(e.message); }
    finally{ st.busy=false; }
  }
  function printCards() {
    const w=window.open('','_blank'); if(!w)return say('팝업이 막혀 있습니다. 팝업을 허용해 주세요.');
    const cards=st.students.map(s=>`<div class="c"><small>${h(s.className)}</small><b>${h(s.name)}</b><span>${h(s.code)}</span><em>꿈이음 출결기 등하원 번호</em></div>`).join('');
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>등하원 번호표</title><style>@page{size:A4;margin:10mm}body{font-family:'Noto Sans KR',sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.c{border:1.5px dashed #9fc7b8;border-radius:4mm;padding:5mm;text-align:center;break-inside:avoid}.c small{display:block;color:#5b6c66;font-size:10pt}.c b{display:block;font-size:15pt;margin:1mm 0}.c span{display:block;font-size:28pt;font-weight:800;letter-spacing:.15em;color:#16614f}.c em{font-style:normal;font-size:8pt;color:#8a978f}</style></head><body><div class="g">${cards}</div><script>print()</${"script"}></body></html>`);
    w.document.close();
  }
  function csv() {
    const lines=[['반','등하원 번호','학생','보호자 연결','학부모 전화'],...st.students.map(s=>[s.className,s.code,s.name,s.guardians?`연결됨 ${s.guardians}명`:'미연결',s.parentPhone])];
    const text='﻿'+lines.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download='등하원번호.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  // 명단 정리 changes return the refreshed list; 등하원 번호 and 담당 반 tables follow along.
  async function review(body, done) {
    await run(async()=>{
      st.review=await api('/api/kkumeum/attendance/roster-review',json('POST',{campusId:st.campusId,month:st.review.month,updatedAt:st.review.updatedAt,...body}));
      st.editKey='';
      const [students,teachers]=await Promise.all([api(`/api/kkumeum/attendance/students?${q()}`),api(`/api/kkumeum/attendance/teachers?${q()}`)]);
      st.students=students.students;st.teachers=teachers;paint();
    }, done);
  }
  const rowOf = key => st.review?.rows.find(r=>r.key===key);
  window.KkumeumAttendanceAdmin = { open(context){ ctx=context; void load(); } };
  const here = () => ctx && ctx.route().view==='attendance-settings';
  document.addEventListener('submit',e=>{
    if(!here()||e.target.id!=='kaPairForm')return; e.preventDefault();
    const label=document.getElementById('kaKioskLabel').value.trim()||`출결기 ${st.kiosks.filter(k=>k.paired).length+1}`;
    void run(async()=>{ st.pairing=await api('/api/kkumeum/attendance/kiosks',json('POST',{campusId:st.campusId,label})); paint(); }, '연결번호를 만들었습니다. 10분 안에 태블릿에서 입력해 주세요.');
  });
  document.addEventListener('click',e=>{
    if(!here())return;
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.kaRevoke){ if(!confirm('이 출결기 연결을 끊을까요? 그 태블릿에서는 바로 등원·하원을 누를 수 없게 됩니다.'))return;
      void run(async()=>{ await api(`/api/kkumeum/attendance/kiosks/${encodeURIComponent(b.dataset.kaRevoke)}`,json('DELETE',{campusId:st.campusId})); st.kiosks=(await api(`/api/kkumeum/attendance/kiosks?${q()}`)).kiosks; paint(); },'출결기 연결을 끊었습니다.'); }
    if(b.hasAttribute('data-ka-save-times')){
      const settings={weekday:{},weekend:{},lateMinutes:Number(document.getElementById('kaLate').value)||0};
      document.querySelectorAll('[data-ka-time]').forEach(i=>{const [g,k]=i.dataset.kaTime.split(':');settings[g][k]=i.value;});
      void run(async()=>{ st.settings=(await api('/api/kkumeum/attendance/settings',json('PUT',{campusId:st.campusId,settings}))).settings; paint(); },'타임 시간을 저장했습니다. 이제 늦은 등원은 자동으로 지각이 됩니다.');
    }
    if(b.hasAttribute('data-ka-invites')){
      const n=st.students.filter(s=>!s.guardians).length;
      if(!confirm(`보호자가 연결되지 않은 ${n}명의 인증키를 발급할까요? 이미 보낸 이전 인증키는 더 이상 쓸 수 없게 됩니다.`))return;
      void run(async()=>{ const r=await api('/api/kkumeum/attendance/invites',json('POST',{campusId:st.campusId})); for(const i of r.issued)st.issued.set(i.studentId,i.code); paint(); return r; }, r=>`${r.issued.length}명의 인증키를 발급했습니다. 학생마다 [문자 보내기]로 보내 주세요.`);
    }
    if(b.dataset.kaCopy){ const s=st.students.find(x=>x.id===b.dataset.kaCopy); const code=st.issued.get(b.dataset.kaCopy);
      navigator.clipboard.writeText(inviteText(s.name,code)).then(()=>say(`${s.name} 안내문을 복사했습니다.`),()=>say('복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.')); }
    if(b.dataset.kaLink){ const r=rowOf(b.dataset.kaLink); if(!r)return;
      void review({action:'link',key:r.key,name:r.name,studentId:b.dataset.sid,reactivate:b.dataset.reactivate==='1'}, `${r.name} 학생을 연결했습니다.`); }
    if(b.dataset.kaCreate){ const r=rowOf(b.dataset.kaCreate); if(!r||!confirm(`${r.className} · ${r.name} 학생을 꿈이음에 새 학생으로 등록할까요?`))return;
      void review({action:'create',key:r.key,name:r.name}, `${r.name} 학생을 새로 등록하고 등하원 번호를 정했습니다.`); }
    if(b.dataset.kaLeft){ const label=b.dataset.status==='withdrawn'?'퇴원':'휴원';
      if(!confirm(`${b.dataset.name} 학생을 ${label} 처리할까요? 출석체크·출결기에서 바로 빠지고 보호자 출결 알림도 가지 않습니다. 나중에 재원으로 되돌릴 수 있습니다.`))return;
      void review({action:'status',studentId:b.dataset.kaLeft,status:b.dataset.status}, `${b.dataset.name} 학생을 ${label} 처리했습니다.`); }
    if(b.dataset.kaEdit){ st.editKey=b.dataset.kaEdit; paint(); }
    if(b.hasAttribute('data-ka-edit-cancel')){ st.editKey=''; paint(); }
    if(b.dataset.kaEditSave){ const r=rowOf(b.dataset.kaEditSave); if(!r)return;
      const className=document.getElementById('kaEditClass').value, status=document.getElementById('kaEditStatus')?.value;
      const slots=[...document.querySelectorAll('[data-ka-slot]:checked')].map(i=>i.value);
      if(status==='withdrawn'&&r.status!=='withdrawn'&&!confirm(`${r.name} 학생을 퇴원 처리할까요? 출석체크·출결기에서 바로 빠집니다.`))return;
      void review({action:'edit',key:r.key,name:r.name,className,slots,...(status?{status}:{})}, `${r.name} 학생 정보를 저장했습니다.`); }
    if(b.hasAttribute('data-ka-sheet')){ const month=document.getElementById('kaSheetMonth').value;
      const campusName=ctx.state.campuses?.find(c=>c.id===st.campusId)?.name||'';
      void run(async()=>{ const {downloadAttendanceSheet}=await import(SHEET_MODULE); return downloadAttendanceSheet({campusId:st.campusId,campusName,month}); }, r=>`${r.filename} 를 받았습니다. (학생 ${r.students}명)`); }
    if(b.hasAttribute('data-ka-print'))printCards();
    if(b.hasAttribute('data-ka-csv'))csv();
  });
  document.addEventListener('change',e=>{
    if(!here())return;
    const el=e.target;
    if(el.dataset.kaTeacher){
      const classId=el.dataset.kaTeacher, ids=[...document.querySelectorAll(`[data-ka-teacher="${CSS.escape(classId)}"]:checked`)].map(i=>i.value);
      void run(async()=>{ const r=await api('/api/kkumeum/attendance/teachers',json('PUT',{campusId:st.campusId,classId,teacherIds:ids})); const c=st.teachers.classes.find(x=>x.id===classId); if(c)c.teacherIds=r.teacherIds; }, '담당 선생님을 저장했습니다.');
    }
    if(el.id==='kaReviewMonth'){
      void run(async()=>{ st.review=await api(`/api/kkumeum/attendance/roster-review?${q()}&month=${encodeURIComponent(el.value)}`); st.editKey=''; paint(); });
    }
    if(el.dataset.kaCode){
      const s=st.students.find(x=>x.id===el.dataset.kaCode), code=el.value.trim();
      if(!s||code===s.code)return;
      void run(async()=>{ await api(`/api/kkumeum/attendance/students/${encodeURIComponent(s.id)}/code`,json('PUT',{campusId:st.campusId,code})); s.code=code; }, `${s.name} 번호를 ${code}(으)로 바꿨습니다.`).then(()=>{ if(s.code!==code){el.value=s.code;} });
    }
  });
  const searchInput = e => { if(e.target.id==='kaSearch')st.q=e.target.value; else if(e.target.id==='kaReviewSearch')st.rq=e.target.value; else return; paint(); };
  document.addEventListener('input',e=>{ if(here()&&!e.isComposing)searchInput(e); });
  document.addEventListener('compositionend',e=>{ if(here())searchInput(e); });
})();

// 꿈이음 출결 설정 (원장·관리자): 출결기 연결, 타임 시간(자동 지각), 반별 담당 선생님, 등하원 번호와 보호자 연결.
// Mounted by kkumeum-mobile.js on view=attendance-settings. Every change is checked again on the server.
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { campusId:'', kiosks:[], pairing:null, settings:null, teachers:null, students:[], issued:new Map(), q:'', roster:null, busy:false, version:0 };
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
    const focus=document.activeElement?.id;
    const roster=st.roster?.rosters?.[0];
    content.innerHTML=`<button type="button" class="km-back" data-view="attendance">출석체크로 돌아가기</button><h2>출결 설정</h2>
      <p id="kaFeedback" class="km-att-feedback" role="status" hidden></p>
      <section class="ka-panel ka-roster"><h3>지금 출석체크에 쓰이는 출석부</h3><p>${roster?`<b>${Number(roster.month.slice(5))}월 출석부</b> · ${h(new Date(roster.updatedAt).toLocaleDateString('ko-KR'))} 업데이트 · ${roster.students}명`:'아직 연동된 출석부가 없습니다.'} <a href="/data-core/work/attendance">출석부 만들기·업데이트</a></p></section>
      ${kiosksHtml()}${timesHtml()}${teachersHtml()}${studentsHtml()}`;
    if(focus==='kaSearch'){const b=document.getElementById('kaSearch');b.focus();b.setSelectionRange(b.value.length,b.value.length);}
  }
  async function load() {
    const v=++st.version;st.campusId=ctx.state.campusId;st.issued=new Map();st.pairing=null;paint();
    try{
      const [kiosks,settings,teachers,students,roster]=await Promise.all([
        api(`/api/kkumeum/attendance/kiosks?${q()}`),api(`/api/kkumeum/attendance/settings?${q()}`),api(`/api/kkumeum/attendance/teachers?${q()}`),
        api(`/api/kkumeum/attendance/students?${q()}`),api(`/api/kkumeum/attendance/roster?${q()}`)]);
      if(v!==st.version)return;
      st.kiosks=kiosks.kiosks;st.settings=settings.settings;st.teachers=teachers;st.students=students.students;st.roster=roster;paint();
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
    if(el.dataset.kaCode){
      const s=st.students.find(x=>x.id===el.dataset.kaCode), code=el.value.trim();
      if(!s||code===s.code)return;
      void run(async()=>{ await api(`/api/kkumeum/attendance/students/${encodeURIComponent(s.id)}/code`,json('PUT',{campusId:st.campusId,code})); s.code=code; }, `${s.name} 번호를 ${code}(으)로 바꿨습니다.`).then(()=>{ if(s.code!==code){el.value=s.code;} });
    }
  });
  document.addEventListener('input',e=>{ if(here()&&e.target.id==='kaSearch'&&!e.isComposing){st.q=e.target.value;paint();} });
  document.addEventListener('compositionend',e=>{ if(here()&&e.target.id==='kaSearch'){st.q=e.target.value;paint();} });
})();

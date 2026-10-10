// 꿈이음 출석체크 (staff): pick students, press 등원·하원·결석·지각·조퇴·보강 and their guardians get an alert.
// Mounted by kkumeum-mobile.js when the 출석체크 menu is open.
// 출석부 연동: when the month's 출석부 was made on the 출석부 page, its roster comes with the day view
// (schedule). "오늘 수업" then lists exactly the students whose 수업요일 is today, grouped by 출석부 반,
// with 학생·학부모 전화 buttons; students not marked yet show "미등원" so they can be called right away.
(() => {
  const STATUS = [['arrive','등원'],['leave','하원'],['absent','결석'],['late','지각'],['early','조퇴'],['makeup','보강']];
  const LABEL = Object.fromEntries(STATUS);
  const CHECKED = new Set(STATUS.map(([k])=>k));
  const HOLIDAYS_MODULE = '/data-core/work/attendance-holidays.js?v=20260924-class-days';
  const SHEET_MODULE = '/data-core/work/kkumeum-attendance-sheet.js?v=20261010-marks';
  const ROSTER_PAGE = '/data-core/work/attendance';
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const att = { tab:'today', date:'', rows:new Map(), schedule:null, mode:'', onlyWaiting:false, holiday:'', holidayKey:'',
    selected:new Set(), month:'', monthly:null, busy:false, version:0, contacts:{}, teachers:{}, slotStarts:{}, canManage:false, q:'' };
  const normName = v => String(v||'').normalize('NFC').replace(/\s+/g,'');
  const ARRIVED = ['arrive','late','makeup'];
  // 출결기·한 번 누르기: 등원 → 하원 → 완료. The one button follows the student's records of the day.
  const nextAction = id => { const ev=att.rows.get(id)||[]; return ev.some(e=>e.status==='leave')?'done':ev.some(e=>ARRIVED.includes(e.status))?'leave':'arrive'; };
  const codeOf = id => att.contacts[id]?.code || '';
  let ctx = null;
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const kstToday = () => new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
  const dayLabel = d => { const [y,m,dd]=d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일 (${'일월화수목금토'[new Date(y,m-1,dd).getDay()]})`; };
  const monthNo = ym => Number(String(ym).slice(5,7));
  const say = text => { const el=document.getElementById('kmAttFeedback'); if(el) el.textContent=text; };
  const name = s => s.display_name || s.displayName || s.name || '';
  const PHONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>';
  const telHref = phone => { const digits=String(phone||'').replace(/[^\d+]/g,''); return digits.replace(/\D/g,'').length>=7?`tel:${digits}`:''; };

  // Rows to show: the 출석부 schedule (today's students or the whole month list) or, without a 출석부,
  // the 꿈이음 classes. Each row: {id (꿈이음 student or null), name, times, studentPhone, parentPhone, unmatched}.
  function groups() {
    const q=normName(att.q);
    if(q){
      // 이름·번호 찾기 looks through the whole month (보강 students too), not only today's list.
      const saved=[att.mode,att.onlyWaiting];att.mode='all';att.onlyWaiting=false;att.q='';
      const all=groups();[att.mode,att.onlyWaiting]=saved;att.q=q;
      return all.map(g=>({...g,rows:g.rows.filter(r=>normName(r.name).includes(q)||(r.id&&codeOf(r.id).startsWith(q)))})).filter(g=>g.rows.length);
    }
    const s=att.schedule;
    if(s){
      const mode=att.mode||'today';
      const list=s.classes.map((c,i)=>({key:`r${i}`,name:c.name,rows:c.students.filter(e=>mode==='all'||e.today).map(e=>({...e,id:e.studentId}))}));
      if(mode==='all'){
        const inRoster=new Set(s.classes.flatMap(c=>c.students.map(e=>e.studentId)).filter(Boolean));
        const others=ctx.state.students.filter(st=>(st.status||'active')==='active'&&!inRoster.has(st.id)).map(st=>({id:st.id,name:name(st),times:[],studentPhone:'',parentPhone:''}));
        if(others.length)list.push({key:'r-other',name:'출석부에 없는 꿈이음 학생',rows:others.sort((a,b)=>a.name.localeCompare(b.name,'ko'))});
      }
      return list.map(g=>({...g,rows:att.onlyWaiting&&mode==='today'?g.rows.filter(waiting):g.rows})).filter(g=>g.rows.length);
    }
    const list=[...ctx.state.classes].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const students=ctx.state.students.filter(st=>(st.status||'active')==='active');
    if(students.some(st=>!(st.current_class_id||st.currentClassId)))list.push({id:'',name:'반 미지정'});
    return list.map(c=>({key:`c${c.id}`,name:c.name,rows:students.filter(st=>(st.current_class_id||st.currentClassId||'')===c.id)
      .sort((a,b)=>name(a).localeCompare(name(b),'ko')).map(st=>({id:st.id,name:name(st),times:[],studentPhone:'',parentPhone:''}))})).filter(g=>g.rows.length);
  }
  const marked = id => (att.rows.get(id)||[]).some(e=>CHECKED.has(e.status));
  const arrived = id => (att.rows.get(id)||[]).some(e=>['arrive','late','makeup'].includes(e.status));
  // 미등원: has class today by the 출석부, can be marked, nothing recorded yet, and today is not a day off.
  const waiting = row => Boolean(att.schedule&&row.today&&row.id&&!att.holiday&&!marked(row.id));

  function chips(studentId) {
    return (att.rows.get(studentId)||[]).map(e=>`<span class="km-att-chip km-att-${h(e.status)}" title="${h(e.message)}">${h(e.label)} ${e.status==='absent'?'':h(e.time)}${e.source==='kiosk'?' <span class="km-att-kiosk" title="출결기로 기록">📟</span>':''}<button type="button" data-att-cancel="${h(e.id)}" aria-label="${h(e.label)} ${h(e.time)} 기록 취소">×</button></span>`).join('');
  }
  function call(phone,who,student) {
    const href=telHref(phone);
    return href
      ? `<a class="km-att-call km-att-call-${who==='학생'?'student':'parent'}" href="${h(href)}" aria-label="${h(student)} ${who}에게 전화 ${h(phone)}" title="${h(phone)}">${PHONE_ICON}<span>${who}</span></a>`
      : `<span class="km-att-call km-att-call-none" aria-label="${h(student)} ${who} 번호 없음" title="출석부에 ${who} 번호가 없습니다">${PHONE_ICON}<span>${who}</span></span>`;
  }
  function oneButton(r) {
    if(!r.id)return '';
    const next=nextAction(r.id);
    return next==='done'?'<button type="button" class="km-att-one km-att-one-done" disabled>완료</button>'
      :`<button type="button" class="km-att-one km-att-one-${next}" data-att-one="${next}" data-id="${h(r.id)}" data-name="${h(r.name)}" ${att.busy?'disabled':''}>${next==='arrive'?'등원':'하원'}</button>`;
  }
  function row(r) {
    const picked=r.id&&att.selected.has(r.id), wait=waiting(r), events=r.id?chips(r.id):'';
    const code=r.id?codeOf(r.id):'', unlinked=r.id&&att.contacts[r.id]&&!att.contacts[r.id].guardians;
    const slot=r.times?.length&&(att.mode||'today')==='today'?`<em class="km-att-slot">${h(r.times.join('·'))}타임</em>`:'';
    const note=r.id?'':`<em class="km-att-note">${r.unmatched==='ambiguous'?'동명이인 확인 필요':r.unmatched==='inactive'?'꿈이음 휴원 상태':'꿈이음 미등록'}</em>`;
    return `<div class="km-att-row${picked?' km-att-picked':''}${wait?' km-att-waiting':''}${r.id?'':' km-att-unlinked'}">
      <label class="km-att-who"><input type="checkbox" ${r.id?`data-att-student="${h(r.id)}"`:'disabled'} ${picked?'checked':''} aria-label="${h(r.name)} 선택">${code?`<span class="km-att-no" title="등하원 번호">${h(code)}</span>`:''}<span class="km-att-name">${h(r.name)}</span>${slot}${wait?'<em class="km-att-tag">미등원</em>':''}${unlinked?'<em class="km-att-ng" title="이 학생은 알림을 받을 보호자가 연결되지 않았습니다">보호자 미연결</em>':''}${note}</label>
      <span class="km-att-calls">${att.schedule?`${call(r.studentPhone,'학생',r.name)}${call(r.parentPhone,'학부모',r.name)}`:''}${oneButton(r)}</span>
      ${events?`<span class="km-att-chips">${events}</span>`:''}</div>`;
  }
  function header() {
    const s=att.schedule;
    if(!s) return `<div class="km-att-roster km-att-roster-missing"><strong>출석부가 아직 연동되지 않았습니다.</strong> 업무의 <a href="${ROSTER_PAGE}">출석부</a>에서 종합 출석부로 이번 달 출석부를 만들면, 날짜와 요일에 맞춰 그날 수업하는 학생과 학생·학부모 전화번호가 여기에 자동으로 나옵니다.</div>`;
    const today=att.date.slice(0,7);
    const rows=s.classes.flatMap(c=>c.students.filter(e=>e.today).map(e=>({...e,id:e.studentId})));
    const waitingCount=rows.filter(waiting).length, arrivedCount=rows.filter(e=>e.studentId&&arrived(e.studentId)).length;
    return `<div class="km-att-roster"><span><strong>${monthNo(s.month)}월 출석부</strong> 기준 · 오늘(${h(s.weekday)}요일) 수업 <b>${s.todayCount}명</b></span>
      ${s.todayCount?`<span class="km-att-stats"><span>등원 <b>${arrivedCount}</b></span>${att.holiday?'':`<span class="km-att-wait-count">미등원 <b>${waitingCount}</b></span>`}</span>`:''}
      ${s.exact?'':`<small>${monthNo(today)}월 출석부가 아직 없어 ${monthNo(s.month)}월 출석부의 수업요일로 보여줍니다. 업무의 <a href="${ROSTER_PAGE}">출석부</a>에서 ${monthNo(today)}월 출석부를 만들면 바로 바뀝니다.</small>`}</div>
      ${att.holiday?`<p class="km-att-holiday">오늘은 <strong>${h(att.holiday)}</strong>(으)로 출석부상 휴무일입니다. 수업하는 학생이 있으면 그대로 출석체크할 수 있습니다.</p>`:''}
      <div class="km-att-modes" role="group" aria-label="학생 보기">
        <button type="button" data-att-mode="today" aria-pressed="${(att.mode||'today')==='today'}">오늘 수업 ${s.todayCount}</button>
        <button type="button" data-att-mode="all" aria-pressed="${att.mode==='all'}">이 달 명단 전체</button>
        ${(att.mode||'today')==='today'&&!att.holiday?`<button type="button" data-att-waiting aria-pressed="${att.onlyWaiting}">미등원만</button>`:''}
      </div>`;
  }
  function today() {
    const gs=groups(), mode=att.schedule?(att.mode||'today'):'all';
    const empty=att.schedule
      ? (mode==='today'?(att.onlyWaiting?'미등원 학생이 없습니다. 오늘 수업 학생 모두 출결이 기록되었습니다.':`오늘(${att.schedule.weekday}요일)은 출석부상 수업하는 학생이 없습니다. "이 달 명단 전체"에서 찾아 출석체크할 수 있습니다.`):'이 달 출석부 명단이 비어 있습니다.')
      : '출석체크할 학생이 없습니다. 반과 학생을 먼저 등록해 주세요.';
    const body=gs.map(({key,name:title,rows})=>{
      const ids=[...new Set(rows.map(r=>r.id).filter(Boolean))];
      const all=ids.length>0&&ids.every(id=>att.selected.has(id));
      const came=ids.filter(arrived).length, wait=rows.filter(waiting).length;
      const times=[...new Set(rows.flatMap(r=>r.times||[]))].sort().map(t=>`${t}타임${att.slotStarts[t]?` ${att.slotStarts[t]}`:''}`).join(' · ');
      const teachers=(att.teachers[normName(title)]||[]).join(', ');
      return `<section class="km-group km-att-group"><div class="km-att-head"><label class="km-check"><input type="checkbox" data-att-class="${h(key)}" ${all?'checked':''} ${ids.length?'':'disabled'} aria-label="${h(title)} 전체 선택"></label><strong>${h(title)}${times&&(att.mode||'today')==='today'&&!att.q?` <span class="km-att-times">${h(times)}</span>`:''}</strong><small>${teachers?`담당 ${h(teachers)} · `:''}등원 ${came} / ${rows.length}${wait?` · <b>미등원 ${wait}</b>`:''}</small></div>
        ${rows.map(row).join('')}</section>`;
    }).join('')||`<p class="km-state">${h(empty)}</p>`;
    // 수업이 끝나면 한 번에: per 타임 (출석부) or for everyone still in.
    const scheduleRows=att.schedule?att.schedule.classes.flatMap(c=>c.students.filter(e=>e.today&&e.studentId)):[];
    const leaveGroups=att.schedule
      ? [...new Set(scheduleRows.flatMap(e=>e.times||[]))].sort().map(t=>({t,ids:[...new Set(scheduleRows.filter(e=>(e.times||[]).includes(t)&&nextAction(e.studentId)==='leave').map(e=>e.studentId))]}))
      : [{t:'',ids:[...att.rows.keys()].filter(id=>nextAction(id)==='leave')}];
    const bulk=leaveGroups.filter(g=>g.ids.length).map(g=>`<button type="button" class="km-att-bulk" data-att-bulk="${h(g.ids.join(','))}" ${att.busy?'disabled':''}>${g.t?`${h(g.t)}타임 `:''}등원 학생 ${g.ids.length}명 모두 하원</button>`).join('');
    return `<p class="km-meta">${h(dayLabel(att.date))} · 학생 줄의 버튼을 누르면 바로 등원·하원되고 보호자에게 알림이 갑니다. 출결기 기록은 30초마다 새로 보입니다.</p>
      ${att.canManage?'<button type="button" class="km-att-settings" data-view="attendance-settings">출결 설정 · 출결기 · 등하원 번호</button>':''}
      ${header()}<label class="km-att-search"><span class="km-sr">학생 찾기</span><input id="kmAttSearch" type="search" value="${h(att.q)}" placeholder="이름·등하원 번호로 찾기 (보강 학생도)" autocomplete="off"></label>${body}${bulk?`<div class="km-att-bulks">${bulk}</div>`:''}
      <div class="km-att-bar" role="region" aria-label="선택한 학생 출결 처리" ${att.selected.size?'':'hidden'}><div class="km-att-bar-top"><output id="kmAttCount">선택 ${att.selected.size}명</output><input id="kmAttMessage" maxlength="500" placeholder="알림에 덧붙일 말 (선택)" aria-label="알림에 덧붙일 말"></div>
        <div class="km-att-buttons">${STATUS.map(([k,l])=>`<button type="button" class="km-att-${k}" data-att-mark="${k}" ${att.selected.size&&!att.busy?'':'disabled'}>${l}</button>`).join('')}</div></div>`;
  }
  function month() {
    const m=att.monthly;
    const rows=m?m.students.map(s=>`<tr><th scope="row">${h(s.name)}</th>${STATUS.map(([k])=>`<td>${s.counts[k]||''}</td>`).join('')}</tr>`).join(''):'';
    return `<div class="km-att-month-row"><label class="km-att-month">기준 월 <input type="month" id="kmAttMonth" value="${h(att.month)}"></label>
      <button type="button" class="km-att-sheet" data-att-sheet>출결 반영 출석부 (Excel)</button></div>
      ${m?(m.students.length?`<div class="km-att-table-wrap"><table class="km-att-table"><thead><tr><th scope="col">학생</th>${STATUS.map(([,l])=>`<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="km-state">이 달 출결 기록이 없습니다.</p>'):'<p class="km-state">불러오는 중...</p>'}`;
  }
  function paint() {
    const content=document.getElementById('kmContent'); if(!content||ctx.route().view!=='attendance')return;
    const focusSearch=document.activeElement?.id==='kmAttSearch';
    const message=document.getElementById('kmAttMessage')?.value||'';
    content.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>출석체크</h2>
      <div class="km-att-tabs" role="group" aria-label="출석체크 보기"><button type="button" data-att-tab="today" aria-pressed="${att.tab==='today'}">오늘 출석</button><button type="button" data-att-tab="month" aria-pressed="${att.tab==='month'}">월별 현황</button></div>
      <p id="kmAttFeedback" class="km-att-feedback" role="status"></p>${att.tab==='today'?today():month()}`;
    const input=document.getElementById('kmAttMessage');if(input&&message)input.value=message;
    if(focusSearch){const box=document.getElementById('kmAttSearch');if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}}
  }
  // 공휴일·휴무 from CORE's calendar (same source as the 출석부): a day off hides 미등원.
  async function loadHoliday(date) {
    const key=`${ctx.state.campusId}|${date}`;
    if(att.holidayKey===key)return;
    att.holidayKey=key;att.holiday='';
    try{
      const {fetchMonthHolidays}=await import(HOLIDAYS_MODULE);
      const [y,m]=date.split('-').map(Number);
      const {holidays}=await fetchMonthHolidays({year:y,month:m,campusId:ctx.state.campusId});
      if(att.holidayKey!==key)return;
      att.holiday=holidays.get(date)||'';
      if(att.holiday)paint();
    }catch{ /* 휴무 확인은 보조 정보라서 실패해도 출석체크는 그대로 쓴다. */ }
  }
  async function loadDay() {
    const v=++att.version;att.date=kstToday();
    const r=await api(`/api/kkumeum/attendance?campusId=${encodeURIComponent(ctx.state.campusId)}`);
    if(v!==att.version)return;
    att.date=r.date;att.schedule=r.schedule||null;
    att.contacts=r.contacts||{};att.teachers=r.teachers||{};att.slotStarts=r.slotStarts||{};att.canManage=Boolean(r.canManage);
    att.rows=new Map(r.students.map(s=>[s.id,s.events]));
    for(const c of att.schedule?.classes||[])for(const e of c.students)if(e.studentId&&!att.rows.has(e.studentId))att.rows.set(e.studentId,e.events||[]);
    paint();
    if(att.schedule)void loadHoliday(att.date);
  }
  async function loadMonth() {
    const v=++att.version;att.monthly=null;paint();
    const r=await api(`/api/kkumeum/attendance/monthly?campusId=${encodeURIComponent(ctx.state.campusId)}&month=${encodeURIComponent(att.month)}`);
    if(v!==att.version)return;att.monthly=r;paint();
  }
  async function mark(status) {
    if(att.busy||!att.selected.size)return;
    if(status==='absent'&&!confirm(`선택한 ${att.selected.size}명을 결석으로 알릴까요?`))return;
    att.busy=true;const message=document.getElementById('kmAttMessage')?.value.trim()||'';
    document.querySelectorAll('[data-att-mark]').forEach(b=>b.disabled=true);
    try{
      const r=await api('/api/kkumeum/attendance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:ctx.state.campusId,status,studentIds:[...att.selected],message})});
      att.selected.clear();att.busy=false;
      const input=document.getElementById('kmAttMessage');if(input)input.value='';
      await loadDay();
      const parents=r.marked.reduce((n,m)=>n+m.guardians,0);
      say(`${r.marked.length}명 ${LABEL[status]} 처리 · ${r.push.sent?`알림 ${r.push.sent}건 보냄`:parents?'알림을 켠 보호자 기기가 아직 없어 기록만 남겼습니다':'연결된 보호자가 없어 기록만 남겼습니다'}`);
    }catch(e){att.busy=false;paint();say(e.message);}
  }
  async function cancel(id) {
    if(att.busy||!confirm('이 출결 기록을 취소할까요? 이미 보낸 알림은 취소되지 않습니다.'))return;
    att.busy=true;
    try{await api(`/api/kkumeum/attendance/${encodeURIComponent(id)}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'});att.busy=false;await loadDay();say('기록을 취소했습니다.');}
    catch(e){att.busy=false;say(e.message);}
  }
  function syncSelection() {
    document.querySelectorAll('[data-att-student]').forEach(b=>{b.checked=att.selected.has(b.dataset.attStudent);b.closest('.km-att-row')?.classList.toggle('km-att-picked',b.checked);});
    const gs=groups();
    document.querySelectorAll('[data-att-class]').forEach(b=>{const ids=[...new Set((gs.find(g=>g.key===b.dataset.attClass)?.rows||[]).map(r=>r.id).filter(Boolean))];const n=ids.filter(id=>att.selected.has(id)).length;b.checked=n>0&&n===ids.length;b.indeterminate=n>0&&n<ids.length;});
    const count=document.getElementById('kmAttCount');if(count)count.textContent=`선택 ${att.selected.size}명`;
    document.querySelectorAll('[data-att-mark]').forEach(b=>b.disabled=!att.selected.size||att.busy);
    const bar=document.querySelector('.km-att-bar');if(bar)bar.hidden=!att.selected.size;
  }
  async function quick(status,ids,label) {
    if(att.busy||!ids.length)return;
    att.busy=true;paint();
    try{
      const r=await api('/api/kkumeum/attendance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campusId:ctx.state.campusId,status,studentIds:ids,auto:status==='arrive'&&ids.length===1})});
      att.busy=false;await loadDay();
      const got=r.marked[0]?.status, word=got==='late'?'지각 등원':LABEL[got]||LABEL[status];
      say(`${label||`${r.marked.length}명`} ${word} 처리 · ${r.push.sent?`보호자 알림 ${r.push.sent}건`:r.marked.some(m=>m.guardians)?'알림을 켠 보호자 기기가 없어 기록만 남김':'연결된 보호자가 없어 기록만 남김'}`);
    }catch(e){att.busy=false;paint();say(e.message);}
  }
  // 출결기 records show up without touching the screen: refresh every 30 s while nothing is being picked or typed.
  setInterval(()=>{
    if(!ctx||ctx.route().view!=='attendance'||att.tab!=='today'||att.busy||att.selected.size||document.visibilityState!=='visible')return;
    if(['kmAttMessage','kmAttSearch'].includes(document.activeElement?.id))return;
    void loadDay().catch(()=>{});
  },30000);
  window.KkumeumAttendance = {
    open(context) {
      if(ctx?.state?.campusId!==context.state.campusId){att.schedule=null;att.mode='';att.onlyWaiting=false;att.holidayKey='';att.holiday='';}
      ctx=context;att.selected.clear();att.month||=kstToday().slice(0,7);
      paint();
      (att.tab==='today'?loadDay():loadMonth()).catch(e=>{const c=document.getElementById('kmContent');if(c&&ctx.route().view==='attendance')c.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><p class="km-state">${h(e.status===403?e.message:'출결 정보를 불러오지 못했습니다. 다시 시도해 주세요.')}</p>`;});
    },
  };
  document.addEventListener('click',e=>{
    if(!ctx||ctx.route().view!=='attendance')return;
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.attTab){att.tab=b.dataset.attTab;att.selected.clear();window.KkumeumAttendance.open(ctx);return;}
    if(b.dataset.attMode){att.mode=b.dataset.attMode;if(att.mode==='all')att.onlyWaiting=false;paint();return;}
    if(b.dataset.attWaiting!==undefined){att.onlyWaiting=!att.onlyWaiting;paint();return;}
    if(b.dataset.attMark){void mark(b.dataset.attMark);return;}
    if(b.dataset.attOne){void quick(b.dataset.attOne,[b.dataset.id],b.dataset.name);return;}
    if(b.dataset.attBulk){const ids=b.dataset.attBulk.split(',').filter(Boolean);if(confirm(`${ids.length}명을 모두 하원 처리하고 보호자에게 알릴까요?`))void quick('leave',ids);return;}
    if(b.dataset.attCancel){void cancel(b.dataset.attCancel);}
    // 출결 반영 출석부: the 출석부 Excel of 기준 월 with each day's 출석체크 result in its date cell.
    if(b.hasAttribute('data-att-sheet')){
      const campusName=ctx.state.campuses?.find(c=>c.id===ctx.state.campusId)?.name||'';b.disabled=true;
      import(SHEET_MODULE).then(m=>m.downloadAttendanceSheet({campusId:ctx.state.campusId,campusName,month:att.month}))
        .then(r=>say(`${r.filename} 를 받았습니다.`),err=>say(err.message)).finally(()=>{b.disabled=false;});
    }
  });
  document.addEventListener('input',e=>{
    if(!ctx||ctx.route().view!=='attendance'||e.target.id!=='kmAttSearch')return;
    if(e.isComposing)return;
    att.q=e.target.value;paint();
  });
  // Korean input: update after each finished syllable, never mid-composition.
  document.addEventListener('compositionend',e=>{if(ctx&&ctx.route().view==='attendance'&&e.target.id==='kmAttSearch'){att.q=e.target.value;paint();}});
  document.addEventListener('change',e=>{
    if(!ctx||ctx.route().view!=='attendance')return;
    const el=e.target;
    if(el.dataset.attStudent!==undefined){if(el.checked)att.selected.add(el.dataset.attStudent);else att.selected.delete(el.dataset.attStudent);syncSelection();}
    else if(el.dataset.attClass!==undefined){const ids=(groups().find(g=>g.key===el.dataset.attClass)?.rows||[]).map(r=>r.id).filter(Boolean);ids.forEach(id=>el.checked?att.selected.add(id):att.selected.delete(id));syncSelection();}
    else if(el.id==='kmAttMonth'&&el.value){att.month=el.value;void loadMonth().catch(err=>say(err.message));}
  });
})();

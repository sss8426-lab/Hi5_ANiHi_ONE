// 꿈이음 출석체크 (staff): pick students, press 등원·하원·결석·지각·조퇴·보강 and their guardians get an alert.
// Mounted by kkumeum-mobile.js when the 출석체크 menu is open; reuses its classes/students for the campus.
(() => {
  const STATUS = [['arrive','등원'],['leave','하원'],['absent','결석'],['late','지각'],['early','조퇴'],['makeup','보강']];
  const LABEL = Object.fromEntries(STATUS);
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const att = { tab:'today', date:'', rows:new Map(), selected:new Set(), month:'', monthly:null, busy:false, version:0 };
  let ctx = null;
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const kstToday = () => new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
  const dayLabel = d => { const [y,m,dd]=d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일 (${'일월화수목금토'[new Date(y,m-1,dd).getDay()]})`; };
  const say = text => { const el=document.getElementById('kmAttFeedback'); if(el) el.textContent=text; };
  const name = s => s.display_name || s.displayName || s.name || '';

  function groups() {
    const list=[...ctx.state.classes].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const students=ctx.state.students.filter(s=>(s.status||'active')==='active');
    if(students.some(s=>!(s.current_class_id||s.currentClassId)))list.push({id:'',name:'반 미지정'});
    return list.map(c=>({cls:c,students:students.filter(s=>(s.current_class_id||s.currentClassId||'')===c.id).sort((a,b)=>name(a).localeCompare(name(b),'ko'))})).filter(g=>g.students.length);
  }
  function chips(studentId) {
    return (att.rows.get(studentId)||[]).map(e=>`<span class="km-att-chip km-att-${h(e.status)}" title="${h(e.message)}">${h(e.label)} ${e.status==='absent'?'':h(e.time)}<button type="button" data-att-cancel="${h(e.id)}" aria-label="${h(e.label)} ${h(e.time)} 기록 취소">×</button></span>`).join('');
  }
  function today() {
    const gs=groups();
    const body=gs.map(({cls,students})=>{
      const arrived=students.filter(s=>(att.rows.get(s.id)||[]).some(e=>['arrive','late','makeup'].includes(e.status))).length;
      const all=students.every(s=>att.selected.has(s.id));
      return `<section class="km-group km-att-group"><div class="km-att-head"><label class="km-check"><input type="checkbox" data-att-class="${h(cls.id)}" ${all?'checked':''} aria-label="${h(cls.name)} 전체 선택"></label><strong>${h(cls.name)}</strong><small>등원 ${arrived} / ${students.length}</small></div>
        ${students.map(s=>`<div class="km-att-row${att.selected.has(s.id)?' km-att-picked':''}"><label><input type="checkbox" data-att-student="${h(s.id)}" ${att.selected.has(s.id)?'checked':''}><span>${h(name(s))}</span></label><span class="km-att-chips">${chips(s.id)}</span></div>`).join('')}</section>`;
    }).join('')||'<p class="km-state">출석체크할 학생이 없습니다. 반과 학생을 먼저 등록해 주세요.</p>';
    return `<p class="km-meta">${h(dayLabel(att.date))} · 학생을 고르고 아래 버튼을 누르면 보호자에게 바로 알림이 갑니다.</p>${body}
      <div class="km-att-bar" role="region" aria-label="출결 처리"><div class="km-att-bar-top"><output id="kmAttCount">선택 ${att.selected.size}명</output><input id="kmAttMessage" maxlength="500" placeholder="알림에 덧붙일 말 (선택)" aria-label="알림에 덧붙일 말"></div>
        <div class="km-att-buttons">${STATUS.map(([k,l])=>`<button type="button" class="km-att-${k}" data-att-mark="${k}" ${att.selected.size&&!att.busy?'':'disabled'}>${l}</button>`).join('')}</div></div>`;
  }
  function month() {
    const m=att.monthly;
    const rows=m?m.students.map(s=>`<tr><th scope="row">${h(s.name)}</th>${STATUS.map(([k])=>`<td>${s.counts[k]||''}</td>`).join('')}</tr>`).join(''):'';
    return `<label class="km-att-month">기준 월 <input type="month" id="kmAttMonth" value="${h(att.month)}"></label>
      ${m?(m.students.length?`<div class="km-att-table-wrap"><table class="km-att-table"><thead><tr><th scope="col">학생</th>${STATUS.map(([,l])=>`<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="km-state">이 달 출결 기록이 없습니다.</p>'):'<p class="km-state">불러오는 중...</p>'}`;
  }
  function paint() {
    const content=document.getElementById('kmContent'); if(!content||ctx.route().view!=='attendance')return;
    content.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>출석체크</h2>
      <div class="km-att-tabs" role="group" aria-label="출석체크 보기"><button type="button" data-att-tab="today" aria-pressed="${att.tab==='today'}">오늘 출석</button><button type="button" data-att-tab="month" aria-pressed="${att.tab==='month'}">월별 현황</button></div>
      <p id="kmAttFeedback" class="km-att-feedback" role="status"></p>${att.tab==='today'?today():month()}`;
  }
  async function loadDay() {
    const v=++att.version;att.date=kstToday();
    const r=await api(`/api/kkumeum/attendance?campusId=${encodeURIComponent(ctx.state.campusId)}`);
    if(v!==att.version)return;
    att.date=r.date;att.rows=new Map(r.students.map(s=>[s.id,s.events]));paint();
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
      att.selected.clear();att.busy=false;await loadDay();
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
    document.querySelectorAll('[data-att-class]').forEach(b=>{const ids=groups().find(g=>g.cls.id===b.dataset.attClass)?.students.map(s=>s.id)||[];const n=ids.filter(id=>att.selected.has(id)).length;b.checked=n>0&&n===ids.length;b.indeterminate=n>0&&n<ids.length;});
    const count=document.getElementById('kmAttCount');if(count)count.textContent=`선택 ${att.selected.size}명`;
    document.querySelectorAll('[data-att-mark]').forEach(b=>b.disabled=!att.selected.size||att.busy);
  }
  window.KkumeumAttendance = {
    open(context) {
      ctx=context;att.selected.clear();att.month||=kstToday().slice(0,7);
      paint();
      (att.tab==='today'?loadDay():loadMonth()).catch(e=>{const c=document.getElementById('kmContent');if(c&&ctx.route().view==='attendance')c.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><p class="km-state">${h(e.status===403?e.message:'출결 정보를 불러오지 못했습니다. 다시 시도해 주세요.')}</p>`;});
    },
  };
  document.addEventListener('click',e=>{
    if(!ctx||ctx.route().view!=='attendance')return;
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.attTab){att.tab=b.dataset.attTab;att.selected.clear();window.KkumeumAttendance.open(ctx);return;}
    if(b.dataset.attMark){void mark(b.dataset.attMark);return;}
    if(b.dataset.attCancel){void cancel(b.dataset.attCancel);}
  });
  document.addEventListener('change',e=>{
    if(!ctx||ctx.route().view!=='attendance')return;
    const el=e.target;
    if(el.dataset.attStudent!==undefined){if(el.checked)att.selected.add(el.dataset.attStudent);else att.selected.delete(el.dataset.attStudent);syncSelection();}
    else if(el.dataset.attClass!==undefined){const ids=groups().find(g=>g.cls.id===el.dataset.attClass)?.students.map(s=>s.id)||[];ids.forEach(id=>el.checked?att.selected.add(id):att.selected.delete(id));syncSelection();}
    else if(el.id==='kmAttMonth'&&el.value){att.month=el.value;void loadMonth().catch(err=>say(err.message));}
  });
})();

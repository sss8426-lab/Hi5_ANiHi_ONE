// 꿈이음 신청/동의서 (교직원): 양식 만들기 · 제출 현황 · 마감 · 미제출 알림.
// Mounted by kkumeum-mobile.js on view=consents|form|form-new. 대상·권한은 서버가 다시 확인합니다
// (캠퍼스 전체는 원장·관리자만, 선생님은 담당 반 학생만).
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { list:null, detail:null, draft:null, busy:false, version:0 };
  let ctx = null;
  const KIND = { application:'신청서', consent:'동의서' };
  const TYPES = [['choice','하나 고르기'],['multi','여러 개 고르기'],['text','직접 쓰기']];
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const json = (method, body) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const campus = () => ctx.state.campusId;
  const content = () => document.getElementById('kmContent');
  const say = text => { const el=document.getElementById('kfFeedback'); if(el){el.textContent=text;el.hidden=!text;} };
  const kstDate = iso => iso ? new Date(iso).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}) : '';
  const md = d => d ? `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}` : '';
  const roles = () => (ctx.state.context?.memberships||[]).filter(m=>m.campusId===campus()).map(m=>m.role);
  const manager = () => Boolean(ctx.state.context?.isSuperAdmin || roles().some(r=>['CAMPUS_ADMIN','CAMPUS_DIRECTOR'].includes(r)));
  const name = s => s.display_name || s.displayName || s.name || '';
  const studentsFor = id => ctx.state.students.filter(s=>(s.current_class_id||s.currentClassId||'')===id);
  const here = () => ctx && ['consents','form','form-new'].includes(ctx.route().view);
  const paint = html => { const c=content(); if(c&&here()) c.innerHTML=html; };

  // ---- 목록 ----
  function listHtml() {
    const d=st.list;
    const head=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>신청/동의서</h2><p class="km-meta">보호자에게 신청서·동의서를 보내고 제출 현황을 봅니다. 보호자는 꿈이음 앱에서 자녀별로 제출해요.</p>`;
    if(!d) return `${head}<p class="km-state">불러오는 중...</p>`;
    const rows=d.forms.map(f=>`<button type="button" class="kt-item" data-kf-open="${h(f.id)}">
      <span class="kt-item-top"><b>${h(f.title)}</b><small>${KIND[f.kind]||'신청서'}</small><em class="kt-status ${f.open?'kt-open':'kt-closed'}">${f.open?'받는 중':'마감'}</em></span>
      <span class="kt-item-title">제출 ${f.submittedCount}/${f.targetCount}명${f.kind==='consent'?` · 동의 ${f.agreeCount}명`:''}${f.deadline?` · 마감 ${h(md(f.deadline))}`:''}</span>
      <span class="kt-item-preview">${h(f.createdByName)} · ${h(new Date(f.createdAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))}</span></button>`).join('');
    return `${head}${d.canWrite?'<button type="button" class="km-primary kf-new" data-kf-new>새 신청/동의서 만들기</button>':''}
      <p id="kfFeedback" class="km-att-feedback" role="status" hidden></p><div class="kt-list">${rows||'<p class="km-state">아직 보낸 신청/동의서가 없습니다.</p>'}</div>`;
  }
  async function loadList() {
    const v=++st.version; st.list=null; st.detail=null; paint(listHtml());
    try{ const list=await api(`/api/kkumeum/forms?campusId=${encodeURIComponent(campus())}`); if(v!==st.version)return; st.list=list; paint(listHtml()); }
    catch(e){ if(v===st.version) paint(`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><p class="km-state">${h(e.message)}</p>`); }
  }

  // ---- 만들기 ----
  function blankDraft() {
    return { kind:'application', title:'', body:'', deadline:'', target:manager()?'campus':'class', classes:new Set(), students:new Set(),
      questions:[{type:'choice',label:'참가 여부',options:'참가\n불참',required:true}], dirty:false };
  }
  function questionHtml(q,i) {
    return `<fieldset class="kf-question" data-kf-q="${i}"><legend>${i+1}번 질문</legend>
      <div class="kf-row"><select data-kf-field="type" aria-label="${i+1}번 질문 종류">${TYPES.map(([v,l])=>`<option value="${v}" ${q.type===v?'selected':''}>${l}</option>`).join('')}</select>
      <label class="kf-inline"><input type="checkbox" data-kf-field="required" ${q.required?'checked':''}> 꼭 답하기</label>
      <button type="button" class="kt-link" data-kf-remove-question="${i}">질문 빼기</button></div>
      <label>질문<input data-kf-field="label" maxlength="200" value="${h(q.label)}" placeholder="예: 겨울 특강에 참가하나요?"></label>
      ${q.type==='text'?'<p class="km-meta">보호자가 직접 글로 답합니다.</p>':`<label>보기 (한 줄에 하나)<textarea data-kf-field="options" rows="3" placeholder="참가&#10;불참">${h(q.options)}</textarea></label>`}</fieldset>`;
  }
  function targetHtml(d) {
    const classes=ctx.state.classes;
    const pickClasses=classes.map(c=>`<label class="kf-inline"><input type="checkbox" data-kf-class="${h(c.id)}" ${d.classes.has(c.id)?'checked':''}> ${h(c.name)} (${studentsFor(c.id).length}명)</label>`).join('')||'<p class="km-meta">반이 없습니다.</p>';
    const pickStudents=classes.map(c=>{const list=studentsFor(c.id);if(!list.length)return '';return `<div class="kf-group"><b>${h(c.name)}</b>${list.map(s=>`<label class="kf-inline"><input type="checkbox" data-kf-student="${h(s.id)}" ${d.students.has(s.id)?'checked':''}> ${h(name(s))}</label>`).join('')}</div>`;}).join('')||'<p class="km-meta">학생이 없습니다.</p>';
    return `<fieldset class="kf-target"><legend>받을 보호자</legend>
      <div class="kf-row">${manager()?`<label class="kf-inline"><input type="radio" name="kfTarget" value="campus" ${d.target==='campus'?'checked':''}> 캠퍼스 전체</label>`:''}
      <label class="kf-inline"><input type="radio" name="kfTarget" value="class" ${d.target==='class'?'checked':''}> 반 고르기</label>
      <label class="kf-inline"><input type="radio" name="kfTarget" value="student" ${d.target==='student'?'checked':''}> 학생 고르기</label></div>
      ${d.target==='class'?`<div class="kf-picks">${pickClasses}</div>`:d.target==='student'?`<div class="kf-picks">${pickStudents}</div>`:'<p class="km-meta">이 캠퍼스 재원생 보호자 모두에게 보냅니다.</p>'}
      ${manager()?'':'<p class="km-meta">선생님은 담당 반 학생에게만 보낼 수 있어요.</p>'}</fieldset>`;
  }
  function newHtml() {
    const d=st.draft;
    return `<button type="button" class="km-back" data-view="consents">신청/동의서 목록</button><h2>새 신청/동의서</h2>
      <form class="km-form kf-form" id="kfForm">
        <fieldset class="kf-kind"><legend>종류</legend><div class="kf-row">
          <label class="kf-inline"><input type="radio" name="kfKind" value="application" ${d.kind==='application'?'checked':''}> 신청서 (질문에 답해요)</label>
          <label class="kf-inline"><input type="radio" name="kfKind" value="consent" ${d.kind==='consent'?'checked':''}> 동의서 (동의 / 동의하지 않음)</label></div></fieldset>
        <label>제목<input id="kfTitle" maxlength="120" required value="${h(d.title)}" placeholder="예: 겨울 특강 신청"></label>
        <label>안내글<textarea id="kfBody" maxlength="4000" rows="5" placeholder="일정, 비용, 준비물 등 보호자가 알아야 할 내용을 적어 주세요.">${h(d.body)}</textarea></label>
        <label>마감일 (선택)<input id="kfDeadline" type="date" value="${h(d.deadline)}"></label>
        <h3 class="kf-sub">질문 ${d.kind==='consent'?'(선택)':''}</h3>
        ${d.questions.map(questionHtml).join('')}
        <button type="button" class="kt-link" data-kf-add-question ${d.questions.length>=15?'disabled':''}>+ 질문 추가</button>
        ${d.kind==='consent'?'<p class="km-meta">동의서는 맨 아래에 "동의합니다 / 동의하지 않음"이 자동으로 붙습니다.</p>':''}
        ${targetHtml(d)}
        <p id="kfFeedback" class="km-att-feedback" role="status" hidden></p>
        <button type="submit" class="km-primary" ${st.busy?'disabled':''}>보호자에게 보내기</button>
        <p class="km-meta">보내면 대상 보호자에게 알림이 갑니다. 보낸 뒤에는 질문을 바꿀 수 없어요.</p></form>`;
  }
  // 화면을 다시 그리기 전에 입력한 내용을 draft에 옮긴다.
  function readDraft() {
    const d=st.draft, form=document.getElementById('kfForm'); if(!d||!form)return;
    d.kind=form.querySelector('[name=kfKind]:checked')?.value||d.kind;
    d.title=document.getElementById('kfTitle').value; d.body=document.getElementById('kfBody').value; d.deadline=document.getElementById('kfDeadline').value;
    d.target=form.querySelector('[name=kfTarget]:checked')?.value||d.target;
    form.querySelectorAll('[data-kf-q]').forEach(box=>{
      const q=d.questions[Number(box.dataset.kfQ)]; if(!q)return;
      q.type=box.querySelector('[data-kf-field=type]').value; q.required=box.querySelector('[data-kf-field=required]').checked;
      q.label=box.querySelector('[data-kf-field=label]').value; const opt=box.querySelector('[data-kf-field=options]'); if(opt)q.options=opt.value;
    });
  }
  function redrawNew() { readDraft(); paint(newHtml()); }
  async function submitNew() {
    readDraft(); const d=st.draft;
    const targets=d.target==='campus'?[{targetType:'campus',targetId:campus()}]:d.target==='class'?[...d.classes].map(id=>({targetType:'class',targetId:id})):[...d.students].map(id=>({targetType:'student',targetId:id}));
    if(!d.title.trim())return say('제목을 입력해 주세요.');
    if(!targets.length)return say('받을 반이나 학생을 골라 주세요.');
    const questions=d.questions.map(q=>({type:q.type,label:q.label,required:q.required,options:q.type==='text'?[]:q.options.split('\n').map(s=>s.trim()).filter(Boolean)}));
    if(!confirm(`보호자에게 ${KIND[d.kind]}를 보낼까요? 보낸 뒤에는 질문을 바꿀 수 없어요.`))return;
    st.busy=true; document.querySelector('#kfForm [type=submit]')?.setAttribute('disabled','');
    try{
      const result=await api('/api/kkumeum/forms',json('POST',{campusId:campus(),kind:d.kind,title:d.title,body:d.body,deadline:d.deadline,questions,targets}));
      st.draft=null; st.busy=false; ctx.go(ctx.route().tab,'form',result.form.id);
    }catch(e){ st.busy=false; say(e.message); document.querySelector('#kfForm [type=submit]')?.removeAttribute('disabled'); }
  }

  // ---- 제출 현황 ----
  const answerText = (q,a) => Array.isArray(a)?a.join(', '):String(a||'');
  function detailHtml() {
    const d=st.detail; if(!d)return '<p class="km-state">불러오는 중...</p>';
    const f=d.form, s=d.summary, consent=f.kind==='consent';
    const chips=`<div class="kf-summary"><span>대상 <b>${s.targetCount}</b>명</span><span>제출 <b>${s.submittedCount}</b>명</span><span>미제출 <b>${s.targetCount-s.submittedCount}</b>명</span>${consent?`<span>동의 <b>${s.agreeCount}</b></span><span>동의하지 않음 <b>${s.disagreeCount}</b></span>`:''}</div>`;
    const tally=d.tally.map(t=>{const total=Math.max(1,t.counts.reduce((n,c)=>n+c.count,0));return `<div class="kf-tally"><b>${h(t.label)}</b>${t.counts.map(c=>`<div class="kf-bar"><span>${h(c.option)}</span><i style="width:${Math.round(c.count/total*100)}%"></i><em>${c.count}</em></div>`).join('')}</div>`;}).join('');
    const head=['반','이름','상태',...(consent?['동의']:[]),...f.questions.map(q=>q.label)];
    const rows=d.rows.map(r=>`<tr class="${r.submitted?'':'kf-waiting'}"><td>${h(r.className)}</td><td>${h(r.studentName)}</td><td>${r.submitted?`제출 ${h(kstDate(r.submittedAt))}`:'미제출'}</td>${consent?`<td>${r.consent==='agree'?'동의':r.consent==='disagree'?'동의하지 않음':''}</td>`:''}${f.questions.map(q=>`<td>${h(answerText(q,r.answers[q.id]))}</td>`).join('')}</tr>`).join('');
    const actions=[
      f.open&&s.targetCount>s.submittedCount?'<button type="button" class="km-primary" data-kf-remind>미제출 보호자에게 다시 알림</button>':'',
      d.canChange?`<button type="button" data-kf-status="${f.open?'closed':'open'}">${f.open?'마감하기':'다시 받기'}</button>`:'',
      d.canChange&&!s.submittedCount?'<button type="button" data-kf-delete>지우기</button>':'',
      d.rows.length?'<button type="button" data-kf-csv>엑셀용 파일(CSV) 받기</button>':'',
    ].join('');
    return `<button type="button" class="km-back" data-view="consents">신청/동의서 목록</button><h2>${h(f.title)}</h2>
      <p class="km-meta">${KIND[f.kind]||'신청서'} · ${h(f.createdByName)}${f.deadline?` · 마감 ${h(md(f.deadline))}`:''} · ${f.open?'받는 중':'마감'}</p>
      ${f.body?`<details class="kt-notice"><summary>안내글 보기</summary><p>${h(f.body)}</p></details>`:''}
      <h3 class="kf-sub">제출 현황</h3>${chips}${tally}<div class="km-actions kf-actions">${actions}</div><p id="kfFeedback" class="km-att-feedback" role="status" hidden></p>
      <div class="kf-table"><table><thead><tr>${head.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${head.length}">대상 학생이 없습니다.</td></tr>`}</tbody></table></div>`;
  }
  async function loadDetail(id) {
    const v=++st.version; st.detail=null; paint(detailHtml());
    try{ const d=await api(`/api/kkumeum/forms/${encodeURIComponent(id)}`); if(v!==st.version)return; st.detail=d; paint(detailHtml()); }
    catch(e){ if(v===st.version) paint(`<button type="button" class="km-back" data-view="consents">신청/동의서 목록</button><p class="km-state">${h(e.message)}</p>`); }
  }
  function downloadCsv() {
    const d=st.detail, f=d.form, consent=f.kind==='consent';
    const cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const lines=[['반','이름','상태','제출한 보호자','제출일',...(consent?['동의']:[]),...f.questions.map(q=>q.label)].map(cell).join(',')];
    for(const r of d.rows)lines.push([r.className,r.studentName,r.submitted?'제출':'미제출',r.guardianName,r.submittedAt?new Date(r.submittedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'',...(consent?[r.consent==='agree'?'동의':r.consent==='disagree'?'동의하지 않음':'']:[]),...f.questions.map(q=>answerText(q,r.answers[q.id]))].map(cell).join(','));
    const url=URL.createObjectURL(new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`${f.title.replace(/[\\/:*?"<>|]/g,'_')}_제출현황.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function act(work, done) {
    if(st.busy)return; st.busy=true;
    try{ await work(); if(done)say(done); }catch(e){ say(e.message); }finally{ st.busy=false; }
  }

  document.addEventListener('click', e => {
    if(!here()||!content()?.contains(e.target))return;
    const b=e.target.closest('button'); if(!b||b.disabled)return;
    const {tab,id}=ctx.route();
    if(b.dataset.kfOpen){ctx.go(tab,'form',b.dataset.kfOpen);return;}
    if(b.hasAttribute('data-kf-new')){st.draft=blankDraft();ctx.go(tab,'form-new');return;}
    if(b.hasAttribute('data-kf-add-question')){readDraft();st.draft.questions.push({type:'choice',label:'',options:'',required:true});st.draft.dirty=true;paint(newHtml());return;}
    if(b.dataset.kfRemoveQuestion){readDraft();st.draft.questions.splice(Number(b.dataset.kfRemoveQuestion),1);paint(newHtml());return;}
    if(b.hasAttribute('data-kf-remind')){void act(async()=>{const r=await api(`/api/kkumeum/forms/${encodeURIComponent(id)}/remind`,json('POST',{}));say(`미제출 학생 ${r.students}명의 보호자 ${r.guardians}명에게 알림을 보냈습니다.${r.push?.sent===0?' (알림을 켠 보호자가 없으면 앱을 열 때 보입니다)':''}`);});return;}
    if(b.dataset.kfStatus){void act(async()=>{st.detail=await api(`/api/kkumeum/forms/${encodeURIComponent(id)}`,json('PATCH',{status:b.dataset.kfStatus}));paint(detailHtml());},b.dataset.kfStatus==='closed'?'마감했습니다. 보호자는 더 제출할 수 없어요.':'다시 받기 시작했습니다.');return;}
    if(b.hasAttribute('data-kf-delete')){if(!confirm('이 양식을 지울까요?'))return;void act(async()=>{await api(`/api/kkumeum/forms/${encodeURIComponent(id)}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'});ctx.go(tab,'consents');});return;}
    if(b.hasAttribute('data-kf-csv')){downloadCsv();return;}
  });
  document.addEventListener('change', e => {
    if(!here()||ctx.route().view!=='form-new'||!st.draft)return;
    const el=e.target;
    if(el.dataset.kfClass){if(el.checked)st.draft.classes.add(el.dataset.kfClass);else st.draft.classes.delete(el.dataset.kfClass);return;}
    if(el.dataset.kfStudent){if(el.checked)st.draft.students.add(el.dataset.kfStudent);else st.draft.students.delete(el.dataset.kfStudent);return;}
    if(el.name==='kfTarget'||el.name==='kfKind'||el.dataset.kfField==='type')redrawNew();
  });
  document.addEventListener('submit', e => {
    if(!here()||e.target.id!=='kfForm')return;
    e.preventDefault(); if(!st.busy)void submitNew();
  });

  window.KkumeumForms = {
    open(next) {
      ctx=next; const {view,id}=ctx.route();
      if(view==='form'){void loadDetail(id);return;}
      if(view==='form-new'){
        const writer=manager()||roles().includes('TEACHER');
        if(!writer){paint('<button type="button" class="km-back" data-view="consents">신청/동의서 목록</button><p class="km-state">신청/동의서는 원장·관리자와 담당 선생님만 만들 수 있습니다.</p>');return;}
        if(!st.draft)st.draft=blankDraft(); paint(newHtml()); return;
      }
      void loadList();
    },
  };
})();

// 꿈이음 수납관리 (원장·관리자) · 개인별 일괄 전송 (원장·관리자·담당 선생님).
// Mounted by kkumeum-mobile.js on view=payments|bulk. 서버가 권한과 금액을 다시 확인합니다.
// 수납관리는 학원에서 받은 돈을 기록하는 장부입니다. 앱에서 결제를 받지 않습니다.
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { tab:'bills', month:'', filter:'all', data:null, daily:null, date:'', settings:null, creating:null, editing:null, busy:false, version:0, bulk:null };
  let ctx = null;
  const METHOD = { card:'카드', transfer:'계좌이체', cash:'현금', other:'기타' };
  const won = n => `${Number(n||0).toLocaleString('ko-KR')}원`;
  const md = d => d ? `${Number(d.slice(5,7))}/${Number(d.slice(8,10))}` : '';
  const kstToday = () => new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const json = (method, body) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const campus = () => ctx.state.campusId;
  const content = () => document.getElementById('kmContent');
  const say = text => { const el=document.getElementById('kpFeedback'); if(el){el.textContent=text;el.hidden=!text;} };
  const name = s => s.display_name || s.displayName || s.name || '';
  const studentsFor = id => ctx.state.students.filter(s=>(s.current_class_id||s.currentClassId||'')===id);
  const groups = () => { const list=ctx.state.classes.map(c=>({id:c.id,name:c.name,students:studentsFor(c.id)})); const loose=ctx.state.students.filter(s=>!(s.current_class_id||s.currentClassId)); if(loose.length)list.push({id:'',name:'반 미지정',students:loose}); return list.filter(g=>g.students.length); };
  const view = () => ctx?.route().view;
  const here = () => ctx && ['payments','bulk'].includes(view());
  const paint = html => { const c=content(); if(c&&here()) c.innerHTML=html; };
  function csv(name, head, rows) {
    const cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const text='﻿'+[head,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  // ======== 수납관리 ========
  function tabs() {
    return `<div class="kt-filter" role="group" aria-label="수납관리 메뉴">${[['bills','청구 현황'],['daily','일일 결산'],['settings','납부 안내 · 자동 알림']].map(([k,l])=>`<button type="button" data-kp-tab="${k}" aria-pressed="${st.tab===k}">${l}</button>`).join('')}</div>`;
  }
  function monthNav() {
    const [y,m]=st.month.split('-').map(Number);
    return `<div class="kp-month"><button type="button" data-kp-month="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button type="button" data-kp-month="1" aria-label="다음 달">›</button></div>`;
  }
  function rowActions(b) {
    if(st.editing?.id===b.id){
      if(st.editing.mode==='pay')return `<div class="kp-edit" data-kp-form="pay"><label>받은 날<input type="date" name="paidAt" value="${h(kstToday())}"></label><label>받은 금액<input name="paidAmount" inputmode="numeric" value="${h(b.amount)}"></label><label>방법<select name="method">${Object.entries(METHOD).map(([k,l])=>`<option value="${k}" ${k==='transfer'?'selected':''}>${l}</option>`).join('')}</select></label><label>메모<input name="memo" maxlength="300" value="${h(b.memo)}"></label><div class="kp-row"><button type="button" class="km-primary" data-kp-save="${h(b.id)}">수납 기록</button><button type="button" data-kp-cancel-edit>닫기</button></div></div>`;
      return `<div class="kp-edit" data-kp-form="edit"><label>금액<input name="amount" inputmode="numeric" value="${h(b.amount)}"></label><label>납부일<input type="date" name="dueDate" value="${h(b.dueDate)}"></label><label>메모<input name="memo" maxlength="300" value="${h(b.memo)}"></label><div class="kp-row"><button type="button" class="km-primary" data-kp-save="${h(b.id)}">고치기</button><button type="button" data-kp-void="${h(b.id)}">청구 취소</button><button type="button" data-kp-cancel-edit>닫기</button></div></div>`;
    }
    if(b.status==='paid')return `<span class="kp-paid">${h(METHOD[b.method]||'')} ${h(md(b.paidAt))}${b.paidAmount!==b.amount?` · ${won(b.paidAmount)}`:''}</span><button type="button" class="kt-link" data-kp-unpay="${h(b.id)}">되돌리기</button>`;
    return `<button type="button" class="km-primary kp-pay" data-kp-pay="${h(b.id)}">수납</button><button type="button" class="kt-link" data-kp-edit="${h(b.id)}">수정</button>`;
  }
  function billsHtml() {
    const d=st.data; if(!d)return '<p class="km-state">불러오는 중...</p>';
    const t=d.totals, today=kstToday();
    const rows=d.bills.filter(b=>st.filter==='all'||(st.filter==='unpaid'?b.status==='unpaid':b.status==='paid'));
    const chips=`<div class="kf-summary"><span>청구 <b>${t.count}</b>건 · ${won(t.billed)}</span><span>수납 <b>${t.paidCount}</b>건 · ${won(t.paid)}</span><span class="kp-warn">미납 <b>${t.unpaidCount}</b>건 · ${won(t.unpaid)}</span>${t.overdueCount?`<span class="kp-warn">납부일 지남 <b>${t.overdueCount}</b>건</span>`:''}</div>`;
    const actions=`<div class="km-actions kf-actions"><button type="button" class="km-primary" data-kp-create>청구 만들기</button>${t.unpaidCount?'<button type="button" data-kp-remind>미납 보호자에게 알림</button>':''}${d.bills.length?'<button type="button" data-kp-csv>엑셀용 파일(CSV) 받기</button>':''}</div>`;
    const filter=`<div class="kt-filter" role="group" aria-label="보기">${[['all','전체'],['unpaid','미납'],['paid','완납']].map(([k,l])=>`<button type="button" data-kp-filter="${k}" aria-pressed="${st.filter===k}">${l}</button>`).join('')}</div>`;
    const list=rows.map(b=>`<article class="kp-bill${b.status==='unpaid'&&b.dueDate<today?' kp-late':''}"><div class="kp-bill-top"><b>${h(b.studentName)}</b><small>${h(b.className)}</small><em class="kt-status ${b.status==='paid'?'kt-answered':'kt-open'}">${b.status==='paid'?'완납':b.dueDate<today?'납부일 지남':'미납'}</em></div>
      <div class="kp-bill-mid"><span>${h(b.title)}</span><b>${won(b.amount)}</b><small>납부일 ${h(md(b.dueDate))}${b.memo?` · ${h(b.memo)}`:''}</small></div><div class="kp-bill-act">${rowActions(b)}</div></article>`).join('');
    return `${monthNav()}${chips}${actions}${filter}<div class="kp-bills">${list||'<p class="km-state">이 달 청구가 없습니다. "청구 만들기"로 시작하세요.</p>'}</div>`;
  }
  function createHtml() {
    const c=st.creating, m=Number(st.month.slice(5,7));
    const list=groups().map(g=>`<div class="kp-group"><label class="kf-inline kp-group-head"><input type="checkbox" data-kp-class="${h(g.id)}" ${g.students.every(s=>c.picked.has(s.id))?'checked':''}> <b>${h(g.name)}</b> (${g.students.length}명)</label>
      ${g.students.map(s=>`<div class="kp-pick"><label class="kf-inline"><input type="checkbox" data-kp-student="${h(s.id)}" ${c.picked.has(s.id)?'checked':''}> ${h(name(s))}</label><input class="kp-amount" data-kp-amount="${h(s.id)}" inputmode="numeric" aria-label="${h(name(s))} 금액" value="${h(c.amounts[s.id]??c.amount)}"><span>원</span></div>`).join('')}</div>`).join('')||'<p class="km-state">학생이 없습니다.</p>';
    return `<button type="button" class="km-back" data-kp-close-create>청구 현황으로</button><h3 class="kf-sub">${st.month.slice(0,4)}년 ${m}월 청구 만들기</h3>
      <form class="km-form kf-form" id="kpCreate"><label>항목 이름<input id="kpTitle" maxlength="80" required value="${h(c.title)}"></label>
      <label>납부일<input id="kpDue" type="date" required value="${h(c.dueDate)}"></label>
      <div class="kp-row"><label>기본 금액<input id="kpAmount" inputmode="numeric" value="${h(c.amount)}"></label><button type="button" data-kp-apply>모든 학생에 넣기</button></div>
      <p class="km-meta">학생을 고르고 금액을 확인하세요. 할인 학생은 금액을 따로 고칠 수 있어요. 같은 달 같은 항목은 한 번만 만들어집니다.</p>
      <div class="kp-picks">${list}</div><p id="kpFeedback" class="km-att-feedback" role="status" hidden></p>
      <button type="submit" class="km-primary" ${st.busy?'disabled':''}>선택한 ${c.picked.size}명 청구 만들기</button></form>`;
  }
  function dailyHtml() {
    const d=st.daily;
    const head=`<div class="kp-row"><label>날짜<input type="date" id="kpDate" value="${h(st.date)}"></label></div>`;
    if(!d)return `${head}<p class="km-state">불러오는 중...</p>`;
    const methods=Object.entries(d.byMethod).filter(([,v])=>v).map(([k,v])=>`<span>${METHOD[k]} ${won(v)}</span>`).join('');
    const rows=d.payments.map(p=>`<tr><td>${h(p.className)}</td><td>${h(p.studentName)}</td><td>${h(p.title)}</td><td>${h(METHOD[p.method]||'')}</td><td class="kp-num">${won(p.paidAmount)}</td></tr>`).join('');
    return `${head}<div class="kf-summary"><span>합계 <b>${won(d.total)}</b> (${d.count}건)</span>${methods}</div>
      ${d.count?'<div class="km-actions kf-actions"><button type="button" data-kp-daily-csv>엑셀용 파일(CSV) 받기</button></div>':''}
      <div class="kf-table"><table><thead><tr><th>반</th><th>이름</th><th>항목</th><th>방법</th><th>금액</th></tr></thead><tbody>${rows||'<tr><td colspan="5">이날 수납 기록이 없습니다.</td></tr>'}</tbody></table></div>`;
  }
  function settingsHtml() {
    const s=st.settings; if(!s)return '<p class="km-state">불러오는 중...</p>';
    return `<form class="km-form kf-form" id="kpSettings"><label>납부 방법 안내 (보호자 앱에 보여요)<textarea id="kpGuide" maxlength="600" rows="4" placeholder="예: OO은행 000-000-000000 (예금주 OO학원), 카드 결제는 학원 데스크에서 가능합니다.">${h(s.guide)}</textarea></label>
      <label class="kf-inline"><input type="checkbox" id="kpAuto" ${s.autoRemind?'checked':''}> 자동 알림 켜기 — 매일 오전 10시, 납부일 하루 전과 납부일 3일 뒤 미납 보호자에게 한 번씩</label>
      <button type="submit" class="km-primary">저장</button></form>`;
  }
  function paymentsHtml() {
    const body=st.creating?createHtml():st.tab==='daily'?dailyHtml():st.tab==='settings'?settingsHtml():billsHtml();
    return `<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>수납관리</h2><p class="km-meta">학원에서 받은 수강료를 기록하고 미납을 알립니다. 보호자 앱에서는 청구와 납부 상태만 보여요.</p>${st.creating?'':tabs()}<p id="kpFeedback" class="km-att-feedback" role="status" hidden></p>${body}`;
  }
  async function loadBills() {
    const v=++st.version; st.data=null; paint(paymentsHtml());
    try{ const d=await api(`/api/kkumeum/bills?campusId=${encodeURIComponent(campus())}&month=${st.month}`); if(v!==st.version)return; st.data=d; st.settings=d.settings; paint(paymentsHtml()); }
    catch(e){ if(v===st.version)paint(`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>수납관리</h2><p class="km-state">${h(e.message)}</p>`); }
  }
  async function loadDaily() {
    const v=++st.version; st.daily=null; paint(paymentsHtml());
    try{ const d=await api(`/api/kkumeum/payments/daily?campusId=${encodeURIComponent(campus())}&date=${st.date}`); if(v!==st.version)return; st.daily=d; paint(paymentsHtml()); }
    catch(e){ if(v===st.version)say(e.message); }
  }
  async function loadSettings() {
    const v=++st.version; st.settings=null; paint(paymentsHtml());
    try{ const d=await api(`/api/kkumeum/payment-settings?campusId=${encodeURIComponent(campus())}`); if(v!==st.version)return; st.settings=d.settings; paint(paymentsHtml()); }
    catch(e){ if(v===st.version)say(e.message); }
  }
  function readCreate() {
    const c=st.creating; if(!c)return;
    const t=document.getElementById('kpTitle'); if(t)c.title=t.value;
    const d=document.getElementById('kpDue'); if(d)c.dueDate=d.value;
    const a=document.getElementById('kpAmount'); if(a)c.amount=a.value;
    document.querySelectorAll('[data-kp-amount]').forEach(el=>{c.amounts[el.dataset.kpAmount]=el.value;});
  }
  async function act(work, done) { if(st.busy)return; st.busy=true; try{ await work(); if(done)say(done); }catch(e){ say(e.message); }finally{ st.busy=false; } }

  // ======== 개인별 일괄 전송 ========
  function bulkHtml() {
    const b=st.bulk, ids=[...b.picked];
    const all=ctx.state.students, byId=new Map(all.map(s=>[s.id,s]));
    const picker=groups().map(g=>`<div class="kp-group"><label class="kf-inline kp-group-head"><input type="checkbox" data-kb-class="${h(g.id)}" ${g.students.every(s=>b.picked.has(s.id))?'checked':''}> <b>${h(g.name)}</b></label>${g.students.map(s=>`<label class="kf-inline"><input type="checkbox" data-kb-student="${h(s.id)}" ${b.picked.has(s.id)?'checked':''}> ${h(name(s))}</label>`).join('')}</div>`).join('');
    const values=ids.map(id=>`<div class="kp-pick"><span>${h(name(byId.get(id)||{name:id}))}</span><input class="kp-amount" data-kb-value="${h(id)}" maxlength="200" aria-label="${h(name(byId.get(id)||{}))} 값" value="${h(b.values[id]||'')}" placeholder="%값%"></div>`).join('');
    const first=ids[0]?byId.get(ids[0]):null;
    const fill=t=>t.replace(/%이름%/g,first?name(first):'').replace(/%값%/g,first?(b.values[ids[0]]||'(값)'):'');
    return `<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>개인별 일괄 전송</h2>
      <p class="km-meta">글에 <b>%이름%</b>, <b>%값%</b>을 넣으면 학생마다 바꿔서 각 보호자에게 따로 보냅니다. 예: 점수, 준비물, 보강 시간.</p>
      <form class="km-form kf-form" id="kbForm"><label>제목<input id="kbTitle" maxlength="160" value="${h(b.title)}" placeholder="예: %이름% 이번 달 실기 점수"></label>
      <label>내용<textarea id="kbBody" maxlength="5900" rows="5" placeholder="예: %이름% 학생의 이번 달 실기 점수는 %값%점입니다.">${h(b.body)}</textarea></label>
      <div class="kp-row"><button type="button" data-kb-insert="%이름%">%이름% 넣기</button><button type="button" data-kb-insert="%값%">%값% 넣기</button></div>
      <fieldset><legend>받을 학생</legend><div class="kp-picks">${picker||'<p class="km-meta">학생이 없습니다.</p>'}</div></fieldset>
      ${ids.length?`<fieldset><legend>학생별 값 (${ids.length}명)</legend><div class="kp-values">${values}</div></fieldset>`:''}
      ${first?`<div class="kb-preview"><b>미리 보기 · ${h(name(first))}</b><p><b>${h(fill(b.title))}</b></p><p>${h(fill(b.body))}</p></div>`:''}
      <p id="kpFeedback" class="km-att-feedback" role="status" hidden></p>
      <button type="submit" class="km-primary" ${st.busy||!ids.length?'disabled':''}>${ids.length}명에게 보내기</button></form>`;
  }
  function readBulk() {
    const b=st.bulk; if(!b)return;
    const t=document.getElementById('kbTitle'); if(t)b.title=t.value;
    const body=document.getElementById('kbBody'); if(body)b.body=body.value;
    document.querySelectorAll('[data-kb-value]').forEach(el=>{b.values[el.dataset.kbValue]=el.value;});
  }

  // ======== events ========
  document.addEventListener('click', e => {
    if(!here()||!content()?.contains(e.target))return;
    const b=e.target.closest('button'); if(!b||b.disabled)return;
    if(view()==='bulk'){
      if(b.dataset.kbInsert){readBulk();const ta=document.getElementById('kbBody');const pos=ta?.selectionStart??st.bulk.body.length;st.bulk.body=st.bulk.body.slice(0,pos)+b.dataset.kbInsert+st.bulk.body.slice(pos);paint(bulkHtml());}
      return;
    }
    if(b.dataset.kpTab){st.tab=b.dataset.kpTab;st.creating=null;st.editing=null;if(st.tab==='daily'){st.date=st.date||kstToday();void loadDaily();}else if(st.tab==='settings')void loadSettings();else void loadBills();return;}
    if(b.dataset.kpMonth){const [y,m]=st.month.split('-').map(Number);st.month=new Date(Date.UTC(y,m-1+Number(b.dataset.kpMonth),1)).toISOString().slice(0,7);st.editing=null;void loadBills();return;}
    if(b.dataset.kpFilter){st.filter=b.dataset.kpFilter;paint(paymentsHtml());return;}
    if(b.hasAttribute('data-kp-create')){const m=Number(st.month.slice(5,7));const tenth=`${st.month}-10`;st.creating={title:`${m}월 수강료`,dueDate:tenth<kstToday()?kstToday():tenth,amount:'',amounts:{},picked:new Set()};paint(paymentsHtml());return;}
    if(b.hasAttribute('data-kp-close-create')){st.creating=null;paint(paymentsHtml());return;}
    if(b.hasAttribute('data-kp-apply')){readCreate();const c=st.creating;ctx.state.students.forEach(s=>{c.amounts[s.id]=c.amount;});paint(paymentsHtml());return;}
    if(b.dataset.kpPay){st.editing={id:b.dataset.kpPay,mode:'pay'};paint(paymentsHtml());return;}
    if(b.dataset.kpEdit){st.editing={id:b.dataset.kpEdit,mode:'edit'};paint(paymentsHtml());return;}
    if(b.hasAttribute('data-kp-cancel-edit')){st.editing=null;paint(paymentsHtml());return;}
    if(b.dataset.kpSave){
      const box=b.closest('[data-kp-form]'),f=n=>box.querySelector(`[name=${n}]`)?.value;
      const body=box.dataset.kpForm==='pay'?{action:'pay',paidAt:f('paidAt'),paidAmount:f('paidAmount'),method:f('method'),memo:f('memo')}:{action:'edit',amount:f('amount'),dueDate:f('dueDate'),memo:f('memo')};
      void act(async()=>{await api(`/api/kkumeum/bills/${encodeURIComponent(b.dataset.kpSave)}`,json('PATCH',body));st.editing=null;await loadBills();},body.action==='pay'?'수납을 기록했습니다.':'고쳤습니다.');return;
    }
    if(b.dataset.kpUnpay){if(!confirm('수납 기록을 되돌릴까요? 미납으로 바뀝니다.'))return;void act(async()=>{await api(`/api/kkumeum/bills/${encodeURIComponent(b.dataset.kpUnpay)}`,json('PATCH',{action:'unpay'}));await loadBills();},'미납으로 되돌렸습니다.');return;}
    if(b.dataset.kpVoid){if(!confirm('이 청구를 취소할까요? 보호자 앱에서도 사라집니다.'))return;void act(async()=>{await api(`/api/kkumeum/bills/${encodeURIComponent(b.dataset.kpVoid)}`,json('PATCH',{action:'cancel'}));st.editing=null;await loadBills();},'청구를 취소했습니다.');return;}
    if(b.hasAttribute('data-kp-remind')){if(!confirm('이 달 미납 보호자에게 납부 알림을 보낼까요?'))return;void act(async()=>{const r=await api('/api/kkumeum/bills/remind',json('POST',{campusId:campus(),month:st.month}));say(r.bills?`미납 ${r.bills}건, 보호자 ${r.guardians}명에게 알림을 보냈습니다.`:'오늘 이미 알림을 보낸 청구뿐이라 새로 보낸 알림이 없습니다.');});return;}
    if(b.hasAttribute('data-kp-csv')){csv(`${st.month}_청구현황.csv`,['반','이름','항목','청구 금액','납부일','상태','받은 날','받은 금액','방법','메모'],st.data.bills.map(x=>[x.className,x.studentName,x.title,x.amount,x.dueDate,x.status==='paid'?'완납':'미납',x.paidAt||'',x.paidAmount??'',METHOD[x.method]||'',x.memo]));return;}
    if(b.hasAttribute('data-kp-daily-csv')){csv(`${st.date}_일일결산.csv`,['반','이름','항목','방법','받은 금액'],st.daily.payments.map(x=>[x.className,x.studentName,x.title,METHOD[x.method]||'',x.paidAmount]));return;}
  });
  document.addEventListener('change', e => {
    if(!here())return;
    const el=e.target;
    if(view()==='bulk'&&st.bulk){
      if(el.dataset.kbClass!==undefined){readBulk();const list=groups().find(g=>g.id===el.dataset.kbClass)?.students||[];list.forEach(s=>el.checked?st.bulk.picked.add(s.id):st.bulk.picked.delete(s.id));paint(bulkHtml());return;}
      if(el.dataset.kbStudent){readBulk();if(el.checked)st.bulk.picked.add(el.dataset.kbStudent);else st.bulk.picked.delete(el.dataset.kbStudent);paint(bulkHtml());return;}
      return;
    }
    if(el.id==='kpDate'){st.date=el.value||kstToday();void loadDaily();return;}
    if(st.creating&&el.dataset.kpClass!==undefined){readCreate();const list=groups().find(g=>g.id===el.dataset.kpClass)?.students||[];list.forEach(s=>el.checked?st.creating.picked.add(s.id):st.creating.picked.delete(s.id));paint(paymentsHtml());return;}
    if(st.creating&&el.dataset.kpStudent){readCreate();if(el.checked)st.creating.picked.add(el.dataset.kpStudent);else st.creating.picked.delete(el.dataset.kpStudent);paint(paymentsHtml());}
  });
  document.addEventListener('input', e => {
    if(view()!=='bulk'||!st.bulk||!['kbTitle','kbBody'].includes(e.target.id)&&!e.target.dataset.kbValue)return;
    readBulk(); const prev=document.querySelector('.kb-preview'); if(!prev)return;
    const ids=[...st.bulk.picked],first=ctx.state.students.find(s=>s.id===ids[0]); if(!first)return;
    const fill=t=>t.replace(/%이름%/g,name(first)).replace(/%값%/g,st.bulk.values[ids[0]]||'(값)');
    prev.innerHTML=`<b>미리 보기 · ${h(name(first))}</b><p><b>${h(fill(st.bulk.title))}</b></p><p>${h(fill(st.bulk.body))}</p>`;
  });
  document.addEventListener('submit', e => {
    if(!here())return;
    if(e.target.id==='kpCreate'){
      e.preventDefault(); readCreate(); const c=st.creating;
      if(!c.picked.size)return say('청구할 학생을 골라 주세요.');
      const items=[...c.picked].map(id=>({studentId:id,amount:c.amounts[id]??c.amount}));
      if(items.some(i=>!String(i.amount).trim()))return say('고른 학생의 금액을 모두 입력해 주세요.');
      void act(async()=>{const r=await api('/api/kkumeum/bills',json('POST',{campusId:campus(),month:st.month,title:c.title,dueDate:c.dueDate,items}));st.creating=null;st.data=r;paint(paymentsHtml());say(`${r.created}건을 만들었습니다.${r.skipped?` 이미 있는 ${r.skipped}건은 건너뛰었어요.`:''}`);});
      return;
    }
    if(e.target.id==='kpSettings'){
      e.preventDefault();
      const settings={guide:document.getElementById('kpGuide').value,autoRemind:document.getElementById('kpAuto').checked};
      void act(async()=>{st.settings=(await api('/api/kkumeum/payment-settings',json('PUT',{campusId:campus(),settings}))).settings;},'저장했습니다.');
      return;
    }
    if(e.target.id==='kbForm'){
      e.preventDefault(); readBulk(); const b=st.bulk, ids=[...b.picked];
      if(!b.title.trim()||!b.body.trim())return say('제목과 내용을 입력해 주세요.');
      if(/%값%/.test(b.title+b.body)&&ids.some(id=>!String(b.values[id]||'').trim()))return say('%값%을 쓴 글은 학생마다 값을 모두 입력해 주세요.');
      if(!confirm(`${ids.length}명의 보호자에게 각각 보낼까요?`))return;
      void act(async()=>{const r=await api('/api/kkumeum/bulk-messages',json('POST',{campusId:campus(),title:b.title,body:b.body,rows:ids.map(id=>({studentId:id,value:b.values[id]||''}))}));st.bulk={title:'',body:'',values:{},picked:new Set()};paint(bulkHtml());say(`${r.count}명에게 보냈습니다. 아이소식에서 확인할 수 있어요.`);});
    }
  });

  window.KkumeumPayments = {
    open(next) {
      const changed=ctx?.state?.campusId!==next.state.campusId; ctx=next;
      if(view()==='bulk'){
        if(!st.bulk||changed)st.bulk={title:'',body:'',values:{},picked:new Set(ctx.state.selected||[])};
        paint(bulkHtml()); return;
      }
      st.month=st.month||kstToday().slice(0,7); st.creating=null; st.editing=null;
      if(st.tab==='daily'){st.date=st.date||kstToday();void loadDaily();}else if(st.tab==='settings')void loadSettings();else void loadBills();
    },
  };
})();

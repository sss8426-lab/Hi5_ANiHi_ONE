// 꿈이음 답변모음 · 문의모음 (교직원): 보호자가 소식에 남긴 답변과 1:1 문의를 모아 보고 답장합니다.
// Mounted by kkumeum-mobile.js on view=answers|inquiries|thread|talk-settings. Every rule is checked again on the server.
(() => {
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { filter:'open', list:null, thread:null, snippets:null, settings:null, files:[], busy:false, version:0, counts:{answers:0,inquiries:0}, countsAt:0 };
  let ctx = null;
  const KIND = { answers:'reply', inquiries:'inquiry' };
  const VIEW = { reply:'answers', inquiry:'inquiries' };
  const STATUS = { open:'답변 필요', answered:'답변 완료', closed:'처리 완료' };
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error||'처리하지 못했습니다. 다시 시도해 주세요.'),{status:res.status});
    return data;
  }
  const json = (method, body) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const campus = () => ctx.state.campusId;
  const q = () => `campusId=${encodeURIComponent(campus())}`;
  const content = () => document.getElementById('kmContent');
  const say = text => { const el=document.getElementById('ktFeedback'); if(el){el.textContent=text;el.hidden=!text;} };
  const when = iso => { if(!iso)return ''; const d=new Date(iso), now=new Date(); const same=d.toDateString()===now.toDateString();
    return same?d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); };
  const here = () => ctx && ['answers','inquiries','thread','talk-settings'].includes(ctx.route().view);

  // ---- 답변모음 · 문의모음 badges ----
  function paintBadges() {
    for (const key of ['answers','inquiries']) {
      const b=document.querySelector(`#kmBottom [data-menu="${key}"]`); if(!b)continue;
      let badge=b.querySelector('.kt-badge'); const n=st.counts[key]||0;
      if(!n){badge?.remove();continue;}
      if(!badge){badge=document.createElement('em');badge.className='kt-badge';b.append(badge);}
      badge.textContent=n>99?'99+':String(n);badge.setAttribute('aria-label',`새 글 ${n}개`);
    }
  }
  async function refreshCounts(force=false) {
    if(!ctx?.state?.campusId)return paintBadges();
    if(!force&&st.countsCampus===campus()&&Date.now()-st.countsAt<30000)return paintBadges();
    st.countsAt=Date.now();st.countsCampus=campus();
    try{ st.counts=await api(`/api/kkumeum/threads/summary?${q()}`); }catch{ /* 배지는 보조 정보 */ }
    paintBadges();
  }

  // ---- list ----
  function listHtml(view) {
    const kind=KIND[view], title=view==='answers'?'답변모음':'문의모음';
    const intro=view==='answers'?'보호자가 소식에 남긴 답변입니다. 다른 보호자에게는 보이지 않습니다.':'보호자가 보낸 1:1 문의입니다.';
    const tabs=`<div class="kt-filter" role="group" aria-label="보기"><button type="button" data-kt-filter="open" aria-pressed="${st.filter==='open'}">답변 필요</button><button type="button" data-kt-filter="all" aria-pressed="${st.filter==='all'}">전체</button></div>`;
    const hours=view==='inquiries'&&st.settings?`<p class="kt-hours">문의 운영시간 · ${h(st.settings.label)}${st.settings.settings.enabled?'':' (자동 안내 꺼짐)'} ${st.settings.canManage?'<button type="button" class="kt-link" data-view="talk-settings">설정</button>':''}</p>`:'';
    const list=st.list;
    const rows=!list?'<p class="km-state">불러오는 중...</p>':!list.threads.length?`<p class="km-state">${st.filter==='open'?'답변이 필요한 글이 없습니다.':'아직 받은 글이 없습니다.'}</p>`
      :list.threads.map(t=>`<button type="button" class="kt-item${t.unread?' kt-unread':''}" data-kt-open="${h(t.id)}">
        <span class="kt-item-top"><b>${h(t.studentName)}</b><small>${h(t.guardianName)}</small><em class="kt-status kt-${h(t.status)}">${h(STATUS[t.status]||t.status)}</em></span>
        <span class="kt-item-title">${kind==='reply'?'소식 · ':''}${h(t.title)}</span><span class="kt-item-preview">${h(t.lastPreview)}</span><time>${h(when(t.lastMessageAt))}</time></button>`).join('');
    return `<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>${title}</h2><p class="km-meta">${intro}</p>${hours}${tabs}
      <p id="ktFeedback" class="km-att-feedback" role="status" hidden></p><div class="kt-list">${rows}</div>`;
  }
  async function loadList(view) {
    const v=++st.version; st.list=null; paint();
    try{
      const [list,settings]=await Promise.all([api(`/api/kkumeum/threads?${q()}&kind=${KIND[view]}&filter=${st.filter}`),view==='inquiries'?api(`/api/kkumeum/talk-settings?${q()}`).catch(()=>null):null]);
      if(v!==st.version)return; st.list=list; st.settings=settings; paint(); void refreshCounts(true);
    }catch(e){ if(v===st.version){const c=content();if(c)c.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><p class="km-state">${h(e.message)}</p>`;} }
  }

  // ---- thread ----
  function bubble(m) {
    const files=(m.files||[]).map(f=>`<a href="/api/kkumeum/talk-files/${encodeURIComponent(f.id)}" target="_blank" rel="noopener"><img src="/api/kkumeum/talk-files/${encodeURIComponent(f.id)}" alt="첨부 사진" loading="lazy"></a>`).join('');
    const who=m.author==='staff'?'kt-me':m.author==='auto'?'kt-auto':'kt-them';
    return `<div class="kt-msg ${who}"><small>${h(m.authorName)} · ${h(when(m.createdAt))}</small>${m.body?`<p>${h(m.body)}</p>`:''}${files?`<div class="kt-files">${files}</div>`:''}</div>`;
  }
  function threadHtml() {
    const d=st.thread; if(!d)return '<p class="km-state">불러오는 중...</p>';
    const t=d.thread, back=VIEW[t.kind];
    const snippets=st.snippets?.snippets||[];
    const picker=`<select id="ktSnippet" aria-label="자주 쓰는 글 넣기"><option value="">자주 쓰는 글 넣기</option>${snippets.map(s=>`<option value="${h(s.id)}">${h(s.title)}</option>`).join('')}</select>`;
    const notice=d.notice?`<details class="kt-notice"><summary>원래 소식 · ${h(d.notice.title)}</summary><p>${h(d.notice.body)}</p></details>`:'';
    const chips=st.files.map((f,i)=>`<span class="kt-chip">${h(f.name)}<button type="button" data-kt-unfile="${i}" aria-label="${h(f.name)} 빼기">×</button></span>`).join('');
    return `<button type="button" class="km-back" data-view="${back}">${back==='answers'?'답변모음':'문의모음'}으로 돌아가기</button>
      <h2>${h(t.studentName)} <small class="kt-sub">${h(t.guardianName)}</small></h2>
      <p class="km-meta">${t.kind==='reply'?'소식 답변':'1:1 문의'} · ${h(t.title)} · <em class="kt-status kt-${h(t.status)}">${h(STATUS[t.status]||t.status)}</em></p>${notice}
      <div class="kt-thread" id="ktThread">${d.messages.map(bubble).join('')}</div>
      <p id="ktFeedback" class="km-att-feedback" role="status" hidden></p>
      <form class="kt-compose" id="ktCompose">
        <div class="kt-compose-tools">${picker}<button type="button" data-kt-save-snippet>이 글 자주 쓰는 글로 저장</button></div>
        <textarea id="ktBody" maxlength="2000" rows="4" placeholder="보호자에게 보낼 답장을 입력하세요" aria-label="답장 내용"></textarea>
        <div class="kt-compose-row"><label class="kt-photo">사진 첨부<input type="file" id="ktFiles" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>${chips}</div>
        <div class="kt-compose-row"><button type="submit" class="km-primary" ${st.busy?'disabled':''}>답장 보내기</button>
          ${t.status==='closed'?'<button type="button" data-kt-status="open">다시 열기</button>':'<button type="button" data-kt-status="closed">답장 없이 처리 완료</button>'}</div>
      </form>`;
  }
  async function loadThread(id) {
    const v=++st.version; st.thread=null; st.files=[]; paint();
    try{
      const [thread,snippets]=await Promise.all([api(`/api/kkumeum/threads/${encodeURIComponent(id)}`),st.snippets?Promise.resolve(st.snippets):api(`/api/kkumeum/snippets?${q()}`).catch(()=>({snippets:[]}))]);
      if(v!==st.version)return; st.thread=thread; st.snippets=snippets; paint(); void refreshCounts(true);
    }catch(e){ if(v===st.version){const c=content();if(c)c.innerHTML=`<button type="button" class="km-back" data-back>소식으로 돌아가기</button><p class="km-state">${h(e.message)}</p>`;} }
  }

  // ---- 운영시간 · 자동 안내 · 자주 쓰는 글 ----
  function settingsHtml() {
    const s=st.settings; if(!s||!st.snippets)return '<p class="km-state">불러오는 중...</p>';
    const v=s.settings, row=(key,label)=>`<div class="kt-day"><b>${label}</b><input type="time" data-kt-hours="${key}:start" value="${h(v[key].start)}" aria-label="${label} 시작"> ~ <input type="time" data-kt-hours="${key}:end" value="${h(v[key].end)}" aria-label="${label} 끝"></div>`;
    const list=st.snippets.snippets.map(x=>`<li><span><b>${h(x.title)}</b><small>${h(x.body)}</small></span>${x.canDelete?`<button type="button" data-kt-del-snippet="${h(x.id)}">삭제</button>`:''}</li>`).join('');
    return `<button type="button" class="km-back" data-view="inquiries">문의모음으로 돌아가기</button><h2>문의 운영시간 · 자주 쓰는 글</h2>
      <p id="ktFeedback" class="km-att-feedback" role="status" hidden></p>
      <section class="ka-panel"><h3>문의 운영시간<small>비워 두면 그날은 휴무</small></h3>
        <label class="kt-switch"><input type="checkbox" id="ktEnabled" ${v.enabled?'checked':''} ${s.canManage?'':'disabled'}> 운영시간 밖에 온 문의에 자동 안내 보내기</label>
        ${row('weekday','평일')}${row('saturday','토요일')}${row('sunday','일요일')}
        <label class="kt-auto">자동 안내 문구<textarea id="ktAutoReply" maxlength="500" rows="3" ${s.canManage?'':'disabled'}>${h(v.autoReply)}</textarea></label>
        <small class="ka-hint">보호자 문의 화면에도 운영시간이 보입니다. 지금은 ${s.openNow?'운영시간입니다':'운영시간이 아닙니다'}.</small>
        ${s.canManage?'<div class="ka-row"><button type="button" class="ka-primary" data-kt-save-hours>저장</button></div>':'<p class="ka-hint">운영시간은 원장·관리자만 바꿀 수 있습니다.</p>'}</section>
      <section class="ka-panel"><h3>자주 쓰는 글<small>답장 쓸 때 골라서 넣을 수 있습니다 · 캠퍼스 선생님이 함께 씁니다</small></h3>
        <ul class="kt-snippets">${list||'<li class="km-state">아직 저장한 글이 없습니다.</li>'}</ul>
        <form class="kt-snippet-form" id="ktSnippetForm"><input id="ktSnippetTitle" maxlength="40" placeholder="제목 (예: 보강 안내)" aria-label="자주 쓰는 글 제목"><textarea id="ktSnippetBody" maxlength="2000" rows="3" placeholder="내용" aria-label="자주 쓰는 글 내용" required></textarea><button type="submit" class="ka-primary">추가</button></form></section>`;
  }
  async function loadSettings() {
    const v=++st.version; st.settings=null; st.snippets=null; paint();
    try{ const [settings,snippets]=await Promise.all([api(`/api/kkumeum/talk-settings?${q()}`),api(`/api/kkumeum/snippets?${q()}`)]); if(v!==st.version)return; st.settings=settings; st.snippets=snippets; paint(); }
    catch(e){ if(v===st.version){const c=content();if(c)c.innerHTML=`<p class="km-state">${h(e.message)}</p>`;} }
  }

  function paint() {
    const c=content(); if(!c||!here())return;
    const {view}=ctx.route();
    const draft=document.getElementById('ktBody')?.value;
    c.innerHTML=view==='thread'?threadHtml():view==='talk-settings'?settingsHtml():listHtml(view);
    if(draft&&document.getElementById('ktBody'))document.getElementById('ktBody').value=draft;
    const box=document.getElementById('ktThread'); if(box)box.scrollTop=box.scrollHeight;
    paintBadges();
  }
  async function run(work, done) {
    if(st.busy)return; st.busy=true;
    try{ const r=await work(); if(done)say(typeof done==='function'?done(r):done); }
    catch(e){ say(e.message); }
    finally{ st.busy=false; }
  }

  window.KkumeumTalk = {
    open(context) {
      ctx=context; const {view,id}=ctx.route();
      if(view==='thread')void loadThread(id); else if(view==='talk-settings')void loadSettings(); else void loadList(view);
    },
    refresh(context) { if(context)ctx=context; return refreshCounts(); },
    paintBadges,
  };

  document.addEventListener('click',e=>{
    if(!here())return;
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const {view}=ctx.route();
    if(b.dataset.ktFilter){ st.filter=b.dataset.ktFilter; void loadList(view); }
    if(b.dataset.ktOpen){ ctx.go(ctx.route().tab,'thread',b.dataset.ktOpen); }
    if(b.dataset.ktUnfile){ st.files.splice(Number(b.dataset.ktUnfile),1); paint(); }
    if(b.dataset.ktStatus){ const t=st.thread.thread;
      void run(async()=>{ st.thread=await api(`/api/kkumeum/threads/${encodeURIComponent(t.id)}`,json('PATCH',{status:b.dataset.ktStatus})); paint(); }, b.dataset.ktStatus==='closed'?'처리 완료로 바꿨습니다.':'다시 답변 필요로 바꿨습니다.'); }
    if(b.hasAttribute('data-kt-save-snippet')){ const body=document.getElementById('ktBody').value.trim(); if(!body)return say('저장할 글을 먼저 입력해 주세요.');
      const title=prompt('자주 쓰는 글 제목',body.replace(/\s+/g,' ').slice(0,20)); if(title===null)return;
      void run(async()=>{ st.snippets=await api('/api/kkumeum/snippets',json('POST',{campusId:campus(),title,body})); paint(); },'자주 쓰는 글로 저장했습니다.'); }
    if(b.dataset.ktDelSnippet){ if(!confirm('이 글을 지울까요?'))return;
      void run(async()=>{ st.snippets=await api(`/api/kkumeum/snippets/${encodeURIComponent(b.dataset.ktDelSnippet)}`,json('DELETE',{})); paint(); },'지웠습니다.'); }
    if(b.hasAttribute('data-kt-save-hours')){
      const settings={enabled:document.getElementById('ktEnabled').checked,autoReply:document.getElementById('ktAutoReply').value,weekday:{},saturday:{},sunday:{}};
      document.querySelectorAll('[data-kt-hours]').forEach(i=>{const [d,k]=i.dataset.ktHours.split(':');settings[d][k]=i.value;});
      void run(async()=>{ st.settings=await api('/api/kkumeum/talk-settings',json('PUT',{campusId:campus(),settings})); paint(); },'운영시간을 저장했습니다.'); }
  });
  document.addEventListener('change',e=>{
    if(!here())return;
    if(e.target.id==='ktSnippet'&&e.target.value){ const s=st.snippets.snippets.find(x=>x.id===e.target.value); const box=document.getElementById('ktBody');
      if(s&&box){box.value=box.value?`${box.value}\n${s.body}`:s.body;box.focus();} e.target.value=''; }
    if(e.target.id==='ktFiles'){ const picked=[...e.target.files]; const room=3-st.files.length;
      if(picked.length>room)say('사진은 한 번에 3장까지 보낼 수 있습니다.');
      st.files.push(...picked.slice(0,Math.max(0,room)).filter(f=>f.size<=8*1024*1024)); if(picked.some(f=>f.size>8*1024*1024))say('8MB가 넘는 사진은 뺐습니다.'); paint(); }
  });
  document.addEventListener('submit',e=>{
    if(!here())return;
    if(e.target.id==='ktCompose'){ e.preventDefault(); const t=st.thread?.thread; const body=document.getElementById('ktBody').value.trim();
      if(!t||(!body&&!st.files.length))return say('답장 내용을 입력하거나 사진을 골라 주세요.');
      const form=new FormData(); form.append('body',body); st.files.forEach(f=>form.append('files',f));
      void run(async()=>{ const r=await api(`/api/kkumeum/threads/${encodeURIComponent(t.id)}/messages`,{method:'POST',body:form}); st.thread=r; st.files=[]; document.getElementById('ktBody').value=''; paint(); return r; },
        r=>r.push?.sent?'답장을 보냈습니다. 보호자 휴대폰에 알림이 갔습니다.':'답장을 보냈습니다. 보호자가 꿈이음 앱을 열면 볼 수 있습니다.'); }
    if(e.target.id==='ktSnippetForm'){ e.preventDefault(); const title=document.getElementById('ktSnippetTitle').value, body=document.getElementById('ktSnippetBody').value;
      void run(async()=>{ st.snippets=await api('/api/kkumeum/snippets',json('POST',{campusId:campus(),title,body})); paint(); },'자주 쓰는 글을 추가했습니다.'); }
  });
  // New answers and 문의 show up on the badges while the app is open.
  setInterval(()=>{ if(ctx&&document.visibilityState==='visible')void refreshCounts(); },60000);
})();

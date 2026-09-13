(() => {
  const $ = id => document.getElementById(id);
  if (!$('kkMobileApp')) return;
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="km-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name==='CalendarDays'?'BookOpen':name}"/></svg>`;
  const tabs = ['kids-news','class-news','notices','select-delivery'];
  const labels = ['아이소식','반소식','전체공지','선택전달'];
  const state = { context:null, campusId:'', campuses:[], classes:[], students:[], notices:[], selected:new Set(), expanded:new Set(), q:'', sort:'name', loading:true, error:'', version:0, composer:null, busy:false };
  const content = $('kmContent');
  const name = item => item.display_name || item.displayName || item.name || '';
  const date = value => value ? new Date(value).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}) : '';
  const roles = () => (state.context?.memberships || []).filter(m=>m.campusId===state.campusId).map(m=>m.role);
  const manager = () => Boolean(state.context?.isSuperAdmin || roles().some(r=>['CAMPUS_ADMIN','CAMPUS_DIRECTOR'].includes(r)));
  const writer = () => manager() || roles().includes('TEACHER');
  const campusWriter = () => Boolean(state.capabilities?.canPublishCampus || manager());
  const route = () => { const p = new URLSearchParams(location.search); return { tab:tabs.includes(p.get('tab'))?p.get('tab'):'kids-news', view:p.get('view')||'', id:p.get('item')||'' }; };
  async function api(path, options={}) {
    const res = await fetch(path,{credentials:'include',cache:'no-store',...options});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw Object.assign(new Error(data.error || '데이터를 불러오지 못했습니다. 다시 시도해주세요.'),{status:res.status});
    return data;
  }
  const json = (method,body) => ({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const empty = text => `<p class="km-state">${h(text)}</p>`;
  const feedback = text => { const el=$('kmFeedback'); if(el)el.textContent=text; };
  function go(tab=route().tab, view='', id='', replace=false) {
    if(state.busy) return;
    if(state.composer?.dirty && !window.confirm('저장하지 않은 내용을 닫을까요?')) return;
    state.composer=null;
    const url=new URL(location.href); url.searchParams.set('tab',tab); url.searchParams.delete('view');url.searchParams.delete('item');url.hash='';
    if(view)url.searchParams.set('view',view);if(id)url.searchParams.set('item',id);
    history[replace?'replaceState':'pushState'](null,'',url); render(); window.scrollTo(0,0);
  }
  function renderNav() {
    const {tab,view}=route();
    document.querySelectorAll('[data-km-tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(b.dataset.kmTab===tab));b.tabIndex=b.dataset.kmTab===tab?0:-1;b.setAttribute('aria-label',labels[i]);});
    content.setAttribute('aria-labelledby',`kmTab-${tab}`);
    const menus=[['attendance','ShieldCheck','출석체크'],['news','BookOpen','아이소식 글모음'],['answers','BookOpen','답변모음'],['inquiries','PenLine','문의모음'],['more','Menu','더보기']];
    $('kmBottom').innerHTML=menus.map(([key,img,label])=>`<button type="button" data-menu="${key}" ${key==='more'?'aria-haspopup="dialog" aria-controls="kmMore" aria-expanded="false"':''} ${view===key || (!view&&key==='news')?'aria-current="page"':''}>${icon(img)}<span>${label}</span></button>`).join('');
  }
  function search() { return `<label class="km-search">${icon('Search')}<input id="kmSearch" aria-label="반·학생·제목 검색" placeholder="반·학생·제목 검색" value="${h(state.q)}"></label>`; }
  const studentsFor = id => state.students.filter(s=>(s.current_class_id || s.currentClassId || '')===id);
  function noticesFor(cls) {
    const ids = new Set(studentsFor(cls.id).map(s=>s.id));
    return state.notices.filter(n=>(n.targets||[]).some(t=>t.targetType==='class'&&t.targetId===cls.id || t.targetType==='student'&&ids.has(t.targetId)));
  }
  function noticeRows(rows) {
    const typeLabels={'child-message':'아이소식','class-news':'반소식','campus-news':'공지사항','organization-notice':'공지사항','selected-delivery':'선택전달'};
    return rows.map(n=>`<button type="button" class="km-notice" data-notice="${h(n.id)}"><span class="km-thumb">${icon('BookOpen')}</span><span class="km-notice-copy"><strong>${h(n.title)}</strong><small>${typeLabels[n.announcementType]||'소식'}${Number.isFinite(n.readCount)?` · 읽은 보호자 ${n.readCount}`:''}<br>${h(date(n.publishedAt||n.createdAt))}</small>${n.status==='draft'?'<span class="km-badge">전송대기</span>':''}</span><i class="km-chevron" aria-hidden="true"></i></button>`).join('');
  }
  function renderGroups() {
    const {tab}=route(); const selective=tab==='select-delivery';
    const query=state.q.toLocaleLowerCase();
    let groups=[...state.classes];
    if(state.students.some(s=>!(s.current_class_id||s.currentClassId)))groups.push({id:'',name:'반 미지정'});
    groups=groups.filter(c=>[c.name,...studentsFor(c.id).map(name),...noticesFor(c).map(n=>n.title)].some(v=>String(v).toLocaleLowerCase().includes(query)));
    groups.sort(state.sort==='name'?(a,b)=>a.name.localeCompare(b.name,'ko'):(a,b)=>String(b.updated_at||b.updatedAt||'').localeCompare(String(a.updated_at||a.updatedAt||'')));
    $('kmGroups').innerHTML=groups.length?groups.map(c=>{
      const students=studentsFor(c.id);const open=state.expanded.has(c.id);const all=students.length>0&&students.every(s=>state.selected.has(s.id));
      const expandedId=`kmGroup-${encodeURIComponent(c.id)||'unassigned'}`;
      let inner='';
      if(selective)inner=students.map(s=>`<div class="km-student"><span>${h(name(s))}</span><label class="km-check"><input type="checkbox" data-student-check="${h(s.id)}" aria-label="${h(name(s))} 선택" ${state.selected.has(s.id)?'checked':''}></label></div>`).join('')||empty('전달 대상이 없습니다.');
      else if(tab==='class-news')inner=noticeRows(noticesFor(c).filter(n=>n.announcementType==='class-news'))||empty('등록된 반소식이 없습니다.');
      else inner=students.map(s=>`<div class="km-student"><button type="button" data-student="${h(s.id)}"><strong>${h(name(s))}</strong><small>작품 · 월간 평가</small></button>${writer()?`<button type="button" data-child-write="${h(s.id)}" aria-label="${h(name(s))} 아이소식 쓰기">${icon('PenLine')}</button>`:''}</div>`).join('')+(noticeRows(noticesFor(c).filter(n=>['child-message','selected-delivery'].includes(n.announcementType)))||empty('등록된 아이소식이 없습니다.'));
      return `<section class="km-group"><div class="km-group-head"><button type="button" data-expand="${h(c.id)}" aria-expanded="${open}" aria-controls="${expandedId}">${tab==='kids-news'?icon('Folder'):''}<strong>${h(c.name)}</strong><i class="km-chevron" aria-hidden="true"></i></button>${selective&&writer()?`<label class="km-check"><input type="checkbox" data-class-check="${h(c.id)}" aria-label="${h(c.name)} 전체 선택" ${all?'checked':''} ${students.length?'':'disabled'}></label>`:''}</div><div class="km-group-body" id="${expandedId}" ${open?'':'hidden'}>${tab==='class-news'&&writer()&&c.id?`<div class="km-actions"><button type="button" data-class-write="${h(c.id)}">${icon('PenLine')}글쓰기</button></div>`:''}${inner}</div></section>`;
    }).join(''):empty(state.q?'검색 결과가 없습니다.':'등록된 반이 없습니다.');
    document.querySelectorAll('[data-class-check]').forEach(el=>{const list=studentsFor(el.dataset.classCheck);const n=list.filter(s=>state.selected.has(s.id)).length;el.indeterminate=n>0&&n<list.length;});
    const count=$('kmSelected');if(count)count.textContent=`선택 ${state.selected.size}명`;
    ['kmWriteSelected','kmScheduleSelected'].forEach(id=>{if($(id))$(id).disabled=!state.selected.size;});
  }
  function rootView() {
    const {tab}=route();
    if(tab==='notices') {
      content.innerHTML=`<div class="km-actions">${campusWriter()?`<button type="button" data-write-notice>${icon('PenLine')}글쓰기</button>`:''}</div>${search()}<div id="kmNotices"></div>`;
      const draw=()=>{$('kmNotices').innerHTML=noticeRows(state.notices.filter(n=>['campus-news','organization-notice'].includes(n.announcementType)&&n.title.toLocaleLowerCase().includes(state.q.toLocaleLowerCase())))||empty('등록된 공지가 없습니다.');};
      $('kmSearch').oninput=e=>{state.q=e.target.value;draw();};draw();return;
    }
    const selective=tab==='select-delivery';
    content.innerHTML=`${selective?`<div class="km-actions"><output id="kmSelected">선택 ${state.selected.size}명</output>${writer()?`<button id="kmScheduleSelected" type="button" data-schedule>${icon('CalendarDays')}일정등록</button><button id="kmWriteSelected" type="button" data-write-selected>${icon('PenLine')}글쓰기</button>`:''}</div>`:search()}<div id="kmGroups"></div>${tab==='kids-news'?`<button type="button" class="km-sort" id="kmSort" title="정렬 기준 변경">${state.sort==='name'?'이름순':'최신순'}</button>`:''}`;
    if(selective&&!writer()){content.innerHTML=empty('선택전달 작성 권한이 없습니다.');return;}
    if($('kmSearch'))$('kmSearch').oninput=e=>{state.q=e.target.value;renderGroups();};
    if($('kmSort'))$('kmSort').onclick=()=>{state.sort=state.sort==='name'?'latest':'name';$('kmSort').textContent=state.sort==='name'?'이름순':'최신순';renderGroups();};
    renderGroups();
  }
  async function showLegacy(view,id) {
    const app=window.KkumeumStaff;
    if(!app){content.innerHTML=empty('기존 운영 화면을 불러오는 중입니다. 잠시 후 다시 선택해주세요.');return;}
    const campusId=state.campusId;
    content.innerHTML=empty('불러오는 중...');
    app.state.campusId=campusId;app.state.classId='';app.state.q='';
    await app.loadClassesAndStudents();
    if(state.campusId!==campusId||route().view!==view||route().id!==id)return;
    const main=document.querySelector('.kk-main');$('kmLegacyMount').append(main);
    main.querySelectorAll(':scope > *').forEach(n=>n.classList.remove('km-tool-active'));
    const sections=view==='student'?['kkStudentDetail','kkReportsSection','kkArtworkSection',...(manager()?['kkGuardiansSection']:[])]:view==='analytics'?['kkAnalyticsSection']:['kkToolbar','kkStudentsSection'];
    sections.forEach(key=>$(key)?.classList.add('km-tool-active'));
    content.hidden=true;$('kmLegacy').hidden=false;
    if(view==='student'){
      ['kkStudentDetail','kkReportOperations','kkArtworkOperations','kkGuardianOperations'].forEach(key=>{if($(key))$(key).textContent='불러오는 중...';});
      window.dispatchEvent(new CustomEvent('kkumeum:select-student',{detail:{studentId:id}}));
    }
  }
  async function detail(id) {
    const version=state.version;
    content.innerHTML=empty('불러오는 중...');
    try {
      const {announcement:n}=await api(`/api/kkumeum/announcements/${encodeURIComponent(id)}`);
      if(route().id!==id||route().view!=='notice'||version!==state.version)return;
      content.innerHTML=`<button type="button" class="km-back" data-back>${icon('ArrowLeft')}목록</button><article class="km-detail"><h2>${h(n.title)}</h2><p class="km-meta">${h(date(n.publishedAt||n.createdAt))} · 읽은 보호자 ${n.readCount}명${n.status==='draft'?' · 전송대기':''}</p><div class="km-detail-body">${h(n.body)}</div>${n.canEdit?'<div class="km-actions"><button type="button" id="kmEdit">수정</button><button type="button" id="kmArchive">임시저장 삭제</button><button type="button" id="kmPublish" class="km-primary">보호자에게 발행</button></div>':''}<p id="kmFeedback" role="status"></p></article>`;
      if($('kmEdit'))$('kmEdit').onclick=()=>compose(n.announcementType,n.targets,n);
      if($('kmArchive'))$('kmArchive').onclick=()=>mutateNotice(n,'archive');
      if($('kmPublish'))$('kmPublish').onclick=()=>mutateNotice(n,'publish');
    }catch{if(route().id===id)content.innerHTML=empty('데이터를 불러오지 못했습니다. 다시 시도해주세요.')+'<button type="button" data-back>목록으로</button><button type="button" data-retry>다시 시도</button>';}
  }
  async function mutateNotice(n,action) {
    if(state.busy||!confirm(action==='publish'?'선택한 대상의 보호자에게 이 소식을 발행할까요?':'이 임시저장을 목록에서 숨길까요? 원본 기록은 보존됩니다.'))return;
    state.busy=true;document.querySelectorAll('.km-actions button').forEach(b=>b.disabled=true);
    try{await api(`/api/kkumeum/announcements/${encodeURIComponent(n.id)}${action==='publish'?'/publish':''}`,{method:action==='publish'?'POST':'DELETE'});state.busy=false;await load();go();}
    catch{feedback('처리하지 못했습니다. 상태를 새로 확인한 뒤 다시 시도해주세요.');}
    finally{state.busy=false;document.querySelectorAll('.km-actions button').forEach(b=>b.disabled=false);}
  }
  function compose(type,targets,existing=null,schedule=false) {
    if(type==='campus-news' ? !campusWriter() : !writer())return;
    if(targets.length>200){content.innerHTML=empty('한 번에 최대 200명의 전달 대상을 선택해주세요.');return;}
    state.composer={type,targets,id:existing?.id,campusId:existing?.campusId??state.campusId,dirty:false};
    content.hidden=false;$('kmLegacy').hidden=true;
    content.innerHTML=`<button type="button" class="km-back" data-back>${icon('ArrowLeft')}목록</button><form class="km-form" id="kmComposer"><h2>${schedule?'일정 안내 작성':'소식 쓰기'}</h2><p class="km-meta">${type==='organization-notice'?'전체 조직':type==='campus-news'?'현재 캠퍼스':`선택 대상 ${targets.length}개`}</p>${type==='campus-news'&&state.context?.isSuperAdmin&&!existing?'<label>전달 범위<select id="kmWriteScope"><option value="campus">현재 캠퍼스</option><option value="organization">전체 조직</option></select></label>':''}${schedule?'<label>일정 날짜<input type="date" id="kmScheduleDate" required></label><p class="km-meta">선택한 대상에게 일정 안내 소식으로 전달합니다. 자동 예약발송은 지원하지 않습니다.</p>':''}<label>제목<input name="title" maxlength="160" required value="${h(existing?.title||'')}"></label><label>내용<textarea name="body" maxlength="5900" required>${h(existing?.body||'')}</textarea></label><button type="submit" class="km-primary">임시저장</button><p class="km-feedback" id="kmFeedback" role="status"></p></form>`;
    const form=$('kmComposer');form.oninput=()=>{state.composer.dirty=true;};
    form.onsubmit=async e=>{
      e.preventDefault();if(state.busy)return;
      const c=state.composer;const data=new FormData(form);const global=$('kmWriteScope')?.value==='organization'||c.type==='organization-notice';
      const body={title:data.get('title'),body:(schedule?`일정: ${$('kmScheduleDate').value}\n\n`:'')+data.get('body'),announcementType:global?'organization-notice':c.type,targets:global?[{targetType:'organization'}]:c.targets,...(!global?{campusId:c.campusId}:{})};
      state.busy=true;form.querySelector('button[type=submit]').disabled=true;
      try{const result=await api(c.id?`/api/kkumeum/announcements/${encodeURIComponent(c.id)}`:'/api/kkumeum/announcements',json(c.id?'PATCH':'POST',body));c.dirty=false;state.composer=null;state.busy=false;await load();go(route().tab,'notice',result.announcement.id);}
      catch{feedback('저장하지 못했습니다. 입력 내용은 유지됩니다. 권한과 연결 상태를 확인해주세요.');}
      finally{state.busy=false;form.querySelector('button[type=submit]').disabled=false;}
    };
  }
  async function calendar() {
    content.innerHTML='<button type="button" class="km-back" data-back>소식으로 돌아가기</button><h2>일정관리</h2><div id="kmCalendarList">불러오는 중...</div>';
    const now=new Date();const from=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;const to=`${now.getFullYear()+1}-12-31`;
    try{const result=await api(`/api/data-core/calendar?from=${from}&to=${to}`);if(!$('kmCalendarList'))return;$('kmCalendarList').innerHTML=(result.events||[]).map(e=>`<article class="km-group"><h3>${h(e.title)}</h3><p class="km-meta">${h(e.metadata?.startDate)} · ${h(e.campusName||'공통 일정')}</p></article>`).join('')||empty('등록된 일정이 없습니다.');}
    catch{if($('kmCalendarList'))$('kmCalendarList').innerHTML=empty('일정을 불러오지 못했습니다.');}
    if(writer()&&route().view==='calendar')content.insertAdjacentHTML('beforeend','<button type="button" class="km-primary" id="kmCalendarAdd">캠퍼스 공통 일정등록</button>');
    if($('kmCalendarAdd'))$('kmCalendarAdd').onclick=()=>{
      content.innerHTML='<button type="button" data-back class="km-back">목록</button><form class="km-form" id="kmCalendarForm"><h2>캠퍼스 공통 일정</h2><p class="km-meta">학생·보호자 이름이나 개인 정보는 입력하지 마세요.</p><label>일정명<input name="title" maxlength="240" required></label><label>날짜<input name="date" type="date" required></label><button type="submit" class="km-primary">일정 저장</button><p id="kmFeedback" role="status"></p></form>';
      $('kmCalendarForm').onsubmit=async e=>{e.preventDefault();if(state.busy)return;state.busy=true;const f=e.currentTarget;f.querySelector('[type=submit]').disabled=true;const d=new FormData(f);try{await api('/api/data-core/calendar',json('POST',{title:d.get('title'),campusId:state.campusId,visibility:'campus',metadata:{schemaVersion:1,startDate:d.get('date'),allDay:true,eventType:'class'}}));await calendar();}catch{feedback('일정을 저장하지 못했습니다.');}finally{state.busy=false;f.querySelector('[type=submit]').disabled=false;}};
    };
  }
  function auxiliary(view) {
    const titles={attendance:'출석체크',answers:'답변모음',inquiries:'문의모음',help:'도움말',suggest:'비트에게 건의/문의',consents:'신청/동의서',payments:'수납관리',teachers:'선생님 관리',settings:'설정'};
    const title=titles[view]||'더보기';
    let body=empty(`${title}은 아직 연결된 운영 기능이 없습니다.`);
    if(view==='help')body='<p class="km-detail-body">아이소식에서 반과 학생을 선택하면 작품과 월간 평가를 볼 수 있습니다. 소식은 임시저장 후 내용을 확인하고 발행하세요. 보호자는 기존 꿈이음 보호자 로그인에서 연결된 자녀의 기록만 확인합니다.</p>';
    if(view==='settings')body=`<p class="km-detail-body">${h(state.campuses.find(c=>c.id===state.campusId)?.name||'')}<br>${manager()?'관리자':'교직원'}</p><button type="button" class="km-tool-link" data-view="analytics">${icon('BookOpen')}성장 통계</button><button type="button" class="km-tool-link" data-view="members">${icon('Users')}학생 · 보호자 연결</button>`;
    content.innerHTML=`<button type="button" class="km-back" data-back>${icon('ArrowLeft')}소식으로 돌아가기</button><h2>${h(title)}</h2>${body}`;
  }
  function render() {
    renderNav();content.hidden=false;$('kmLegacy').hidden=true;
    if(state.loading){content.innerHTML=empty('불러오는 중...');return;}
    if(state.error){content.innerHTML=empty(state.error)+'<button type="button" class="km-primary" data-retry>다시 시도</button>';return;}
    const {view,id}=route();
    if(['members','student','analytics'].includes(view)){if(view!=='student'&&!manager()){content.innerHTML=empty('관리 권한이 없습니다.');return;}void showLegacy(view,id);return;}
    if(view==='notice'){void detail(id);return;}
    if(view==='calendar'){void calendar();return;}
    if(view){auxiliary(view);return;}
    rootView();
  }
  function openMore() {
    const menus=[['settings','Settings','설정',manager()],['help','BookOpen','도움말',true],['suggest','PenLine','비트에게 건의/문의',true],['consents','ShieldCheck','신청/동의서',true],['payments','BookOpen','수납관리',manager()],['members','Users','회원등록',manager()],['members','Folder','반관리',manager()],['teachers','Users','선생님 관리',manager()],['calendar','CalendarDays','일정관리',writer()]];
    $('kmMoreItems').innerHTML=menus.filter(m=>m[3]).map(([view,img,title])=>`<button type="button" data-view="${view}">${icon(img)}<span>${title}</span></button>`).join('');
    $('kmMore').showModal();document.querySelector('[data-menu=more]')?.setAttribute('aria-expanded','true');
  }
  async function load() {
    const version=++state.version;state.loading=true;state.error='';state.capabilities=null;state.selected.clear();window.dispatchEvent(new Event('kkumeum:scope-changing'));render();
    try{
      if(!state.context){state.context=await api('/api/data-core/context');if(!state.context.authenticated)throw new Error('로그인이 필요합니다.');const campuses=await api('/api/data-core/campuses');state.campuses=campuses.campuses||[];state.campusId=state.campuses[0]?.id||'';}
      const health=await api('/api/kkumeum/health');if(!health.status?.ok)throw new Error('꿈이음 연결을 확인해주세요.');
      $('kmCampus').innerHTML=state.campuses.map(c=>`<option value="${h(c.id)}" ${c.id===state.campusId?'selected':''}>${h(c.name)}</option>`).join('');$('kmCampus').disabled=state.campuses.length<2;
      if(!state.campusId){state.classes=[];state.students=[];state.notices=[];return;}
      const q=`campusId=${encodeURIComponent(state.campusId)}`;
      const capabilities=await api(`/api/kkumeum/announcement-capabilities?${q}`);
      if(version!==state.version)return;
      state.capabilities=capabilities;
      const [classes,students,notices]=await Promise.all([writer()?api(`/api/kkumeum/classes?${q}`):{classes:[]},writer()?api(`/api/kkumeum/students?${q}`):{students:[]},api(`/api/kkumeum/announcements?${q}`)]);
      if(version!==state.version)return;
      state.classes=classes.classes||[];state.students=students.students||[];state.notices=(notices.announcements||[]).filter(n=>!n.campusId||n.campusId===state.campusId);
      const old=window.KkumeumStaff;if(old){old.state.campusId=state.campusId;old.state.classes=state.classes;old.state.students=state.students;}
    }catch(error){if(version===state.version){state.error=error.status===401?'로그인이 필요합니다.':'데이터를 불러오지 못했습니다. 다시 시도해주세요.';state.classes=[];state.students=[];state.notices=[];}}
    finally{if(version===state.version){state.loading=false;render();}}
  }
  $('kmCampus').onchange=async e=>{if(state.busy){e.target.value=state.campusId;return;}if(state.composer?.dirty&&!confirm('저장하지 않은 내용을 닫을까요?')){e.target.value=state.campusId;return;}state.composer=null;state.campusId=e.target.value;state.expanded.clear();go(route().tab,'','',true);await load();};
  $('kmRefresh').onclick=()=>{if(state.busy)return;if(state.composer?.dirty&&!confirm('작성 내용을 닫고 새로고침할까요?'))return;state.composer=null;void load();};
  $('kmLegacyBack').onclick=async()=>{go();await load();};
  $('kmMoreClose').onclick=()=>$('kmMore').close();
  $('kmMore').addEventListener('close',()=>document.querySelector('[data-menu=more]')?.setAttribute('aria-expanded','false'));
  $('kmMore').addEventListener('click',e=>{if(e.target===$('kmMore')){const r=e.target.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)e.target.close();}});
  $('kkMobileApp').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.kmTab){go(b.dataset.kmTab);return;}
    if(b.hasAttribute('data-back')){go();return;}
    if(b.hasAttribute('data-retry')){void load();return;}
    if(b.dataset.menu==='more'){openMore();return;}
    if(b.dataset.menu){go('kids-news',b.dataset.menu==='news'?'':b.dataset.menu);return;}
    if(b.dataset.view){$('kmMore').close();go(route().tab,b.dataset.view);return;}
    if(b.hasAttribute('data-expand')){const id=b.dataset.expand;if(state.expanded.has(id))state.expanded.delete(id);else state.expanded.add(id);renderGroups();return;}
    if(b.dataset.notice){go(route().tab,'notice',b.dataset.notice);return;}
    if(b.dataset.student){go('kids-news','student',b.dataset.student);return;}
    if(b.dataset.classWrite){compose('class-news',[{targetType:'class',targetId:b.dataset.classWrite}]);return;}
    if(b.dataset.childWrite){compose('child-message',[{targetType:'student',targetId:b.dataset.childWrite}]);return;}
    if(b.hasAttribute('data-write-notice')){compose('campus-news',[{targetType:'campus',targetId:state.campusId}]);return;}
    if(b.hasAttribute('data-write-selected')||b.hasAttribute('data-schedule')){if(!state.selected.size)return;compose('selected-delivery',[...state.selected].map(id=>({targetType:'student',targetId:id})),null,b.hasAttribute('data-schedule'));}
  });
  $('kkMobileApp').addEventListener('change',e=>{
    const el=e.target;
    if(el.hasAttribute('data-class-check'))studentsFor(el.dataset.classCheck).forEach(s=>el.checked?state.selected.add(s.id):state.selected.delete(s.id));
    else if(el.hasAttribute('data-student-check')){if(el.checked)state.selected.add(el.dataset.studentCheck);else state.selected.delete(el.dataset.studentCheck);}
    else return;
    renderGroups();
  });
  document.querySelector('.km-tabs').addEventListener('keydown',e=>{const i=tabs.indexOf(route().tab);if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;go(tabs[next]);$(`kmTab-${tabs[next]}`).focus();});
  window.addEventListener('popstate',()=>{state.composer=null;render();});
  window.addEventListener('beforeunload',e=>{if(state.composer?.dirty||state.busy){e.preventDefault();e.returnValue='';}});
  const hashes={kkStudentsSection:'members',kkReportsSection:'members',kkArtworkSection:'members',kkGuardiansSection:'members',kkAnalyticsSection:'analytics',kkAnnouncements:''};
  function legacyHash(){const key=location.hash.slice(1);if(Object.hasOwn(hashes,key))go(key==='kkAnnouncements'?'notices':'kids-news',hashes[key],'',true);}
  window.addEventListener('hashchange',legacyHash);
  window.addEventListener('kkumeum:ready',()=>{if(['members','student','analytics'].includes(route().view))render();});
  window.addEventListener('kkumeum:select-student',e=>{if(route().view==='members')go('kids-news','student',e.detail.studentId);});
  legacyHash();void load();
})();

(() => {
  let state, $, h, api, canWrite, isSuperAdmin, orderedCampuses, campusDisplayName, toast;
  const ui = { view:'month', q:'', scope:'', type:'', loading:false, error:'', upcoming:[], upcomingError:'', upcomingLoading:false,
    external:[], detailKey:null, detailEpoch:0, detailAbort:null, returnTo:null, editSnapshot:'', editOrigin:null, summary:'today', timer:null, identity:'' };
  const labels = {class:'수업',admission:'입시',competition:'공모전',marketing:'홍보',holiday:'휴일',meeting:'회의',other:'기타'};
  const dayMs = 86400000;
  const dateKey = date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const addDays = (key,n) => new Date(Date.parse(key+'T00:00:00Z')+n*dayMs).toISOString().slice(0,10);
  const monthKey = () => `${state.calendarMonth.getFullYear()}-${String(state.calendarMonth.getMonth()+1).padStart(2,'0')}`;
  function range(grid=false) {
    const from=monthKey()+'-01', d=new Date(Date.parse(from+'T00:00:00Z'));
    const to=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);
    return grid ? {from:addDays(from,-d.getUTCDay()),to:addDays(to,6-new Date(to+'T00:00:00Z').getUTCDay())} : {from,to};
  }
  const key = event => `${event.external?'competition':'academy'}:${event.id}`;
  const overlaps = (event,from,to=from) => event.metadata.startDate<=to && (event.metadata.endDate||event.metadata.startDate)>=from;
  const allEvents = () => [...state.calendarEvents,...ui.external];
  const lookup = id => [...allEvents(),...ui.upcoming].find(event=>key(event)===id);
  function matches(event) {
    const m=event.metadata;
    return (!ui.type||m.eventType===ui.type) && (!ui.scope || (ui.scope==='organization'?event.visibility==='organization':event.campusId===ui.scope))
      && (!ui.q||`${event.title}\n${event.summary||''}`.toLocaleLowerCase().includes(ui.q.toLocaleLowerCase()));
  }
  const filtered = () => allEvents().filter(matches).sort((a,b)=>a.metadata.startDate.localeCompare(b.metadata.startDate)||key(a).localeCompare(key(b)));
  const manage = event => !event.external && event.canManage === true && canWrite();
  function dateLabel(value) {
    return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(value+'T00:00:00Z'));
  }
  const period = event => dateLabel(event.metadata.startDate)+(event.metadata.endDate?' ~ '+dateLabel(event.metadata.endDate):'');
  const timeLabel = event => event.metadata.allDay===true?'종일':event.metadata.startTime?`${event.metadata.startTime}${event.metadata.endTime?' ~ '+event.metadata.endTime:''} (한국 시간)`:'시간 미지정';
  function badge(event) {
    const days=event.external?Math.round((Date.parse(event.metadata.startDate)-Date.parse(dateKey(new Date())))/dayMs):null;
    return `<span class="calendar-type ${h(event.metadata.eventType||'other')}">${h(labels[event.metadata.eventType]||'기타')}</span>${days!==null?` <span>공모전 마감 ${days===0?'D-day':days>0?'D-'+days:'종료'}</span>`:''}`;
  }
  function rows(events) {
    return events.map(event=>`<button type="button" class="calendar-event-row calendar-open" data-calendar-event="${h(key(event))}"><strong>${h(event.title)}</strong><span>${badge(event)} ${h(event.campusName||'조직 공통')}</span><small>${h(period(event))} · ${h(timeLabel(event))}</small>${event.summary?`<span class="calendar-excerpt">${h(event.summary)}</span>`:''}</button>`).join('');
  }
  function permittedCampuses() {
    const ids=new Set((state.context?.memberships||[]).map(m=>m.campusId).filter(Boolean));
    return orderedCampuses().filter(campus=>isSuperAdmin()||ids.has(campus.id));
  }
  function configure(deps) {
    ({state,$,h,api,canWrite,isSuperAdmin,orderedCampuses,campusDisplayName,toast}=deps);
    const today=dateKey(new Date()); const [year,month]=today.split('-').map(Number);state.calendarMonth=new Date(year,month-1,1);
    document.querySelectorAll('[data-calendar-home]').forEach(home=>{
      const tools=document.createElement('div');tools.className='calendar-tools';
      tools.innerHTML=`<div class="calendar-modes" role="group" aria-label="일정 보기"><button type="button" data-calendar-mode="month" aria-pressed="true">월간</button><button type="button" data-calendar-mode="list" aria-pressed="false">목록</button></div>
        <label class="calendar-search"><span>선택한 월 검색</span><input type="search" data-calendar-search maxlength="120" placeholder="일정 제목·메모"></label>
        <label><span>범위</span><select data-calendar-scope aria-label="일정 범위"></select></label>
        <label><span>유형</span><select data-calendar-type aria-label="일정 유형"><option value="">전체 유형</option>${Object.entries(labels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
        <label><span>연월 이동</span><input type="month" data-calendar-jump aria-label="연월 이동"></label>`;
      home.querySelector('[data-calendar-month]').before(tools);
      const status=document.createElement('div');status.className='calendar-status';status.dataset.calendarStatus='';status.setAttribute('role','status');tools.after(status);
      const agenda=document.createElement('div');agenda.dataset.calendarAgenda='';home.querySelector('[data-calendar-list]').before(agenda);
      const summary=document.createElement('section');summary.className='calendar-summary';summary.innerHTML='<div class="calendar-summary-head"><h4>가까운 일정 · 한국 오늘 기준</h4><select data-calendar-summary aria-label="가까운 일정 기간"><option value="today">오늘</option><option value="next">앞으로 7일</option></select></div><div data-calendar-upcoming></div>';home.append(summary);
      home.addEventListener('click',event=>{
        const target=event.target.closest('button');
        if(target?.dataset.calendarEvent) {openDetail(target.dataset.calendarEvent,target);return;}
        if(target?.dataset.calendarMore){openDay(target.dataset.calendarMore,target);return;}
        if(target?.dataset.calendarMode){ui.view=target.dataset.calendarMode;render();return;}
        if(target?.hasAttribute('data-calendar-retry')){void load();return;}
        const day=event.target.closest('[data-calendar-cell]');
        if(day){state.calendarSelectedDate=day.dataset.calendarCell;render();home.querySelector(`[data-calendar-date="${state.calendarSelectedDate}"]`)?.focus({preventScroll:true});}
      });
      const search=home.querySelector('[data-calendar-search]');let composing=false;
      const change=()=>{if(composing)return;ui.q=search.value.trim();syncTools(search);clearTimeout(ui.timer);ui.timer=setTimeout(()=>load(),180);};
      search.addEventListener('compositionstart',()=>{composing=true;clearTimeout(ui.timer);});
      search.addEventListener('compositionend',()=>{composing=false;change();});search.addEventListener('input',change);
      home.querySelector('[data-calendar-scope]').onchange=event=>{ui.scope=event.target.value;syncTools();void load();};
      home.querySelector('[data-calendar-type]').onchange=event=>{ui.type=event.target.value;syncTools();void load();};
      home.querySelector('[data-calendar-jump]').onchange=event=>{if(!/^\d{4}-\d{2}$/.test(event.target.value))return;const [y,m]=event.target.value.split('-').map(Number);if(y<100||y>9998)return;state.calendarMonth=new Date(y,m-1,1);state.calendarSelectedDate=range().from;void load();};
      home.querySelector('[data-calendar-summary]').onchange=event=>{ui.summary=event.target.value;renderSummary();};
    });
    const dialog=document.createElement('dialog');dialog.id='calendarDetail';dialog.className='calendar-reader';dialog.setAttribute('aria-labelledby','calendarDetailTitle');
    dialog.innerHTML='<header><h3 id="calendarDetailTitle" tabindex="-1"></h3><button type="button" class="icon-btn" data-reader-close aria-label="닫기">×</button></header><div id="calendarDetailBody" class="calendar-reader-body"></div><footer id="calendarDetailActions"></footer>';
    document.body.append(dialog);
    for(const modal of [dialog,$('calendarModal')])modal.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const controls=[...modal.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();return;}
      if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){event.preventDefault();first.focus();}
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
    let backdrop=false;dialog.addEventListener('pointerdown',event=>{backdrop=event.target===dialog&&!inside(dialog,event);});
    dialog.addEventListener('click',event=>{
      if(backdrop&&event.target===dialog&&!inside(dialog,event)){closeDetail();return;}
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.calendarEvent){openDetail(button.dataset.calendarEvent,ui.returnTo);return;}
      if(button.hasAttribute('data-detail-retry')){openDetail(ui.detailKey,ui.returnTo);return;}
      const item=lookup(ui.detailKey);
      if(button.hasAttribute('data-detail-edit')&&item&&manage(item)){ui.editOrigin=key(item);closeDetail(false);openEditor(item);}
      if(button.hasAttribute('data-detail-copy')&&item&&canWrite()){ui.editOrigin=null;closeDetail(false);openEditor(item,true);}
      if(button.hasAttribute('data-detail-delete')&&item)void remove(item);
      if(button.hasAttribute('data-reader-close'))closeDetail();
    });
    dialog.addEventListener('close',()=>{if(!$('calendarModal').open)document.body.classList.remove('calendar-dialog-open');});
    $('calendarModal').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
    $('calendarModal').addEventListener('close',()=>{if(!dialog.open)document.body.classList.remove('calendar-dialog-open');});
    $('calendarTimeMode').onchange=()=>{
      const timed=$('calendarTimeMode').value==='time';
      $('calendarStartTime').disabled=!timed;$('calendarEndTime').disabled=!timed;$('calendarStartTime').required=timed;
      $('calendarStartTime').parentElement.hidden=!timed;$('calendarEndTime').parentElement.hidden=!timed;
    };
    syncTools();
  }
  function inside(dialog,event){const rect=dialog.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;}
  function syncTools(except) {
    const campusOptions='<option value="">전체</option><option value="organization">조직 공통</option>'+permittedCampuses().map(c=>`<option value="${h(c.id)}">${h(campusDisplayName(c))}</option>`).join('');
    document.querySelectorAll('[data-calendar-home]').forEach(home=>{
      const search=home.querySelector('[data-calendar-search]');if(search!==except)search.value=ui.q;
      const scope=home.querySelector('[data-calendar-scope]');if(scope.innerHTML!==campusOptions)scope.innerHTML=campusOptions;scope.value=ui.scope;
      home.querySelector('[data-calendar-type]').value=ui.type;home.querySelector('[data-calendar-jump]').value=monthKey();
      home.querySelectorAll('[data-calendar-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarMode===ui.view)));
    });
  }
  function renderSummary() {
    const today=dateKey(new Date()),from=ui.summary==='today'?today:addDays(today,1),to=ui.summary==='today'?today:addDays(today,7);
    const events=[...ui.upcoming,...ui.external].filter(event=>overlaps(event,from,to));
    document.querySelectorAll('[data-calendar-upcoming]').forEach(node=>{node.innerHTML=ui.upcomingLoading?'불러오는 중...':ui.upcomingError?`${h(ui.upcomingError)} <button type="button" data-calendar-retry>다시 시도</button>`:rows(events)||'해당 기간 일정이 없습니다.';});
    document.querySelectorAll('[data-calendar-summary]').forEach(select=>{select.value=ui.summary;});
  }
  function render() {
    const {from,to}=range(),grid=range(true),today=dateKey(new Date());
    const authenticated=state.context?.authenticated;
    if(!state.calendarSelectedDate||state.calendarSelectedDate<grid.from||state.calendarSelectedDate>grid.to)state.calendarSelectedDate=from;
    const events=authenticated?filtered():[];
    const dates=[];for(let date=grid.from;date<=grid.to;date=addDays(date,1))dates.push(date);
    const html=dates.map(date=>{
      const dayEvents=events.filter(e=>overlaps(e,date));const outside=date<from||date>to;
      return `<div class="calendar-day${outside?' outside':''}${date===today?' today':''}${date===state.calendarSelectedDate?' selected':''}" data-calendar-cell="${date}">
        <button class="calendar-date${outside?' outside':''}" type="button" data-calendar-date="${date}" aria-pressed="${date===state.calendarSelectedDate}" aria-label="${date} 일정 보기">${Number(date.slice(-2))}${date===today?'<span class="calendar-today-label">오늘</span>':''}</button>
        ${dayEvents.slice(0,2).map(event=>`<button type="button" class="calendar-event-chip ${h(event.metadata.eventType||'other')}" data-calendar-event="${h(key(event))}" title="${h(event.title)}"><span>${h(labels[event.metadata.eventType]||'기타')}</span> ${h(event.title)}${event.metadata.endDate?` <small>${date===event.metadata.startDate?'시작':date===event.metadata.endDate?'종료':'진행'}</small>`:''}</button>`).join('')}
        ${dayEvents.length>2&&!ui.loading&&!ui.error?`<button type="button" class="calendar-more" data-calendar-more="${date}">+ ${dayEvents.length-2}개 더보기</button>`:''}</div>`;
    }).join('');
    const selected=events.filter(e=>overlaps(e,state.calendarSelectedDate));
    const monthly=events.filter(e=>overlaps(e,from,to));let group='';
    const agenda=monthly.map(event=>{const date=event.metadata.startDate<from?from:event.metadata.startDate;const header=date===group?'':`<h4>${h(dateLabel(date))}${event.metadata.startDate<from?' · 이전 달부터 진행':''}</h4>`;group=date;return header+rows([event]);}).join('');
    document.querySelectorAll('[data-calendar-home]').forEach(home=>{
      home.querySelector('[data-calendar-month]').textContent=`${state.calendarMonth.getFullYear()}년 ${state.calendarMonth.getMonth()+1}월`;
      home.querySelector('[data-calendar-grid]').innerHTML=html;
      home.querySelector('[data-calendar-grid]').hidden=ui.view!=='month';home.querySelector('.calendar-weekdays').hidden=ui.view!=='month';
      home.querySelector('[data-calendar-agenda]').hidden=ui.view!=='list';home.querySelector('[data-calendar-agenda]').innerHTML=agenda||(!ui.loading&&!ui.error?'<p>조건에 맞는 일정이 없습니다.</p>':'');
      home.querySelector('[data-calendar-list]').hidden=ui.view!=='month';
      home.querySelector('[data-calendar-list]').innerHTML=`<h4>${h(dateLabel(state.calendarSelectedDate))}</h4>`+(rows(selected)||(!ui.loading&&!ui.error?'<p>조건에 맞는 일정이 없습니다.</p>':''));
      home.querySelector('[data-calendar-status]').innerHTML=!authenticated?'로그인 후 내부 일정을 확인할 수 있습니다.':ui.loading?'불러오는 중... · 전체 조회 완료 전입니다.':ui.error?`${h(ui.error)} <button type="button" data-calendar-retry>다시 시도</button>`:`선택한 월 ${monthly.length}건 · 전체 조회 완료`;
      home.querySelector('[data-calendar-add]').classList.toggle('hidden',!canWrite());
    });
    syncTools();renderSummary();
  }
  async function pages(from,to,signal,filters=true) {
    const params=new URLSearchParams({from,to});if(filters){if(ui.q)params.set('q',ui.q);if(ui.type)params.set('eventType',ui.type);if(ui.scope==='organization')params.set('scope','organization');else if(ui.scope)params.set('campusId',ui.scope);}
    const events=new Map();let cursor=null;
    do {
      if(cursor)params.set('cursor',cursor);
      const response=await api('/api/data-core/calendar?'+params,{signal});
      response.events.forEach(event=>events.set(event.id,event));
      if(response.hasMore&&(!response.nextCursor||response.nextCursor===cursor))throw Error('일정 페이지를 불러오지 못했습니다.');
      cursor=response.hasMore?response.nextCursor:null;
    } while(cursor);
    return [...events.values()];
  }
  async function load() {
    clearTimeout(ui.timer);++state.calendarLoadId;state.calendarAbort?.abort();
    if(!state.context?.authenticated){reset();return;}
    const identity=JSON.stringify([state.context.user?.internalUserId,state.context.canWrite,state.context.memberships]);
    if(ui.identity&&ui.identity!==identity)reset();ui.identity=identity;
    const current=state.calendarLoadId,controller=new AbortController();state.calendarAbort=controller;
    ui.loading=true;ui.error='';ui.upcomingLoading=true;ui.upcomingError='';state.calendarEvents=[];ui.upcoming=[];render();
    const visible=range(!ui.q),today=dateKey(new Date());
    const results=await Promise.allSettled([pages(visible.from,visible.to,controller.signal),pages(today,addDays(today,7),controller.signal,false)]);
    if(current!==state.calendarLoadId||controller.signal.aborted)return;
    if(results[0].status==='fulfilled')state.calendarEvents=results[0].value;else ui.error='일정을 불러오지 못했습니다. 다시 시도해주세요.';
    if(results[1].status==='fulfilled')ui.upcoming=results[1].value;else ui.upcomingError='가까운 일정을 불러오지 못했습니다.';
    ui.loading=false;ui.upcomingLoading=false;state.calendarAbort=null;render();
  }
  function reset() {
    clearTimeout(ui.timer);++state.calendarLoadId;state.calendarAbort?.abort();state.calendarAbort=null;
    ui.detailEpoch++;ui.detailAbort?.abort();ui.detailKey=null;ui.editOrigin=null;ui.editSnapshot='';ui.returnTo=null;
    ui.identity='';state.calendarEvents=[];ui.upcoming=[];ui.external=[];ui.scope='';ui.q='';ui.type='';ui.loading=false;ui.error='';ui.upcomingLoading=false;ui.upcomingError='';
    $('calendarDetail')?.close();$('calendarModal')?.close();$('calendarForm')?.reset();$('calendarDetailBody').replaceChildren();document.body.classList.remove('calendar-dialog-open');render();
  }
  function closeDetail(restore=true) {
    ++ui.detailEpoch;ui.detailAbort?.abort();$('calendarDetail').close();document.body.classList.remove('calendar-dialog-open');
    if(restore){const target=ui.returnTo?.isConnected?ui.returnTo:document.querySelector(`[data-calendar-home="${state.currentView==='work-home'?'work':'counseling'}"] [data-calendar-date="${state.calendarSelectedDate}"]`);target?.focus({preventScroll:true});}
  }
  function showReader(title,body,actions='') {
    $('calendarDetailTitle').textContent=title;$('calendarDetailBody').innerHTML=body;$('calendarDetailActions').innerHTML=actions+'<button type="button" class="ghost-btn" data-reader-close>닫기</button>';
    $('calendarDetailBody').scrollTop=0;
    if(!$('calendarDetail').open)$('calendarDetail').showModal();document.body.classList.add('calendar-dialog-open');$('calendarDetailTitle').focus({preventScroll:true});
  }
  function safeSource(value) {try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}
  function detail(event) {
    const source=event.external?safeSource(event.sourceUrl):null;
    const stamp=value=>value&&!Number.isNaN(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
    showReader(event.title,`<div class="calendar-detail-meta">${badge(event)} <span>${h(event.campusName||'조직 공통')}</span><p>${h(period(event))}</p><p>${h(timeLabel(event))}</p>${event.metadata.location?`<p>장소 · ${h(event.metadata.location)}</p>`:''}</div>
      <div class="calendar-detail-notes">${h(event.summary||'등록된 메모가 없습니다.')}</div>
      ${source?`<p><a href="${h(source)}" target="_blank" rel="noopener noreferrer">원본 보러가기</a></p>`:''}
      ${event.createdByName?`<p class="muted">작성자 · ${h(event.createdByName)}</p>`:''}
      ${stamp(event.createdAt)?`<p class="muted">등록 · ${h(stamp(event.createdAt))}</p>`:''}${stamp(event.updatedAt)?`<p class="muted">수정 · ${h(stamp(event.updatedAt))}</p>`:''}`,
      `${canWrite()?'<button type="button" class="ghost-btn" data-detail-copy>일정 복사</button>':''}${manage(event)?'<button type="button" class="ghost-btn" data-detail-edit>수정</button><button type="button" class="danger-btn" data-detail-delete>삭제</button>':''}`);
  }
  async function openDetail(id,trigger) {
    ui.detailAbort?.abort();const epoch=++ui.detailEpoch;ui.detailKey=id;ui.returnTo=trigger||ui.returnTo;
    const event=lookup(id);if(!event)return;
    showReader(event.title,'<p role="status">불러오는 중...</p>');
    if(event.external){detail(event);return;}
    const controller=new AbortController();ui.detailAbort=controller;
    try {
      const response=await api('/api/data-core/calendar/'+encodeURIComponent(event.id),{signal:controller.signal});
      if(epoch!==ui.detailEpoch||!$('calendarDetail').open)return;
      if(response.event.id!==event.id)throw Error('일정을 확인할 수 없습니다.');
      replaceEvent(response.event);detail(response.event);
    } catch(error) {
      if(epoch!==ui.detailEpoch||error.name==='AbortError')return;
      showReader('일정 상세',`<p>일정을 불러오지 못했습니다.</p>${error.status===403||error.status===404?'':'<button type="button" data-detail-retry>다시 시도</button>'}`);
    }
  }
  function openDay(date,trigger){ui.detailEpoch++;ui.detailAbort?.abort();ui.detailKey=null;ui.returnTo=trigger;showReader(dateLabel(date)+' 전체 일정',rows(filtered().filter(event=>overlaps(event,date))));}
  const snapshot=()=>JSON.stringify([...$('calendarForm').elements].filter(el=>el.id&&el.type!=='submit').map(el=>[el.id,el.value]));
  function closeEditor(force=false) {
    if(state.calendarSaving)return;
    if(!force&&ui.editSnapshot&&snapshot()!==ui.editSnapshot&&!confirm('저장하지 않은 변경을 닫을까요?'))return;
    $('calendarModal').close();ui.editSnapshot='';document.body.classList.remove('calendar-dialog-open');
    if(!force&&ui.editOrigin){const event=lookup(ui.editOrigin);if(event){ui.detailKey=key(event);detail(event);}}
  }
  function openEditor(event=null,copy=false) {
    if(!canWrite()||state.calendarSaving||(!copy&&event&&!manage(event)))return;
    if($('calendarDetail').open)closeDetail(false);else if(!event)ui.editOrigin=null;
    const m=event?.metadata||{},campuses=permittedCampuses();
    $('calendarModalTitle').textContent=copy?'일정 복사':event?'일정 수정':'일정 등록';
    $('calendarEventId').value=copy?'':event?.id||'';$('calendarTitle').value=event?.title||'';
    $('calendarStartDate').value=copy?'':m.startDate||state.calendarSelectedDate||range().from;
    $('calendarEndDate').value=copy?'':m.endDate||'';$('calendarEventType').value=m.eventType||'other';$('calendarSummary').value=event?.summary||'';
    $('calendarLocation').value=m.location||'';$('calendarTimeMode').value=copy?'unspecified':m.allDay===true?'allDay':m.startTime?'time':'unspecified';
    $('calendarStartTime').value=copy?'':m.startTime||'';$('calendarEndTime').value=copy?'':m.endTime||'';$('calendarTimeMode').onchange();
    $('calendarCampus').innerHTML=(isSuperAdmin()?'<option value="">조직 공통</option>':'')+campuses.map(c=>`<option value="${h(c.id)}">${h(campusDisplayName(c))}</option>`).join('');
    $('calendarCampus').value=event&&!copy?event.campusId||'':isSuperAdmin()?'':campuses[0]?.id||'';
    $('calendarFormError').textContent='';$('calendarModal').showModal();document.body.classList.add('calendar-dialog-open');ui.editSnapshot=snapshot();
    $(copy?'calendarStartDate':'calendarTitle').focus({preventScroll:true});
  }
  function replaceEvent(event) {
    state.calendarEvents=state.calendarEvents.filter(item=>item.id!==event.id);state.calendarEvents.push(event);
    ui.upcoming=ui.upcoming.filter(item=>item.id!==event.id);const today=dateKey(new Date());if(overlaps(event,today,addDays(today,7)))ui.upcoming.push(event);
  }
  async function save(event) {
    event.preventDefault();if(state.calendarSaving)return;const errorLabel=$('calendarFormError');errorLabel.textContent='';
    if(!$('calendarForm').reportValidity())return;
    const start=$('calendarStartDate').value,end=$('calendarEndDate').value,timed=$('calendarTimeMode').value==='time';
    if(end&&end<start){errorLabel.textContent='종료일은 시작일과 같거나 이후여야 합니다.';return;}
    if(timed&&(!end||end===start)&&$('calendarEndTime').value&&$('calendarEndTime').value<$('calendarStartTime').value){errorLabel.textContent='종료 시간은 시작 시간과 같거나 이후여야 합니다.';return;}
    const id=$('calendarEventId').value,campusId=$('calendarCampus').value||null;
    const payload={title:$('calendarTitle').value.trim(),summary:$('calendarSummary').value.trim()||null,campusId,visibility:campusId?'campus':'organization',
      metadata:{startDate:start,endDate:end||'',eventType:$('calendarEventType').value,allDay:$('calendarTimeMode').value==='allDay',startTime:timed?$('calendarStartTime').value:'',endTime:timed?$('calendarEndTime').value:'',location:$('calendarLocation').value.trim()}};
    const controls=[...$('calendarForm').elements],disabled=controls.map(control=>control.disabled),identity=ui.identity;
    state.calendarSaving=true;controls.forEach(control=>{control.disabled=true;});$('calendarSubmitBtn').textContent='저장 중...';$('calendarForm').setAttribute('aria-busy','true');
    try {
      const response=await api(id?'/api/data-core/calendar/'+encodeURIComponent(id):'/api/data-core/calendar',{method:id?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      if(identity!==ui.identity||!state.context?.authenticated)return;
      const needsReload=ui.loading||Boolean(ui.error)||Boolean(ui.upcomingError);
      ++state.calendarLoadId;state.calendarAbort?.abort();state.calendarAbort=null;ui.loading=false;ui.upcomingLoading=false;ui.error='';replaceEvent(response.event);
      state.calendarSelectedDate=start;const [y,m]=start.split('-').map(Number),changedMonth=monthKey()!==start.slice(0,7);state.calendarMonth=new Date(y,m-1,1);
      state.calendarSaving=false;closeEditor(true);render();
      if(id){ui.detailKey=key(response.event);detail(response.event);}if(changedMonth||needsReload)void load();toast(id?'일정을 수정했습니다.':'일정을 등록했습니다.');
    } catch(error){if(identity===ui.identity){errorLabel.textContent=error.message;toast(error.message,'error');}}
    finally {state.calendarSaving=false;controls.forEach((control,index)=>{control.disabled=disabled[index];});$('calendarSubmitBtn').textContent='일정 저장';$('calendarForm').removeAttribute('aria-busy');}
  }
  async function remove(event) {
    if(!manage(event)||!confirm(`'${event.title}' 일정을 삭제할까요?`))return;
    const button=$('calendarDetailActions').querySelector('[data-detail-delete]');if(button?.disabled)return;if(button)button.disabled=true;
    try {await api('/api/data-core/calendar/'+encodeURIComponent(event.id),{method:'DELETE'});closeDetail();await load();toast('일정을 삭제했습니다.');}
    catch(error){toast(error.message,'error');if(button)button.disabled=false;}
  }
  function external(items) {
    const seen=new Set();
    const next=items.filter(item=>/^\d{4}-\d{2}-\d{2}$/.test(item.applicationEnd||'')).flatMap(item=>{
      const id=JSON.stringify([item.sourceId||item.sourceName||'',item.id||item.sourceUrl,item.applicationEnd]);if(seen.has(id))return [];seen.add(id);
      return [{id,external:true,title:item.title,summary:item.summary||'',campusId:null,visibility:'organization',sourceUrl:item.sourceUrl,metadata:{startDate:item.applicationEnd,eventType:'competition'},canManage:false}];
    });
    if(JSON.stringify(ui.external)===JSON.stringify(next))return false;ui.external=next;return true;
  }
  function today(){const value=dateKey(new Date()),[y,m]=value.split('-').map(Number);state.calendarMonth=new Date(y,m-1,1);state.calendarSelectedDate=value;void load();}
  globalThis.AcademyCalendar={configure,render,load,dateKey,range,openEditor,closeEditor,save,reset,setExternal:external,today};
})();

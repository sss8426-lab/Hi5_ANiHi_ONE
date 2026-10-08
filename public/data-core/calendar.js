(() => {
  let state, $, h, api, canWrite, isSuperAdmin, orderedCampuses, campusDisplayName, toast;
  const ui = { view:'month', q:'', scope:'', type:'', loading:false, error:'', upcoming:[], upcomingError:'', upcomingLoading:false,
    external:[], fixed:null, detailKey:null, detailEpoch:0, detailAbort:null, returnTo:null, editSnapshot:'', editOrigin:null, summary:'today', timer:null, identity:'' };
  const labels = {class:'수업',admission:'입시',competition:'공모전',marketing:'홍보',holiday:'휴일',meeting:'회의',other:'기타'};
  const dayMs = 86400000;
  const mounted = new WeakSet();
  let rootObserver;
  let pendingLoad=null;
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
    if(!rootObserver){const today=dateKey(new Date()); const [year,month]=today.split('-').map(Number);state.calendarMonth=new Date(year,month-1,1);}
    mountRoots();
    if(document.getElementById('calendarDetail'))return;
    rootObserver=new MutationObserver(records=>{
      if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches('[data-calendar-home]')||node.querySelector('[data-calendar-home]'))))){mountRoots();render();}
    });
    rootObserver.observe(document.querySelector('main'),{childList:true,subtree:true});
    mountDialogs();syncTools();
  }
  function mountRoots(){
    document.querySelectorAll('[data-calendar-home]').forEach(home=>{
      if(mounted.has(home)||!home.querySelector('[data-calendar-month]'))return;
      mounted.add(home);
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
        if(target?.matches('[data-calendar-prev],[data-calendar-next]')){state.calendarMonth=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth()+(target.hasAttribute('data-calendar-prev')?-1:1),1);state.calendarSelectedDate=range().from;void load();return;}
        if(target?.hasAttribute('data-calendar-today')){today();return;}
        if(target?.hasAttribute('data-calendar-add')){openEditor();return;}
        if(target?.dataset.calendarEvent) {openDetail(target.dataset.calendarEvent,target);return;}
        if(target?.dataset.calendarMore){openDay(target.dataset.calendarMore,target);return;}
        if(target?.dataset.calendarFixed){openFixed(target.dataset.calendarFixed);return;}
        if(target?.hasAttribute('data-calendar-fixed-manage')){openFixedManager();return;}
        if(target?.dataset.calendarMode){ui.view=target.dataset.calendarMode;render();return;}
        if(target?.hasAttribute('data-calendar-retry')){void load();return;}
        const day=event.target.closest('[data-calendar-cell]');
        if(day){state.calendarSelectedDate=day.dataset.calendarCell;render();home.querySelector(`[data-calendar-date="${state.calendarSelectedDate}"]`)?.focus({preventScroll:true});}
      });
      // Double-click (or double-tap) a day to write an event that starts on that day.
      home.addEventListener('dblclick',event=>{
        const day=event.target.closest('[data-calendar-cell]');if(!day||!canWrite())return;
        event.preventDefault();state.calendarSelectedDate=day.dataset.calendarCell;render();openEditor();
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
  }
  function mountDialogs(){
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
      if(button.dataset.fixedEdit){openFixedManager((ui.fixed?.tasks||[]).find(t=>t.id===button.dataset.fixedEdit));return;}
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
    mountRoots();
    const {from,to}=range(),grid=range(true),today=dateKey(new Date());
    const authenticated=state.context?.authenticated;
    if(!state.calendarSelectedDate||state.calendarSelectedDate<grid.from||state.calendarSelectedDate>grid.to)state.calendarSelectedDate=from;
    const events=authenticated?filtered():[];
    const dates=[];for(let date=grid.from;date<=grid.to;date=addDays(date,1))dates.push(date);
    // Week rows: a multi-day event is one bar across its days (like a phone calendar), and 고정 업무 sit first.
    const fixedEvents=(ui.fixed?.tasks||[]).flatMap(task=>task.dates.map(date=>({id:`fixed:${task.id}:${date}`,fixed:true,task,title:task.title,metadata:{startDate:date,eventType:'fixed'}})));
    const LANES=3,html=Array.from({length:dates.length/7},(_,w)=>{
      const week=dates.slice(w*7,w*7+7),ws=week[0],we=week[6],lanes=Array.from({length:LANES},()=>Array(7).fill(false)),hidden=Array(7).fill(0);
      const end=e=>e.metadata.endDate||e.metadata.startDate;
      const segs=[...fixedEvents,...events].filter(e=>overlaps(e,ws,we)).map(e=>({e,c1:week.indexOf(e.metadata.startDate<ws?ws:e.metadata.startDate),c2:week.indexOf(end(e)>we?we:end(e)),contL:e.metadata.startDate<ws,contR:end(e)>we}))
        .sort((a,b)=>Number(Boolean(b.e.fixed))-Number(Boolean(a.e.fixed))||(b.c2-b.c1)-(a.c2-a.c1)||a.c1-b.c1);
      const placed=[];
      for(const seg of segs){
        const lane=lanes.findIndex(row=>row.slice(seg.c1,seg.c2+1).every(used=>!used));
        if(lane<0){for(let c=seg.c1;c<=seg.c2;c++)hidden[c]++;continue;}
        for(let c=seg.c1;c<=seg.c2;c++)lanes[lane][c]=true;placed.push({...seg,lane});
      }
      const cells=week.map((date,i)=>{const outside=date<from||date>to;return `<div class="calendar-day${outside?' outside':''}${date===today?' today':''}${date===state.calendarSelectedDate?' selected':''}" data-calendar-cell="${date}" style="grid-column:${i+1}"${canWrite()?' title="두 번 누르면 이 날 일정을 씁니다"':''}>
        <button class="calendar-date${outside?' outside':''}" type="button" data-calendar-date="${date}" aria-pressed="${date===state.calendarSelectedDate}" aria-label="${date} 일정 보기">${Number(date.slice(-2))}${date===today?'<span class="calendar-today-label">오늘</span>':''}</button></div>`;}).join('');
      const bars=placed.map(({e,c1,c2,contL,contR,lane})=>{
        const multi=c2>c1||contL||contR,place=`grid-column:${c1+1}/${c2+2};grid-row:${lane+2}`;
        if(e.fixed)return `<button type="button" class="calendar-event-chip calendar-bar calendar-fixed-chip" data-calendar-fixed="${h(e.task.id)}" style="${place}" title="${h(e.title)}">📌 ${h(e.title)}</button>`;
        const type=e.metadata.eventType||'other';
        return `<button type="button" class="calendar-event-chip calendar-bar ${h(type)}${multi?' multi':''}${contL?' cont-l':''}${contR?' cont-r':''}" data-calendar-event="${h(key(e))}" style="${place}" title="${h(e.title)}"><span>${h(labels[type]||'기타')}</span> ${h(e.title)}${multi&&!contR?` <small>~${Number(end(e).slice(-2))}일</small>`:''}</button>`;
      }).join('');
      const more=!ui.loading&&!ui.error?hidden.map((n,i)=>n?`<button type="button" class="calendar-more" data-calendar-more="${week[i]}" style="grid-column:${i+1};grid-row:${LANES+2}">+ ${n}개 더보기</button>`:'').join(''):'';
      return `<div class="calendar-week">${cells}${bars}${more}</div>`;
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
      home.querySelector('[data-calendar-status]').innerHTML=!authenticated?'로그인 후 내부 일정을 확인할 수 있습니다.':ui.loading?'불러오는 중... · 전체 조회 완료 전입니다.':ui.error?`${h(ui.error)} <button type="button" data-calendar-retry>다시 시도</button>`:fixedStrip()+`<span class="calendar-status-count">선택한 월 ${monthly.length}건 · 전체 조회 완료</span>`+(ui.fixed?.canCreate?'<button type="button" class="ghost-btn calendar-fixed-manage" data-calendar-fixed-manage>🔒 고정 업무 관리</button>':'');
      home.querySelector('[data-calendar-add]').classList.toggle('hidden',!canWrite());
    });
    syncTools();renderSummary();
  }
  // 고정 업무 (e.g. the 월간 업무보고 deadline) shown on top of the calendar and on their days.
  function fixedStrip(){
    const tasks=ui.fixed?.tasks||[];if(!tasks.length)return '';
    const today=dateKey(new Date());
    return '<span class="calendar-fixed-label">📌 고정 업무</span>'+tasks.map(task=>{
      const date=task.dates.find(d=>d>=today)||task.dates[0];if(!date)return '';
      const days=Math.round((Date.parse(date)-Date.parse(today))/dayMs);
      return `<button type="button" class="calendar-fixed-item${task.kind==='monthly-report'?' report':''}" data-calendar-fixed="${h(task.id)}"><b>${h(task.title)}</b> ${h(dateLabel(date))}${days>=0?` <span class="calendar-dday">${days===0?'D-day':'D-'+days}</span>`:''} <small>${h(task.campusName)}${task.kind==='monthly-report'&&task.staffCount?` · 제출 ${task.submittedCount}/${task.staffCount}`:''}</small></button>`;
    }).join('');
  }
  function openFixed(id){
    const task=(ui.fixed?.tasks||[]).find(t=>t.id===id);if(!task)return;
    ui.detailEpoch++;ui.detailAbort?.abort();ui.detailKey=null;
    showReader('📌 '+task.title,`<div class="calendar-detail-meta"><span class="calendar-type fixed">고정 업무</span> <span>${h(task.campusName)}</span>${task.dates.map(d=>`<p>${h(dateLabel(d))}</p>`).join('')}<p class="muted">${h(fixedRuleText(task))}</p>${task.kind==='monthly-report'?`<p>제출 ${task.submittedCount}/${task.staffCount}명 · <a href="/data-core/reports">월간 업무보고 열기</a></p>`:''}</div>`,
      task.canManage?`<button type="button" class="ghost-btn" data-fixed-edit="${h(task.id)}">수정</button>`:'');
  }
  const WEEKDAYS=['일','월','화','수','목','금','토'];
  const fixedRuleText=task=>task.rule==='first-saturday'?'매월 첫째 주 토요일 (첫 주가 3일 이하면 다음 주 토요일)':task.rule==='month-end'?'매월 마지막 날':task.rule==='month-day'?`매월 ${task.ruleValue}일`:task.rule==='weekday'?`매주 ${WEEKDAYS[task.ruleValue]}요일`:'';
  function mountFixedDialog(){
    if(document.getElementById('calendarFixedDialog'))return;
    const dialog=document.createElement('dialog');dialog.id='calendarFixedDialog';dialog.className='calendar-reader calendar-fixed-dialog';dialog.setAttribute('aria-labelledby','calendarFixedTitle');
    dialog.innerHTML=`<header><h3 id="calendarFixedTitle">📌 고정 업무 관리</h3><button type="button" class="icon-btn" data-fixed-close aria-label="닫기">×</button></header>
      <div class="calendar-reader-body"><div data-fixed-list></div>
      <form data-fixed-form class="calendar-fixed-form"><h4 data-fixed-form-title>고정 업무 등록</h4><input type="hidden" name="id">
        <label>업무 이름<input name="title" maxlength="60" required placeholder="예: 출석부 월말 정리"></label>
        <fieldset><legend>날짜 규칙</legend>
          <label><input type="radio" name="rule" value="first-saturday" checked> 매월 첫째 주 토요일 <small>첫 주가 3일 이하(1일이 목·금·토요일)면 다음 주 토요일</small></label>
          <label><input type="radio" name="rule" value="month-end"> 매월 마지막 날</label>
          <label><input type="radio" name="rule" value="month-day"> 매월 <input type="number" name="day" min="1" max="31" value="1" aria-label="날짜"> 일</label>
          <label><input type="radio" name="rule" value="weekday"> 매주 <select name="weekday" aria-label="요일">${WEEKDAYS.map((d,i)=>`<option value="${i}">${d}요일</option>`).join('')}</select></label></fieldset>
        <label>보이는 범위<select name="campusId"></select></label>
        <p class="calendar-fixed-preview" data-fixed-preview></p><p class="calendar-fixed-error" data-fixed-error role="alert"></p>
        <div class="calendar-fixed-actions"><button type="button" class="ghost-btn" data-fixed-new>새로 쓰기</button><button type="submit" class="primary-btn">저장</button></div></form></div>`;
    document.body.append(dialog);
    const form=dialog.querySelector('[data-fixed-form]');
    dialog.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-fixed-close'))dialog.close();
      if(b.hasAttribute('data-fixed-new'))fillFixed(null);
      if(b.dataset.fixedPick)fillFixed((ui.fixed?.tasks||[]).find(t=>t.id===b.dataset.fixedPick));
      if(b.dataset.fixedDelete)void removeFixed(b.dataset.fixedDelete);
    });
    form.addEventListener('input',()=>void previewFixed());
    form.addEventListener('submit',event=>{event.preventDefault();void saveFixed();});
  }
  function fixedPayload(){
    const f=document.querySelector('[data-fixed-form]'),rule=f.elements.rule.value;
    return {id:f.elements.id.value,title:f.elements.title.value.trim(),rule,ruleValue:rule==='month-day'?Number(f.elements.day.value):rule==='weekday'?Number(f.elements.weekday.value):null,campusId:f.elements.campusId.value||null};
  }
  async function previewFixed(){
    const t=fixedPayload(),rules=await import('/data-core/fixed-task-rules.js?v=20261008-reports');
    const out=[];let month=monthKey();for(let i=0;i<4;i++){const [y,m]=month.split('-').map(Number);const d=rules.ruleDates(t.rule,t.ruleValue,y,m);out.push(`${m}월 → ${d.slice(0,2).map(x=>`${Number(x.slice(8))}일(${WEEKDAYS[new Date(x+'T00:00:00Z').getUTCDay()]})`).join(', ')}${d.length>2?' 외':''}`);month=rules.shiftMonth(month,1);}
    const node=document.querySelector('[data-fixed-preview]');if(node)node.textContent='앞으로의 날짜: '+out.join(' · ');
  }
  function fillFixed(task){
    const f=document.querySelector('[data-fixed-form]');
    f.querySelector('[data-fixed-form-title]').textContent=task?'고정 업무 수정':'고정 업무 등록';
    f.elements.id.value=task?.id||'';f.elements.title.value=task?.title?.replace(/^\d+월 /,'')||'';
    f.elements.rule.value=task?.rule||'first-saturday';f.elements.day.value=task?.rule==='month-day'?task.ruleValue:1;f.elements.weekday.value=task?.rule==='weekday'?task.ruleValue:6;
    f.elements.campusId.innerHTML=(ui.fixed?.manageableCampuses||[]).map(c=>`<option value="${h(c.id||'')}">${h(c.name)}</option>`).join('');
    f.elements.campusId.value=task?task.campusId||'':(ui.fixed?.manageableCampuses?.find(c=>c.id)?.id||'');
    f.elements.campusId.disabled=task?.kind==='monthly-report';
    f.querySelector('[data-fixed-error]').textContent='';void previewFixed();
  }
  function renderFixedList(){
    const list=document.querySelector('[data-fixed-list]');if(!list)return;
    const mine=(ui.fixed?.tasks||[]).filter(t=>t.canManage);
    list.innerHTML=mine.length?`<ul class="calendar-fixed-list">${mine.map(t=>`<li><b>${h(t.title)}</b> <small>${h(t.campusName)} · ${h(fixedRuleText(t))}</small> <button type="button" class="ghost-btn" data-fixed-pick="${h(t.id)}">수정</button>${t.kind==='monthly-report'?'':`<button type="button" class="danger-btn" data-fixed-delete="${h(t.id)}">삭제</button>`}</li>`).join('')}</ul>`:'<p class="muted">관리할 수 있는 고정 업무가 아직 없습니다.</p>';
  }
  function openFixedManager(task=null){
    if(!ui.fixed?.canCreate)return;mountFixedDialog();renderFixedList();fillFixed(task);
    if($('calendarDetail').open)closeDetail(false);
    document.getElementById('calendarFixedDialog').showModal();
  }
  async function saveFixed(){
    const t=fixedPayload(),err=document.querySelector('[data-fixed-error]');err.textContent='';
    try{
      ui.fixed=await api('/api/data-core/calendar/fixed-tasks'+(t.id?'/'+encodeURIComponent(t.id):'')+'?month='+monthKey(),{method:t.id?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(t)});
      renderFixedList();fillFixed(null);render();toast(t.id?'고정 업무를 고쳤습니다.':'고정 업무를 등록했습니다.');
    }catch(error){err.textContent=error.message;}
  }
  async function removeFixed(id){
    const task=(ui.fixed?.tasks||[]).find(t=>t.id===id);if(!task||!confirm(`'${task.title}' 고정 업무를 삭제할까요?`))return;
    try{ui.fixed=await api('/api/data-core/calendar/fixed-tasks/'+encodeURIComponent(id)+'?month='+monthKey(),{method:'DELETE'});renderFixedList();fillFixed(null);render();toast('고정 업무를 삭제했습니다.');}
    catch(error){toast(error.message,'error');}
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
  function load(){
    const key=JSON.stringify([state.context?.user?.internalUserId,state.context?.memberships,state.context?.canWrite,state.context?.authenticated,monthKey(),ui.q,ui.scope,ui.type]);
    if(pendingLoad?.key===key)return pendingLoad.promise;
    const pending={key,promise:null};pendingLoad=pending;
    pending.promise=loadCurrent().finally(()=>{if(pendingLoad===pending)pendingLoad=null;});return pending.promise;
  }
  async function loadCurrent() {
    clearTimeout(ui.timer);++state.calendarLoadId;state.calendarAbort?.abort();
    if(!state.context?.authenticated){reset();return;}
    const identity=JSON.stringify([state.context.user?.internalUserId,state.context.canWrite,state.context.memberships]);
    if(ui.identity&&ui.identity!==identity)reset();ui.identity=identity;
    const current=state.calendarLoadId,controller=new AbortController();state.calendarAbort=controller;
    ui.loading=true;ui.error='';ui.upcomingLoading=true;ui.upcomingError='';state.calendarEvents=[];ui.upcoming=[];render();
    const visible=range(!ui.q),today=dateKey(new Date());
    const results=await Promise.allSettled([pages(visible.from,visible.to,controller.signal),pages(today,addDays(today,7),controller.signal,false),api('/api/data-core/calendar/fixed-tasks?month='+monthKey(),{signal:controller.signal})]);
    if(current!==state.calendarLoadId||controller.signal.aborted)return;
    if(results[0].status==='fulfilled')state.calendarEvents=results[0].value;else ui.error='일정을 불러오지 못했습니다. 다시 시도해주세요.';
    if(results[1].status==='fulfilled')ui.upcoming=results[1].value;else ui.upcomingError='가까운 일정을 불러오지 못했습니다.';
    ui.fixed=results[2].status==='fulfilled'?results[2].value:null;
    ui.loading=false;ui.upcomingLoading=false;state.calendarAbort=null;render();
  }
  function reset() {
    pendingLoad=null;
    clearTimeout(ui.timer);++state.calendarLoadId;state.calendarAbort?.abort();state.calendarAbort=null;
    ui.detailEpoch++;ui.detailAbort?.abort();ui.detailKey=null;ui.editOrigin=null;ui.editSnapshot='';ui.returnTo=null;
    ui.identity='';state.calendarEvents=[];ui.upcoming=[];ui.external=[];ui.fixed=null;ui.scope='';ui.q='';ui.type='';ui.loading=false;ui.error='';ui.upcomingLoading=false;ui.upcomingError='';
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
      pendingLoad=null;++state.calendarLoadId;state.calendarAbort?.abort();state.calendarAbort=null;ui.loading=false;ui.upcomingLoading=false;ui.error='';replaceEvent(response.event);
      state.calendarSelectedDate=start;const [y,m]=start.split('-').map(Number),changedMonth=monthKey()!==start.slice(0,7);state.calendarMonth=new Date(y,m-1,1);
      state.calendarSaving=false;closeEditor(true);render();
      if(id){ui.detailKey=key(response.event);detail(response.event);}if(changedMonth||needsReload)void load();toast(id?'일정을 수정했습니다.':'일정을 등록했습니다.');
    } catch(error){if(identity===ui.identity){errorLabel.textContent=error.message;toast(error.message,'error');}}
    finally {state.calendarSaving=false;controls.forEach((control,index)=>{control.disabled=disabled[index];});$('calendarSubmitBtn').textContent='일정 저장';$('calendarForm').removeAttribute('aria-busy');}
  }
  async function remove(event) {
    if(!manage(event)||!confirm(`'${event.title}' 일정을 삭제할까요?`))return;
    const button=$('calendarDetailActions').querySelector('[data-detail-delete]');if(button?.disabled)return;if(button)button.disabled=true;
    try {await api('/api/data-core/calendar/'+encodeURIComponent(event.id),{method:'DELETE'});pendingLoad=null;closeDetail();await load();toast('일정을 삭제했습니다.');}
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

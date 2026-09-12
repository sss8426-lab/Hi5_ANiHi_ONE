/* global lucide */
const api=window.hi5Sync,$=id=>document.getElementById(id);
const selected=new Set(['content-basic','content-advanced','content-admission']);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>new Intl.NumberFormat('ko-KR').format(value||0);
const date=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'아직 없음';
const bytes=value=>`${((value||0)/1024/1024).toFixed(1)} MB`;
const labels={waiting:'대기',scanning:'검사 중',offline:'연결 필요',missing:'폴더 없음',error:'오류',blocked:'확인 필요',review:'변경 확인 필요',new:'새 자료 있음',current:'최신',stale:'재검사 필요',syncing:'동기화 중',done:'검증 완료',cancelled:'중지됨'};
let state={},targetSignature='',confirmation=null,localMessage='',wizardShown=false;
function icons(){lucide.createIcons({attrs:{'aria-hidden':'true'}});}
async function run(fn){try{const r=await fn();if(r?.error){localMessage=r.error.message;notice();}return r;}catch{localMessage='작업 연결이 끊겼습니다. 앱을 다시 실행해 주세요.';notice();return {error:true};}}
function notice(){const text=state.error?.message||localMessage;$('notice').textContent=text||'';$('notice').hidden=!text;}
function render(next){
  state=next;const connection={connected:'연결됨',unknown:'연결 확인 중',auth:'인증 필요',error:'연결 오류'}[state.connection]||'연결 확인 중';
  $('connection').className=state.connection||'';$('connection').innerHTML=`<span class="dot"></span>${connection}`;
  $('login').hidden=state.connection==='connected'||state.connection==='unknown';$('login').disabled=state.busy;
  const signature=JSON.stringify({targets:state.targets,busy:state.busy});
  if(signature!==targetSignature){targetSignature=signature;renderTargets();}
  $('selection').textContent=`${selected.size}개 과정 선택`;
  const ready=selected.size>0&&[...selected].every(id=>state.targets?.find(t=>t.id===id)?.diff?.canApply&&!['stale','done','error','offline','missing'].includes(state.targets.find(t=>t.id===id).status));
  $('scan').disabled=state.busy;$('sync').disabled=state.busy||!ready;$('cancel').hidden=!state.busy;
  $('operation-state').textContent=state.busy?'작업 진행 중':ready?'확인 후 수동 반영':'변경사항을 다시 확인해 주세요';
  const p=state.progress;$('progress-panel').hidden=!p;
  if(p){const target=state.targets.find(t=>t.id===p.targetId);$('progress-title').textContent=`${target?.title||''} · ${{scan:'파일 검사',prepare:'미리보기 준비',upload:'중앙 반영',verify:'원본 검증'}[p.phase]||'확인'}`;
    $('progress-number').textContent=p.total?`${fmt(p.completed)} / ${fmt(p.total)}`:`${fmt(p.completed)}개 확인`;
    if(p.total){$('progress').max=p.total;$('progress').value=p.completed;}else $('progress').removeAttribute('value');
    $('progress-path').textContent=p.path||'';$('progress-bytes').textContent=p.totalBytes?`처리 ${bytes(p.processedBytes)} / ${bytes(p.totalBytes)} · 실제 업로드 ${bytes(p.uploadedBytes)} · ${fmt(p.uploaded)}개 파일`:'';
  }
  $('history').innerHTML=state.history?.length?state.history.map(h=>`<div class="history-row"><time>${escape(date(h.at))}</time><strong>${h.status==='success'?'검증 완료':h.status==='cancelled'?'중지':'확인 필요'}</strong><p>${h.targets.map(t=>`${escape(state.targets.find(x=>x.id===t.id)?.title)} 신규 ${fmt(t.newFiles)} · 수정 ${fmt(t.modified)} · 업로드 ${fmt(t.uploaded)}`).join(' / ')||'완료된 과정 없음'}</p></div>`).join(''):'<p class="muted">아직 동기화 기록이 없습니다.</p>';
  notice();icons();
  if(state.settings&&!state.settings.configured&&!wizardShown){wizardShown=true;showSettings(true);}
}
function renderTargets(){
  $('targets').innerHTML=(state.targets||[]).map(t=>`<article class="target ${escape(t.status)}" data-target="${t.id}"><div class="target-top"><div class="target-name"><input type="checkbox" id="select-${t.id}" data-select="${t.id}" ${selected.has(t.id)?'checked':''} ${state.busy?'disabled':''}><i data-lucide="folder-open"></i><label for="select-${t.id}">${t.title}</label></div><span class="status"><span class="dot"></span>${labels[t.status]}</span></div><div class="source-row"><span>${escape(t.source)}</span><button data-folder="${t.id}" title="${t.title} 폴더 변경" aria-label="${t.title} 폴더 변경" ${state.busy?'disabled':''}><i data-lucide="folder-cog"></i></button></div><p class="counts">${t.folders===undefined?'폴더 확인 대기':`${fmt(t.folders)}개 수업 · ${fmt(t.files)}개 파일`}</p><div class="target-bottom"><div class="metrics">${t.diff?`<span>신규 <strong>${fmt(t.diff.newFiles)}</strong></span><span>수정 <strong>${fmt(t.diff.changed)}</strong></span><span>동일 <strong>${fmt(t.diff.unchanged)}</strong></span><span>삭제 확인 <strong>${fmt(t.diff.reviewNeeded)}</strong></span><span>충돌 <strong>${fmt(t.diff.conflicts+t.diff.deletedConflicts)}</strong></span><span>미지원 <strong>${fmt(t.diff.unsupported)}</strong></span>`:'<span>중앙 비교 대기</span>'}</div><button data-detail="${t.id}" ${!t.diff?'disabled':''}>상세 보기<i data-lucide="chevron-right"></i></button></div>${t.error?`<p class="target-error">${escape(t.error.message)}</p>`:''}<p class="last-sync">마지막 성공 동기화 ${escape(date(t.lastSync))}</p></article>`).join('');
}
function modal(title,html){$('modal-title').textContent=title;$('modal-body').innerHTML=html;if(!$('modal').open)$('modal').showModal();icons();}
$('modal-close').onclick=()=>$('modal').close();
$('targets').onchange=e=>{if(e.target.dataset.select){if(e.target.checked)selected.add(e.target.dataset.select);else selected.delete(e.target.dataset.select);render(state);}};
async function chooseFolder(id){const r=await run(()=>api.chooseFolder(id));if(!r?.error&&!r?.cancelled){$('modal').close();await run(()=>api.scan());}}
$('targets').onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.folder)chooseFolder(button.dataset.folder);if(button.dataset.detail){const t=state.targets.find(t=>t.id===button.dataset.detail),types={folder:'새 폴더',new:'새 이미지',modified:'수정 감지',missing:'삭제 확인',unsupported:'지원 확인'};modal(`${t.title} 변경사항`,t.diff.details.length?`<ul class="diff-list">${t.diff.details.map(d=>`<li><span>${types[d.kind]}</span>${escape(d.path)}</li>`).join('')}</ul>`:'<p>변경된 자료가 없습니다.</p>');}};
$('scan').onclick=async()=>{localMessage='';await run(()=>api.scan());};
$('cancel').onclick=async()=>{await run(()=>api.cancel());localMessage='진행 중인 파일을 안전하게 마친 뒤 중지합니다.';notice();};
$('login').onclick=async()=>{localMessage='브라우저에서 Cloudflare 로그인을 완료해 주세요.';notice();$('login').disabled=true;await run(()=>api.login());$('login').disabled=false;};
$('web').onclick=()=>run(()=>api.openWeb());
$('sync').onclick=async()=>{
  confirmation=await run(()=>api.confirm([...selected]));if(confirmation?.error)return;
  modal('중앙서버 반영 예정',`<dl><dt>새 폴더</dt><dd>${fmt(confirmation.newFolders)}</dd><dt>새 파일</dt><dd>${fmt(confirmation.newFiles)}</dd><dt>수정 파일</dt><dd>${fmt(confirmation.modified)}</dd><dt>로컬에서 사라진 자료</dt><dd>${fmt(confirmation.missing)} · 중앙 유지</dd><dt>중앙 자료 자동 삭제</dt><dd>0</dd></dl>${confirmation.modified?'<label class="check-row"><input id="allow-modified" type="checkbox">수정파일을 새 버전으로 반영합니다. 기존 원본은 보존합니다.</label>':''}<div class="dialog-actions"><button id="confirm-cancel">취소</button><button id="confirm-start" class="primary" ${confirmation.modified?'disabled':''}>동기화 시작</button></div>`);
  $('allow-modified')?.addEventListener('change',e=>{$('confirm-start').disabled=!e.target.checked;});
  $('confirm-cancel').onclick=()=>$('modal').close();
  $('confirm-start').onclick=async()=>{const allowModified=$('allow-modified')?.checked===true,token=confirmation.token;$('modal').close();localMessage='';const r=await run(()=>api.apply({token,allowModified}));if(r?.status==='success'){localMessage='동기화와 원본 검증이 완료되었습니다.';notice();}};
};
function showSettings(first=false){
  modal(first?'HI5·ANiHi Sync 설정':'설정',`<ul class="setting-sources">${(state.targets||[]).map(t=>`<li><div><strong>${t.title}</strong><span>${escape(t.source)}</span></div><button data-setting-folder="${t.id}" ${state.busy?'disabled':''}>폴더 변경</button></li>`).join('')}</ul><label class="setting-row">운영 웹 주소<input id="base-url" type="url" value="${escape(state.settings?.baseUrl)}"></label><label class="check-row"><input id="watch" type="checkbox" ${state.settings?.watch?'checked':''}>폴더 변경 자동 감지</label><p class="muted">자동 반영은 하지 않습니다. Windows 시작 시 자동실행은 등록하지 않습니다.</p><div class="dialog-actions"><button id="shortcut">바탕화면 바로가기</button><button id="save-settings" class="primary">${first?'연결 확인':'저장'}</button></div><p id="settings-error" class="dialog-error"></p>`);
  $('modal-body').querySelectorAll('[data-setting-folder]').forEach(b=>b.onclick=()=>chooseFolder(b.dataset.settingFolder));
  $('shortcut').onclick=async()=>{const r=await run(()=>api.shortcut());$('settings-error').textContent=r?.ok?'바탕화면 바로가기를 만들었습니다.':r?.error?.message||'바로가기 생성 결과를 확인해 주세요.';};
  $('save-settings').onclick=async()=>{const r=await run(()=>api.settings({baseUrl:$('base-url').value,watch:$('watch').checked}));if(r?.error){$('settings-error').textContent=r.error.message;return;}$('modal').close();if(first&&!state.busy)await run(()=>api.scan());};
}
$('settings').onclick=()=>showSettings();
$('help').onclick=()=>modal('도움말','<div class="help-copy"><p>원본 폴더에 자료를 추가한 후 앱을 실행하세요. 검사 결과를 확인하고 <strong>중앙서버에 동기화</strong>를 누르면 새 자료만 반영됩니다.</p><p>수정 파일은 확인 후 새 버전으로 저장합니다. 로컬에서 삭제한 파일은 중앙에서 자동 삭제되지 않습니다.</p><p>중단되면 <strong>변경사항 다시 확인</strong> 후 이어갈 수 있습니다. 정상 반영된 파일은 다시 업로드하지 않습니다.</p><p>이 앱은 원본이 있는 MASTER 관리 PC용입니다. 다른 캠퍼스는 웹앱에 로그인해 열람·인쇄합니다.</p><p>로그: %LOCALAPPDATA%\\HI5-ANiHi-Sync\\logs<br>설정: %APPDATA%\\HI5-ANiHi-Sync\\config.json</p></div>');
api.onState(render);run(()=>api.state()).then(s=>{if(s?.targets)render(s);});icons();

(() => {
  if (window.DataCoreLibrary) return;
  const host = document.getElementById('libraryBrowser');
  if (!host) return;
  const $ = id => document.getElementById(id);
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="lb-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;
  const href = id => `/data-core/work/library${id === 'root' ? '' : `?folder=${encodeURIComponent(id)}`}`;
  const state = { folder: null, folders: [], files: [], recent: [], recentCount: 0, picked: new Set(), breadcrumbs: [], controller: null, generation: 0, queue: null, pending: null };
  // 하위 폴더 포함 (remembered), the 전체/사진/문서 tab (reset per folder) and the campus the recent panel follows:
  // '' = the open folder's campus, 'all' = every readable campus, otherwise a campus id picked from the menu.
  const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preference is optional. */ } };
  state.deep = stored('library-deep') !== '0'; state.kind = ''; state.recentCampus = stored('library-recent-campus') || ''; state.recentAll = false; state.campuses = null;
  let enhancements;
  const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/data-core/work/library-browser.css?v=20261009-mock'; document.head.append(sheet);
  let imageCache=null, observer=null, recentObserver=null, imageGeneration=0;
  function clearImages() {
    window.DataCoreImageGallery.close('library');
    imageGeneration++;
    observer?.disconnect(); observer=null; imageCache?.clear(); imageCache=null;
    recentObserver?.disconnect(); recentObserver=null;
    for(const img of host.querySelectorAll('.lb-thumbnail img')){img.removeAttribute('src');img.hidden=true;img.parentElement.classList.remove('lb-image-ready');}
  }
  async function showImage(img,generation) {
    const source=img.dataset.thumbnail || img.dataset.original;
    for(const path of [...new Set([source,img.dataset.original])]) {
      try {
        const url=await imageCache.get(path);
        if(generation!==imageGeneration||!img.isConnected)return;
        // A display:none lazy image never starts decoding. Keep its reserved box visible but transparent until ready.
        img.hidden=false;img.src=url;await img.decode();
        if(generation!==imageGeneration||!img.isConnected)return;
        img.hidden=false;img.parentElement.classList.add('lb-image-ready');return;
      } catch(e) {img.hidden=true;if(e.name==='AbortError'||[401,403].includes(e.status)||generation!==imageGeneration)return;}
    }
    img.removeAttribute('src');img.hidden=true;img.parentElement.classList.add('lb-image-fallback');
  }
  function observeImages() {
    imageCache ||= new window.DataCorePrivateImageCache({onUnauthorized:clearImages});
    const generation=imageGeneration;
    if('IntersectionObserver' in window){
      observer ||= new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer?.unobserve(entry.target);void showImage(entry.target.querySelector('img'),generation);}},{rootMargin:'200px'});
      for(const node of host.querySelectorAll('.lb-thumbnail:not([data-observed])')){node.dataset.observed='true';observer.observe(node);}
    } else loadNearbyImages();
  }
  function loadNearbyImages() {
    if('IntersectionObserver' in window)return;
    for(const img of host.querySelectorAll('.lb-thumbnail img:not([data-started])')){
      const rect=img.parentElement.getBoundingClientRect();
      if(rect.top<innerHeight+400&&rect.bottom>-400){img.dataset.started='true';void showImage(img,imageGeneration);}
    }
  }
  window.addEventListener('scroll',loadNearbyImages,{passive:true});
  window.addEventListener('pagehide',clearImages);
  window.addEventListener('pageshow',e=>{if(e.persisted)void load();});
  document.addEventListener('click',e=>{if(e.target.closest('#logoutBtn'))clearImages();},true);
  host.innerHTML = `<header class="lb-heading"><div class="lb-head-text"><nav id="libraryBreadcrumb" aria-label="자료보관함 경로"></nav>
      <h2 id="libraryTitle" class="lb-visually-hidden" tabindex="-1">자료보관함</h2><small id="libraryPermission"></small></div>
    <div class="lb-toolbar">
      <button id="libraryNew" class="lb-button" hidden>${icon('Folder')}새 폴더</button>
      <button id="libraryUpload" class="lb-button lb-primary" hidden>${icon('Image')}파일 업로드</button>
      <button id="libraryDeleteFolder" class="lb-button lb-danger" hidden>폴더 삭제</button>
      <button id="libraryRenameFolder" class="lb-button" hidden>이름 변경</button>
      <button id="libraryArchived" class="lb-button" hidden>${icon('RotateCcw')}삭제한 기본 폴더</button>
      <button id="libraryRestoreFolder" class="lb-button" hidden>${icon('RotateCcw')}폴더 복원</button>
      <button id="libraryRefresh" class="lb-button lb-square" aria-label="새로고침" title="새로고침">${icon('RotateCcw')}</button>
    </div></header>
    <div class="lb-layout">
    <aside id="libraryTree" class="lb-tree" aria-label="폴더 목록"><h3>폴더</h3><ul data-tree></ul>
      <div class="lb-tree-foot"><p>🔒 MASTER는 모든 캠퍼스에, 캠퍼스 계정은 자기 캠퍼스에만 자료를 올리고 고칠 수 있습니다.</p><span id="libraryUsage" class="lb-usage" hidden></span></div></aside>
    <div class="lb-main">
    <form id="librarySearch" class="lb-search"><label for="libraryQuery" class="lb-visually-hidden">파일 검색</label>
      <span class="lb-search-box">${icon('Search')}<input id="libraryQuery" type="search" maxlength="120" placeholder="파일 이름·올린 사람 검색"></span>
      <button class="lb-visually-hidden" type="submit">검색</button>
      <label class="lb-deep"><input id="libraryDeep" type="checkbox">하위 폴더 포함</label></form>
    <div class="lb-tabs-row"><div id="libraryTabs" class="lb-tabs" role="group" aria-label="파일 종류"></div></div>
    <p id="libraryStatus" role="status"></p><div id="libraryContents" aria-busy="false"><div id="libraryFolders"></div><div id="libraryFiles"></div></div>
    <nav id="libraryPages" class="lb-toolbar" aria-label="파일 페이지"></nav>
    </div>
    <aside id="libraryRecent" class="lb-recent" aria-labelledby="libraryRecentTitle" hidden>
      <header class="lb-recent-head"><h3 id="libraryRecentTitle">최근 올린 파일</h3><div class="lb-recent-scope">
        <button type="button" id="libraryRecentCampus" aria-haspopup="true" aria-expanded="false">이 캠퍼스</button><span aria-hidden="true">·</span><button type="button" data-recent-all>전체</button>
        <div id="libraryRecentMenu" class="lb-recent-menu" hidden></div></div></header>
      <div id="libraryRecentPick" class="lb-recent-pick" hidden><input type="checkbox" checked data-recent-clear aria-label="선택 해제"><span></span><button type="button" class="lb-primary" data-recent-download-picked>${icon('Download')}<b>선택한 파일 받기</b></button></div>
      <p id="libraryRecentStatus" role="status"></p>
      <div id="libraryRecentList" class="lb-recent-list"></div>
      <p id="libraryRecentEmpty" hidden>최근 올린 파일이 없습니다.</p><p id="libraryRecentEnd"></p>
      <button type="button" id="libraryRecentMore" class="lb-recent-more" hidden>더 보기</button>
      <p class="lb-recent-note">파일을 누르면 크게 미리보고, 폴더 이름을 누르면 그 폴더로 이동합니다.</p></aside>
    </div>
    <input id="libraryFileInput" type="file" multiple hidden>
    <dialog id="libraryArchivedDialog" aria-labelledby="libraryArchivedTitle"><h3 id="libraryArchivedTitle">삭제한 기본 폴더</h3><div id="libraryArchivedList"></div><p id="libraryArchivedError" role="alert"></p><button type="button" data-lb-close>닫기</button></dialog>
    <dialog id="libraryFolderDialog" aria-labelledby="libraryFolderTitle"><form id="libraryFolderForm"><h3 id="libraryFolderTitle">새 폴더</h3>
      <label for="libraryFolderName">새 폴더 이름</label><input id="libraryFolderName" required maxlength="80" autocomplete="off">
      <p id="libraryFolderError" role="alert"></p><div class="lb-toolbar"><button type="button" data-lb-close>취소</button><button id="libraryCreate" class="lb-primary" type="submit">만들기</button></div></form></dialog>
    <dialog id="libraryDeleteDialog" aria-labelledby="libraryDeleteTitle"><h3 id="libraryDeleteTitle"></h3><p id="libraryDeleteName"></p><p id="libraryDeleteError" role="alert"></p>
      <div class="lb-toolbar"><button type="button" data-lb-close autofocus>취소</button><button id="libraryDeleteConfirm" class="lb-danger" type="button">휴지통으로 이동</button></div></dialog>
    <dialog id="libraryMoveDialog" aria-labelledby="libraryMoveTitle"><h3 id="libraryMoveTitle">파일 이동</h3><p id="libraryMovePath"></p><div id="libraryMoveFolders"></div><p id="libraryMoveError" role="alert"></p>
      <div class="lb-toolbar"><button type="button" data-lb-close>취소</button><button id="libraryMoveConfirm" type="button">이 폴더로 이동</button></div></dialog>
    <dialog id="libraryProgressDialog" aria-labelledby="libraryProgressTitle"><h3 id="libraryProgressTitle">파일 업로드</h3><p id="libraryProgressCount" role="status"></p>
      <progress id="libraryProgress" max="100" value="0"></progress><p id="libraryProgressCurrent"></p><ul id="libraryUploadErrors"></ul>
      <div class="lb-toolbar"><button id="libraryCancelUpload" type="button">업로드 취소</button><button id="libraryRetry" type="button" hidden>실패 파일 재시도</button><button id="libraryCloseProgress" type="button" hidden>닫기</button></div></dialog>`;
  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const body = await response.json();
    if (!response.ok) { if([401,403].includes(response.status))clearImages(); const e = new Error(body.error || '요청에 실패했습니다.'); e.status = response.status; throw e; }
    return body;
  }
  function presentation(folder) {
    return { title: folder.title };
  }
  function locationState() {
    const params = new URLSearchParams(location.search);
    return { id: params.get('folder') || 'root', q: params.get('q') || '', page: Math.max(1, Number(params.get('page')) || 1), sort:params.get('sort')||'newest', focusId:params.get('focusId')||'' };
  }
  function navigate(id, q = '', page = 1, focusId = '', sort = locationState().sort) {
    if (id !== locationState().id) state.kind = '';
    history.replaceState({...history.state,scrollY:window.scrollY},'');
    const url = new URL(href(id), location.origin);
    if (q) url.searchParams.set('q', q);
    if (page > 1) url.searchParams.set('page', String(page));
    if (sort!=='newest') url.searchParams.set('sort',sort);
    if (focusId) url.searchParams.set('focusId',focusId);
    history.pushState({ view: 'library' }, '', url.pathname + url.search);
    load(true);
  }
  function renderFolders(folders, q) {
    const groups = window.DataCoreLibraryClient.folderGroups({ folder: state.folder, folders }, q);
    $('libraryFolders').innerHTML = groups.map(([group, rows]) => `<section class="lb-folder-group">${state.folder?.id==='root'?`<h3>${h(group)}</h3>`:''}<div class="lb-folder-grid">${rows.map(f =>
      `<div class="lb-folder-item${f.canDelete ? ' lb-folder-editable' : ''}" data-library-folder="${h(f.id)}"><a class="lb-folder" href="${h(href(f.id))}" data-lb-folder="${h(f.id)}">${icon('Folder')}<div class="lb-folder-text"><strong>${window.DataCoreLibraryClient.nameMarkup(f.title)}</strong><small class="lb-folder-count">${h(countLabel(f))}</small></div></a>
      ${f.canDelete ? `<details class="lb-folder-menu"><summary aria-label="${h(f.title)} 폴더 메뉴" title="폴더 메뉴">${icon('Menu')}</summary><div>${f.canRename ? `<button type="button" data-lb-rename="${h(f.id)}">이름 변경</button>` : ''}<button type="button" data-lb-delete-folder="${h(f.id)}">폴더 삭제</button></div></details>` : ''}</div>`).join('')}</div></section>`).join('');
  }
  // Totals include every folder below (사진 = images, 문서 = everything else).
  function countLabel(f) {
    if (f.totalFiles == null) return '';
    const images = f.totalImages || 0, docs = f.totalFiles - images;
    return [images ? `사진 ${images}` : '', docs ? `문서 ${docs}` : ''].filter(Boolean).join(' · ') || (f.folderCount ? `폴더 ${f.folderCount}` : '비어 있음');
  }
  const shortDate = iso => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const md = `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}.${md}`; };
  function renderTabs(totals) {
    const show = state.folder && state.folder.id !== 'root' && (state.folder.category || state.deep);
    $('libraryTabs').hidden = !show; if (!show) return;
    const n = totals ? { '': totals.files, image: totals.images, doc: totals.files - totals.images } : {};
    $('libraryTabs').innerHTML = [['', '전체'], ['image', '사진'], ['doc', '문서']].map(([kind, label]) =>
      `<button type="button" data-lb-kind="${kind}" aria-pressed="${state.kind === kind}">${label}${n[kind] == null ? '' : ` <b>${h(n[kind])}</b>`}</button>`).join('');
  }
  function size(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes/1048576).toFixed(1)} MB` : `${(bytes/1073741824).toFixed(2)} GB`; }
  const opaquePreview = fileName => /\.(ai|psd|psb|clip|eps|zip)$/i.test(fileName || '');
  const imageFile = file => !opaquePreview(file.fileName) && /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimeType);
  function renderFiles(files) {
    const byDate = ['newest', 'oldest'].includes(locationState().sort);let month = '';
    $('libraryFiles').innerHTML = files.length ? `<ul class="lb-file-list">${files.map(f => {
      const d = new Date(f.createdAt), key = Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}년 ${d.getMonth()+1}월`;
      const heading = byDate && key && key !== month ? `<li class="lb-month"><h3>${h(key)}</h3></li>` : ''; if (byDate) month = key;
      const preview = true;
      const image = imageFile(f);
      const visual = image ? `<a class="lb-thumbnail" data-lb-image="${h(f.id)}" href="${h(f.previewUrl)}" target="_blank" rel="noopener" aria-label="${h(f.fileName)} 미리보기">${icon('Image')}<img hidden data-original="${h(f.previewUrl)}" data-thumbnail="${h(f.thumbnailUrl||'')}" alt="" width="112" height="84" loading="lazy" decoding="async"></a>` : icon('BookOpen');
      const where = f.folderId && f.folderId !== state.folder?.id ? `<small class="lb-file-where">${icon('Folder')}${h(f.folderTitle || '')}</small>` : '';
      return `${heading}<li class="lb-file" data-library-file="${h(f.id)}"><div class="lb-file-main">${visual}
        <div><strong>${window.DataCoreLibraryClient.nameMarkup(f.fileName)}</strong><small>${h([shortDate(f.createdAt),f.ownerName,size(f.sizeBytes)].filter(Boolean).join(' · '))}</small>${where}</div></div>
        <div class="lb-file-actions">${preview ? `<a class="lb-button" data-lb-preview="${h(f.id)}" href="${h(f.previewUrl)}" target="_blank" rel="noopener">미리보기</a>` : ''}
        <a class="lb-button" href="${h(f.downloadUrl)}" download>다운로드</a>${f.canMove ? `<button class="lb-button" data-lb-move="${h(f.id)}">이동</button>` : ''}${f.canDelete ? `<button class="lb-button lb-danger" data-lb-delete="${h(f.id)}">삭제</button>` : ''}</div></li>`;
    }).join('')}</ul>` : '';
    observeImages();
    enhancements?.render();
  }
  const pad = n => String(n).padStart(2,'0');
  function dayKey(iso) { const d=new Date(iso); return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function dayLabel(key) {
    const today=new Date(), yesterday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1);
    if(key===dayKey(today.toISOString()))return '오늘';
    const [y,m,d]=key.split('-').map(Number), date=new Date(y,m-1,d);
    if(key===dayKey(yesterday.toISOString()))return `어제 · ${m}월 ${d}일`;
    return `${y===today.getFullYear()?'':y+'년 '}${m}월 ${d}일 (${'일월화수목금토'[date.getDay()]})`;
  }
  // Long camera/KakaoTalk names keep their start and end so similar files stay distinguishable.
  const shortName = name => { const s=String(name||''); return s.length>24?`${s.slice(0,12)}…${s.slice(-10)}`:s; };
  function recentPlace(f,scope) {
    const crumbs=(f.path||[]).filter(p=>p.id!=='root'), rest=crumbs.slice(1);
    const parts=scope==='all'?[f.campusName||crumbs[0]?.title||'본원·조직 공통',rest.at(-1)?.title]:(rest.length?rest.slice(-2):crumbs.slice(-1)).map(p=>p.title);
    return parts.filter(Boolean).join(' › ')||f.folderTitle||'';
  }
  function renderRecent(files,scope) {
    state.recent=files.slice(0,50);state.recentCount=state.recent.length;state.picked.clear();
    $('libraryRecent').hidden = false;
    $('libraryRecentEmpty').hidden = files.length > 0;$('libraryRecentEmpty').textContent='최근 올린 파일이 없습니다.';
    const perDay=new Map();for(const f of state.recent){const k=dayKey(f.createdAt);perDay.set(k,(perDay.get(k)||0)+1);}
    const visible=state.recentAll?state.recent:state.recent.slice(0,10);
    $('libraryRecentMore').hidden=visible.length>=state.recent.length;$('libraryRecentMore').textContent=`더 보기 (${state.recent.length-visible.length}개)`;
    const groups=new Map();for(const f of visible){const k=dayKey(f.createdAt);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);}
    $('libraryRecentList').innerHTML=[...groups].map(([key,rows])=>`<section class="lb-recent-group"><div class="lb-recent-day"><strong>${h(dayLabel(key))}</strong><button type="button" data-recent-day="${h(key)}" aria-label="${h(dayLabel(key))} 파일 ${perDay.get(key)}개 모두 받기">${perDay.get(key)}개 · 모두 받기</button></div>${rows.map(f=>{
      const image=imageFile(f), time=new Date(f.createdAt), when=Number.isNaN(time.getTime())?'':`${pad(time.getHours())}:${pad(time.getMinutes())}`;
      const visual=image?`<a class="lb-thumbnail" data-lb-preview="${h(f.id)}" href="${h(f.previewUrl)}" aria-label="${h(f.fileName)} 미리보기">${icon('Image')}<img hidden alt="" width="56" height="42" loading="lazy" decoding="async" data-original="${h(f.previewUrl)}" data-thumbnail="${h(f.thumbnailUrl||'')}"></a>`
        :`<a class="lb-recent-doc" data-ext="${h((f.fileName.split('.').pop()||'').toUpperCase())}" data-lb-preview="${h(f.id)}" href="${h(f.previewUrl)}" aria-label="${h(f.fileName)} 미리보기">${h((f.fileName.split('.').pop()||'').slice(0,4).toUpperCase())}</a>`;
      return `<div class="lb-recent-row" data-recent-row="${h(f.id)}"><input type="checkbox" class="lb-pick" data-recent-pick="${h(f.id)}" aria-label="${h(f.fileName)} 선택">${visual}<div class="lb-recent-text"><a class="lb-recent-name" href="${h(f.previewUrl)}" data-lb-preview="${h(f.id)}" title="${h(f.fileName)}">${h(shortName(f.fileName))}</a><a class="lb-recent-folder" href="${h(href(f.folderId))}" data-lb-folder="${h(f.folderId)}" title="${h((f.path||[]).map(p=>p.title).join(' › '))}">${h(recentPlace(f,scope))}</a><small>${h([f.ownerName,when].filter(Boolean).join(' · '))}</small></div><a class="lb-recent-dl" href="${h(f.downloadUrl)}" download aria-label="${h(f.fileName)} 다운로드" title="다운로드">${icon('Download')}</a></div>`;
    }).join('')}</section>`).join('');
    $('libraryRecentEnd').textContent=state.recentAll&&state.recent.length>=50?'최근 올린 파일 50개까지 보여줍니다.':'';
    syncPicked();
    observeImages();
  }
  async function loadRecent(id, options) {
    // Newest uploads of the open folder's campus, of a campus picked in the menu, or of every readable campus.
    const picked=state.recentCampus&&state.recentCampus!=='all'?state.recentCampus:'';
    const scope=state.recentCampus==='all'||!picked&&!state.folder?.campusId?'all':'campus';
    const target=scope==='all'?'root':picked?`campus:${picked}`:id;
    const name=picked?(state.campuses?.find(c=>c.campusId===picked)?.title||'선택한 캠퍼스'):'이 캠퍼스';
    $('libraryRecentCampus').innerHTML=`${h(name)} <span aria-hidden="true">▾</span>`;
    $('libraryRecentCampus').setAttribute('aria-pressed',String(scope==='campus'));host.querySelector('[data-recent-all]').setAttribute('aria-pressed',String(scope==='all'));
    const generation=state.generation;
    $('libraryRecent').hidden=false;$('libraryRecentEnd').textContent='불러오는 중…';
    try { const result=await api(`/api/data-core/library/recent?folderId=${encodeURIComponent(target)}`, options);if(generation===state.generation)renderRecent(result.files,scope); }
    catch (e) { if (e.name !== 'AbortError' && generation===state.generation) {renderRecent([],scope);$('libraryRecentEmpty').textContent='최근 파일을 불러오지 못했습니다. 새로고침해주세요.';} }
  }
  let downloader=null;
  async function downloadRecent(files,name) {
    if(!files.length)return;
    const status=$('libraryRecentStatus');status.textContent='';
    try{downloader ||= await import('/data-core/work/library-download.js?v=20261009-mock');await downloader.downloadFiles(files,name,text=>{status.textContent=text;});}
    catch(e){status.textContent=e.message||'파일을 받지 못했습니다.';}
  }
  function syncPicked() {
    for(const box of host.querySelectorAll('[data-recent-pick]')){box.checked=state.picked.has(box.dataset.recentPick);box.closest('.lb-recent-row').classList.toggle('lb-picked',box.checked);}
    $('libraryRecentPick').hidden=!state.picked.size;$('libraryRecentPick').querySelector('span').textContent=`${state.picked.size}개 선택`;
    $('libraryRecentPick').querySelector('b').textContent=`선택한 ${state.picked.size}개 받기`;$('libraryRecentPick').querySelector('[data-recent-clear]').checked=true;
  }
  $('libraryRecent').addEventListener('change',e=>{
    if(e.target.closest('[data-recent-clear]')){state.picked.clear();syncPicked();return;}
    const box=e.target.closest('[data-recent-pick]');if(!box)return;if(box.checked)state.picked.add(box.dataset.recentPick);else state.picked.delete(box.dataset.recentPick);syncPicked();});
  const recentMenu=$('libraryRecentMenu');
  function closeRecentMenu(){recentMenu.hidden=true;$('libraryRecentCampus').setAttribute('aria-expanded','false');}
  function chooseRecent(value){state.recentCampus=value;remember('library-recent-campus',value);state.recentAll=false;closeRecentMenu();void loadRecent(state.folder?.id||'root',{});}
  async function openRecentMenu(){
    recentMenu.hidden=false;$('libraryRecentCampus').setAttribute('aria-expanded','true');recentMenu.textContent='불러오는 중…';
    try{state.campuses ||= (await api('/api/data-core/library/folders?counts=0&parentId=root')).folders.filter(f=>f.id.startsWith('campus:')&&!f.navigationHidden);}
    catch(e){recentMenu.textContent=e.message;return;}
    const here=state.folder?.campusId?state.campuses.find(c=>c.campusId===state.folder.campusId)?.title:'';
    recentMenu.innerHTML=(here?`<button type="button" data-recent-campus="" aria-pressed="${!state.recentCampus}">이 캠퍼스 (${h(here)})</button>`:'')
      +state.campuses.map(c=>`<button type="button" data-recent-campus="${h(c.campusId)}" aria-pressed="${state.recentCampus===c.campusId}">${h(c.title)}</button>`).join('')
      +`<button type="button" data-recent-campus="all" aria-pressed="${state.recentCampus==='all'}">전체 캠퍼스</button>`;
    recentMenu.querySelector('[aria-pressed=true]')?.focus();
  }
  document.addEventListener('click',e=>{if(!recentMenu.hidden&&!e.target.closest('.lb-recent-scope'))closeRecentMenu();});
  recentMenu.addEventListener('keydown',e=>{if(e.key==='Escape'){closeRecentMenu();$('libraryRecentCampus').focus();}});
  $('libraryRecent').addEventListener('click',e=>{
    if(e.target.closest('#libraryRecentCampus')){if(recentMenu.hidden)void openRecentMenu();else closeRecentMenu();return;}
    const pick=e.target.closest('[data-recent-campus]');if(pick){chooseRecent(pick.dataset.recentCampus);return;}
    if(e.target.closest('[data-recent-all]')){chooseRecent('all');return;}
    if(e.target.closest('#libraryRecentMore')){state.recentAll=true;renderRecent(state.recent,state.recentCampus==='all'?'all':'campus');return;}
    const day=e.target.closest('[data-recent-day]');
    if(day){const files=state.recent.filter(f=>dayKey(f.createdAt)===day.dataset.recentDay);void downloadRecent(files,`최근 파일_${day.dataset.recentDay}`);return;}
    if(e.target.closest('[data-recent-download-picked]')){void downloadRecent(state.recent.filter(f=>state.picked.has(f.id)),`최근 파일_${dayKey(new Date().toISOString())}`);return;}
  });
  async function load(focus = false) {
    clearImages();
    if (!/\/data-core\/work\/library\/?$/.test(location.pathname)) return;
    const generation = ++state.generation, current = locationState();
    state.controller?.abort(); state.controller = new AbortController();
    state.folder = null; state.folders = []; state.files = [];state.recent=[];state.recentCount=0;
    $('libraryPermission').textContent = '';
    $('libraryStatus').textContent = '불러오는 중…'; $('libraryContents').setAttribute('aria-busy','true');
    $('libraryFolders').replaceChildren(); $('libraryFiles').replaceChildren(); $('libraryPages').replaceChildren();
    $('libraryRecentList').replaceChildren(); $('libraryRecentEmpty').hidden = true; state.picked.clear(); syncPicked();
    for (const id of ['libraryNew','libraryUpload','libraryDeleteFolder','libraryRenameFolder','libraryArchived','libraryRestoreFolder']) $(id).hidden = true;
    $('libraryQuery').value = current.q; $('libraryDeep').checked = state.deep;
    try {
      const options = { signal: state.controller.signal };
      const { view, listing, redirected } = await window.DataCoreLibraryClient.browse(api, {...current, deep:state.deep, kind:state.kind}, options);
      if (generation !== state.generation) return;
      if(redirected){history.replaceState(null,'',href('root'));current.id='root';current.q='';current.page=1;}
      state.folder = view.folder; state.folders = view.folders; state.files = listing.files; state.breadcrumbs = view.breadcrumbs;
      current.page=listing.page||current.page;
      if(current.focusId){const url=new URL(location.href);url.searchParams.set('page',current.page);history.replaceState(history.state,'',url);}
      $('libraryTitle').textContent = presentation(view.folder).title;
      $('libraryPermission').textContent = view.folder.archived ? '삭제한 기본 폴더 · 원본 자료 보존 중' : view.folder.readOnly ? (view.folder.campusId?'다른 캠퍼스 자료 · 읽기 전용':'읽기·다운로드 가능') : '';
      $('libraryBreadcrumb').innerHTML = `<ol>${view.breadcrumbs.map((b,i) => `<li>${i === view.breadcrumbs.length-1 ? `<span aria-current="page">${h(presentation(b).title)}</span>` : `<a href="${h(href(b.id))}" data-lb-folder="${h(b.id)}">${h(presentation(b).title)}</a>`}</li>`).join('')}</ol>`;
      $('libraryNew').hidden = !view.folder.canWrite;
      $('libraryUpload').hidden = !view.folder.canWrite || !view.folder.category;
      $('libraryDeleteFolder').hidden = !view.folder.canDelete;
      $('libraryRenameFolder').hidden = !view.folder.canRename;
      $('libraryRestoreFolder').hidden = !view.folder.canRestore;
      $('libraryArchived').hidden = !view.folder.canWrite || !(view.folder.id.startsWith('campus:') || ['organization','hq'].includes(view.folder.id));
      renderFolders(view.folders, current.q); renderFiles(listing.files); renderTabs(listing.totals);
      $('libraryStatus').textContent = !listing.files.length && !$('libraryFolders').children.length ? (current.q ? '검색 결과가 없습니다.' : '이 폴더에 자료가 없습니다.') : '';
      if (current.page > 1 || listing.hasMore) $('libraryPages').innerHTML = `<button class="lb-button" data-lb-page="${current.page-1}" ${current.page===1?'disabled':''}>이전</button><span>${current.page} 페이지</span><button class="lb-button" data-lb-page="${current.page+1}" ${listing.hasMore?'':'disabled'}>다음</button>`;
      await loadRecent(current.id, options);
      if (generation !== state.generation) return;
      if (focus) $('libraryTitle').focus({ preventScroll: true });
      enhancements?.render();
      if(current.focusId){const card=[...host.querySelectorAll('[data-library-file]')].find(n=>n.dataset.libraryFile===current.focusId);if(card){card.classList.add('lb-located');card.tabIndex=-1;card.focus();card.scrollIntoView({block:'center'});}}
      else if(!focus&&history.state?.scrollY)window.scrollTo(0,history.state.scrollY);
    } catch (e) {
      if (e.name === 'AbortError' || generation !== state.generation) return;
      $('libraryTitle').textContent = '자료보관함';
      $('libraryBreadcrumb').innerHTML = `<a href="${href('root')}" data-lb-folder="root">자료보관함</a>`;
      $('libraryStatus').textContent = e.message; $('libraryRecent').hidden = true;
      if (e.status === 401) $('libraryStatus').innerHTML = `<a href="/data-core/login?next=${encodeURIComponent(location.pathname+location.search)}">교직원 로그인</a>`;
    } finally { if (generation === state.generation) $('libraryContents').setAttribute('aria-busy','false'); }
  }
  host.addEventListener('click', e => {
    const image = e.target.closest('[data-lb-image]');
    if (image && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) {
      e.preventDefault();
      const files=(image.closest('#libraryRecent')?state.recent.slice(0,state.recentCount):state.files).filter(imageFile);
      window.DataCoreImageGallery.open({scope:'library',title:state.folder.title,anchor:image,
        index:files.findIndex(f=>f.id===image.dataset.lbImage),
        items:files.map(f=>({title:f.fileName,previewSrc:imageCache.peek(f.thumbnailUrl||f.previewUrl)||f.thumbnailUrl,load:({priority})=>imageCache.get(f.previewUrl,{priority:priority!=='low'})}))});
    }
    const folder = e.target.closest('[data-lb-folder]');
    if (folder && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); folder.closest('dialog')?.close(); navigate(folder.dataset.lbFolder); }
    const page = e.target.closest('[data-lb-page]'); if (page && !page.disabled) { const s=locationState(); navigate(s.id,s.q,Number(page.dataset.lbPage)); }
    const remove = e.target.closest('[data-lb-delete]');
    if (remove) confirmDelete('file', [...state.files,...state.recent].find(f=>f.id===remove.dataset.lbDelete));
    const rename=e.target.closest('[data-lb-rename]');if(rename)editFolder(state.folders.find(f=>f.id===rename.dataset.lbRename));
    const move=e.target.closest('[data-lb-move]');if(move)void openMove([...state.files,...state.recent].find(f=>f.id===move.dataset.lbMove));
    const moveFolder=e.target.closest('[data-lb-move-folder]');if(moveFolder)void browseMove(moveFolder.dataset.lbMoveFolder);
    const removeFolder = e.target.closest('[data-lb-delete-folder]');
    if (removeFolder) { removeFolder.closest('details').open=false; confirmDelete('folder', state.folders.find(f=>f.id===removeFolder.dataset.lbDeleteFolder)); }
    if (e.target.closest('[data-lb-close]')) e.target.closest('dialog').close();
  });
  // Space complements the native Enter behavior of folder links.
  host.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.matches('[data-lb-folder]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') for (const menu of host.querySelectorAll('.lb-folder-menu[open]')) { menu.open=false; menu.querySelector('summary').focus(); }
  });
  document.addEventListener('click', e => { for (const menu of host.querySelectorAll('.lb-folder-menu[open]')) if (!menu.contains(e.target)) menu.open=false; });
  $('librarySearch').onsubmit = e => { e.preventDefault(); navigate(locationState().id,$('libraryQuery').value.trim()); };
  $('libraryDeep').onchange = () => { state.deep = $('libraryDeep').checked; remember('library-deep', state.deep ? '1' : '0'); const s = locationState(); navigate(s.id, s.q); };
  $('libraryTabs').addEventListener('click', e => { const tab = e.target.closest('[data-lb-kind]'); if (!tab) return; state.kind = tab.dataset.lbKind; const s = locationState(); navigate(s.id, s.q); });
  $('libraryRefresh').onclick = () => load();
  $('libraryArchived').onclick = async () => {
    const id=state.folder?.id;if(!id)return;
    $('libraryArchivedDialog').showModal();$('libraryArchivedList').textContent='불러오는 중…';$('libraryArchivedError').textContent='';
    try {
      const view=await api(`/api/data-core/library/folders?parentId=${encodeURIComponent(id)}&archived=1`);
      $('libraryArchivedList').innerHTML=view.folders.length?view.folders.map(f=>`<p><a class="lb-button" href="${h(href(f.id))}" data-lb-folder="${h(f.id)}">${icon('Folder')}${h(f.title)} · 자료 보기 / 복원</a></p>`).join(''):'삭제한 기본 폴더가 없습니다.';
    } catch(e){$('libraryArchivedList').textContent='';$('libraryArchivedError').textContent=e.message;}
  };
  $('libraryRestoreFolder').onclick = async () => {
    const id=state.folder?.id;if(!id)return;$('libraryRestoreFolder').disabled=true;
    try {await api(`/api/data-core/library/folders/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({restore:true})});await load();}
    catch(e){$('libraryStatus').textContent=e.message;}finally{$('libraryRestoreFolder').disabled=false;}
  };
  function editFolder(folder=null) { if (!state.folder?.canWrite) return; $('libraryFolderForm').reset();$('libraryFolderError').textContent='';$('libraryFolderDialog').dataset.parentId=state.folder.id;$('libraryFolderDialog').dataset.editId=folder?.id||'';$('libraryFolderName').value=folder?.title||'';$('libraryFolderTitle').textContent=folder?'폴더 이름 변경':'새 폴더 만들기';$('libraryCreate').textContent=folder?'저장':'만들기';$('libraryFolderDialog').showModal();$('libraryFolderName').focus(); }
  $('libraryNew').onclick=()=>editFolder();$('libraryRenameFolder').onclick=()=>editFolder(state.folder);
  $('libraryFolderForm').onsubmit = async e => {
    e.preventDefault(); $('libraryCreate').disabled=true;
    const editId=$('libraryFolderDialog').dataset.editId;
    try { await api('/api/data-core/library/folders'+(editId?'/'+encodeURIComponent(editId):''),{method:editId?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({parentFolderId:$('libraryFolderDialog').dataset.parentId,title:$('libraryFolderName').value.trim()})}); $('libraryFolderDialog').close(); await load(); }
    catch(e) { $('libraryFolderError').textContent=e.message; } finally { $('libraryCreate').disabled=false; }
  };
  function confirmDelete(kind, item) {
    if (!item) return;
    state.pending={kind,id:item.id}; $('libraryDeleteError').textContent='';
    $('libraryDeleteTitle').textContent=kind==='file'?'이 파일을 휴지통으로 이동하시겠습니까?':`"${item.title}" 폴더를 삭제하시겠습니까?`;
    $('libraryDeleteName').textContent=kind==='file'?item.fileName:item.defaultFolder?'기본 폴더를 목록에서 제거합니다. 원본 파일과 권한은 보존되며, 삭제한 기본 폴더에서 자료를 보거나 복원할 수 있습니다.':'폴더 안의 원본 파일은 삭제되지 않습니다. 상위 폴더 또는 미분류에서 다시 확인할 수 있습니다.';
    $('libraryDeleteConfirm').textContent=kind==='file'?'휴지통으로 이동':'폴더 삭제'; $('libraryDeleteDialog').showModal();
  }
  $('libraryDeleteFolder').onclick=()=>confirmDelete('folder',state.folder);
  $('libraryDeleteConfirm').onclick=async()=>{
    const pending=state.pending, parent=state.folder?.parentId; if(!pending)return;
    $('libraryDeleteConfirm').disabled=true;
    try { await api(`/api/data-core/library/${pending.kind==='file'?'files':'folders'}/${encodeURIComponent(pending.id)}`,{method:'DELETE'}); $('libraryDeleteDialog').close(); if(pending.kind==='folder'&&pending.id===state.folder.id)navigate(parent||'root');else await load(); }
    catch(e){$('libraryDeleteError').textContent=e.message;}finally{$('libraryDeleteConfirm').disabled=false;}
  };
  let moving=null, moveTarget=null, moveGeneration=0;
  async function openMove(file) { if(!file?.canMove)return;moving=file;moveTarget=null;$('libraryMoveDialog').showModal();await browseMove(file.folderId||state.folder.id); }
  async function browseMove(id) {
    const generation=++moveGeneration;$('libraryMoveConfirm').disabled=true;$('libraryMoveError').textContent='';
    try { const view=await api(`/api/data-core/library/folders?parentId=${encodeURIComponent(id)}`);if(generation!==moveGeneration)return;
      moveTarget=view.folder;$('libraryMovePath').textContent=view.breadcrumbs.map(b=>b.title).join(' > ');
      $('libraryMoveFolders').innerHTML=(view.folder.parentId?`<button data-lb-move-folder="${h(view.folder.parentId)}">${icon('ArrowLeft')}상위 폴더</button>`:'')+view.folders.filter(f=>f.canWrite).map(f=>`<button data-lb-move-folder="${h(f.id)}">${icon('Folder')}${window.DataCoreLibraryClient.nameMarkup(f.title)}</button>`).join('');
      $('libraryMoveConfirm').disabled=!view.folder.canWrite||!view.folder.category||view.folder.campusId!==moving.campusId;
    } catch(e){$('libraryMoveError').textContent=e.message;}
  }
  $('libraryMoveConfirm').onclick=async()=>{if(!moving||!moveTarget)return;$('libraryMoveConfirm').disabled=true;
    try{await api(`/api/data-core/library/files/${encodeURIComponent(moving.id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({folderId:moveTarget.id})});$('libraryMoveDialog').close();await load();}
    catch(e){$('libraryMoveError').textContent=e.message;}finally{$('libraryMoveConfirm').disabled=false;}
  };
  function progress(p) {
    $('libraryProgressCount').textContent=`${p.count}개 파일 · ${p.percent}% · 완료 ${p.success}개 · 실패 ${p.failed}개`;
    $('libraryProgress').value=p.percent;
    const active=p.currentItems?.[0];
    $('libraryProgressCurrent').textContent=active?`${active.name}\n${active.phase==='thumbnail'?'원본 저장 완료 · 미리보기 준비 중':`${size(active.loaded)} / ${size(active.total)}`}`:p.current;
    $('libraryProgressCurrent').style.whiteSpace='pre-line';
    $('libraryCancelUpload').hidden=!p.running; $('libraryCloseProgress').hidden=p.running; $('libraryRetry').hidden=p.running||!p.failed||p.cancelled;
    $('libraryUploadErrors').innerHTML=state.queue?.items.filter(i=>i.status==='failed').map(i=>`<li>${h(i.file.name)}: ${h(i.error)}</li>`).join('')||'';
  }
  async function run(retry=false){await state.queue.run(retry);await load();}
  $('libraryUpload').onclick=()=>{if(state.folder?.canWrite&&!state.queue?.running)$('libraryFileInput').click();};
  $('libraryFileInput').onchange=async()=>{
    const files=[...$('libraryFileInput').files]; if(!files.length||!state.folder?.canWrite)return;
    state.queue=new window.DataCoreUploadQueue(files,{recordId:state.folder.id,libraryScoped:true},progress,window.DataCoreLibraryThumbnail.send); $('libraryProgressDialog').showModal();
    await run(); $('libraryFileInput').value='';
  };
  $('libraryCancelUpload').onclick=()=>state.queue?.cancel(); $('libraryRetry').onclick=()=>run(true);
  $('libraryCloseProgress').onclick=()=>$('libraryProgressDialog').close();
  $('libraryProgressDialog').addEventListener('cancel',e=>{if(state.queue?.running)e.preventDefault();});
  // Close on a backdrop click only when the press also started on the backdrop: dragging to select the
  // folder name and letting go outside the window must not close it (a mouseup there counts as a click).
  for(const dialog of host.querySelectorAll('dialog')){
    let pressedOutside=false;
    const outside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',e=>{pressedOutside=e.target===dialog&&outside(e);});
    dialog.addEventListener('click',e=>{const close=pressedOutside&&e.target===dialog&&outside(e);pressedOutside=false;if(close&&dialog.id!=='libraryProgressDialog')dialog.close();});
  }
  window.DataCoreLibrary={refresh:load};
  import('/data-core/work/library-manager.js?v=20261009-mock').then(module=>{enhancements=module.setup({host,state,api,navigate,load,locationState,cachedOriginal:file=>imageCache?.peek(file.previewUrl)});enhancements.render();}).catch(()=>{$('libraryStatus').textContent='추가 파일 관리 기능을 불러오지 못했습니다. 새로고침해 주세요.';});
})();

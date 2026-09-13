(() => {
  if (window.DataCoreLibrary) return;
  const host = document.getElementById('libraryBrowser');
  if (!host) return;
  const $ = id => document.getElementById(id);
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg class="lb-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;
  const href = id => `/data-core/work/library${id === 'root' ? '' : `?folder=${encodeURIComponent(id)}`}`;
  const state = { folder: null, folders: [], files: [], breadcrumbs: [], controller: null, generation: 0, queue: null, pending: null };
  const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/data-core/work/library-browser.css?v=20260911-thumbnails'; document.head.append(sheet);
  let imageCache=null, observer=null, imageGeneration=0;
  function clearImages() {
    imageGeneration++;
    observer?.disconnect(); observer=null; imageCache?.clear();
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
    imageCache=new DataCorePrivateImageCache({onUnauthorized:clearImages});
    const generation=imageGeneration;
    if('IntersectionObserver' in window){
      observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer?.unobserve(entry.target);void showImage(entry.target.querySelector('img'),generation);}},{rootMargin:'400px'});
      for(const node of host.querySelectorAll('.lb-thumbnail'))observer.observe(node);
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
  host.innerHTML = `<nav id="libraryBreadcrumb" aria-label="자료보관함 경로"></nav>
    <header class="lb-heading"><div><h2 id="libraryTitle" tabindex="-1">자료보관함</h2><small id="libraryPermission"></small></div>
    <div class="lb-toolbar"><a id="libraryUp" class="lb-button" hidden>${icon('ArrowLeft')}상위 폴더</a>
      <button id="libraryNew" class="lb-button" hidden>${icon('Folder')}새 폴더</button>
      <button id="libraryUpload" class="lb-button lb-primary" hidden>${icon('Image')}파일 업로드</button>
      <button id="libraryDeleteFolder" class="lb-button lb-danger" hidden>폴더 삭제</button>
      <button id="libraryRefresh" class="lb-button lb-square" aria-label="새로고침" title="새로고침">${icon('RotateCcw')}</button>
    </div></header>
    <form id="librarySearch" class="lb-search"><label for="libraryQuery">현재 폴더 검색</label><input id="libraryQuery" type="search" maxlength="120"><button class="lb-button" type="submit">검색</button></form>
    <p id="libraryStatus" role="status"></p><div id="libraryContents" aria-busy="false"><div id="libraryFolders"></div><div id="libraryFiles"></div></div>
    <nav id="libraryPages" class="lb-toolbar" aria-label="파일 페이지"></nav>
    <input id="libraryFileInput" type="file" multiple hidden>
    <dialog id="libraryFolderDialog" aria-labelledby="libraryFolderTitle"><form id="libraryFolderForm"><h3 id="libraryFolderTitle">새 폴더</h3>
      <label for="libraryFolderName">새 폴더 이름</label><input id="libraryFolderName" required maxlength="80" autocomplete="off">
      <p id="libraryFolderError" role="alert"></p><div class="lb-toolbar"><button type="button" data-lb-close>취소</button><button id="libraryCreate" class="lb-primary" type="submit">만들기</button></div></form></dialog>
    <dialog id="libraryDeleteDialog" aria-labelledby="libraryDeleteTitle"><h3 id="libraryDeleteTitle"></h3><p id="libraryDeleteName"></p><p id="libraryDeleteError" role="alert"></p>
      <div class="lb-toolbar"><button type="button" data-lb-close autofocus>취소</button><button id="libraryDeleteConfirm" class="lb-danger" type="button">휴지통으로 이동</button></div></dialog>
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
    const code = folder.id.startsWith('campus:campus-') ? folder.id.slice('campus:campus-'.length) : '';
    const info = typeof CAMPUS_PRESENTATION !== 'undefined' && CAMPUS_PRESENTATION[code];
    return { title: info?.name || folder.title, group: folder.group || info?.group || '폴더', order: info?.order || 0 };
  }
  function locationState() {
    const params = new URLSearchParams(location.search);
    return { id: params.get('folder') || 'root', q: params.get('q') || '', page: Math.max(1, Number(params.get('page')) || 1) };
  }
  function navigate(id, q = '', page = 1) {
    const url = new URL(href(id), location.origin);
    if (q) url.searchParams.set('q', q);
    if (page > 1) url.searchParams.set('page', String(page));
    history.pushState({ view: 'library' }, '', url.pathname + url.search);
    load(true);
  }
  function renderFolders(folders, q) {
    const groups = new Map();
    folders.filter(f => !q || presentation(f).title.toLocaleLowerCase().includes(q.toLocaleLowerCase())).forEach(f => {
      const p = presentation(f), group = state.folder.id === 'root' ? p.group : '폴더';
      if (!groups.has(group)) groups.set(group, []); groups.get(group).push({ ...f, ...p });
    });
    $('libraryFolders').innerHTML = [...groups].map(([group, rows]) => `<section class="lb-folder-group"><h3>${h(group)}</h3><div class="lb-folder-grid">${rows.sort((a,b)=>a.order-b.order).map(f =>
      `<div class="lb-folder-item${f.canDelete && state.folder.id === 'root' ? ' lb-folder-editable' : ''}"><a class="lb-folder" href="${h(href(f.id))}" data-lb-folder="${h(f.id)}">${icon('Folder')}<strong>${h(f.title)}</strong></a>
      ${f.canDelete && state.folder.id === 'root' ? `<details class="lb-folder-menu"><summary aria-label="${h(f.title)} 폴더 메뉴" title="폴더 메뉴">${icon('Menu')}</summary><button type="button" data-lb-delete-folder="${h(f.id)}">폴더 삭제</button></details>` : ''}</div>`).join('')}</div></section>`).join('');
  }
  function size(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`; }
  function renderFiles(files) {
    $('libraryFiles').innerHTML = files.length ? `<ul class="lb-file-list">${files.map(f => {
      const preview = /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf|text\/plain)$/.test(f.mimeType);
      const image = /^image\/(jpeg|png|webp|gif|avif)$/.test(f.mimeType);
      const visual = image ? `<a class="lb-thumbnail" href="${h(f.previewUrl)}" target="_blank" rel="noopener" aria-label="${h(f.fileName)} 미리보기">${icon('Image')}<img hidden data-original="${h(f.previewUrl)}" data-thumbnail="${h(f.thumbnailUrl||'')}" alt="" width="112" height="84" loading="lazy" decoding="async"></a>` : icon('BookOpen');
      return `<li class="lb-file" data-library-file="${h(f.id)}"><div class="lb-file-main">${visual}
        <div><strong>${h(f.fileName)}</strong><small>${h(f.mimeType)} · ${h(size(f.sizeBytes))} · ${h(new Date(f.createdAt).toLocaleDateString('ko-KR'))}</small>
        <small>${h(state.breadcrumbs.find(b=>b.id.startsWith('campus:'))?.title || '본원·조직 공통')} · ${h(f.ownerName || '')}</small></div></div>
        <div class="lb-file-actions">${preview ? `<a class="lb-button" href="${h(f.previewUrl)}" target="_blank" rel="noopener">미리보기</a>` : ''}
        <a class="lb-button" href="${h(f.downloadUrl)}" download>다운로드</a>${f.canDelete ? `<button class="lb-button lb-danger" data-lb-delete="${h(f.id)}">삭제</button>` : ''}</div></li>`;
    }).join('')}</ul>` : '';
    observeImages();
  }
  async function load(focus = false) {
    clearImages();
    if (!/\/data-core\/work\/library\/?$/.test(location.pathname)) return;
    const generation = ++state.generation, current = locationState();
    state.controller?.abort(); state.controller = new AbortController();
    state.folder = null; state.folders = []; state.files = [];
    $('libraryUp').hidden = true; $('libraryPermission').textContent = '';
    $('libraryStatus').textContent = '불러오는 중…'; $('libraryContents').setAttribute('aria-busy','true');
    $('libraryFolders').replaceChildren(); $('libraryFiles').replaceChildren(); $('libraryPages').replaceChildren();
    for (const id of ['libraryNew','libraryUpload','libraryDeleteFolder']) $(id).hidden = true;
    $('libraryQuery').value = current.q;
    try {
      const options = { signal: state.controller.signal };
      const { view, listing } = await window.DataCoreLibraryClient.browse(api, current, options);
      if (generation !== state.generation) return;
      state.folder = view.folder; state.folders = view.folders; state.files = listing.files; state.breadcrumbs = view.breadcrumbs;
      $('libraryTitle').textContent = presentation(view.folder).title;
      $('libraryPermission').textContent = view.folder.readOnly ? '읽기·다운로드 가능' : '';
      $('libraryBreadcrumb').innerHTML = `<ol>${view.breadcrumbs.map((b,i) => `<li>${i === view.breadcrumbs.length-1 ? `<span aria-current="page">${h(presentation(b).title)}</span>` : `<a href="${h(href(b.id))}" data-lb-folder="${h(b.id)}">${h(presentation(b).title)}</a>`}</li>`).join('')}</ol>`;
      $('libraryUp').hidden = !view.folder.parentId; $('libraryUp').href = href(view.folder.parentId || 'root'); $('libraryUp').dataset.lbFolder = view.folder.parentId || 'root';
      $('libraryNew').hidden = !view.folder.canWrite;
      $('libraryUpload').hidden = !view.folder.canWrite || !view.folder.category;
      $('libraryDeleteFolder').hidden = !view.folder.canDelete;
      renderFolders(view.folders, current.q); renderFiles(listing.files);
      $('libraryStatus').textContent = !listing.files.length && !$('libraryFolders').children.length ? (current.q ? '검색 결과가 없습니다.' : '이 폴더에 자료가 없습니다.') : '';
      if (current.page > 1 || listing.hasMore) $('libraryPages').innerHTML = `<button class="lb-button" data-lb-page="${current.page-1}" ${current.page===1?'disabled':''}>이전</button><span>${current.page} 페이지</span><button class="lb-button" data-lb-page="${current.page+1}" ${listing.hasMore?'':'disabled'}>다음</button>`;
      if (focus) $('libraryTitle').focus({ preventScroll: true });
    } catch (e) {
      if (e.name === 'AbortError' || generation !== state.generation) return;
      $('libraryTitle').textContent = '자료보관함';
      $('libraryBreadcrumb').innerHTML = `<a href="${href('root')}" data-lb-folder="root">자료보관함</a>`;
      $('libraryStatus').textContent = e.message;
      if (e.status === 401) $('libraryStatus').innerHTML = `<a href="/data-core/login?next=${encodeURIComponent(location.pathname+location.search)}">교직원 로그인</a>`;
    } finally { if (generation === state.generation) $('libraryContents').setAttribute('aria-busy','false'); }
  }
  host.addEventListener('click', e => {
    const folder = e.target.closest('[data-lb-folder]');
    if (folder && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate(folder.dataset.lbFolder); }
    const page = e.target.closest('[data-lb-page]'); if (page && !page.disabled) { const s=locationState(); navigate(s.id,s.q,Number(page.dataset.lbPage)); }
    const remove = e.target.closest('[data-lb-delete]');
    if (remove) confirmDelete('file', state.files.find(f=>f.id===remove.dataset.lbDelete));
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
  $('libraryRefresh').onclick = () => load();
  $('libraryNew').onclick = () => { if (!state.folder?.canWrite) return; $('libraryFolderForm').reset(); $('libraryFolderError').textContent=''; $('libraryFolderDialog').dataset.parentId=state.folder.id; $('libraryFolderDialog').showModal(); $('libraryFolderName').focus(); };
  $('libraryFolderForm').onsubmit = async e => {
    e.preventDefault(); $('libraryCreate').disabled=true;
    try { await api('/api/data-core/library/folders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({parentFolderId:$('libraryFolderDialog').dataset.parentId,title:$('libraryFolderName').value.trim()})}); $('libraryFolderDialog').close(); await load(); }
    catch(e) { $('libraryFolderError').textContent=e.message; } finally { $('libraryCreate').disabled=false; }
  };
  function confirmDelete(kind, item) {
    if (!item) return;
    state.pending={kind,id:item.id}; $('libraryDeleteError').textContent='';
    $('libraryDeleteTitle').textContent=kind==='file'?'이 파일을 휴지통으로 이동하시겠습니까?':`"${item.title}" 폴더를 삭제하시겠습니까?`;
    $('libraryDeleteName').textContent=kind==='file'?item.fileName:'';
    $('libraryDeleteConfirm').textContent=kind==='file'?'휴지통으로 이동':'폴더 삭제'; $('libraryDeleteDialog').showModal();
  }
  $('libraryDeleteFolder').onclick=()=>confirmDelete('folder',state.folder);
  $('libraryDeleteConfirm').onclick=async()=>{
    const pending=state.pending, parent=state.folder?.parentId; if(!pending)return;
    $('libraryDeleteConfirm').disabled=true;
    try { await api(`/api/data-core/library/${pending.kind==='file'?'files':'folders'}/${encodeURIComponent(pending.id)}`,{method:'DELETE'}); $('libraryDeleteDialog').close(); if(pending.kind==='folder')navigate(parent||'root');else await load(); }
    catch(e){$('libraryDeleteError').textContent=e.message;}finally{$('libraryDeleteConfirm').disabled=false;}
  };
  function progress(p) {
    $('libraryProgressCount').textContent=`${p.count}개 파일 · ${p.percent}% · 완료 ${p.success}개 · 실패 ${p.failed}개`;
    $('libraryProgress').value=p.percent; $('libraryProgressCurrent').textContent=p.current;
    $('libraryCancelUpload').hidden=!p.running; $('libraryCloseProgress').hidden=p.running; $('libraryRetry').hidden=p.running||!p.failed||p.cancelled;
    $('libraryUploadErrors').innerHTML=state.queue?.items.filter(i=>i.status==='failed').map(i=>`<li>${h(i.file.name)}: ${h(i.error)}</li>`).join('')||'';
  }
  async function run(retry=false){await state.queue.run(retry);await load();}
  $('libraryUpload').onclick=()=>{if(state.folder?.canWrite&&!state.queue?.running)$('libraryFileInput').click();};
  $('libraryFileInput').onchange=async()=>{
    const files=[...$('libraryFileInput').files]; if(!files.length||!state.folder?.canWrite)return;
    state.queue=new DataCoreUploadQueue(files,{recordId:state.folder.id,libraryScoped:true},progress,DataCoreLibraryThumbnail.send); $('libraryProgressDialog').showModal();
    await run(); $('libraryFileInput').value='';
  };
  $('libraryCancelUpload').onclick=()=>state.queue?.cancel(); $('libraryRetry').onclick=()=>run(true);
  $('libraryCloseProgress').onclick=()=>$('libraryProgressDialog').close();
  $('libraryProgressDialog').addEventListener('cancel',e=>{if(state.queue?.running)e.preventDefault();});
  for(const dialog of host.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog&&dialog.id!=='libraryProgressDialog')dialog.close();});
  window.DataCoreLibrary={refresh:load};
})();

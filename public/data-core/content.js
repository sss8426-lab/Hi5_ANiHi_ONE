const state = {
  context: null,
  health: null,
  campuses: [],
  files: [],
  drafts: [],
  sourceApp: location.pathname.endsWith('/instagram') ? 'instagram' : 'blog',
  editingDraftId: null,
  selectedFileIds: [],
  selectedDerivedFileIds: [],
  knownFiles: new Map(),
  folderId: 'root',
  page: 1,
  browseGeneration: 0,
  defaultsGeneration: 0,
  busy: false,
  aiController: null,
  aiFile: null,
  aiSourceId: null,
};
const PHOTO_LIMIT = 6;

let derivativeEditor;

const $ = (id) => document.getElementById(id);

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === 'object' ? (body?.error || body?.message || '요청을 완료하지 못했습니다.') : '요청을 완료하지 못했습니다.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function toast(message, type = 'success') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function showNotice(message) {
  const el = $('globalNotice');
  if (!message) return el.classList.add('hidden');
  el.textContent = message;
  el.classList.remove('hidden');
}

function roleLabel(role) {
  return ({
    MASTER: '마스터 관리자', CAMPUS_ADMIN: '캠퍼스 관리자', SUPER_ADMIN: '마스터 관리자', CAMPUS_DIRECTOR: '캠퍼스 원장', TEACHER: '교사', STAFF: '직원'
  })[role] || role || '-';
}

function sourceLabel(source) {
  return source === 'instagram' ? '인스타그램' : '블로그';
}

function statusLabel(status) {
  return ({
    draft: '초안',
    review: '검토',
    ready: '게시 준비',
    published: '게시 완료',
    archived: '보관',
  })[status] || status || '초안';
}

function canWrite() {
  return Boolean(state.context?.canWrite);
}

function isSuperAdmin() {
  return Boolean(state.context?.isSuperAdmin);
}

function renderConnection() {
  const card = $('connectionCard');
  const health = state.health;
  if (health?.ok) {
    card.className = 'connection-card online';
    card.querySelector('strong').textContent = '중앙 저장소 연결됨';
    card.querySelector('small').textContent = 'D1 + R2 정상';
  } else {
    card.className = 'connection-card degraded';
    card.querySelector('strong').textContent = '일부 연결 필요';
    const db = health?.bindings?.database ? 'D1 정상' : 'D1 필요';
    const files = health?.bindings?.files ? 'R2 정상' : 'R2 필요';
    card.querySelector('small').textContent = `${db} · ${files}`;
  }
}

function renderUser() {
  const chip = $('userChip');
  const context = state.context;
  if (!context?.authenticated) {
    chip.querySelector('strong').textContent = '로그인이 필요합니다';
    chip.querySelector('small').textContent = 'DATA CORE 접근 불가';
    chip.querySelector('.avatar').textContent = '?';
    showNotice('DATA CORE를 사용하려면 로그인해야 합니다.');
    return;
  }
  const user = context.user || {};
  chip.querySelector('strong').textContent = context.memberships?.find(m => m.role === 'CAMPUS_ADMIN')?.campusName || user.displayName || user.email || '사용자';
  chip.querySelector('small').textContent = context.isSuperAdmin
    ? '마스터 관리자'
    : context.memberships?.length
      ? context.memberships.map((m) => `${m.campusName || '공통'} · ${roleLabel(m.role)}`).join(' / ')
      : '권한 미부여';
  chip.querySelector('.avatar').textContent = String(user.displayName || user.email || 'H').trim().slice(0, 1).toUpperCase();
  showNotice(context.canWrite ? '' : '로그인은 확인됐지만 DATA CORE 사용 권한이 아직 부여되지 않았습니다.');
  $('saveDraftBtn').disabled = !context.canWrite;
}

function fillCampusSelect(select, options = {}) {
  if (!select) return;
  const rows = [];
  if (options.all) rows.push('<option value="">전체 캠퍼스</option>');
  if (options.allowOrganization && isSuperAdmin()) rows.push('<option value="">조직 공통</option>');
  rows.push(...state.campuses.map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`));
  select.innerHTML = rows.join('');
}

function renderCampusSelectors() {
  fillCampusSelect($('draftCampus'), { allowOrganization: true });
}

function setSourceApp(sourceApp) {
  state.sourceApp = sourceApp === 'instagram' ? 'instagram' : 'blog';
  document.querySelectorAll('[data-source-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sourceTab === state.sourceApp);
  });
  document.querySelectorAll('[data-content-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.contentNav === state.sourceApp);
  });
  const pageTitle = state.sourceApp === 'instagram' ? '인스타 자동화' : '블로그 자동화';
  $('contentPageTitle').textContent = pageTitle;
  document.title = `${pageTitle} · HI5·ANiHi DATA CORE`;
  $('contentLabel').textContent = state.sourceApp === 'instagram' ? '캡션' : '본문';
  const instagram = state.sourceApp === 'instagram';
  $('draftContent').rows = instagram ? 5 : 12;
  $('commandLabel').textContent = instagram ? '어떤 느낌으로 편집할까요?' : '어떤 글을 만들까요?';
  $('aiCommand').placeholder = instagram ? '학생과 그림은 그대로 유지하고, 밝고 고급스러운 학원 홍보 이미지로 편집해줘.' : '고1 칸만화 수업 사진입니다. 인체와 장면 연출을 연습한 내용을 학부모가 이해하기 쉽게 작성해줘.';
  $('generateAi').textContent = instagram ? 'AI로 인스타 이미지 만들기' : 'AI로 블로그 글 작성';
  $('regenerateAi').textContent = instagram ? '다시 편집' : '다시 작성';
  $('copyContent').textContent = instagram ? '문구 복사' : '전체 복사';
  $('aiPrivacy').textContent = instagram ? 'AI 이미지 편집은 선택한 대표 사진 1장에 대해 실행됩니다.' : '선택한 사진과 입력한 명령만 OpenAI에 전송됩니다.';
  resetDraftForm(false);
}

function selectedFiles() {
  return state.selectedFileIds.map((id) => state.knownFiles.get(String(id)) || { id, fileName: '이전 작업 파일', mimeType: '' });
}

function renderSelectedFiles() {
  const rows = selectedFiles();
  derivativeEditor?.update(rows, state.sourceApp === 'instagram');
  $('selectedDerivatives').innerHTML = state.selectedDerivedFileIds.map((id) => {
    return `<div class="selected-file derived-selection"><img src="/api/data-core/files/${encodeURIComponent(id)}" alt="인스타 파생 이미지" width="64" height="80" loading="lazy" decoding="async"><div><strong>인스타 파생 이미지</strong><small>2160 × 2700px · 4:5</small></div><button class="ghost-btn" data-remove-derived="${h(id)}" type="button">제외</button></div>`;
  }).join('');
  $('selectedDerivatives').querySelectorAll('[data-remove-derived]').forEach((button) => {
    button.onclick = () => {
      state.selectedDerivedFileIds = state.selectedDerivedFileIds.filter((id) => id !== button.dataset.removeDerived);
      renderSelectedFiles(); renderFilePicker();
    };
  });
  $('photoCount').textContent = state.sourceApp === 'instagram' ? `대표 사진 ${rows.length}장 선택` : `사진 ${rows.length}장 선택`;
  $('selectedFiles').innerHTML = rows.map((file, index) => `<button data-remove-file="${h(file.id)}" type="button" aria-label="선택 사진 ${index + 1} 제외" title="선택 해제"><img src="${h(file.thumbnailUrl || file.previewUrl || '/api/data-core/files/' + encodeURIComponent(file.id))}" alt=""></button>`).join('');
  document.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.onclick = () => {
      if (state.busy) return;
      state.selectedFileIds = state.selectedFileIds.filter((id) => String(id) !== String(button.dataset.removeFile));
      renderSelectedFiles();
      renderFilePicker();
    };
  });
}

async function loadHealthAndContext() {
  const [healthResult, contextResult] = await Promise.allSettled([
    api('/api/data-core/health'),
    api('/api/data-core/context'),
  ]);
  state.health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  state.context = contextResult.status === 'fulfilled' ? contextResult.value : null;
  renderConnection();
  renderUser();
  if (!state.context?.authenticated) return;
  try {
    const response = await api('/api/data-core/campuses');
    state.campuses = response.campuses || [];
    renderCampusSelectors();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadFiles() {
  if (!state.context?.authenticated || state.busy) return;
  const token = ++state.browseGeneration;
  $('pickerStatus').textContent = '사진을 불러오고 있습니다.';
  try {
    const { view, listing } = await window.DataCoreLibraryClient.browse(api, { id: state.folderId, page: state.page, q: $('fileSearchInput').value.trim() });
    if (token !== state.browseGeneration) return;
    if (view.folder.campusId && $('draftCampus').value !== view.folder.campusId) {
      $('draftCampus').value = view.folder.campusId;
      resetDraftForm();
      void loadDefaults();
    }
    $('photoBreadcrumb').innerHTML = (view.breadcrumbs || []).map(item => `<button type="button" data-folder="${h(item.id)}">${h(item.title)}</button>`).join('<span aria-hidden="true">/</span>');
    $('photoFolders').innerHTML = (view.folders || []).map(folder => `<button type="button" data-folder="${h(folder.id)}"><svg aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Folder"></use></svg>${h(folder.title)}</button>`).join('');
    document.querySelectorAll('[data-folder]').forEach(button => { button.onclick = () => { if (state.busy) return; state.folderId = button.dataset.folder; state.page = 1; $('fileSearchInput').value = ''; void loadFiles(); }; });
    state.files = (listing.files || []).filter(file => ['image/jpeg','image/png','image/webp'].includes(file.mimeType));
    state.files.forEach((file) => state.knownFiles.set(String(file.id), file));
    $('pickerStatus').textContent = state.files.length ? '' : '이 폴더에 선택할 사진이 없습니다.';
    $('photoPages').innerHTML = `<button type="button" class="ghost-btn" id="photoPrev" ${state.page <= 1 ? 'disabled' : ''} aria-label="이전 사진 페이지">←</button><span>${state.page}</span><button type="button" class="ghost-btn" id="photoNext" ${listing.hasMore ? '' : 'disabled'} aria-label="다음 사진 페이지">→</button>`;
    $('photoPrev').onclick = () => { if (state.busy) return; state.page--; void loadFiles(); };
    $('photoNext').onclick = () => { if (state.busy) return; state.page++; void loadFiles(); };
    renderFilePicker();
    renderSelectedFiles();
  } catch (error) {
    if (token !== state.browseGeneration) return;
    state.files = []; renderFilePicker();
    $('pickerStatus').textContent = error.message;
    if ([401,403].includes(error.status)) { state.selectedFileIds = []; state.knownFiles.clear(); renderSelectedFiles(); }
  }
}

function renderFilePicker() {
  const list = $('filePickList');
  if (!state.files.length) {
    list.innerHTML = '';
    delete list.dataset.signature;
    return;
  }
  const signature = state.files.map(file => [file.id,file.thumbnailUrl,file.previewUrl].join(':')).join('|');
  if (list.dataset.signature === signature) {
    list.querySelectorAll('[data-pick-file]').forEach(button => {
      const selected = state.selectedFileIds.includes(button.dataset.pickFile);
      button.setAttribute('aria-pressed',String(selected));
      button.querySelector('.photo-check').textContent = selected ? '✓' : '';
    });
    return;
  }
  list.dataset.signature = signature;
  list.innerHTML = state.files.map((file, index) => {
    const selected = [...state.selectedFileIds, ...state.selectedDerivedFileIds].includes(String(file.id));
    return `<article class="photo-tile">
      <button data-pick-file="${h(file.id)}" type="button" aria-label="사진 ${index + 1} 선택" aria-pressed="${selected}">
        <img src="${h(file.thumbnailUrl || file.previewUrl)}" data-original="${h(file.previewUrl)}" alt="자료보관함 사진 ${index + 1}" loading="${index < 6 ? 'eager' : 'lazy'}" decoding="async">
        <span class="photo-check" aria-hidden="true">${selected ? '✓' : ''}</span>
      </button>
      <button class="photo-zoom" data-preview="${h(file.id)}" type="button" aria-label="사진 ${index + 1} 확대" title="확대"><svg><use href="/data-core/assets/core-icons.svg#Search"></use></svg></button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-pick-file]').forEach((button) => {
    button.onclick = () => {
      if (state.busy) return;
      const id = String(button.dataset.pickFile);
      if (state.selectedFileIds.includes(id)) state.selectedFileIds = state.selectedFileIds.filter(item => item !== id);
      else if (state.sourceApp === 'instagram') state.selectedFileIds = [id];
      else if (state.selectedFileIds.length >= PHOTO_LIMIT) return toast('AI가 분석할 사진을 조금 줄여주세요.', 'error');
      else state.selectedFileIds.push(id);
      renderFilePicker();
      renderSelectedFiles();
    };
  });
  list.querySelectorAll('img').forEach(img => { img.onerror = () => { if (img.src !== new URL(img.dataset.original, location.origin).href) img.src = img.dataset.original; }; });
  list.querySelectorAll('[data-preview]').forEach(button => { button.onclick = () => {
    const file = state.knownFiles.get(button.dataset.preview);
    $('photoViewerImage').src = file.previewUrl;
    $('photoViewer').showModal();
  }; });
}

function draftPayload() {
  return {
    sourceApp: state.sourceApp,
    campusId: $('draftCampus').value || null,
    title: $('draftTitle').value.trim(),
    summary: $('draftSummary').value.trim() || null,
    content: $('draftContent').value,
    contentPurpose: $('contentPurpose').value,
    publishStatus: $('publishStatus').value,
    relatedFileIds: state.selectedFileIds,
    derivedFileIds: state.selectedDerivedFileIds,
    tags: normalizedHashtags($('draftTags').value),
    metadata: { footer: $('resultFooter').value, callToAction: $('resultFooter').value || null },
  };
}

async function saveDraft(event) {
  event.preventDefault();
  if (!canWrite()) return toast('DATA CORE 쓰기 권한이 필요합니다.', 'error');
  const button = $('saveDraftBtn');
  button.disabled = true;
  button.textContent = state.editingDraftId ? '수정 중...' : '저장 중...';
  try {
    const payload = draftPayload();
    const url = state.editingDraftId
      ? `/api/data-core/content/${encodeURIComponent(state.editingDraftId)}`
      : '/api/data-core/content';
    const response = await api(url, {
      method: state.editingDraftId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast(`${sourceLabel(state.sourceApp)} 초안을 저장했습니다.`);
    state.editingDraftId = response.draft.id;
    $('newDraftBtn').classList.remove('hidden');
    await loadDrafts();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = !canWrite();
    button.textContent = '초안 저장';
  }
}

function resetDraftForm(clearSource = true) {
  state.editingDraftId = null;
  state.selectedFileIds = [];
  state.selectedDerivedFileIds = [];
  derivativeEditor?.reset();
  $('draftForm').reset();
  $('aiResult').hidden = true;
  $('aiImageResult').hidden = true;
  $('aiOutput').removeAttribute('src'); $('aiOriginal').removeAttribute('src');
  state.aiFile = null; state.aiSourceId = null;
  $('retryCaption').hidden = true;
  $('aiStatus').textContent = '';
  if (!clearSource) {
    $('publishStatus').value = 'draft';
    $('contentPurpose').value = 'class-story';
  }
  $('newDraftBtn').classList.add('hidden');
  $('deleteDraftBtn').classList.add('hidden');
  $('saveDraftBtn').textContent = '초안 저장';
  renderSelectedFiles();
  renderFilePicker();
}

function loadDraftIntoForm(draft) {
  if (state.busy) return;
  state.sourceApp = draft.sourceApp;
  setSourceApp(draft.sourceApp);
  state.editingDraftId = draft.id;
  const metadata = draft.metadata || {};
  $('draftCampus').value = draft.campusId || '';
  $('contentPurpose').value = metadata.contentPurpose || 'class-story';
  $('draftTitle').value = draft.title || '';
  $('draftSummary').value = draft.summary || '';
  $('draftContent').value = draft.content || '';
  $('draftTags').value = (draft.tags || []).join(', ');
  $('publishStatus').value = metadata.publishStatus || 'draft';
  $('resultFooter').value = metadata.footer || metadata.callToAction || '';
  state.selectedFileIds = Array.isArray(metadata.relatedFileIds) ? metadata.relatedFileIds.map(String) : [];
  state.selectedDerivedFileIds = Array.isArray(metadata.derivedFileIds) ? metadata.derivedFileIds.map(String) : [];
  $('newDraftBtn').classList.remove('hidden');
  $('deleteDraftBtn').classList.remove('hidden');
  $('saveDraftBtn').textContent = '초안 수정';
  $('aiResult').hidden = false;
  $('resultHeading').textContent = '지난 작업';
  state.folderId = draft.campusId ? 'campus:' + draft.campusId : 'root';
  void loadDefaults(); void loadFiles();
  renderSelectedFiles();
  renderFilePicker();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadDrafts() {
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams({ sourceApp: state.sourceApp, limit: '100' });
  const q = $('draftSearchInput')?.value.trim();
  const status = $('draftStatusFilter')?.value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  try {
    const response = await api(`/api/data-core/content?${params}`);
    state.drafts = response.drafts || [];
    renderDrafts();
  } catch (error) {
    $('draftList').innerHTML = `<div class="empty-state">${h(error.message)}</div>`;
  }
}

function renderDrafts() {
  const list = $('draftList');
  if (!state.drafts.length) {
    list.innerHTML = '<div class="empty-state">저장된 초안이 없습니다.</div>';
    return;
  }
  list.innerHTML = state.drafts.map((draft) => {
    const metadata = draft.metadata || {};
    const files = (metadata.relatedFileIds?.length || 0) + (metadata.derivedFileIds?.length || 0);
    const snippet = draft.content || draft.summary || '';
    return `<article class="draft-card">
      <div>
        <strong>${h(draft.title)}</strong>
        <small>${h(draft.campusName || '조직 공통')} · ${h(sourceLabel(draft.sourceApp))}</small>
        <p>${h(snippet.slice(0, 180))}</p>
        <div class="draft-meta">
          <span class="pill">${h(statusLabel(metadata.publishStatus))}</span>
          <span class="pill">파일 ${files}개</span>
          ${(draft.tags || []).slice(0, 5).map((tag) => `<span class="pill">#${h(tag)}</span>`).join('')}
        </div>
      </div>
      <button class="ghost-btn" data-open-draft="${h(draft.id)}" type="button">열기</button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-open-draft]').forEach((button) => {
    button.onclick = () => {
      const draft = state.drafts.find((item) => String(item.id) === String(button.dataset.openDraft));
      if (draft) loadDraftIntoForm(draft);
    };
  });
}

async function deleteDraft() {
  if (!state.editingDraftId) return;
  if (!confirm('이 콘텐츠 초안을 삭제할까요?')) return;
  try {
    await api(`/api/data-core/content/${encodeURIComponent(state.editingDraftId)}`, { method: 'DELETE' });
    toast('콘텐츠 초안을 삭제했습니다.');
    resetDraftForm();
    await loadDrafts();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('[data-source-tab]').forEach((button) => {
    button.onclick = () => setSourceApp(button.dataset.sourceTab);
  });
  $('draftForm').onsubmit = saveDraft;
  $('newDraftBtn').onclick = () => resetDraftForm();
  $('deleteDraftBtn').onclick = deleteDraft;
  $('clearFilesBtn').onclick = () => {
    if (state.busy) return;
    state.selectedFileIds = [];
    renderSelectedFiles();
    renderFilePicker();
  };
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('draftCampus').onchange = () => {
    resetDraftForm();
    state.selectedFileIds = []; state.selectedDerivedFileIds = [];
    state.folderId = $('draftCampus').value ? 'campus:' + $('draftCampus').value : 'root'; state.page = 1;
    renderSelectedFiles(); void loadFiles(); void loadDefaults();
  };
  $('refreshDraftsBtn').onclick = loadDrafts;
  $('draftStatusFilter').onchange = loadDrafts;
  $('draftSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadDrafts(); };
  $('pastWork').ontoggle = () => { if ($('pastWork').open) void loadDrafts(); };
  $('saveDefaults').onclick = saveDefaults;
  $('generateAi').onclick = () => runAi();
  $('regenerateAi').onclick = () => runAi();
  $('retryCaption').onclick = () => runAi(true);
  $('cancelAi').onclick = () => state.aiController?.abort();
  $('copyContent').onclick = copyContent;
  $('manualDraft').onclick = () => { $('aiResult').hidden = false; $('resultHeading').textContent = '작성 결과'; $('resultFooter').value = $('defaultFooter').value; };
  $('compareImage').onclick = () => {
    const visible = !$('aiOriginalFigure').hidden;
    $('aiOriginalFigure').hidden = visible; $('compareImage').setAttribute('aria-pressed', String(!visible));
    if (!visible && state.aiSourceId) $('aiOriginal').src = '/api/data-core/files/' + encodeURIComponent(state.aiSourceId);
  };
  $('downloadImage').onclick = downloadImage;
  $('closePhotoViewer').onclick = () => $('photoViewer').close();
  $('photoViewer').onclose = () => $('photoViewerImage').removeAttribute('src');
  const clearPrivateImages = () => {
    state.aiController?.abort(); state.knownFiles.clear();
    document.querySelectorAll('.content-workspace img, #photoViewerImage').forEach(img => img.removeAttribute('src'));
  };
  window.addEventListener('pagehide', clearPrivateImages);
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('click', event => { if (event.target.closest('#logoutBtn')) clearPrivateImages(); }, true);
  $('clearFilesBtn').addEventListener('click', () => { if (!state.busy) renderSelectedFiles(); });
}

function normalizedHashtags(...values) {
  return [...new Set(values.flat().flatMap(value => String(value || '').split(/[\s,#]+/)).map(value => value.trim()).filter(Boolean))].slice(0,30);
}

async function loadDefaults() {
  const token = ++state.defaultsGeneration;
  $('defaultHashtags').value = ''; $('defaultFooter').value = '';
  $('defaultsStatus').textContent = '';
  try {
    const params = new URLSearchParams({ sourceApp: state.sourceApp, campusId: $('draftCampus').value });
    const result = await api('/api/data-core/content/defaults?' + params);
    if (token !== state.defaultsGeneration) return;
    $('defaultHashtags').value = result.defaults.hashtags; $('defaultFooter').value = result.defaults.footer;
  } catch (error) { if (token === state.defaultsGeneration) $('defaultsStatus').textContent = error.message; }
}

async function saveDefaults() {
  $('saveDefaults').disabled = true;
  const token = state.defaultsGeneration;
  try {
    await api('/api/data-core/content/defaults', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceApp: state.sourceApp, campusId: $('draftCampus').value || null, hashtags: $('defaultHashtags').value, footer: $('defaultFooter').value }) });
    if (token === state.defaultsGeneration) $('defaultsStatus').textContent = '기본 문구가 저장되었습니다.';
  } catch (error) { if (token === state.defaultsGeneration) $('defaultsStatus').textContent = error.message; }
  finally { $('saveDefaults').disabled = !canWrite(); }
}

async function loadAiStatus() {
  if (!isSuperAdmin()) return;
  $('aiDiagnostics').hidden = false;
  try {
    const status = await api('/api/data-core/content/ai-status');
    $('aiDiagnosticStatus').textContent = `API key: ${status.configured ? '설정됨' : '설정 필요'} · Text: ${status.models.text} · Image: ${status.models.image}`;
  } catch { $('aiDiagnosticStatus').textContent = '연결 설정을 확인할 수 없습니다.'; }
}

function setAiBusy(busy) {
  state.busy = busy;
  $('manualWork').inert = busy;
  $('pastWork').inert = busy;
  for (const id of ['generateAi','regenerateAi','draftCampus','saveDraftBtn','newDraftBtn','deleteDraftBtn','manualDraft','clearFilesBtn','makeInstagramImage','saveDerivative']) $(id).disabled = busy || !canWrite();
  $('cancelAi').hidden = !busy;
  $('aiStatus').classList.toggle('busy', busy);
  if (!busy) derivativeEditor?.update(selectedFiles(), state.sourceApp === 'instagram');
}

async function runAi(captionOnly = false) {
  if (state.busy || !canWrite()) return;
  const ids = captionOnly && state.aiSourceId ? [state.aiSourceId] : [...state.selectedFileIds], direction = $('aiCommand').value.trim();
  const instagram = state.sourceApp === 'instagram';
  if (!ids.length || (instagram && ids.length !== 1)) return toast('사용할 사진을 선택하세요.', 'error');
  if (!direction) return toast('원하는 내용을 입력해주세요.', 'error');
  const campusId = $('draftCampus').value || null, sourceApp = state.sourceApp;
  state.aiController = new AbortController();
  state.browseGeneration++;
  const signal = state.aiController.signal, timer = setTimeout(() => state.aiController?.abort(), instagram ? 290000 : 100000);
  setAiBusy(true);
  $('retryCaption').hidden = true;
  $('aiStatus').textContent = captionOnly ? '홍보 문구를 작성하고 있습니다…' : instagram ? '사진을 분석하고 홍보 이미지를 편집하고 있습니다…' : '사진을 살펴보고 글을 작성하고 있습니다…';
  let imageSaved = false;
  const post = (path, body) => api('/api/data-core/content/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ ...body, sourceApp, campusId, requestId: crypto.randomUUID() }) });
  try {
    if (instagram && !captionOnly) {
      const result = await post('image-edit', { sourceFileId: ids[0], direction });
      state.aiFile = result.file; state.aiSourceId = ids[0]; state.selectedDerivedFileIds = [result.file.id];
      state.knownFiles.set(result.file.id, result.file); imageSaved = true;
      $('aiImageResult').hidden = false; $('aiResult').hidden = false;
      $('resultHeading').textContent = '인스타 결과';
      $('aiOutput').src = result.file.downloadUrl;
      $('aiOriginalFigure').hidden = true; $('compareImage').setAttribute('aria-pressed','false');
      $('aiImageSaved').textContent = '저장 완료 · 2160 × 2700px · 4:5';
      $('draftTitle').value = '인스타 홍보 이미지';
      $('draftContent').value = ''; $('draftTags').value = $('defaultHashtags').value;
      $('resultFooter').value = $('defaultFooter').value;
      renderSelectedFiles();
      $('aiStatus').textContent = '이미지가 저장되었습니다. 홍보 문구를 작성하고 있습니다…';
    }
    const result = await post('generate', { selectedFileIds: ids, notes: direction });
    const generated = result.generated;
    $('draftTitle').value = generated.title;
    $('draftContent').value = generated.body || generated.content;
    $('draftTags').value = normalizedHashtags($('defaultHashtags').value, generated.hashtags || generated.keywords).map(tag => '#' + tag).join(' ');
    $('resultFooter').value = $('defaultFooter').value || generated.cta || generated.callToAction || '';
    $('aiResult').hidden = false;
    $('resultHeading').textContent = instagram ? '인스타 결과' : 'AI 작성 결과';
    $('aiStatus').textContent = '작성이 완료되었습니다.';
  } catch (error) {
    const message = error.name === 'AbortError' ? '대기를 중단했습니다. 이미 전송된 AI 작업은 과금되거나 저장될 수 있습니다.' : error.message;
    $('aiStatus').textContent = imageSaved ? '이미지는 저장되었습니다. 홍보 문구는 작성하지 못했습니다. 직접 작성하거나 다시 시도해주세요.' : message;
    $('retryCaption').hidden = !(imageSaved || captionOnly);
  } finally { clearTimeout(timer); setAiBusy(false); state.aiController = null; }
}

async function copyContent() {
  const text = [state.sourceApp === 'blog' ? $('draftTitle').value : '', $('draftContent').value, $('draftTags').value, $('resultFooter').value].filter(Boolean).join('\n\n');
  try { await navigator.clipboard.writeText(text); toast('복사했습니다.'); }
  catch { toast('클립보드 권한을 확인해주세요.', 'error'); }
}

async function downloadImage() {
  if (!state.aiFile) return;
  $('downloadImage').disabled = true;
  let objectUrl;
  try {
    const response = await fetch('/api/data-core/files/' + encodeURIComponent(state.aiFile.id), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('이미지를 다운로드할 수 없습니다.');
    objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = objectUrl; link.download = 'instagram-4x5.png';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  } catch (error) { if (objectUrl) URL.revokeObjectURL(objectUrl); toast(error.message, 'error'); }
  finally { $('downloadImage').disabled = false; }
}

async function init() {
  derivativeEditor = window.HI5InstagramDerivative.mount({
    canWrite,
    onError: (message) => toast(message, 'error'),
    onSaved: (file) => {
      state.knownFiles.set(String(file.id), file);
      state.files.unshift(file);
      state.selectedDerivedFileIds.push(String(file.id));
      $('aiResult').hidden = false;
      $('resultHeading').textContent = '작성 결과';
      renderSelectedFiles(); renderFilePicker();
    },
  });
  bindEvents();
  setSourceApp(state.sourceApp);
  await loadHealthAndContext();
  renderCampusSelectors();
  renderSelectedFiles();
  if (state.context?.authenticated) {
    state.folderId = $('draftCampus').value ? 'campus:' + $('draftCampus').value : 'root';
    await Promise.all([loadFiles(), loadDefaults(), loadAiStatus()]);
  }
}

init().catch((error) => {
  showNotice(error.status === 401 ? '로그인이 필요합니다.' : '자동화 작업실을 시작하지 못했습니다. 새로고침해주세요.');
});

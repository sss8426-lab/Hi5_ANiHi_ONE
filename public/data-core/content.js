const state = {
  context: null,
  health: null,
  campuses: [],
  files: [],
  drafts: [],
  sourceApp: location.pathname.endsWith('/instagram') ? 'instagram' : 'blog',
  editingDraftId: null,
  selectedFileIds: [],
};

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
    const message = typeof body === 'object' && body?.error ? body.error : String(body || `HTTP ${response.status}`);
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
    SUPER_ADMIN: '마스터 관리자', CAMPUS_DIRECTOR: '캠퍼스 원장', TEACHER: '교사', STAFF: '직원'
  })[role] || role || '-';
}

function categoryLabel(category) {
  return ({
    'student-artwork': '학생작품',
    'class-photo': '수업사진',
    'academy-photo': '학원사진',
    'competition-poster': '공모전 포스터',
    'competition-guide': '공모전 요강',
    'award-work': '수상작',
    'admission-guide': '입시요강',
    'research-work': '연구작',
    document: '문서',
  })[category] || category || '기타';
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
  chip.querySelector('strong').textContent = user.displayName || user.email || '사용자';
  chip.querySelector('small').textContent = context.isSuperAdmin
    ? '마스터 관리자'
    : context.memberships?.length
      ? context.memberships.map((m) => `${m.campusName || '공통'} · ${roleLabel(m.role)}`).join(' / ')
      : '권한 미부여';
  chip.querySelector('.avatar').textContent = String(user.displayName || user.email || 'H').trim().slice(0, 1).toUpperCase();
  showNotice(context.canWrite ? '' : '로그인은 확인됐지만 DATA CORE 사용 권한이 아직 부여되지 않았습니다.');
  $('saveDraftBtn').disabled = !context.canWrite;
  document.querySelectorAll('[data-admin-nav]').forEach((link) => {
    link.classList.toggle('hidden', !isSuperAdmin());
  });
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
  fillCampusSelect($('fileCampusFilter'), { all: true });
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
  $('contentHeroTitle').textContent = pageTitle;
  document.title = `${pageTitle} · HI5·ANiHi DATA CORE`;
  $('editorTitle').textContent = `${sourceLabel(state.sourceApp)} 초안`;
  $('editorHint').textContent = state.sourceApp === 'instagram'
    ? '같은 DATA CORE 원본 사진을 고르고 캡션과 해시태그를 남깁니다.'
    : '수업 흐름, 피드백, 성장 포인트를 본문으로 남깁니다.';
  $('contentLabel').textContent = state.sourceApp === 'instagram' ? '캡션' : '본문';
  $('instagramSpec').classList.toggle('hidden', state.sourceApp !== 'instagram');
  resetDraftForm(false);
  renderDraftPreview();
  loadDrafts();
}

function selectedFiles() {
  const map = new Map(state.files.map((file) => [String(file.id), file]));
  return state.selectedFileIds.map((id) => map.get(String(id)) || { id, fileName: id });
}

function renderSelectedFiles() {
  const rows = selectedFiles();
  $('selectedFiles').innerHTML = rows.length ? rows.map((file) => `<div class="selected-file">
    <div>
      <strong>${h(file.fileName || file.id)}</strong>
      <small>${h(file.campusName || '조직 공통')} · ${h(categoryLabel(file.category))}</small>
    </div>
    <button class="ghost-btn" data-remove-file="${h(file.id)}" type="button">제외</button>
  </div>`).join('') : '<div class="empty-state">아직 연결한 파일이 없습니다.</div>';
  document.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.onclick = () => {
      state.selectedFileIds = state.selectedFileIds.filter((id) => String(id) !== String(button.dataset.removeFile));
      renderSelectedFiles();
      renderFilePicker();
    };
  });
}

function renderDraftPreview() {
  const source = sourceLabel(state.sourceApp);
  const title = $('draftTitle').value.trim();
  const summary = $('draftSummary').value.trim();
  const content = $('draftContent').value.trim();
  const cta = $('draftCta').value.trim();
  const tags = $('draftTags').value.split(',').map((item) => item.trim()).filter(Boolean);
  $('previewSource').textContent = state.sourceApp === 'instagram' ? '인스타 2160 × 2700px · 4:5' : `${source} 초안`;
  $('previewDraftTitle').textContent = title || '제목을 입력하면 미리보기에 표시됩니다.';
  $('previewDraftSummary').textContent = summary || '요약과 본문, 키워드, CTA를 확인한 뒤 같은 화면에서 수정할 수 있습니다.';
  $('previewDraftContent').textContent = content;
  $('previewDraftCta').textContent = cta ? `CTA · ${cta}` : '';
  $('previewDraftTags').innerHTML = tags.map((tag) => `<span>#${h(tag)}</span>`).join('');
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
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams({ limit: '100' });
  const campusId = $('fileCampusFilter').value;
  const category = $('fileCategoryFilter').value;
  const q = $('fileSearchInput').value.trim();
  if (campusId) params.set('campusId', campusId);
  if (category) params.set('category', category);
  if (q) params.set('q', q);
  try {
    const response = await api(`/api/data-core/files?${params}`);
    state.files = response.files || [];
    renderFilePicker();
    renderSelectedFiles();
  } catch (error) {
    $('filePickList').innerHTML = `<div class="empty-state">${h(error.message)}</div>`;
  }
}

function renderFilePicker() {
  const list = $('filePickList');
  if (!state.files.length) {
    list.innerHTML = '<div class="empty-state">조건에 맞는 파일이 없습니다.</div>';
    return;
  }
  list.innerHTML = state.files.map((file) => {
    const selected = state.selectedFileIds.includes(String(file.id));
    return `<article class="file-pick-item">
      <div>
        <strong>${h(file.fileName)}</strong>
        <small>${h(file.campusName || '조직 공통')}</small>
        <div class="file-pick-meta">
          <span class="pill">${h(categoryLabel(file.category))}</span>
          <span class="pill">${h(file.sourceApp || 'legacy')}</span>
        </div>
      </div>
      <button class="${selected ? 'secondary-btn' : 'ghost-btn'}" data-pick-file="${h(file.id)}" type="button">${selected ? '선택됨' : '연결'}</button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-pick-file]').forEach((button) => {
    button.onclick = () => {
      const id = String(button.dataset.pickFile);
      state.selectedFileIds = state.selectedFileIds.includes(id)
        ? state.selectedFileIds.filter((item) => item !== id)
        : [...state.selectedFileIds, id];
      renderFilePicker();
      renderSelectedFiles();
    };
  });
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
    tags: $('draftTags').value.split(',').map((item) => item.trim()).filter(Boolean),
    metadata: { callToAction: $('draftCta').value.trim() || null },
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
    await api(url, {
      method: state.editingDraftId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast(`${sourceLabel(state.sourceApp)} 초안을 저장했습니다.`);
    resetDraftForm();
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
  $('draftForm').reset();
  if (!clearSource) {
    $('publishStatus').value = 'draft';
    $('contentPurpose').value = 'class-story';
  }
  $('newDraftBtn').classList.add('hidden');
  $('deleteDraftBtn').classList.add('hidden');
  $('saveDraftBtn').textContent = '초안 저장';
  renderSelectedFiles();
  renderFilePicker();
  renderDraftPreview();
}

function loadDraftIntoForm(draft) {
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
  $('draftCta').value = metadata.callToAction || '';
  $('publishStatus').value = metadata.publishStatus || 'draft';
  state.selectedFileIds = Array.isArray(metadata.relatedFileIds) ? metadata.relatedFileIds.map(String) : [];
  $('newDraftBtn').classList.remove('hidden');
  $('deleteDraftBtn').classList.remove('hidden');
  $('saveDraftBtn').textContent = '초안 수정';
  renderSelectedFiles();
  renderFilePicker();
  renderDraftPreview();
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
    const files = Array.isArray(metadata.relatedFileIds) ? metadata.relatedFileIds.length : 0;
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
    state.selectedFileIds = [];
    renderSelectedFiles();
    renderFilePicker();
  };
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('fileCampusFilter').onchange = loadFiles;
  $('fileCategoryFilter').onchange = loadFiles;
  $('refreshDraftsBtn').onclick = loadDrafts;
  $('draftStatusFilter').onchange = loadDrafts;
  $('draftSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadDrafts(); };
  ['draftTitle', 'draftSummary', 'draftContent', 'draftTags', 'draftCta'].forEach((id) => {
    $(id).oninput = renderDraftPreview;
  });
}

async function init() {
  bindEvents();
  setSourceApp(state.sourceApp);
  await loadHealthAndContext();
  renderCampusSelectors();
  renderSelectedFiles();
  if (state.context?.authenticated) {
    await Promise.all([loadFiles(), loadDrafts()]);
  }
}

init().catch((error) => {
  console.error(error);
  showNotice(`자동화 작업실을 시작하지 못했습니다: ${error.message}`);
});

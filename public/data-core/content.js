const state = {
  context: null,
  campuses: [],
  platform: 'blog',
  items: [],
  current: null,
  files: [],
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
    throw new Error(message);
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

function notice(message) {
  $('notice').textContent = message || '';
  $('notice').classList.toggle('hidden', !message);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(value) {
  return ({ draft: '초안', review: '검수중', ready: '게시 준비', published: '게시 완료', archived: '보관' })[value] || value || '초안';
}

function platformLabel(value) { return value === 'instagram' ? '인스타그램' : '블로그'; }

function fillCampusSelect(select, includeAll = false) {
  const first = includeAll ? '<option value="">전체 캠퍼스</option>' : (state.context?.isSuperAdmin ? '<option value="">조직 공통</option>' : '');
  select.innerHTML = first + state.campuses.map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`).join('');
}

async function loadContext() {
  try {
    state.context = await api('/api/data-core/context');
    if (!state.context?.authenticated) {
      notice('로그인이 필요합니다. DATA CORE에 로그인한 뒤 다시 접근하세요.');
      return;
    }
    const response = await api('/api/data-core/campuses');
    state.campuses = response.campuses || [];
    fillCampusSelect($('campusFilter'), true);
    fillCampusSelect($('editCampus'), false);
    if (!state.context.canWrite) notice('콘텐츠 작성 권한이 아직 부여되지 않았습니다. 마스터 관리자에게 캠퍼스 권한을 요청하세요.');
  } catch (error) { notice(error.message); }
}

function queryParams() {
  const params = new URLSearchParams({ platform: state.platform, limit: '100' });
  const campus = $('campusFilter').value;
  const status = $('statusFilter').value;
  const q = $('searchInput').value.trim();
  if (campus) params.set('campusId', campus);
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  return params;
}

async function loadContent() {
  if (!state.context?.authenticated) return;
  try {
    const response = await api(`/api/data-core/content?${queryParams()}`);
    state.items = response.content || [];
    renderList();
  } catch (error) {
    state.items = [];
    renderList();
    notice(error.message);
  }
}

function mediaPreview(media) {
  if (!media?.length) return '';
  return `<div class="content-card-media">${media.slice(0, 5).map((file) => `<span class="mini-media">${String(file.mimeType || '').startsWith('image/') ? `<img src="${h(file.downloadUrl)}" alt="">` : '▤'}</span>`).join('')}</div>`;
}

function renderList() {
  const counts = { draft: 0, ready: 0, published: 0 };
  state.items.forEach((item) => { if (counts[item.status] !== undefined) counts[item.status] += 1; });
  $('statTotal').textContent = state.items.length;
  $('statDraft').textContent = counts.draft;
  $('statReady').textContent = counts.ready;
  $('statPublished').textContent = counts.published;
  $('contentEmpty').classList.toggle('hidden', state.items.length > 0);
  $('contentList').innerHTML = state.items.map((item) => `<article class="content-card" data-content-id="${h(item.id)}">
    <div class="content-card-head">
      <span class="platform-badge ${h(item.platform)}">${h(platformLabel(item.platform))}</span>
      <span class="status-badge ${h(item.status)}">${h(statusLabel(item.status))}</span>
    </div>
    <h3>${h(item.title)}</h3>
    <p>${h(item.summary || String(item.content || '').slice(0, 120) || '요약이 없습니다.')}</p>
    ${mediaPreview(item.media)}
    <div class="content-card-meta"><span>${h(item.campusName || '조직 공통')}</span><span>자료 ${h(item.media?.length || 0)}개</span><span>${h(formatDate(item.updatedAt))}</span></div>
  </article>`).join('');
  document.querySelectorAll('[data-content-id]').forEach((card) => { card.onclick = () => openExisting(card.dataset.contentId); });
}

function editorPayload() {
  const platform = $('editPlatform').value;
  return {
    platform,
    campusId: $('editCampus').value || null,
    title: $('editTitle').value.trim(),
    contentType: $('editContentType').value,
    status: $('editStatus').value,
    summary: $('editSummary').value.trim(),
    content: $('editContent').value,
    tags: $('editTags').value.split(',').map((value) => value.trim()).filter(Boolean),
    metadata: platform === 'instagram'
      ? { imageSpec: { width: 2160, height: 2700, aspectRatio: '4:5' } }
      : {},
  };
}

function syncPlatformUI() {
  const platform = $('editPlatform').value;
  $('instagramSpec').classList.toggle('hidden', platform !== 'instagram');
  $('contentBodyLabel').textContent = platform === 'instagram' ? '인스타 캡션' : '블로그 본문';
  $('editorEyebrow').textContent = platform === 'instagram' ? 'INSTAGRAM CONTENT · 2160×2700' : 'BLOG CONTENT';
}

function renderLinkedMedia() {
  const media = state.current?.media || [];
  $('linkedEmpty').classList.toggle('hidden', media.length > 0);
  $('linkedMedia').innerHTML = media.map((file) => `<article class="linked-item">
    <span class="linked-preview">${String(file.mimeType || '').startsWith('image/') ? `<img src="${h(file.downloadUrl)}" alt="">` : '▤'}</span>
    <div class="linked-info"><strong>${h(file.fileName)}</strong><small>${h(file.role)} · ${h(file.category || '')}</small></div>
    <button type="button" data-unlink-id="${h(file.linkId)}">×</button>
  </article>`).join('');
  document.querySelectorAll('[data-unlink-id]').forEach((button) => { button.onclick = () => unlinkMedia(button.dataset.unlinkId); });
}

function populateEditor(item) {
  state.current = item || null;
  const platform = item?.platform || state.platform;
  $('editorTitleText').textContent = item ? '콘텐츠 편집' : '새 콘텐츠';
  $('editPlatform').value = platform;
  $('editCampus').value = item?.campusId || (!state.context?.isSuperAdmin && state.campuses.length === 1 ? state.campuses[0].id : '');
  $('editTitle').value = item?.title || '';
  $('editContentType').value = item?.contentType || 'class';
  $('editStatus').value = item?.status || 'draft';
  $('editSummary').value = item?.summary || '';
  $('editContent').value = item?.content || '';
  $('editTags').value = (item?.tags || []).join(', ');
  $('deleteContentBtn').classList.toggle('hidden', !item);
  syncPlatformUI();
  renderLinkedMedia();
}

function openNew() {
  if (!state.context?.canWrite) { toast('콘텐츠 작성 권한이 필요합니다.', 'error'); return; }
  populateEditor(null);
  $('editorModal').classList.remove('hidden');
}

async function openExisting(id) {
  try {
    const response = await api(`/api/data-core/content/${encodeURIComponent(id)}`);
    populateEditor(response.content);
    $('editorModal').classList.remove('hidden');
  } catch (error) { toast(error.message, 'error'); }
}

function closeEditor() { $('editorModal').classList.add('hidden'); }

async function saveContent(silent = false) {
  const payload = editorPayload();
  if (!payload.title) { if (!silent) toast('제목을 입력하세요.', 'error'); return null; }
  const button = $('saveContentBtn');
  button.disabled = true;
  button.textContent = '저장 중...';
  try {
    const response = state.current?.id
      ? await api(`/api/data-core/content/${encodeURIComponent(state.current.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      : await api('/api/data-core/content', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    state.current = response.content;
    populateEditor(state.current);
    if (!silent) toast('콘텐츠를 저장했습니다.');
    await loadContent();
    return state.current;
  } catch (error) {
    if (!silent) toast(error.message, 'error');
    return null;
  } finally {
    button.disabled = false;
    button.textContent = '저장';
  }
}

async function deleteContent() {
  if (!state.current?.id || !confirm(`'${state.current.title}' 콘텐츠를 삭제할까요? 연결된 원본 파일 자체는 삭제하지 않습니다.`)) return;
  try {
    await api(`/api/data-core/content/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
    toast('콘텐츠를 삭제했습니다.');
    closeEditor();
    await loadContent();
  } catch (error) { toast(error.message, 'error'); }
}

async function openFilePicker() {
  if (!state.current?.id) {
    const saved = await saveContent(true);
    if (!saved) { toast('자료를 연결하기 전에 제목을 입력하고 콘텐츠를 저장해야 합니다.', 'error'); return; }
  }
  $('filePickerModal').classList.remove('hidden');
  await loadFiles();
}

function closeFilePicker() { $('filePickerModal').classList.add('hidden'); }

async function loadFiles() {
  const params = new URLSearchParams({ limit: '100' });
  const campusId = state.current?.campusId;
  const q = $('fileSearchInput').value.trim();
  if (campusId) params.set('campusId', campusId);
  if (q) params.set('q', q);
  try {
    const response = await api(`/api/data-core/files?${params}`);
    state.files = response.files || [];
    renderFiles();
  } catch (error) { state.files = []; renderFiles(); toast(error.message, 'error'); }
}

function renderFiles() {
  $('filePickerEmpty').classList.toggle('hidden', state.files.length > 0);
  $('filePickerList').innerHTML = state.files.map((file) => `<article class="picker-file">
    <span class="picker-preview">${String(file.mimeType || '').startsWith('image/') ? `<img src="${h(file.downloadUrl)}" alt="">` : '▤'}</span>
    <div class="picker-info"><strong>${h(file.fileName)}</strong><small>${h(file.campusName || '조직 공통')} · ${h(file.category || '')} · ${h(file.sourceApp || 'legacy')}</small></div>
    <button type="button" data-link-file="${h(file.id)}">연결</button>
  </article>`).join('');
  document.querySelectorAll('[data-link-file]').forEach((button) => { button.onclick = () => linkFile(button.dataset.linkFile); });
}

async function linkFile(fileId) {
  if (!state.current?.id) return;
  try {
    const response = await api(`/api/data-core/content/${encodeURIComponent(state.current.id)}/media`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileId, role: $('fileRole').value, position: (state.current.media || []).length }),
    });
    state.current = response.content;
    renderLinkedMedia();
    toast('자료를 콘텐츠에 연결했습니다.');
  } catch (error) { toast(error.message, 'error'); }
}

async function unlinkMedia(linkId) {
  if (!state.current?.id) return;
  try {
    await api(`/api/data-core/content/${encodeURIComponent(state.current.id)}/media/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
    const response = await api(`/api/data-core/content/${encodeURIComponent(state.current.id)}`);
    state.current = response.content;
    renderLinkedMedia();
    toast('자료 연결을 해제했습니다.');
  } catch (error) { toast(error.message, 'error'); }
}

function setPlatform(platform) {
  state.platform = platform;
  document.querySelectorAll('[data-platform]').forEach((button) => button.classList.toggle('active', button.dataset.platform === platform));
  loadContent();
}

function bindEvents() {
  document.querySelectorAll('[data-platform]').forEach((button) => { button.onclick = () => setPlatform(button.dataset.platform); });
  $('newContentBtn').onclick = openNew;
  $('searchBtn').onclick = loadContent;
  $('campusFilter').onchange = loadContent;
  $('statusFilter').onchange = loadContent;
  $('searchInput').onkeydown = (event) => { if (event.key === 'Enter') loadContent(); };
  $('editPlatform').onchange = syncPlatformUI;
  $('closeEditorBtn').onclick = closeEditor;
  $('closeEditorBottomBtn').onclick = closeEditor;
  $('saveContentBtn').onclick = () => saveContent(false);
  $('deleteContentBtn').onclick = deleteContent;
  $('openFilePickerBtn').onclick = openFilePicker;
  $('closeFilePickerBtn').onclick = closeFilePicker;
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('editorModal').addEventListener('click', (event) => { if (event.target === $('editorModal')) closeEditor(); });
  $('filePickerModal').addEventListener('click', (event) => { if (event.target === $('filePickerModal')) closeFilePicker(); });
}

async function init() {
  bindEvents();
  await loadContext();
  if (state.context?.authenticated) await loadContent();
}

init().catch((error) => { console.error(error); notice(`콘텐츠 허브를 시작하지 못했습니다: ${error.message}`); });

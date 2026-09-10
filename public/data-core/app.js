const LIBRARY_CATEGORIES = [
  { key: 'class-photo', label: '수업사진' },
  { key: 'student-artwork', label: '학생그림' },
  { key: 'academy-photo', label: '학원사진' },
  { key: 'competition-material', label: '공모전·실기대회' },
  { key: 'admission-material', label: '입시자료' },
  { key: 'counseling-material', label: '상담자료' },
  { key: 'blog-source', label: '블로그소스', sourceApp: 'blog' },
  { key: 'instagram-source', label: '인스타소스', sourceApp: 'instagram' },
  { key: 'promotion-material', label: '홍보자료' },
];

const CAMPUS_PRESENTATION = {
  'design-admission': { name: '부천 디자인 입시관', group: '입시관', order: 1 },
  'anihi-admission': { name: '부천 애니 입시관', group: '입시관', order: 2 },
  gwangjin: { name: '서울 광진 입시관', group: '입시관', order: 3 },
  ulsan: { name: '울산 송정 입시관', group: '입시관', order: 4 },
  ansan: { name: '안산 입시관', group: '입시관', order: 5 },
  paju: { name: '파주 입시관', group: '입시관', order: 6 },
  beombak: { name: '부천 범박 캠퍼스', group: '예비관', order: 1 },
  wonjong: { name: '부천 원종 캠퍼스', group: '예비관', order: 2 },
  jungdong: { name: '부천 중동 캠퍼스', group: '예비관', order: 3 },
  okgil: { name: '부천 옥길 캠퍼스', group: '예비관', order: 4 },
};

const state = {
  health: null,
  context: null,
  campuses: [],
  files: [],
  selectedFolder: null,
  competitions: [],
  competitionResults: [],
  competitionFiles: [],
  selectedCompetitionId: null,
  competitionSourcePreviews: {},
  awardFolders: [],
  awardFiles: [],
  selectedAwardFolderId: null,
  guideDraft: null,
  calendarEvents: [],
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calendarSelectedDate: null,
  currentMode: 'mode',
  currentView: 'mode-home',
  droppedFiles: [],
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function categoryLabel(category) {
  return ({
    'student-artwork': '학생그림',
    'class-photo': '수업사진',
    'academy-photo': '학원사진',
    'competition-material': '공모전·실기대회',
    'admission-material': '입시자료',
    'counseling-material': '상담자료',
    'blog-source': '블로그소스',
    'instagram-source': '인스타소스',
    'promotion-material': '홍보자료',
  })[category] || category || '기타';
}

function roleLabel(role) {
  return ({
    SUPER_ADMIN: '마스터 관리자', CAMPUS_DIRECTOR: '캠퍼스 원장', TEACHER: '교사', STAFF: '직원'
  })[role] || role || '-';
}

function statusLabel(status) {
  return ({
    open: '접수 중', upcoming: '접수 예정', closed: '접수 마감',
    'result-announced': '결과 발표', unknown: '일정 확인 필요'
  })[status] || status || '일정 확인 필요';
}

function canWrite() {
  return Boolean(state.context?.canWrite);
}

function isSuperAdmin() {
  return Boolean(state.context?.isSuperAdmin);
}

function modeForView(view) {
  if (view === 'mode-home') return 'mode';
  if (view === 'counseling-home' || view === 'competitions') return 'counseling';
  if (view === 'work-home' || view === 'library') return 'work';
  return state.currentMode === 'mode' ? 'work' : state.currentMode;
}

function titleForView(view) {
  return ({
    'mode-home': '모드 선택',
    'counseling-home': '상담용',
    'work-home': '업무용',
    library: '자료보관함',
    competitions: '공모전·실기대회',
    admin: '권한관리',
  })[view] || 'DATA CORE';
}

function updateSidebar() {
  document.querySelectorAll('[data-nav-scope]').forEach((group) => {
    const scope = group.dataset.navScope;
    const visible = scope === state.currentMode || (scope === 'admin' && isSuperAdmin() && state.currentMode !== 'mode');
    group.classList.toggle('hidden', !visible);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.currentView);
  });
}

function switchView(view, options = {}) {
  state.currentView = view;
  state.currentMode = modeForView(view);
  document.body.classList.toggle('counseling-header', state.currentMode === 'counseling');
  if (view !== 'competitions') clearAwardImages();
  document.querySelectorAll('.view').forEach((section) => section.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $('pageTitle').textContent = titleForView(view);
  updateSidebar();

  if (options.push !== false) {
    const path = ({
      'mode-home': '/data-core',
      'counseling-home': '/data-core/counseling',
      'work-home': '/data-core/work',
      library: '/data-core/work/library',
      competitions: '/data-core/counseling/competitions',
    })[view];
    if (path && location.pathname !== path) history.pushState({ view }, '', path);
  }

  if (state.context !== null) renderUser();
  if (view === 'library') loadFiles();
  if (view === 'competitions') {
    loadCompetitions();
    loadAwardFolders();
  }
  if (view === 'counseling-home' || view === 'work-home') loadCalendar();
  if (view === 'admin' && isSuperAdmin()) loadMemberships();
}

function initialViewFromPath() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/data-core/counseling') return 'counseling-home';
  if (path === '/data-core/counseling/competitions') return 'competitions';
  if (path === '/data-core/work/library') return 'library';
  if (path === '/data-core/work') return 'work-home';
  return 'mode-home';
}

function renderConnection() {
  const card = $('connectionCard');
  const health = state.health;
  if (health?.ok) {
    card.className = 'connection-card online';
    card.querySelector('strong').textContent = '중앙 저장소 연결됨';
    card.querySelector('small').textContent = 'D1 + R2 정상';
    $('storageStatus').textContent = '정상';
  } else {
    card.className = 'connection-card degraded';
    card.querySelector('strong').textContent = '일부 연결 필요';
    const db = health?.bindings?.database ? 'D1 정상' : 'D1 필요';
    const files = health?.bindings?.files ? 'R2 정상' : 'R2 필요';
    card.querySelector('small').textContent = `${db} · ${files}`;
    $('storageStatus').textContent = '점검 필요';
  }
}

function renderUser() {
  const chip = $('userChip');
  const context = state.context;
  if (!context?.authenticated) {
    chip.querySelector('strong').textContent = '로그인이 필요합니다';
    chip.querySelector('small').textContent = '업무용은 로그인 후 사용';
    chip.querySelector('.avatar').textContent = '?';
    $('openUploadBtn').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    if (state.currentMode === 'work') showNotice('업무용 DATA CORE를 사용하려면 로그인해야 합니다.');
    else if (state.currentView === 'competitions') showNotice('공개 상담 화면은 열 수 있지만, 내부 대회 데이터 조회는 로그인 후 가능합니다.');
    else showNotice('');
    updateSidebar();
    return;
  }

  const user = context.user || {};
  chip.querySelector('strong').textContent = user.displayName || user.email || '사용자';
  const membershipText = context.isSuperAdmin
    ? '마스터 관리자'
    : context.memberships?.length
      ? context.memberships.map((m) => `${m.campusName || '공통'} · ${roleLabel(m.role)}`).join(' / ')
      : '권한 미부여';
  chip.querySelector('small').textContent = membershipText;
  chip.querySelector('.avatar').textContent = String(user.displayName || user.email || 'H').trim().slice(0, 1).toUpperCase();

  if (state.currentMode === 'work' && !context.canWrite) {
    showNotice('로그인은 확인됐지만 DATA CORE 사용 권한이 아직 부여되지 않았습니다.');
  } else {
    showNotice('');
  }

  $('adminNav').classList.toggle('hidden', !context.isSuperAdmin);
  $('openUploadBtn').classList.toggle('hidden', !context.canWrite);
  $('logoutBtn').classList.toggle('hidden', !context.user?.internalUserId?.startsWith('local:'));
  updateSidebar();
}

function fillCampusSelect(select, options = {}) {
  if (!select) return;
  const { all = false, allowOrganization = false } = options;
  const rows = [];
  if (all) rows.push('<option value="">전체 캠퍼스</option>');
  if (allowOrganization && isSuperAdmin()) rows.push('<option value="">조직 공통</option>');
  rows.push(...orderedCampuses().map((campus) => `<option value="${h(campus.id)}">${h(campusDisplayName(campus))}</option>`));
  select.innerHTML = rows.join('');
}

function campusPresentation(campus) {
  return CAMPUS_PRESENTATION[campus.code] || { name: campus.name, group: '기타', order: 999 };
}

function campusDisplayName(campus) {
  return campusPresentation(campus).name || campus.name;
}

function orderedCampuses() {
  const groupOrder = { 입시관: 1, 예비관: 2, 기타: 3 };
  return [...state.campuses].sort((left, right) => {
    const a = campusPresentation(left);
    const b = campusPresentation(right);
    return (groupOrder[a.group] - groupOrder[b.group]) || (a.order - b.order) || campusDisplayName(left).localeCompare(campusDisplayName(right), 'ko');
  });
}

function folderButton(folder, campusId = '') {
  const selected = state.selectedFolder
    && state.selectedFolder.key === `${campusId}:${folder.key}`;
  const attrs = [
    `data-folder-key="${h(`${campusId}:${folder.key}`)}"`,
    `data-folder-category="${h(folder.key)}"`,
    `data-folder-campus="${h(campusId)}"`,
    `data-folder-label="${h(folder.label)}"`,
  ];
  if (folder.sourceApp) attrs.push(`data-folder-source="${h(folder.sourceApp)}"`);
  return `<button class="folder-chip ${selected ? 'active' : ''}" aria-pressed="${selected ? 'true' : 'false'}" ${attrs.join(' ')}>
    <span>▣</span>
    <strong>${h(folder.label)}</strong>
  </button>`;
}

function renderLibraryFolders() {
  const container = $('folderGroups');
  if (!container) return;
  const groups = new Map();
  orderedCampuses().forEach((campus) => {
    const presentation = campusPresentation(campus);
    if (!groups.has(presentation.group)) groups.set(presentation.group, []);
    groups.get(presentation.group).push(campus);
  });
  container.innerHTML = groups.size
    ? [...groups.entries()].map(([group, campuses]) => `<section class="campus-folder-section" data-campus-group="${h(group)}">
        <h4>${h(group)}</h4>
        ${campuses.map((campus) => `<article class="folder-group" data-campus-folder="${h(campus.id)}">
          <div class="folder-title">
            <strong>${h(campusDisplayName(campus))}</strong>
            <small>캠퍼스 폴더</small>
          </div>
          <div class="folder-chip-grid">${LIBRARY_CATEGORIES.map((folder) => folderButton(folder, campus.id)).join('')}</div>
        </article>`).join('')}
      </section>`).join('')
    : '<div class="empty-state">로그인 후 접근 가능한 캠퍼스 폴더가 표시됩니다.</div>';
  document.querySelectorAll('[data-folder-key]').forEach((button) => {
    button.onclick = () => {
      state.selectedFolder = {
        key: button.dataset.folderKey,
        campusId: button.dataset.folderCampus || '',
        category: button.dataset.folderCategory || '',
        sourceApp: button.dataset.folderSource || '',
        label: button.dataset.folderLabel || '선택한 폴더',
      };
      $('fileCampusFilter').value = state.selectedFolder.campusId;
      $('fileCategoryFilter').value = state.selectedFolder.category;
      renderLibraryFolders();
      loadFiles();
    };
  });
  renderSelectedFolder();
}

function renderSelectedFolder() {
  const notice = $('selectedFolderNotice');
  if (!notice) return;
  if (!state.selectedFolder) {
    notice.textContent = '';
    notice.classList.add('hidden');
    return;
  }
  const source = state.selectedFolder.sourceApp === 'blog'
    ? '블로그 자료만'
    : state.selectedFolder.sourceApp === 'instagram'
      ? '인스타그램 자료만'
      : '선택한 분류';
  notice.textContent = `${state.selectedFolder.label} 폴더 선택됨 · ${source} 표시`;
  notice.classList.remove('hidden');
}

function clearSelectedFolder() {
  if (!state.selectedFolder) return;
  state.selectedFolder = null;
  renderLibraryFolders();
}

function renderCampusSelectors() {
  fillCampusSelect($('fileCampusFilter'), { all: true });
  fillCampusSelect($('uploadCampus'), { allowOrganization: true });
  fillCampusSelect($('competitionCampus'), { allowOrganization: true });
  fillCampusSelect($('awardFolderCampus'), { allowOrganization: true });
  fillCampusSelect($('calendarCampus'), { allowOrganization: true });
  fillCampusSelect($('memberCampus'), { all: false });
  $('campusCount').textContent = state.campuses.length;
  renderLibraryFolders();
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

  if (!state.context?.authenticated) {
    renderCampusSelectors();
    return;
  }
  try {
    const campusResponse = await api('/api/data-core/campuses');
    state.campuses = campusResponse.campuses || [];
    renderCampusSelectors();
    if (state.currentView === 'counseling-home' || state.currentView === 'work-home') await loadCalendar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadFiles() {
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams();
  const campusId = $('fileCampusFilter')?.value || '';
  const category = $('fileCategoryFilter')?.value || '';
  const sourceApp = state.selectedFolder?.sourceApp || '';
  const q = $('fileSearchInput')?.value.trim() || '';
  if (campusId) params.set('campusId', campusId);
  if (category) params.set('category', category);
  if (sourceApp) params.set('sourceApp', sourceApp);
  if (q) params.set('q', q);
  params.set('limit', '100');

  try {
    const response = await api(`/api/data-core/files?${params}`);
    state.files = response.files || [];
    renderFiles();
  } catch (error) {
    state.files = [];
    renderFiles();
    if (error.status !== 401) toast(error.message, 'error');
  }
}

function renderFiles() {
  $('fileCount').textContent = state.files.length;
  const body = $('fileTableBody');
  $('fileEmpty').classList.toggle('hidden', state.files.length > 0);
  body.innerHTML = state.files.map((file) => {
    const canDelete = isSuperAdmin() || file.ownerUserId === state.context?.user?.internalUserId;
    return `<tr>
      <td>
        <div class="file-name">
          <span class="file-icon">${h(file.mimeType?.startsWith('image/') ? '▧' : '▤')}</span>
          <div><strong>${h(file.fileName)}</strong><small>${h(file.mimeType || '')}</small></div>
        </div>
      </td>
      <td>${h(file.campusName || '조직 공통')}</td>
      <td><span class="pill">${h(categoryLabel(file.category))}</span></td>
      <td>${h(formatBytes(file.sizeBytes))}</td>
      <td>${h(formatDate(file.createdAt))}</td>
      <td>
        <div class="row-actions">
          <button class="ghost-btn" data-open-file="${h(file.id)}">열기</button>
          ${canDelete ? `<button class="danger-btn" data-delete-file="${h(file.id)}">삭제</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  document.querySelectorAll('[data-open-file]').forEach((button) => {
    button.onclick = () => window.open(`/api/data-core/files/${encodeURIComponent(button.dataset.openFile)}`, '_blank', 'noopener');
  });
  document.querySelectorAll('[data-delete-file]').forEach((button) => {
    button.onclick = () => deleteFile(button.dataset.deleteFile);
  });
}

async function deleteFile(fileId) {
  const file = state.files.find((item) => String(item.id) === String(fileId));
  if (!confirm(`'${file?.fileName || '이 파일'}'을 중앙 저장소에서 삭제할까요?`)) return;
  try {
    await api(`/api/data-core/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    toast('파일을 삭제했습니다.');
    await loadFiles();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openModal(id) {
  if ($(id) instanceof HTMLDialogElement) return $(id).showModal();
  if (id === 'uploadModal' && !uploadQueue?.running) {
    $('uploadFile').value = '';
    state.droppedFiles = [];
    updateUploadFiles();
  }
  $(id)?.classList.remove('hidden');
}

function closeModal(id) {
  if ($(id) instanceof HTMLDialogElement) return $(id).close();
  if (id === 'uploadModal') {
    if (uploadQueue?.running) {
      if (confirm('업로드가 진행 중입니다. 취소하시겠습니까?')) uploadQueue.cancel();
      return;
    }
    $('uploadRecordId').value = '';
    $('uploadCampus').disabled = false;
    $('uploadCategory').disabled = false;
    $('uploadTargetNotice').classList.add('hidden');
  }
  $(id)?.classList.add('hidden');
}

let uploadQueue = null;
function selectedUploadFiles() {
  return state.droppedFiles.length ? state.droppedFiles : Array.from($('uploadFile').files || []);
}
function updateUploadFiles() {
  const files = selectedUploadFiles();
  uploadQueue = null;
  $('uploadSubmitBtn').disabled = false;
  $('uploadProgress').classList.add('hidden');
  $('retryUploadsBtn').classList.add('hidden');
  $('selectedFileName').textContent = files.length ? `${files.length}개 파일 선택 · 총 ${formatBytes(files.reduce((n,f)=>n+f.size,0))}` : '최대 100MB';
  $('selectedUploadDetails').classList.toggle('hidden', !files.length);
  $('selectedUploadSummary').textContent = `선택 파일 ${files.length}개 보기`;
  $('selectedUploadList').innerHTML = files.map(f=>`<li>${h(f.name)}</li>`).join('');
}
function renderUploadProgress(progress) {
  $('uploadProgress').classList.remove('hidden');
  $('uploadProgressTitle').textContent = progress.running ? '수상작 업로드 중' : progress.cancelled ? '업로드 취소됨' : progress.failed ? '일부 파일 업로드 실패' : '업로드 완료';
  $('uploadProgressBar').value = progress.percent;
  $('uploadProgressPercent').textContent = `${progress.percent}%`;
  $('uploadProgressCount').textContent = `${progress.success} / ${progress.count} 완료 · 성공 ${progress.success}개 · 실패 ${progress.failed}개`;
  $('uploadProgressCurrent').textContent = progress.current ? `현재: ${progress.current}` : '';
  $('uploadProgressBytes').textContent = `전송 ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`;
  $('retryUploadsBtn').classList.toggle('hidden', progress.running || !progress.failed || progress.cancelled);
}
async function uploadFile(event) {
  event.preventDefault();
  if (uploadQueue?.running) return;
  const files = selectedUploadFiles();
  if (!files.length) return toast('업로드할 파일을 선택하세요.', 'error');
  const target = {
    campusId: $('uploadCampus').value || '',
    category: $('uploadCategory').value,
    recordId: $('uploadRecordId').value || '',
    sourceApp: 'data-core-library', ownerId: 'shared', year: String(new Date().getFullYear()),
  };
  uploadQueue = new DataCoreUploadQueue(files, target, renderUploadProgress);
  await runUploadQueue();
}
async function runUploadQueue(retry = false) {
  const queue = uploadQueue;
  if (!queue || queue.running) return;
  const button = $('uploadSubmitBtn');
  button.disabled = true;
  $('uploadFile').disabled = true;
  $('uploadCampus').disabled = true;
  $('uploadCategory').disabled = true;
  try {
    await queue.run(retry);
    const result = queue.snapshot();
    toast(`${result.success}개 완료 · ${result.failed}개 실패${result.cancelled ? ' · 나머지 취소' : ''}`);
    await loadFiles();
    if (queue.target.recordId === state.selectedAwardFolderId) await loadAwardFiles();
    if (result.success === result.count) {
      button.disabled = false;
      closeModal('uploadModal');
      $('uploadForm').reset();
      state.droppedFiles = [];
      updateUploadFiles();
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = uploadQueue === queue;
    $('uploadFile').disabled = false;
    $('uploadCampus').disabled = Boolean($('uploadRecordId').value);
    $('uploadCategory').disabled = Boolean($('uploadRecordId').value);
    button.textContent = '중앙 저장소에 업로드';
  }
}

function competitionMetadata(competition) {
  return competition?.metadata || {};
}

function applicationDday(value) {
  if (!value) return '접수 마감일 확인 필요';
  const end = new Date(`${value}T00:00:00`);
  if (Number.isNaN(end.getTime())) return '접수 마감일 확인 필요';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'D-day';
  return days > 0 ? `D-${days}` : `마감 ${Math.abs(days)}일 경과`;
}

function arrayIncludes(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return (Array.isArray(list) ? list : []).some((item) => String(item).toLowerCase().includes(q));
}

function filteredCompetitions() {
  return state.competitions;
}

function sourceLabel(source) {
  return source === 'artmd' ? '미대입시' : '엠굿';
}

function renderCompetitionSourcePreviews() {
  const list = $('competitionSourceList');
  const previews = Object.values(state.competitionSourcePreviews);
  if (!previews.length) {
    list.innerHTML = '<div class="empty-state compact">외부 소식은 아직 불러오지 않았습니다.</div>';
    return;
  }
  const items = previews.flatMap((preview) => preview.items || []);
  const importButtons = state.context?.isSuperAdmin ? previews.map((preview) => (
    `<button class="primary-btn source-import-btn" data-competition-source-import="${h(preview.source)}" type="button">${h(preview.sourceName || sourceLabel(preview.source))} 안전 반영</button>`
  )).join('') : '';
  list.innerHTML = (items.length ? items.map((item) => {
    const dates = [item.applicationStart, item.applicationEnd].filter(Boolean).join(' ~ ');
    const status = ({ new: '새 항목', matched: '기존 항목과 연결', same: '이미 반영됨', ambiguous: '검토 필요' })[item.importStatus] || '검토 필요';
    return `<article class="competition-source-card">
      <div class="source-card-head"><span class="source-badge ${h(item.source)}">${h(item.sourceName || sourceLabel(item.source))}</span><span class="source-import-status ${h(item.importStatus)}">${h(status)}</span></div>
      <strong>${h(item.title)}</strong>
      <small>${h(item.organizer || item.hostSchool || '주최·대학 확인 필요')}</small>
      <span>${dates ? `접수 ${h(dates)}` : '접수기간 확인 필요'} · ${h(applicationDday(item.applicationEnd))}</span>
      <a class="ghost-btn" href="${h(item.sourceUrl)}" target="_blank" rel="noopener">원문 보기</a>
    </article>`;
  }).join('') : '<div class="empty-state compact">추출 가능한 공개 사실정보가 없습니다. 출처 연결을 확인해 주세요.</div>') + importButtons;
  document.querySelectorAll('[data-competition-source-import]').forEach((button) => {
    button.onclick = () => importCompetitionSource(button.dataset.competitionSource);
  });
}

async function previewCompetitionSource(source) {
  if (!state.context?.authenticated) {
    toast('로그인 후 외부 대회 소식을 확인할 수 있습니다.', 'error');
    return;
  }
  $('competitionSourceStatus').textContent = `${sourceLabel(source)} 공개 소식을 확인하는 중...`;
  try {
    const response = await api(`/api/data-core/competition-sources/${encodeURIComponent(source)}/preview`, { method: 'POST' });
    state.competitionSourcePreviews[source] = response;
    $('competitionSourceStatus').textContent = `${response.sourceName} ${response.items?.length || 0}건을 미리보기로 불러왔습니다. 마스터 관리자만 안전하게 반영할 수 있습니다.`;
    renderCompetitionSourcePreviews();
  } catch (error) {
    $('competitionSourceStatus').textContent = error.message;
    toast(error.message, 'error');
  }
}

async function importCompetitionSource(source) {
  if (!state.context?.isSuperAdmin) {
    toast('외부 대회 소식 반영은 마스터 관리자만 할 수 있습니다.', 'error');
    return;
  }
  $('competitionSourceStatus').textContent = `${sourceLabel(source)} 항목을 서버에서 다시 확인하여 안전하게 반영하는 중...`;
  try {
    const response = await api(`/api/data-core/competition-sources/${encodeURIComponent(source)}/import`, { method: 'POST' });
    const summary = response.summary || {};
    $('competitionSourceStatus').textContent = `${response.sourceName || sourceLabel(source)} 반영 완료: 새 항목 ${summary.created || 0}, 출처 병합 ${summary.updated || 0}, 기존 유지 ${summary.unchanged || 0}, 검토 필요 ${summary.ambiguous || 0}.`;
    await loadCompetitions();
    await previewCompetitionSource(source);
  } catch (error) {
    $('competitionSourceStatus').textContent = error.message;
    toast(error.message, 'error');
  }
}

async function loadCompetitions() {
  if (!$('competitionList')) return;
  if (!state.context?.authenticated) {
    $('competitionList').innerHTML = '<div class="empty-state">로그인 후 내부 공모전·실기대회 데이터를 조회할 수 있습니다.</div>';
    renderCompetitionDetail(null);
    return;
  }
  $('competitionList').innerHTML = '<div class="empty-state">불러오는 중...</div>';
  try {
    const response = await api('/api/data-core/competitions?limit=100');
    state.competitions = response.competitions || [];
    if (!state.selectedCompetitionId && state.competitions[0]) {
      state.selectedCompetitionId = state.competitions[0].id;
    }
    renderCompetitions();
    await loadSelectedCompetition();
  } catch (error) {
    state.competitions = [];
    $('competitionList').innerHTML = `<div class="empty-state">${h(error.message)}</div>`;
    renderCompetitionDetail(null);
  }
}

function renderCompetitions() {
  const list = $('competitionList');
  if (!list) return;
  const competitions = filteredCompetitions();
  if (!competitions.length) {
    list.innerHTML = '<div class="empty-state">조건에 맞는 공모전·실기대회가 없습니다.</div>';
    state.selectedCompetitionId = null;
    renderCompetitionDetail(null);
    return;
  }
  if (!competitions.some((item) => item.id === state.selectedCompetitionId)) {
    state.selectedCompetitionId = competitions[0].id;
  }
  list.innerHTML = competitions.map((competition) => {
    const meta = competitionMetadata(competition);
    const dates = [meta.applicationStart, meta.applicationEnd].filter(Boolean).join(' ~ ');
    const grades = Array.isArray(meta.targetGrades) ? meta.targetGrades : [];
    const majors = Array.isArray(meta.majors) ? meta.majors : [];
    const practicalTypes = Array.isArray(meta.practicalTypes) ? meta.practicalTypes : [];
    return `<button class="competition-list-item ${competition.id === state.selectedCompetitionId ? 'active' : ''}" data-competition-id="${h(competition.id)}">
      <span class="status-pill ${h(competition.competitionStatus)}">${h(statusLabel(competition.competitionStatus))}</span>
      <strong>${h(competition.title)}</strong>
      <small>${h(meta.organizer || meta.hostSchool || '주최/주관 확인 필요')}</small>
      <span>${dates ? `접수 ${h(dates)}` : '접수기간 확인 필요'}</span>
      <span class="competition-dday">${h(applicationDday(meta.applicationEnd))}</span>
      <span>${h([meta.hostSchool, ...grades, ...majors, ...practicalTypes].filter(Boolean).slice(0, 5).join(' · '))}</span>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-competition-id]').forEach((button) => {
    button.onclick = async () => {
      state.selectedCompetitionId = button.dataset.competitionId;
      renderCompetitions();
      await loadSelectedCompetition();
    };
  });
}

function fileUrl(file) {
  return `/api/data-core/files/${encodeURIComponent(file.id)}`;
}

function guideLinks(meta, files = []) {
  const links = [];
  if (meta.guideUrl) links.push(`<a class="ghost-btn" href="${h(meta.guideUrl)}" target="_blank" rel="noopener">요강 PDF/링크</a>`);
  if (meta.sourceUrl) links.push(`<a class="ghost-btn" href="${h(meta.sourceUrl)}" target="_blank" rel="noopener">원문 링크</a>`);
  files
    .filter((file) => file.category === 'competition-guide'
      || (file.category === 'competition-poster' && !String(file.mimeType || '').startsWith('image/')))
    .forEach((file) => {
      links.push(`<a class="ghost-btn" href="${fileUrl(file)}" target="_blank" rel="noopener">${h(file.fileName || '연결 파일')}</a>`);
    });
  return links.join('');
}

function renderCompetitionPoster(competition, files = []) {
  const poster = files.find((file) => (
    file.category === 'competition-poster' && String(file.mimeType || '').startsWith('image/')
  ));
  if (!poster) {
    return '<div class="competition-media-empty">연결된 대표 포스터가 없습니다.</div>';
  }
  return `<figure class="competition-poster">
    <a href="${fileUrl(poster)}" target="_blank" rel="noopener">
      <img src="${fileUrl(poster)}" alt="${h(competition.title)} 포스터">
    </a>
    <figcaption>${h(poster.fileName || '대표 포스터')}</figcaption>
  </figure>`;
}

function renderCompetitionAwardFiles(files = []) {
  const awardFiles = files.filter((file) => file.category === 'award-work');
  if (!awardFiles.length) {
    return '<div class="empty-state compact">연결된 수상작 파일이 없습니다.</div>';
  }
  return `<div class="award-file-grid">${awardFiles.map((file) => {
    const image = String(file.mimeType || '').startsWith('image/');
    const url = fileUrl(file);
    return `<a class="award-file" href="${url}" target="_blank" rel="noopener">
      ${image ? `<img src="${url}" alt="${h(file.fileName || '수상작')}">` : '<span class="award-file-icon">파일</span>'}
      <strong>${h(file.fileName || '연결 파일')}</strong>
      <small>${h(categoryLabel(file.category))}</small>
    </a>`;
  }).join('')}</div>`;
}

function selectedAwardFolder() {
  return state.awardFolders.find((folder) => folder.id === state.selectedAwardFolderId) || null;
}

let awardFilesRequest = 0;
let awardFilesLoading = false;

function renderAwardFolders() {
  const list = $('awardFolderList');
  if (!list) return;
  const folder = selectedAwardFolder();
  list.innerHTML = state.awardFolders.length
    ? state.awardFolders.map((item) => `<button type="button" title="${h(item.title)}" class="award-folder-tab ${item.id === state.selectedAwardFolderId ? 'active' : ''}" aria-pressed="${item.id === state.selectedAwardFolderId}" data-award-folder-id="${h(item.id)}">
        <strong>${h(item.title)}</strong><small>${h(item.campusName || '조직 공통')}</small>
      </button>`).join('')
    : '<div class="empty-state compact">등록된 수상작 폴더가 없습니다.</div>';
  document.querySelectorAll('[data-award-folder-id]').forEach((button) => {
    button.onclick = async () => {
      state.selectedAwardFolderId = button.dataset.awardFolderId;
      renderAwardFolders();
      await loadAwardFiles();
    };
  });
  $('selectedAwardFolderTitle').textContent = folder?.title || '수상작 폴더를 선택하세요';
  $('selectedAwardFolderMeta').textContent = folder
    ? `${folder.campusName || '조직 공통'} · 빈 폴더만 삭제할 수 있습니다.`
    : '빈 폴더만 삭제할 수 있습니다.';
  $('openAwardUploadBtn').disabled = !folder || !canWrite();
  $('deleteAwardFolderBtn').disabled = !folder || !canWrite();
  $('openAwardFolderBtn').disabled = !canWrite();
  list.querySelector?.('.active')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  updateAwardFolderArrows();
}

function updateAwardFolderArrows() {
  const track = $('awardFolderTrack');
  if (!track) return;
  $('awardFolderPrev').disabled = track.scrollLeft <= 1;
  $('awardFolderNext').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}
function moveAwardFolder(direction) {
  const track = $('awardFolderTrack');
  const bounds = track.getBoundingClientRect();
  const items = [...track.querySelectorAll('button')];
  const target = direction > 0 ? items.find(item=>item.getBoundingClientRect().right > bounds.right + 1)
    : items.reverse().find(item=>item.getBoundingClientRect().left < bounds.left - 1);
  if (target) {
    const rect = target.getBoundingClientRect();
    track.scrollBy({left: direction > 0 ? rect.right - bounds.right : rect.left - bounds.left, behavior:'smooth'});
  }
}

const awardSelected = new Set();
const awardImages = new AwardImageCache();
let awardImageObserver;
let awardDeletePending = null;
let awardDeleteBusy = false;
function clearAwardImages() {
  awardImageObserver?.disconnect();
  awardImages.clear();
  $('awardLightbox')?.close();
}
function updateAwardSelection() {
  $('awardSelectionBar').classList.toggle('hidden', !awardSelected.size);
  $('awardSelectionCount').textContent = `선택 ${awardSelected.size}개`;
  $('deleteSelectedAwardsBtn').disabled = awardDeleteBusy || !canWrite();
}
function canDeleteAward(file) {
  return canWrite() && isSuperAdmin();
}
function requestAwardDelete() {
  const folder = selectedAwardFolder();
  if (!folder || awardDeleteBusy || !awardSelected.size) return;
  awardDeletePending = { folderId: folder.id, ids: [...awardSelected] };
  $('awardDeleteSummary').textContent = `${folder.title} · 선택 ${awardSelected.size}개`;
  $('awardDeleteDialog').showModal();
  $('cancelAwardDeleteBtn').focus?.();
}
async function deleteSelectedAwards() {
  const pending = awardDeletePending;
  if (awardDeleteBusy || !pending || pending.folderId !== state.selectedAwardFolderId) return;
  awardDeleteBusy = true;
  $('confirmAwardDeleteBtn').disabled = true;
  let deleted = 0;
  try {
    for (const id of pending.ids) {
      const file = state.awardFiles.find((item) => item.id === id && item.recordId === pending.folderId);
      if (!file || !canDeleteAward(file)) throw new Error('선택한 파일의 권한을 확인해 주세요.');
      await api(`/api/data-core/files/${encodeURIComponent(id)}?awardFolderId=${encodeURIComponent(pending.folderId)}`, { method: 'DELETE' });
      awardImages.remove(id);
      awardSelected.delete(id);
      deleted += 1;
    }
    toast(`${deleted}개 수상작을 완전히 삭제했습니다.`);
  } catch (error) { toast(`${deleted}개 삭제 완료. ${error.message}`, 'error'); }
  finally {
    awardDeleteBusy = false;
    awardDeletePending = null;
    $('confirmAwardDeleteBtn').disabled = false;
    $('awardDeleteDialog').close();
    if (pending.folderId === state.selectedAwardFolderId) await loadAwardFiles();
  }
}
function renderAwardLibraryFiles() {
  const root = $('awardLibraryFiles');
  if (!root) return;
  updateAwardSelection();
  awardImageObserver?.disconnect();
  root.setAttribute('aria-busy', String(awardFilesLoading));
  if (!selectedAwardFolder()) {
    root.innerHTML = '<div class="empty-state compact">수상작 폴더를 선택하세요.</div>';
    return;
  }
  if (awardFilesLoading) {
    root.innerHTML = '<div class="empty-state compact" role="status">수상작을 불러오는 중...</div>';
    return;
  }
  root.innerHTML = state.awardFiles.length ? state.awardFiles.map((file) => {
    const url = fileUrl(file);
    const image = String(file.mimeType || '').startsWith('image/');
    return `<div class="award-library-item">${canDeleteAward(file) ? `<label class="award-select"><input type="checkbox" data-award-select="${h(file.id)}" aria-label="${h(file.fileName || '수상작')} 선택" ${awardSelected.has(file.id) ? 'checked' : ''}></label>` : ''}<a class="award-library-file" href="${url}" ${image ? `data-award-image="${h(file.id)}" aria-haspopup="dialog"` : 'target="_blank" rel="noopener"'}>
      ${image ? `<img data-award-thumbnail="${h(file.id)}" alt="${h(file.fileName || '수상작')}" decoding="async">` : '<span class="award-file-icon">파일</span>'}
      <strong>${h(file.fileName || '수상작 파일')}</strong>
    </a></div>`;
  }).join('') : '<div class="empty-state compact">이 폴더에 연결된 수상작이 없습니다.</div>';
  root.querySelectorAll('[data-award-select]').forEach((checkbox) => {
    checkbox.onchange = () => {
      if (checkbox.checked) awardSelected.add(checkbox.dataset.awardSelect);
      else awardSelected.delete(checkbox.dataset.awardSelect);
      updateAwardSelection();
    };
  });
  const folderId = state.selectedAwardFolderId;
  const loadThumbnail = async (img) => {
    try {
      const url = await awardImages.get(img.dataset.awardThumbnail);
      if (folderId === state.selectedAwardFolderId && img.isConnected) img.src = url;
    } catch { if (img.isConnected) img.alt = '이미지를 다시 눌러 확인하세요'; }
  };
  if (typeof IntersectionObserver !== 'undefined') {
    awardImageObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      awardImageObserver.unobserve(entry.target);
      loadThumbnail(entry.target);
    }), { rootMargin: '160px' });
  }
  root.querySelectorAll('[data-award-thumbnail]').forEach((img) => {
    if (awardImageObserver) awardImageObserver.observe(img);
    else loadThumbnail(img);
  });
  root.querySelectorAll('[data-award-image]').forEach((link) => {
    link.onclick = async (event) => {
      event.preventDefault();
      const file = state.awardFiles.find((item) => String(item.id) === link.dataset.awardImage);
      if (!file || file.recordId !== state.selectedAwardFolderId) return;
      const image = $('awardLightboxImage');
      image.removeAttribute('src');
      image.dataset.fileId = file.id;
      const cached = awardImages.peek(file.id);
      if (cached) image.src = cached;
      $('awardLightboxImage').alt = file.fileName || '수상작';
      $('awardLightboxCaption').textContent = file.fileName || '수상작';
      $('awardLightbox').showModal();
      try {
        const url = cached || await awardImages.get(file.id);
        if ($('awardLightbox').open && image.dataset.fileId === file.id && file.recordId === state.selectedAwardFolderId) image.src = url;
      } catch (error) {
        if ($('awardLightbox').open && image.dataset.fileId === file.id) $('awardLightboxCaption').textContent = error.message;
      }
    };
  });
}

async function loadAwardFolders() {
  if (!state.context?.authenticated) return;
  try {
    const response = await api('/api/data-core/records?recordType=competition-award-folder&sourceApp=competition&limit=100');
    state.awardFolders = (response.records || []).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
    if (!state.awardFolders.some((folder) => folder.id === state.selectedAwardFolderId)) {
      state.selectedAwardFolderId = state.awardFolders[0]?.id || null;
    }
    renderAwardFolders();
    await loadAwardFiles();
  } catch (error) {
    state.awardFolders = [];
    state.awardFiles = [];
    renderAwardFolders();
    renderAwardLibraryFiles();
    if (error.status !== 401) toast(error.message, 'error');
  }
}

async function loadAwardFiles() {
  clearAwardImages();
  awardSelected.clear();
  const request = ++awardFilesRequest;
  const folder = selectedAwardFolder();
  state.awardFiles = [];
  awardFilesLoading = Boolean(folder && state.context?.authenticated);
  $('awardLightbox').close();
  renderAwardLibraryFiles();
  if (!folder || !state.context?.authenticated) {
    return;
  }
  try {
    const response = await api(`/api/data-core/files?recordId=${encodeURIComponent(folder.id)}&category=competition-material&limit=100`);
    // A slow response must never replace the currently selected folder's gallery.
    if (request !== awardFilesRequest || folder.id !== state.selectedAwardFolderId) return;
    state.awardFiles = (response.files || []).filter((file) => file.recordId === folder.id);
  } catch (error) {
    if (request !== awardFilesRequest || folder.id !== state.selectedAwardFolderId) return;
    state.awardFiles = [];
    if (error.status !== 401) toast(error.message, 'error');
  }
  awardFilesLoading = false;
  renderAwardLibraryFiles();
}

async function createAwardFolder(event) {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const response = await api('/api/data-core/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recordType: 'competition-award-folder',
        sourceApp: 'competition',
        title: $('awardFolderTitle').value.trim(),
        campusId: $('awardFolderCampus').value || null,
        visibility: isSuperAdmin() ? 'organization' : 'campus',
        tags: ['competition-award-library'],
      }),
    });
    state.selectedAwardFolderId = response.record.id;
    event.target.reset();
    closeModal('awardFolderModal');
    toast('수상작 폴더를 만들었습니다.');
    await loadAwardFolders();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function deleteAwardFolder() {
  const folder = selectedAwardFolder();
  if (!folder) return;
  if (state.awardFiles.length) return toast('폴더 안에 수상작이 있습니다. 먼저 수상작을 삭제하세요.', 'error');
  if (!confirm(`'${folder.title}' 빈 폴더를 삭제할까요?`)) return;
  try {
    await api(`/api/data-core/records/${encodeURIComponent(folder.id)}`, { method: 'DELETE' });
    state.selectedAwardFolderId = null;
    toast('빈 수상작 폴더를 삭제했습니다.');
    await loadAwardFolders();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openAwardUpload() {
  const folder = selectedAwardFolder();
  if (!folder) return toast('수상작 폴더를 먼저 선택하세요.', 'error');
  $('uploadRecordId').value = folder.id;
  $('uploadCategory').value = 'competition-material';
  $('uploadCampus').value = folder.campusId || '';
  $('uploadCampus').disabled = true;
  $('uploadCategory').disabled = true;
  $('uploadTargetNotice').textContent = `'${folder.title}' 폴더에 연결해 업로드합니다.`;
  $('uploadTargetNotice').classList.remove('hidden');
  openModal('uploadModal');
}

function competitionGuideTemplate(competition) {
  const meta = competitionMetadata(competition);
  const grades = Array.isArray(meta.targetGrades) ? meta.targetGrades : [];
  const practicalTypes = Array.isArray(meta.practicalTypes) ? meta.practicalTypes : [];
  return [
    `${competition.title} 참가 안내`,
    '',
    `대상: ${grades.join(', ') || '확인 필요'}`,
    `실기유형: ${practicalTypes.join(', ') || '확인 필요'}`,
    `접수기간: ${[meta.applicationStart, meta.applicationEnd].filter(Boolean).join(' ~ ') || '확인 필요'}`,
    `접수방법: ${meta.applicationMethod || '확인 필요'}`,
    `시상/상금: ${meta.prize || '확인 필요'}`,
    '',
    '참가를 희망하는 학생은 담당 선생님과 준비 일정 및 접수 서류를 확인해 주세요.',
  ].join('\n');
}

function renderGuideDraft(competition) {
  const draft = state.guideDraft?.competitionId === competition.id ? state.guideDraft.text : '';
  if (!draft) {
    return `<section class="detail-section">
      <h4>학원용 안내문</h4>
      <p>대회 정보로 만드는 템플릿 기반 초안입니다.</p>
      <button class="secondary-btn" id="createCompetitionGuideDraft">안내문 초안 만들기</button>
    </section>`;
  }
  return `<section class="detail-section guide-draft-section">
    <div class="detail-section-head">
      <div><h4>학원용 안내문 초안</h4><p>템플릿 기반 초안입니다. 필요한 문구를 바로 수정할 수 있습니다.</p></div>
      <button class="ghost-btn" id="createCompetitionGuideDraft">초안 다시 만들기</button>
    </div>
    <textarea id="competitionGuideDraft" rows="10" aria-label="학원용 안내문 초안">${h(draft)}</textarea>
    <div class="guide-draft-actions"><button class="primary-btn" id="copyCompetitionGuideDraft">복사</button></div>
  </section>`;
}

function renderResults(results = []) {
  if (!results.length) return '<div class="empty-state compact">아직 캠퍼스별 출품·수상 데이터가 없습니다.</div>';
  return `<div class="result-grid">${results.map((result) => {
    const rate = result.awardRate ?? result.award_rate;
    return `<article>
      <strong>${h(result.campusName || result.campus_name || '캠퍼스')}</strong>
      <span>출품 ${h(result.participants ?? 0)}명</span>
      <span>수상 ${h(result.winners ?? 0)}명</span>
      <b>${rate == null ? '-' : `${h(rate)}%`}</b>
    </article>`;
  }).join('')}</div>`;
}

function renderCompetitionDetail(competition) {
  const detail = $('competitionDetail');
  if (!detail) return;
  if (!competition) {
    detail.innerHTML = '<div class="empty-state">좌측에서 대회를 선택하세요.</div>';
    return;
  }
  const meta = competitionMetadata(competition);
  const majors = Array.isArray(meta.majors) ? meta.majors : [];
  const grades = Array.isArray(meta.targetGrades) ? meta.targetGrades : [];
  const practicalTypes = Array.isArray(meta.practicalTypes) ? meta.practicalTypes : [];
  detail.innerHTML = `
    ${renderCompetitionPoster(competition, state.competitionFiles)}
    <div class="competition-detail-head">
      <div>
        <span class="status-pill ${h(competition.competitionStatus)}">${h(statusLabel(competition.competitionStatus))}</span>
        <h3>${h(competition.title)}</h3>
        <p>${h(competition.summary || '상세 설명이 아직 등록되지 않았습니다.')}</p>
      </div>
      <div class="row-actions">${guideLinks(meta, state.competitionFiles)}</div>
    </div>
    <dl class="detail-list">
      <div><dt>주최/주관</dt><dd>${h(meta.organizer || '-')}</dd></div>
      <div><dt>대학/기관</dt><dd>${h(meta.hostSchool || '-')}</dd></div>
      <div><dt>접수기간</dt><dd>${h([meta.applicationStart, meta.applicationEnd].filter(Boolean).join(' ~ ') || '-')}</dd></div>
      <div><dt>대회일/발표일</dt><dd>${h([meta.eventDate, meta.resultDate].filter(Boolean).join(' / ') || '-')}</dd></div>
      <div><dt>대상학년</dt><dd>${h(grades.join(', ') || '-')}</dd></div>
      <div><dt>전공</dt><dd>${h(majors.join(', ') || '-')}</dd></div>
      <div><dt>실기유형</dt><dd>${h(practicalTypes.join(', ') || '-')}</dd></div>
      <div><dt>접수방법</dt><dd>${h(meta.applicationMethod || '-')}</dd></div>
      <div><dt>시상/상금</dt><dd>${h(meta.prize || '-')}</dd></div>
    </dl>
    <section class="detail-section">
      <h4>상세설명</h4>
      <p>${h(competition.content || competition.contentText || meta.description || '등록된 상세설명이 없습니다.')}</p>
    </section>
    ${renderGuideDraft(competition)}
    <section class="detail-section">
      <h4>캠퍼스별 출품·수상 현황</h4>
      ${renderResults(state.competitionResults)}
    </section>
    <section class="detail-section">
      <h4>수상작 파일/이미지</h4>
      ${renderCompetitionAwardFiles(state.competitionFiles)}
    </section>
  `;
  bindCompetitionDetailEvents(competition);
}

function bindCompetitionDetailEvents(competition) {
  const create = $('createCompetitionGuideDraft');
  if (create) {
    create.onclick = () => {
      state.guideDraft = { competitionId: competition.id, text: competitionGuideTemplate(competition) };
      renderCompetitionDetail(competition);
    };
  }
  const textarea = $('competitionGuideDraft');
  if (textarea) {
    textarea.oninput = () => {
      state.guideDraft = { competitionId: competition.id, text: textarea.value };
    };
  }
  const copy = $('copyCompetitionGuideDraft');
  if (copy) {
    copy.onclick = async () => {
      const text = $('competitionGuideDraft')?.value.trim() || '';
      if (!text) return toast('복사할 안내문 초안이 없습니다.', 'error');
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const field = $('competitionGuideDraft');
          field.focus();
          field.select();
          if (!document.execCommand('copy')) throw new Error('copy failed');
        }
        toast('안내문 초안을 복사했습니다.');
      } catch {
        toast('자동 복사에 실패했습니다. 안내문을 선택해 복사해 주세요.', 'error');
      }
    };
  }
}

async function loadSelectedCompetition() {
  const selected = state.competitions.find((item) => item.id === state.selectedCompetitionId);
  state.competitionResults = [];
  state.competitionFiles = [];
  renderCompetitionDetail(selected);
  if (!selected) return;
  try {
    const [detailResponse, resultsResponse, filesResponse] = await Promise.all([
      api(`/api/data-core/competitions/${encodeURIComponent(selected.id)}`),
      api(`/api/data-core/competitions/${encodeURIComponent(selected.id)}/results`),
      api(`/api/data-core/files?recordId=${encodeURIComponent(selected.id)}&sourceApp=competition&limit=100`),
    ]);
    const detailed = detailResponse.competition || selected;
    state.competitionResults = resultsResponse.results || [];
    state.competitionFiles = filesResponse.files || [];
    renderCompetitionDetail(detailed);
  } catch {
    renderCompetitionDetail(selected);
  }
}

function commaList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function createCompetitionFromForm(event) {
  event.preventDefault();
  const payload = {
    campusId: $('competitionCampus').value || null,
    title: $('competitionTitle').value.trim(),
    year: $('competitionYear').value || null,
    organizer: $('competitionOrganizer').value.trim() || null,
    hostSchool: $('competitionSchool').value.trim() || null,
    competitionKind: 'practical-competition',
    applicationStart: $('competitionStart').value || null,
    applicationEnd: $('competitionEnd').value || null,
    eventDate: $('competitionDate').value || null,
    resultDate: $('competitionResultDate').value || null,
    majors: commaList($('competitionMajors').value),
    practicalTypes: commaList($('competitionTypes').value),
    summary: $('competitionSummary').value.trim() || null,
    content: $('competitionContent').value.trim() || null,
  };
  try {
    await api('/api/data-core/competitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('공모전·실기대회 정보를 DATA CORE에 저장했습니다.');
    closeModal('competitionModal');
    event.target.reset();
    await loadCompetitions();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadMemberships() {
  if (!isSuperAdmin()) return;
  try {
    const response = await api('/api/data-core/admin/memberships');
    const rows = response.memberships || [];
    $('membershipList').innerHTML = rows.length ? rows.map((item) => `<div class="membership-item">
      <div>
        <strong>${h(item.display_name || item.email || item.user_id)}</strong>
        <small>${h(item.email || '')} · ${h(item.campus_name || '전체 조직')} · ${h(roleLabel(item.role))}</small>
      </div>
      <button class="danger-btn" data-delete-membership="${h(item.id)}">해제</button>
    </div>`).join('') : '<div class="empty-state">등록된 권한이 없습니다.</div>';
    document.querySelectorAll('[data-delete-membership]').forEach((button) => {
      button.onclick = () => revokeMembership(button.dataset.deleteMembership);
    });
  } catch (error) {
    $('membershipList').innerHTML = `<div class="empty-state">${h(error.message)}</div>`;
  }
}

async function grantMembership(event) {
  event.preventDefault();
  const role = $('memberRole').value;
  const payload = {
    email: $('memberEmail').value.trim(),
    role,
    campusId: role === 'SUPER_ADMIN' ? null : $('memberCampus').value,
  };
  try {
    await api('/api/data-core/admin/memberships', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('사용자 권한을 부여했습니다.');
    event.target.reset();
    await loadMemberships();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function revokeMembership(id) {
  if (!confirm('이 사용자의 DATA CORE 권한을 해제할까요?')) return;
  try {
    await api(`/api/data-core/admin/memberships/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('권한을 해제했습니다.');
    await loadMemberships();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function calendarDateKey(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function calendarRange() {
  const month = state.calendarMonth;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { from: calendarDateKey(first), to: calendarDateKey(last) };
}

function calendarEventTypeLabel(value) {
  return ({ class: '수업', admission: '입시', competition: '공모전', marketing: '홍보', holiday: '휴일', meeting: '회의', other: '기타' })[value] || '기타';
}

function calendarEventsForDate(date) {
  return state.calendarEvents.filter((event) => {
    const metadata = event.metadata || {};
    return metadata.startDate <= date && (metadata.endDate || metadata.startDate) >= date;
  });
}

function canManageCalendarEvent(event) {
  return isSuperAdmin() || event.createdByUserId === state.context?.user?.internalUserId;
}

function renderCalendar() {
  const homes = document.querySelectorAll('[data-calendar-home]');
  if (!homes.length) return;
  const month = state.calendarMonth;
  const { from, to } = calendarRange();
  const today = calendarDateKey(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - first.getDay());
  const gridEnd = new Date(month.getFullYear(), month.getMonth() + 1, 6 - last.getDay());
  const dates = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(new Date(cursor));
  }
  const selectedDate = state.calendarSelectedDate && state.calendarSelectedDate >= from && state.calendarSelectedDate <= to
    ? state.calendarSelectedDate
    : from;
  state.calendarSelectedDate = selectedDate;

  const grid = dates.map((date) => {
    const key = calendarDateKey(date);
    const events = calendarEventsForDate(key);
    const metadata = events.map((event) => event.metadata || {});
    const classes = [
      'calendar-day',
      date.getMonth() === month.getMonth() ? '' : 'outside',
      key === today ? 'today' : '',
      key === selectedDate ? 'selected' : '',
    ].filter(Boolean).join(' ');
    return `<button class="${classes}" type="button" data-calendar-date="${h(key)}" aria-label="${h(key)} 일정 보기">
      <span class="calendar-date">${date.getDate()}</span>
      ${events.slice(0, 2).map((event, index) => `<span class="calendar-event-chip ${h(metadata[index].eventType || 'other')}">${h(event.title)}</span>`).join('')}
      ${events.length > 2 ? `<span class="calendar-more">+${events.length - 2}</span>` : ''}
    </button>`;
  }).join('');

  const selectedEvents = calendarEventsForDate(selectedDate);
  const list = !state.context?.authenticated
    ? '<div class="empty-state compact">로그인 후 내부 일정을 확인할 수 있습니다.</div>'
    : selectedEvents.length
      ? `<h4>${h(selectedDate)} 일정</h4><div class="calendar-event-list">${selectedEvents.map((event) => {
        const metadata = event.metadata || {};
        const range = metadata.endDate ? `${metadata.startDate} ~ ${metadata.endDate}` : metadata.startDate;
        return `<article class="calendar-event-row"><div><strong>${h(event.title)}</strong><small>${h(calendarEventTypeLabel(metadata.eventType))} · ${h(event.campusName || '조직 공통')} · ${h(range)}${event.summary ? ` · ${h(event.summary)}` : ''}</small></div>${canManageCalendarEvent(event) ? `<div class="calendar-event-actions"><button class="ghost-btn" type="button" data-calendar-edit="${h(event.id)}">수정</button><button class="danger-btn" type="button" data-calendar-delete="${h(event.id)}">삭제</button></div>` : ''}</article>`;
      }).join('')}</div>`
      : `<div class="empty-state compact">${h(selectedDate)}에 등록된 일정이 없습니다.</div>`;

  homes.forEach((home) => {
    home.querySelector('[data-calendar-month]').textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
    home.querySelector('[data-calendar-grid]').innerHTML = grid;
    home.querySelector('[data-calendar-list]').innerHTML = list;
    home.querySelector('[data-calendar-add]').classList.toggle('hidden', !canWrite());
  });
  document.querySelectorAll('[data-calendar-date]').forEach((button) => {
    button.onclick = () => {
      state.calendarSelectedDate = button.dataset.calendarDate;
      renderCalendar();
    };
  });
  document.querySelectorAll('[data-calendar-edit]').forEach((button) => {
    button.onclick = () => openCalendarModal(state.calendarEvents.find((event) => event.id === button.dataset.calendarEdit));
  });
  document.querySelectorAll('[data-calendar-delete]').forEach((button) => {
    button.onclick = () => deleteCalendarEvent(button.dataset.calendarDelete);
  });
}

async function loadCalendar() {
  if (!state.context?.authenticated) {
    state.calendarEvents = [];
    renderCalendar();
    return;
  }
  const { from, to } = calendarRange();
  try {
    const response = await api(`/api/data-core/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    state.calendarEvents = response.events || [];
  } catch (error) {
    state.calendarEvents = [];
    if (error.status !== 401) toast(error.message, 'error');
  }
  renderCalendar();
}

function openCalendarModal(event = null) {
  if (!canWrite()) return;
  const date = state.calendarSelectedDate || calendarRange().from;
  const metadata = event?.metadata || {};
  $('calendarModalTitle').textContent = event ? '일정 수정' : '일정 등록';
  $('calendarEventId').value = event?.id || '';
  $('calendarTitle').value = event?.title || '';
  $('calendarStartDate').value = metadata.startDate || date;
  $('calendarEndDate').value = metadata.endDate || '';
  $('calendarEventType').value = metadata.eventType || 'other';
  $('calendarSummary').value = event?.summary || '';
  $('calendarCampus').value = event?.campusId || '';
  openModal('calendarModal');
}

async function saveCalendarEvent(event) {
  event.preventDefault();
  const id = $('calendarEventId').value;
  const campusId = $('calendarCampus').value || null;
  const payload = {
    title: $('calendarTitle').value.trim(),
    summary: $('calendarSummary').value.trim() || null,
    campusId,
    visibility: campusId ? 'campus' : 'organization',
    metadata: {
      startDate: $('calendarStartDate').value,
      endDate: $('calendarEndDate').value || undefined,
      allDay: true,
      eventType: $('calendarEventType').value,
    },
  };
  const button = $('calendarSubmitBtn');
  button.disabled = true;
  try {
    await api(id ? `/api/data-core/calendar/${encodeURIComponent(id)}` : '/api/data-core/calendar', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.calendarSelectedDate = payload.metadata.startDate;
    closeModal('calendarModal');
    await loadCalendar();
    toast(id ? '일정을 수정했습니다.' : '일정을 등록했습니다.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function deleteCalendarEvent(id) {
  const event = state.calendarEvents.find((item) => item.id === id);
  if (!event || !confirm(`'${event.title}' 일정을 삭제할까요?`)) return;
  try {
    await api(`/api/data-core/calendar/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadCalendar();
    toast('일정을 삭제했습니다.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('.nav-item[data-view], .feature-card[data-view]').forEach((button) => {
    button.onclick = () => switchView(button.dataset.view);
  });
  $('refreshFilesBtn').onclick = loadFiles;
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('fileCampusFilter').onchange = () => { clearSelectedFolder(); loadFiles(); };
  $('fileCategoryFilter').onchange = () => { clearSelectedFolder(); loadFiles(); };
  $('openUploadBtn').onclick = () => openModal('uploadModal');
  $('uploadForm').onsubmit = uploadFile;
  $('retryUploadsBtn').onclick = () => runUploadQueue(true);
  $('awardFolderPrev').onclick = () => moveAwardFolder(-1);
  $('awardFolderNext').onclick = () => moveAwardFolder(1);
  $('awardFolderTrack').addEventListener('scroll', updateAwardFolderArrows, {passive:true});
  window.addEventListener('resize', updateAwardFolderArrows);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('uploadModal').classList.contains('hidden')) closeModal('uploadModal');
    if (event.key === 'Enter' && $('awardDeleteDialog').open && document.activeElement === $('confirmAwardDeleteBtn')) event.preventDefault();
  });
  $('competitionForm').onsubmit = createCompetitionFromForm;
  $('awardFolderForm').onsubmit = createAwardFolder;
  $('openAwardFolderBtn').onclick = () => openModal('awardFolderModal');
  $('closeAwardLightboxBtn').onclick = () => $('awardLightbox').close();
  $('awardLightbox').addEventListener('close', () => {
    $('awardLightboxImage').removeAttribute('src');
    $('awardLightboxImage').alt = '';
    $('awardLightboxCaption').textContent = '';
  });
  ['awardFolderModal', 'awardLightbox', 'awardDeleteDialog'].forEach((id) => {
    $(id).addEventListener('click', (event) => {
      if (event.target !== $(id)) return;
      const rect = $(id).getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(id).close();
    });
  });
  $('openAwardUploadBtn').onclick = openAwardUpload;
  $('deleteAwardFolderBtn').onclick = deleteAwardFolder;
  document.querySelectorAll('[data-competition-source]').forEach((button) => {
    button.onclick = () => previewCompetitionSource(button.dataset.competitionSource);
  });
  $('refreshCompetitionSourcesBtn').onclick = async () => {
    await previewCompetitionSource('artmd');
    await previewCompetitionSource('mgood');
  };
  $('deleteSelectedAwardsBtn').onclick = requestAwardDelete;
  $('cancelAwardDeleteBtn').onclick = () => $('awardDeleteDialog').close();
  $('confirmAwardDeleteBtn').onclick = deleteSelectedAwards;
  window.addEventListener('pagehide', clearAwardImages);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearAwardImages();
    else if (state.currentView === 'competitions') loadAwardFiles();
  });
  $('membershipForm').onsubmit = grantMembership;
  $('refreshMembershipsBtn').onclick = loadMemberships;
  document.querySelectorAll('[data-calendar-prev]').forEach((button) => {
    button.onclick = () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      state.calendarSelectedDate = calendarRange().from;
      loadCalendar();
    };
  });
  document.querySelectorAll('[data-calendar-next]').forEach((button) => {
    button.onclick = () => {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      state.calendarSelectedDate = calendarRange().from;
      loadCalendar();
    };
  });
  document.querySelectorAll('[data-calendar-today]').forEach((button) => {
    button.onclick = () => {
      const today = new Date();
      state.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      state.calendarSelectedDate = calendarDateKey(today);
      loadCalendar();
    };
  });
  document.querySelectorAll('[data-calendar-add]').forEach((button) => {
    button.onclick = () => openCalendarModal();
  });
  $('calendarForm').onsubmit = saveCalendarEvent;
  $('memberRole').onchange = () => {
    $('memberCampus').disabled = $('memberRole').value === 'SUPER_ADMIN';
  };
  $('logoutBtn').onclick = async () => {
    clearAwardImages();
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('로그아웃에 실패했습니다.');
      location.assign('/data-core/counseling');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.onclick = () => closeModal(button.dataset.closeModal);
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  $('uploadFile').onchange = () => {
    state.droppedFiles = [];
    updateUploadFiles();
  };
  const drop = $('fileDrop');
  ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.remove('dragging');
  }));
  drop.addEventListener('drop', (event) => {
    if (uploadQueue?.running) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    state.droppedFiles = files;
    updateUploadFiles();
  });

  window.addEventListener('popstate', () => switchView(initialViewFromPath(), { push: false }));
}

async function init() {
  bindEvents();
  switchView(initialViewFromPath(), { push: false });
  await loadHealthAndContext();
  renderCampusSelectors();
  if (state.context?.authenticated && state.currentView === 'library') {
    await loadFiles();
  }
  if (state.context?.authenticated && state.currentView === 'competitions') {
    await Promise.all([loadCompetitions(), loadAwardFolders()]);
  }
}

init().catch((error) => {
  console.error(error);
  showNotice(`DATA CORE 화면을 시작하지 못했습니다: ${error.message}`);
});

const state = {
  health: null,
  context: null,
  campuses: [],
  files: [],
  currentView: 'library',
  droppedFile: null,
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
    'student-artwork': '학생작품',
    'class-photo': '수업사진',
    'academy-photo': '학원사진',
    'competition-poster': '공모전 포스터',
    'competition-guide': '공모전 요강',
    'award-work': '수상작',
    'admission-guide': '입시요강',
    'research-work': '연구작',
    'document': '문서',
  })[category] || category || '기타';
}

function sourceLabel(source) {
  return ({
    blog: '블로그', instagram: '인스타그램', competition: '공모전', admissions: '입시',
    education: '교육·수업', 'dream-roadmap': '꿈·전공 로드맵', 'data-core': 'DATA CORE'
  })[source] || source || '공통';
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
  })[status] || status;
}

function canWrite() {
  return Boolean(state.context?.canWrite);
}

function isSuperAdmin() {
  return Boolean(state.context?.isSuperAdmin);
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => section.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  const title = ({
    library: '자료보관함', search: '통합검색', competitions: '공모전·실기대회', admin: '권한관리'
  })[view];
  $('pageTitle').textContent = title || 'DATA CORE';
  if (view === 'library') loadFiles();
  if (view === 'competitions') loadCompetitions();
  if (view === 'admin' && isSuperAdmin()) loadMemberships();
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
    const db = health?.bindings?.database ? 'D1✓' : 'D1×';
    const files = health?.bindings?.files ? 'R2✓' : 'R2×';
    card.querySelector('small').textContent = `${db} · ${files}`;
    $('storageStatus').textContent = '점검 필요';
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
  const membershipText = context.isSuperAdmin
    ? '마스터 관리자'
    : context.memberships?.length
      ? context.memberships.map((m) => `${m.campusName || '공통'} · ${roleLabel(m.role)}`).join(' / ')
      : '권한 미부여';
  chip.querySelector('small').textContent = membershipText;
  chip.querySelector('.avatar').textContent = String(user.displayName || user.email || 'H').trim().slice(0, 1).toUpperCase();

  if (!context.canWrite) {
    showNotice('로그인은 확인됐지만 DATA CORE 사용 권한이 아직 부여되지 않았습니다. 마스터 관리자에게 캠퍼스 권한을 요청하세요.');
  } else {
    showNotice('');
  }

  $('adminNav').classList.toggle('hidden', !context.isSuperAdmin);
  $('openUploadBtn').classList.toggle('hidden', !context.canWrite);
  $('openCompetitionBtn').classList.toggle('hidden', !context.canWrite);
}

function fillCampusSelect(select, options = {}) {
  if (!select) return;
  const { all = false, allowOrganization = false } = options;
  const rows = [];
  if (all) rows.push('<option value="">전체 캠퍼스</option>');
  if (allowOrganization && isSuperAdmin()) rows.push('<option value="">조직 공통</option>');
  rows.push(...state.campuses.map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`));
  select.innerHTML = rows.join('');
}

function renderCampusSelectors() {
  fillCampusSelect($('fileCampusFilter'), { all: true });
  fillCampusSelect($('searchCampusFilter'), { all: true });
  fillCampusSelect($('uploadCampus'), { allowOrganization: true });
  fillCampusSelect($('competitionCampus'), { allowOrganization: true });
  fillCampusSelect($('memberCampus'), { all: false });
  $('campusCount').textContent = state.campuses.length;
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
    const campusResponse = await api('/api/data-core/campuses');
    state.campuses = campusResponse.campuses || [];
    renderCampusSelectors();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadFiles() {
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams();
  const campusId = $('fileCampusFilter')?.value || '';
  const category = $('fileCategoryFilter')?.value || '';
  const q = $('fileSearchInput')?.value.trim() || '';
  if (campusId) params.set('campusId', campusId);
  if (category) params.set('category', category);
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
  $(id)?.classList.remove('hidden');
}

function closeModal(id) {
  $(id)?.classList.add('hidden');
}

async function uploadFile(event) {
  event.preventDefault();
  const input = $('uploadFile');
  const file = state.droppedFile || input.files?.[0];
  if (!file) return toast('업로드할 파일을 선택하세요.', 'error');

  const button = $('uploadSubmitBtn');
  button.disabled = true;
  button.textContent = '업로드 중...';
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('campusId', $('uploadCampus').value || '');
    form.append('area', $('uploadArea').value);
    form.append('category', $('uploadCategory').value);
    form.append('sourceApp', 'data-core-library');
    form.append('ownerId', 'shared');
    form.append('year', String(new Date().getFullYear()));
    await api('/api/data-core/files', { method: 'POST', body: form });
    toast('DATA CORE에 파일을 저장했습니다.');
    closeModal('uploadModal');
    event.target.reset();
    state.droppedFile = null;
    $('selectedFileName').textContent = '최대 100MB';
    await loadFiles();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '중앙 저장소에 업로드';
  }
}

async function runGlobalSearch() {
  const q = $('globalSearchInput').value.trim();
  if (!q) return toast('검색어를 입력하세요.', 'error');
  const params = new URLSearchParams({ q, limit: '50' });
  const source = $('searchSourceFilter').value;
  const campusId = $('searchCampusFilter').value;
  if (source) params.set('sourceApp', source);
  if (campusId) params.set('campusId', campusId);

  const container = $('searchResults');
  container.innerHTML = '<div class="panel">검색 중...</div>';
  try {
    const response = await api(`/api/data-core/search?${params}`);
    const results = response.results || [];
    if (!results.length) {
      container.innerHTML = '<div class="panel empty-state">검색 결과가 없습니다.</div>';
      return;
    }
    container.innerHTML = results.map((record) => `<article class="search-card">
      <div class="search-card-head">
        <div><h3>${h(record.title)}</h3><p>${h(record.contentSnippet || record.summary || '')}</p></div>
        <span class="pill">${h(sourceLabel(record.sourceApp))}</span>
      </div>
      <div class="search-meta">
        ${record.campusName ? `<span class="pill">${h(record.campusName)}</span>` : '<span class="pill">조직 공통</span>'}
        <span class="pill">${h(record.recordType)}</span>
        ${(record.tags || []).slice(0, 8).map((tag) => `<span class="pill">#${h(tag)}</span>`).join('')}
      </div>
    </article>`).join('');
  } catch (error) {
    container.innerHTML = `<div class="panel empty-state">${h(error.message)}</div>`;
  }
}

async function loadCompetitions() {
  if (!state.context?.authenticated) return;
  const list = $('competitionList');
  list.innerHTML = '<div class="panel">불러오는 중...</div>';
  try {
    const response = await api('/api/data-core/competitions?limit=100');
    const competitions = response.competitions || [];
    if (!competitions.length) {
      list.innerHTML = '<div class="panel empty-state">등록된 공모전·실기대회가 없습니다.</div>';
      return;
    }
    list.innerHTML = competitions.map((competition) => {
      const meta = competition.metadata || {};
      const dates = [meta.applicationStart, meta.applicationEnd].filter(Boolean).join(' ~ ');
      const majors = Array.isArray(meta.majors) ? meta.majors : [];
      const practicalTypes = Array.isArray(meta.practicalTypes) ? meta.practicalTypes : [];
      return `<article class="competition-card">
        <div>
          <h3>${h(competition.title)}</h3>
          <p>${h(competition.summary || '상세 정보를 확인하세요.')}</p>
          <div class="competition-meta">
            ${meta.hostSchool ? `<span class="pill">${h(meta.hostSchool)}</span>` : ''}
            ${dates ? `<span class="pill">접수 ${h(dates)}</span>` : ''}
            ${majors.slice(0, 4).map((item) => `<span class="pill">${h(item)}</span>`).join('')}
            ${practicalTypes.slice(0, 4).map((item) => `<span class="pill">${h(item)}</span>`).join('')}
          </div>
        </div>
        <span class="status-pill ${h(competition.competitionStatus)}">${h(statusLabel(competition.competitionStatus))}</span>
      </article>`;
    }).join('');
  } catch (error) {
    list.innerHTML = `<div class="panel empty-state">${h(error.message)}</div>`;
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

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.onclick = () => switchView(button.dataset.view);
  });
  $('refreshFilesBtn').onclick = loadFiles;
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('fileCampusFilter').onchange = loadFiles;
  $('fileCategoryFilter').onchange = loadFiles;
  $('openUploadBtn').onclick = () => openModal('uploadModal');
  $('uploadForm').onsubmit = uploadFile;
  $('globalSearchBtn').onclick = runGlobalSearch;
  $('globalSearchInput').onkeydown = (event) => { if (event.key === 'Enter') runGlobalSearch(); };
  $('openCompetitionBtn').onclick = () => openModal('competitionModal');
  $('competitionForm').onsubmit = createCompetitionFromForm;
  $('membershipForm').onsubmit = grantMembership;
  $('refreshMembershipsBtn').onclick = loadMemberships;
  $('memberRole').onchange = () => {
    $('memberCampus').disabled = $('memberRole').value === 'SUPER_ADMIN';
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
    state.droppedFile = null;
    const file = $('uploadFile').files?.[0];
    $('selectedFileName').textContent = file ? `${file.name} · ${formatBytes(file.size)}` : '최대 100MB';
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
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    state.droppedFile = file;
    $('selectedFileName').textContent = `${file.name} · ${formatBytes(file.size)}`;
  });
}

async function init() {
  bindEvents();
  await loadHealthAndContext();
  renderCampusSelectors();
  if (state.context?.authenticated) {
    await loadFiles();
  }
}

init().catch((error) => {
  console.error(error);
  showNotice(`DATA CORE 화면을 시작하지 못했습니다: ${error.message}`);
});

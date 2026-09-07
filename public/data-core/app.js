const ORGANIZATION_FOLDERS = [
  { label: '공통자료', category: 'document' },
  { label: '대학요강', category: 'admission-guide' },
  { label: '공모전원본', category: 'competition-guide' },
  { label: '로드맵기준자료', category: 'research-work' },
  { label: '브랜드자료', category: 'academy-photo' },
];

const CAMPUS_FOLDERS = [
  { label: '수업사진', category: 'class-photo' },
  { label: '학생그림', category: 'student-artwork' },
  { label: '학원사진', category: 'academy-photo' },
  { label: '공모전·실기대회', category: 'competition-poster' },
  { label: '입시자료', category: 'admission-guide' },
  { label: '상담자료', category: 'document' },
  { label: '블로그소스', category: 'class-photo', sourceApp: 'blog' },
  { label: '인스타소스', category: 'academy-photo', sourceApp: 'instagram' },
  { label: '홍보자료', category: 'academy-photo' },
];

const state = {
  health: null,
  context: null,
  campuses: [],
  files: [],
  competitions: [],
  competitionResults: [],
  selectedCompetitionId: null,
  currentMode: 'mode',
  currentView: 'mode-home',
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
  if (view === 'competitions') loadCompetitions();
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
    $('openCompetitionBtn').classList.add('hidden');
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
  $('openCompetitionBtn').classList.toggle('hidden', !context.canWrite);
  updateSidebar();
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

function folderButton(folder, campusId = '') {
  const attrs = [
    `data-folder-category="${h(folder.category || '')}"`,
    `data-folder-campus="${h(campusId)}"`,
  ];
  if (folder.sourceApp) attrs.push(`data-folder-source="${h(folder.sourceApp)}"`);
  return `<button class="folder-chip" ${attrs.join(' ')}>
    <span>▣</span>
    <strong>${h(folder.label)}</strong>
  </button>`;
}

function renderLibraryFolders() {
  const container = $('folderGroups');
  if (!container) return;
  const campusGroups = state.campuses.map((campus) => `<article class="folder-group" data-campus-folder="${h(campus.id)}">
    <div class="folder-title">
      <strong>${h(campus.name)}</strong>
      <small>캠퍼스 폴더</small>
    </div>
    <div class="folder-chip-grid">${CAMPUS_FOLDERS.map((folder) => folderButton(folder, campus.id)).join('')}</div>
  </article>`).join('');
  container.innerHTML = `
    <article class="folder-group organization-folder">
      <div class="folder-title">
        <strong>조직 공통</strong>
        <small>캠퍼스와 분리된 공통 자료</small>
      </div>
      <div class="folder-chip-grid">${ORGANIZATION_FOLDERS.map((folder) => folderButton(folder)).join('')}</div>
    </article>
    ${campusGroups || '<div class="empty-state">로그인 후 접근 가능한 캠퍼스 폴더가 표시됩니다.</div>'}
  `;
  document.querySelectorAll('[data-folder-category]').forEach((button) => {
    button.onclick = () => {
      $('fileCampusFilter').value = button.dataset.folderCampus || '';
      $('fileCategoryFilter').value = button.dataset.folderCategory || '';
      loadFiles();
    };
  });
}

function renderCampusSelectors() {
  fillCampusSelect($('fileCampusFilter'), { all: true });
  fillCampusSelect($('uploadCampus'), { allowOrganization: true });
  fillCampusSelect($('competitionCampus'), { allowOrganization: true });
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

function competitionMetadata(competition) {
  return competition?.metadata || {};
}

function arrayIncludes(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return (Array.isArray(list) ? list : []).some((item) => String(item).toLowerCase().includes(q));
}

function filteredCompetitions() {
  const q = $('competitionSearchInput')?.value.trim().toLowerCase() || '';
  const status = $('competitionStatusFilter')?.value || '';
  const grade = $('competitionGradeFilter')?.value || '';
  const major = $('competitionMajorFilter')?.value || '';
  const practical = $('competitionPracticalFilter')?.value || '';
  return state.competitions.filter((competition) => {
    const meta = competitionMetadata(competition);
    const text = [
      competition.title,
      competition.summary,
      meta.organizer,
      meta.hostSchool,
      meta.applicationMethod,
      meta.sourceUrl,
      meta.guideUrl,
      ...(Array.isArray(meta.majors) ? meta.majors : []),
      ...(Array.isArray(meta.practicalTypes) ? meta.practicalTypes : []),
      ...(Array.isArray(meta.targetGrades) ? meta.targetGrades : []),
    ].join(' ').toLowerCase();
    return (!q || text.includes(q))
      && (!status || competition.competitionStatus === status)
      && arrayIncludes(meta.targetGrades, grade)
      && arrayIncludes(meta.majors, major)
      && arrayIncludes(meta.practicalTypes, practical);
  });
}

async function loadCompetitions() {
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

function guideLinks(meta) {
  const links = [];
  if (meta.guideUrl) links.push(`<a class="ghost-btn" href="${h(meta.guideUrl)}" target="_blank" rel="noopener">요강 PDF/링크</a>`);
  if (meta.sourceUrl) links.push(`<a class="ghost-btn" href="${h(meta.sourceUrl)}" target="_blank" rel="noopener">원문 링크</a>`);
  return links.join('');
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
  if (!competition) {
    detail.innerHTML = '<div class="empty-state">좌측에서 대회를 선택하세요.</div>';
    return;
  }
  const meta = competitionMetadata(competition);
  const majors = Array.isArray(meta.majors) ? meta.majors : [];
  const grades = Array.isArray(meta.targetGrades) ? meta.targetGrades : [];
  const practicalTypes = Array.isArray(meta.practicalTypes) ? meta.practicalTypes : [];
  detail.innerHTML = `
    <div class="competition-poster">
      <span>Poster</span>
      <strong>${h(competition.title)}</strong>
    </div>
    <div class="competition-detail-head">
      <div>
        <span class="status-pill ${h(competition.competitionStatus)}">${h(statusLabel(competition.competitionStatus))}</span>
        <h3>${h(competition.title)}</h3>
        <p>${h(competition.summary || '상세 설명이 아직 등록되지 않았습니다.')}</p>
      </div>
      <div class="row-actions">${guideLinks(meta)}</div>
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
    <section class="detail-section">
      <h4>학원용 안내문 초안</h4>
      <p>${h(`${competition.title} 준비 안내\n대상: ${grades.join(', ') || '확인 필요'}\n실기유형: ${practicalTypes.join(', ') || '확인 필요'}\n접수: ${[meta.applicationStart, meta.applicationEnd].filter(Boolean).join(' ~ ') || '확인 필요'}`)}</p>
    </section>
    <section class="detail-section">
      <h4>캠퍼스별 출품·수상 현황</h4>
      ${renderResults(state.competitionResults)}
    </section>
    <section class="detail-section">
      <h4>수상작 파일/이미지</h4>
      <p>DATA CORE 파일에서 recordId와 공모전 파일 분류로 연결된 자료를 사용합니다.</p>
    </section>
  `;
}

async function loadSelectedCompetition() {
  const selected = state.competitions.find((item) => item.id === state.selectedCompetitionId);
  state.competitionResults = [];
  renderCompetitionDetail(selected);
  if (!selected) return;
  try {
    const [detailResponse, resultsResponse] = await Promise.all([
      api(`/api/data-core/competitions/${encodeURIComponent(selected.id)}`),
      api(`/api/data-core/competitions/${encodeURIComponent(selected.id)}/results`),
    ]);
    const detailed = detailResponse.competition || selected;
    state.competitionResults = resultsResponse.results || [];
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

function bindEvents() {
  document.querySelectorAll('[data-mode-card]').forEach((card) => {
    card.onclick = (event) => {
      event.preventDefault();
      switchView(card.dataset.modeCard === 'work' ? 'work-home' : 'counseling-home');
    };
  });
  document.querySelectorAll('.nav-item[data-view], .feature-card[data-view]').forEach((button) => {
    button.onclick = () => switchView(button.dataset.view);
  });
  $('refreshFilesBtn').onclick = loadFiles;
  $('fileSearchBtn').onclick = loadFiles;
  $('fileSearchInput').onkeydown = (event) => { if (event.key === 'Enter') loadFiles(); };
  $('fileCampusFilter').onchange = loadFiles;
  $('fileCategoryFilter').onchange = loadFiles;
  $('openUploadBtn').onclick = () => openModal('uploadModal');
  $('uploadForm').onsubmit = uploadFile;
  $('openCompetitionBtn').onclick = () => openModal('competitionModal');
  $('competitionForm').onsubmit = createCompetitionFromForm;
  $('competitionSearchBtn').onclick = () => { renderCompetitions(); loadSelectedCompetition(); };
  ['competitionStatusFilter', 'competitionGradeFilter', 'competitionMajorFilter', 'competitionPracticalFilter'].forEach((id) => {
    $(id).onchange = () => { renderCompetitions(); loadSelectedCompetition(); };
  });
  $('competitionSearchInput').onkeydown = (event) => {
    if (event.key === 'Enter') {
      renderCompetitions();
      loadSelectedCompetition();
    }
  };
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
    await loadCompetitions();
  }
}

init().catch((error) => {
  console.error(error);
  showNotice(`DATA CORE 화면을 시작하지 못했습니다: ${error.message}`);
});

const state = {
  context: null,
  campuses: [],
  trash: [],
  backups: [],
  diagnostics: null,
  knowledgeStatus: null,
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

function notice(message) {
  const el = $('notice');
  if (!message) { el.classList.add('hidden'); return; }
  el.textContent = message;
  el.classList.remove('hidden');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function categoryLabel(category) {
  return ({
    'student-artwork': '학생작품', 'class-photo': '수업사진', 'academy-photo': '학원사진',
    'competition-poster': '공모전 포스터', 'competition-guide': '공모전 요강', 'award-work': '수상작',
    'admission-guide': '입시요강', 'research-work': '연구작', document: '문서',
  })[category] || category || '기타';
}

function roleLabel(context) {
  if (context?.isSuperAdmin) return '마스터';
  if (context?.memberships?.length) {
    const roles = new Set(context.memberships.map((m) => m.role));
    if (roles.has('CAMPUS_DIRECTOR')) return '캠퍼스 원장';
    if (roles.has('TEACHER')) return '교사';
    if (roles.has('STAFF')) return '직원';
  }
  return context?.authenticated ? '권한 미부여' : '로그인 필요';
}

function renderContext() {
  const context = state.context;
  $('roleStatus').textContent = roleLabel(context);
  $('userStatus').textContent = context?.user?.displayName || context?.user?.email || '사용자 정보 없음';
  ['backupPanel','backupStatCard','diagnosticPanel','diagnosticStatCard','knowledgeSyncPanel','knowledgeStatCard']
    .forEach((id) => $(id)?.classList.toggle('hidden', !context?.isSuperAdmin));
  if (!context?.authenticated) notice('로그인이 필요합니다. DATA CORE에 로그인한 뒤 다시 접근하세요.');
  else if (!context?.canWrite) notice('DATA CORE 사용 권한이 아직 부여되지 않았습니다. 마스터 관리자에게 캠퍼스 권한을 요청하세요.');
  else notice('');
}

function fillCampuses() {
  const select = $('trashCampus');
  select.innerHTML = '<option value="">전체 캠퍼스</option>' + state.campuses
    .map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`).join('');
}

async function loadContext() {
  try {
    state.context = await api('/api/data-core/context');
    renderContext();
    if (!state.context?.authenticated) return;
    const response = await api('/api/data-core/campuses');
    state.campuses = response.campuses || [];
    fillCampuses();
  } catch (error) { notice(error.message); }
}

async function loadKnowledgeStatus() {
  if (!state.context?.isSuperAdmin) return;
  try {
    const response = await api('/api/data-core/admin/knowledge/admissions/status');
    state.knowledgeStatus = response.status || null;
    renderKnowledgeStatus();
  } catch (error) {
    state.knowledgeStatus = null;
    renderKnowledgeStatus();
    toast(error.message, 'error');
  }
}

function renderKnowledgeStatus() {
  const status = state.knowledgeStatus || {};
  const counts = status.counts || {};
  const universities = Number(counts.university || 0);
  const programs = Number(counts.university_program || 0);
  const admissions = Number(counts.admission_method || 0);
  $('knowledgeUniversities').textContent = universities;
  $('knowledgePrograms').textContent = programs;
  $('knowledgeAdmissions').textContent = admissions;
  $('knowledgeLastSync').textContent = formatDate(status.lastSyncedAt);
  $('knowledgeStatus').textContent = `${universities}개 대학`;
  $('knowledgeDate').textContent = status.lastSyncedAt ? formatDate(status.lastSyncedAt) : '동기화 전';
}

async function syncKnowledge() {
  if (!state.context?.isSuperAdmin) return;
  if (!confirm('현재 입시컨설팅 대학 데이터를 꿈·전공 로드맵 지식 그래프에 동기화할까요? 원본 입시데이터는 수정하지 않습니다.')) return;
  const button = $('syncKnowledgeBtn');
  button.disabled = true;
  button.textContent = '동기화 중...';
  try {
    const response = await api('/api/data-core/admin/knowledge/admissions/sync', { method: 'POST' });
    const result = response.sync || {};
    $('knowledgeSyncResult').innerHTML = `입시 원본 ${h(result.sourceRows || 0)}개에서 대학 ${h(result.universityNodes || 0)}개, 학과·프로그램 ${h(result.programNodes || 0)}개, 전형 ${h(result.admissionNodes || 0)}개를 동기화하고 관계 ${h(result.edges || 0)}개를 연결했습니다.`;
    $('knowledgeSyncResult').classList.remove('hidden');
    toast('입시데이터를 로드맵에 동기화했습니다.');
    await loadKnowledgeStatus();
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = '입시데이터 동기화'; }
}

async function loadTrash() {
  if (!state.context?.authenticated) return;
  const params = new URLSearchParams({ limit: '100' });
  const campusId = $('trashCampus').value;
  const q = $('trashSearch').value.trim();
  if (campusId) params.set('campusId', campusId);
  if (q) params.set('q', q);
  try {
    const response = await api(`/api/data-core/trash/files?${params}`);
    state.trash = response.files || [];
    renderTrash();
  } catch (error) { state.trash = []; renderTrash(); toast(error.message, 'error'); }
}

function renderTrash() {
  $('trashCount').textContent = state.trash.length;
  $('trashEmpty').classList.toggle('hidden', state.trash.length > 0);
  $('trashBody').innerHTML = state.trash.map((file) => `<tr>
    <td><div class="ops-file"><span class="ops-file-icon">${h(file.mimeType?.startsWith('image/') ? '▧' : '▤')}</span><div><strong>${h(file.fileName)}</strong><small>${h(file.mimeType || '')}</small></div></div></td>
    <td>${h(file.campusName || '조직 공통')}</td><td><span class="pill">${h(categoryLabel(file.category))}</span></td><td>${h(formatDate(file.deletedAt))}</td>
    <td><div class="row-actions"><button class="ghost-btn" data-restore-file="${h(file.id)}">복원</button>${state.context?.isSuperAdmin ? `<button class="danger-btn" data-purge-file="${h(file.id)}">영구삭제</button>` : ''}</div></td>
  </tr>`).join('');
  document.querySelectorAll('[data-restore-file]').forEach((button) => { button.onclick = () => restoreFile(button.dataset.restoreFile); });
  document.querySelectorAll('[data-purge-file]').forEach((button) => { button.onclick = () => purgeFile(button.dataset.purgeFile); });
}

async function restoreFile(fileId) {
  const file = state.trash.find((item) => String(item.id) === String(fileId));
  if (!confirm(`'${file?.fileName || '이 파일'}'을 자료보관함으로 복원할까요?`)) return;
  try { await api(`/api/data-core/trash/files/${encodeURIComponent(fileId)}/restore`, { method: 'POST' }); toast('파일을 복원했습니다.'); await loadTrash(); }
  catch (error) { toast(error.message, 'error'); }
}

async function purgeFile(fileId) {
  const file = state.trash.find((item) => String(item.id) === String(fileId));
  const label = file?.fileName || '이 파일';
  if (!confirm(`'${label}'을 영구 삭제하면 R2 원본도 사라지고 복구할 수 없습니다. 계속할까요?`)) return;
  if (!confirm('정말 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
  try { await api(`/api/data-core/trash/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); toast('파일을 영구 삭제했습니다.'); await loadTrash(); }
  catch (error) { toast(error.message, 'error'); }
}

async function loadBackups() {
  if (!state.context?.isSuperAdmin) return;
  try { const response = await api('/api/data-core/admin/backups'); state.backups = response.backups || []; renderBackups(); }
  catch (error) { state.backups = []; renderBackups(); toast(error.message, 'error'); }
}

function renderBackups() {
  const latest = state.backups[0];
  $('backupStatus').textContent = latest ? (latest.status === 'completed' ? '완료' : latest.status) : '없음';
  $('backupDate').textContent = latest ? formatDate(latest.completedAt || latest.createdAt) : '아직 백업이 없습니다';
  $('backupEmpty').classList.toggle('hidden', state.backups.length > 0);
  $('backupBody').innerHTML = state.backups.map((backup) => `<tr><td><span class="backup-state ${h(backup.status)}">${h(backup.status)}</span></td><td>${h(String(backup.totalRows ?? 0))}</td><td>${h(formatDate(backup.createdAt))}</td><td>${h(formatDate(backup.completedAt))}</td><td><div class="row-actions">${backup.manifestUrl ? `<a class="ghost-btn link-btn" href="${h(backup.manifestUrl)}">Manifest</a>` : ''}</div></td></tr>`).join('');
}

async function createBackup() {
  if (!state.context?.isSuperAdmin || !confirm('현재 DATA CORE 운영 데이터의 새 스냅샷 백업을 생성할까요?')) return;
  const button = $('createBackupBtn'); button.disabled = true; button.textContent = '백업 생성 중...';
  try { const response = await api('/api/data-core/admin/backups', { method: 'POST' }); toast(`백업을 완료했습니다. ${response.backup?.totalRows ?? 0}개 행을 스냅샷했습니다.`); await loadBackups(); }
  catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = '새 백업 생성'; }
}

function renderDiagnostics() {
  const result = state.diagnostics; const checks = result?.checks || [];
  $('diagnosticEmpty').classList.toggle('hidden', checks.length > 0);
  $('diagnosticBody').innerHTML = checks.map((check) => `<tr><td><strong>${h(check.label)}</strong></td><td><span class="diagnostic-state ${check.ok ? 'ok' : 'fail'}">${check.ok ? '정상' : '실패'}</span></td><td>${h(check.detail)}</td><td>${h(String(check.durationMs ?? 0))}ms</td></tr>`).join('');
  if (!result) { $('diagnosticStatus').textContent = '미실행'; $('diagnosticDate').textContent = '마스터 전용'; return; }
  $('diagnosticStatus').textContent = result.ok ? '정상' : '점검 필요'; $('diagnosticDate').textContent = formatDate(result.completedAt);
}

async function runDiagnostics() {
  if (!state.context?.isSuperAdmin || !confirm('D1과 R2에 임시 진단 probe를 생성·읽기·삭제하여 실제 운영 연결을 점검할까요?')) return;
  const button = $('runDiagnosticsBtn'); button.disabled = true; button.textContent = '진단 중...';
  try { const response = await api('/api/data-core/admin/diagnostics/run', { method: 'POST' }); state.diagnostics = response.diagnostics || null; renderDiagnostics(); toast(state.diagnostics?.ok ? '운영환경 진단을 모두 통과했습니다.' : '운영환경 진단에서 확인이 필요한 항목이 있습니다.', state.diagnostics?.ok ? 'success' : 'error'); }
  catch (error) { state.diagnostics = null; renderDiagnostics(); toast(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = '진단 실행'; }
}

function bindEvents() {
  $('refreshTrashBtn').onclick = loadTrash; $('trashSearchBtn').onclick = loadTrash; $('trashCampus').onchange = loadTrash;
  $('trashSearch').onkeydown = (event) => { if (event.key === 'Enter') loadTrash(); };
  $('refreshBackupsBtn').onclick = loadBackups; $('createBackupBtn').onclick = createBackup; $('runDiagnosticsBtn').onclick = runDiagnostics;
  $('refreshKnowledgeBtn').onclick = loadKnowledgeStatus; $('syncKnowledgeBtn').onclick = syncKnowledge;
}

async function init() {
  bindEvents(); renderDiagnostics(); renderKnowledgeStatus(); await loadContext();
  if (state.context?.authenticated) {
    await loadTrash();
    if (state.context.isSuperAdmin) await Promise.all([loadBackups(), loadKnowledgeStatus()]);
  }
}

init().catch((error) => { console.error(error); notice(`운영관리 화면을 시작하지 못했습니다: ${error.message}`); });

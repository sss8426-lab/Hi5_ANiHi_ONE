const state = {
  context: null,
  campuses: [],
  trash: [],
  backups: [],
  diagnostics: null,
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
  if (!message) {
    el.classList.add('hidden');
    return;
  }
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
  $('backupPanel').classList.toggle('hidden', !context?.isSuperAdmin);
  $('backupStatCard').classList.toggle('hidden', !context?.isSuperAdmin);
  $('diagnosticPanel').classList.toggle('hidden', !context?.isSuperAdmin);
  $('diagnosticStatCard').classList.toggle('hidden', !context?.isSuperAdmin);
  if (!context?.authenticated) {
    notice('로그인이 필요합니다. DATA CORE에 로그인한 뒤 다시 접근하세요.');
  } else if (!context?.canWrite) {
    notice('DATA CORE 사용 권한이 아직 부여되지 않았습니다. 마스터 관리자에게 캠퍼스 권한을 요청하세요.');
  } else {
    notice('');
  }
}

function fillCampuses() {
  const select = $('trashCampus');
  select.innerHTML = '<option value="">전체 캠퍼스</option>' + state.campuses
    .map((campus) => `<option value="${h(campus.id)}">${h(campus.name)}</option>`)
    .join('');
}

async function loadContext() {
  try {
    state.context = await api('/api/data-core/context');
    renderContext();
    if (!state.context?.authenticated) return;
    const response = await api('/api/data-core/campuses');
    state.campuses = response.campuses || [];
    fillCampuses();
  } catch (error) {
    notice(error.message);
  }
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
  } catch (error) {
    state.trash = [];
    renderTrash();
    toast(error.message, 'error');
  }
}

function renderTrash() {
  $('trashCount').textContent = state.trash.length;
  $('trashEmpty').classList.toggle('hidden', state.trash.length > 0);
  $('trashBody').innerHTML = state.trash.map((file) => `<tr>
    <td>
      <div class="ops-file">
        <span class="ops-file-icon">${h(file.mimeType?.startsWith('image/') ? '▧' : '▤')}</span>
        <div><strong>${h(file.fileName)}</strong><small>${h(file.mimeType || '')}</small></div>
      </div>
    </td>
    <td>${h(file.campusName || '조직 공통')}</td>
    <td><span class="pill">${h(categoryLabel(file.category))}</span></td>
    <td>${h(formatDate(file.deletedAt))}</td>
    <td>
      <div class="row-actions">
        <button class="ghost-btn" data-restore-file="${h(file.id)}">복원</button>
        ${state.context?.isSuperAdmin ? `<button class="danger-btn" data-purge-file="${h(file.id)}">영구삭제</button>` : ''}
      </div>
    </td>
  </tr>`).join('');

  document.querySelectorAll('[data-restore-file]').forEach((button) => {
    button.onclick = () => restoreFile(button.dataset.restoreFile);
  });
  document.querySelectorAll('[data-purge-file]').forEach((button) => {
    button.onclick = () => purgeFile(button.dataset.purgeFile);
  });
}

async function restoreFile(fileId) {
  const file = state.trash.find((item) => String(item.id) === String(fileId));
  if (!confirm(`'${file?.fileName || '이 파일'}'을 자료보관함으로 복원할까요?`)) return;
  try {
    await api(`/api/data-core/trash/files/${encodeURIComponent(fileId)}/restore`, { method: 'POST' });
    toast('파일을 복원했습니다.');
    await loadTrash();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function purgeFile(fileId) {
  const file = state.trash.find((item) => String(item.id) === String(fileId));
  const label = file?.fileName || '이 파일';
  if (!confirm(`'${label}'을 영구 삭제하면 R2 원본도 사라지고 복구할 수 없습니다. 계속할까요?`)) return;
  if (!confirm('정말 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
  try {
    await api(`/api/data-core/trash/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    toast('파일을 영구 삭제했습니다.');
    await loadTrash();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadBackups() {
  if (!state.context?.isSuperAdmin) return;
  try {
    const response = await api('/api/data-core/admin/backups');
    state.backups = response.backups || [];
    renderBackups();
  } catch (error) {
    state.backups = [];
    renderBackups();
    toast(error.message, 'error');
  }
}

function renderBackups() {
  const latest = state.backups[0];
  $('backupStatus').textContent = latest ? (latest.status === 'completed' ? '완료' : latest.status) : '없음';
  $('backupDate').textContent = latest ? formatDate(latest.completedAt || latest.createdAt) : '아직 백업이 없습니다';
  $('backupEmpty').classList.toggle('hidden', state.backups.length > 0);
  $('backupBody').innerHTML = state.backups.map((backup) => `<tr>
    <td><span class="backup-state ${h(backup.status)}">${h(backup.status)}</span></td>
    <td>${h(String(backup.totalRows ?? 0))}</td>
    <td>${h(formatDate(backup.createdAt))}</td>
    <td>${h(formatDate(backup.completedAt))}</td>
    <td>
      <div class="row-actions">
        ${backup.manifestUrl ? `<a class="ghost-btn link-btn" href="${h(backup.manifestUrl)}">Manifest</a>` : ''}
      </div>
    </td>
  </tr>`).join('');
}

async function createBackup() {
  if (!state.context?.isSuperAdmin) return;
  if (!confirm('현재 DATA CORE 운영 데이터의 새 스냅샷 백업을 생성할까요?')) return;
  const button = $('createBackupBtn');
  button.disabled = true;
  button.textContent = '백업 생성 중...';
  try {
    const response = await api('/api/data-core/admin/backups', { method: 'POST' });
    const rows = response.backup?.totalRows ?? 0;
    toast(`백업을 완료했습니다. ${rows}개 행을 스냅샷했습니다.`);
    await loadBackups();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '새 백업 생성';
  }
}

function renderDiagnostics() {
  const result = state.diagnostics;
  const checks = result?.checks || [];
  $('diagnosticEmpty').classList.toggle('hidden', checks.length > 0);
  $('diagnosticBody').innerHTML = checks.map((check) => `<tr>
    <td><strong>${h(check.label)}</strong></td>
    <td><span class="diagnostic-state ${check.ok ? 'ok' : 'fail'}">${check.ok ? '정상' : '실패'}</span></td>
    <td>${h(check.detail)}</td>
    <td>${h(String(check.durationMs ?? 0))}ms</td>
  </tr>`).join('');

  if (!result) {
    $('diagnosticStatus').textContent = '미실행';
    $('diagnosticDate').textContent = '마스터 전용';
    return;
  }
  $('diagnosticStatus').textContent = result.ok ? '정상' : '점검 필요';
  $('diagnosticDate').textContent = formatDate(result.completedAt);
}

async function runDiagnostics() {
  if (!state.context?.isSuperAdmin) return;
  if (!confirm('D1과 R2에 임시 진단 probe를 생성·읽기·삭제하여 실제 운영 연결을 점검할까요?')) return;
  const button = $('runDiagnosticsBtn');
  button.disabled = true;
  button.textContent = '진단 중...';
  try {
    const response = await api('/api/data-core/admin/diagnostics/run', { method: 'POST' });
    state.diagnostics = response.diagnostics || null;
    renderDiagnostics();
    if (state.diagnostics?.ok) {
      toast('운영환경 진단을 모두 통과했습니다.');
    } else {
      toast('운영환경 진단에서 확인이 필요한 항목이 있습니다.', 'error');
    }
  } catch (error) {
    state.diagnostics = null;
    renderDiagnostics();
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '진단 실행';
  }
}

function bindEvents() {
  $('refreshTrashBtn').onclick = loadTrash;
  $('trashSearchBtn').onclick = loadTrash;
  $('trashCampus').onchange = loadTrash;
  $('trashSearch').onkeydown = (event) => { if (event.key === 'Enter') loadTrash(); };
  $('refreshBackupsBtn').onclick = loadBackups;
  $('createBackupBtn').onclick = createBackup;
  $('runDiagnosticsBtn').onclick = runDiagnostics;
}

async function init() {
  bindEvents();
  renderDiagnostics();
  await loadContext();
  if (state.context?.authenticated) {
    await loadTrash();
    if (state.context.isSuperAdmin) await loadBackups();
  }
}

init().catch((error) => {
  console.error(error);
  notice(`운영관리 화면을 시작하지 못했습니다: ${error.message}`);
});

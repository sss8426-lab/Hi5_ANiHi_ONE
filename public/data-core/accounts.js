const $ = (id) => document.getElementById(id);
const notice = (message = '') => { $('notice').textContent = message; $('notice').classList.toggle('hidden', !message); };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

function password() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const values = crypto.getRandomValues(new Uint32Array(18));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

let campuses = [];
async function load() {
  try {
    const [session, campusData, accountData] = await Promise.all([api('/api/auth/session'), api('/api/data-core/campuses'), api('/api/auth/accounts')]);
    if (!session.isSuperAdmin) throw new Error('계정 관리는 마스터 관리자만 사용할 수 있습니다.');
    campuses = campusData.campuses || [];
    $('campusId').innerHTML = campuses.map((campus) => `<option value="${escapeHtml(campus.id)}">${escapeHtml(campus.name)}</option>`).join('');
    render(accountData.accounts || []);
  } catch (error) {
    notice(error.message);
    if (/로그인/.test(error.message)) location.assign('/data-core/login?next=/data-core/accounts');
  }
}

function render(accounts) {
  $('accountsBody').innerHTML = accounts.map((account) => `<tr><td>${escapeHtml(account.display_name)}</td><td>${escapeHtml(account.login_id)}</td><td>${escapeHtml(account.campus_name || '조직 공통')} · ${escapeHtml(account.role)}</td><td><span class="status-${escapeHtml(account.status)}">${account.status === 'active' ? '사용 중' : '비활성'}</span></td><td>${account.last_login_at ? new Date(account.last_login_at).toLocaleString('ko-KR') : '-'}</td><td><div class="account-actions"><button class="ghost-btn" data-action="reset" data-id="${escapeHtml(account.id)}">비밀번호 초기화</button><button class="ghost-btn" data-action="sessions" data-id="${escapeHtml(account.id)}">세션 해제</button><button class="ghost-btn" data-action="status" data-status="${escapeHtml(account.status)}" data-id="${escapeHtml(account.id)}">${account.status === 'active' ? '비활성화' : '다시 사용'}</button></div></td></tr>`).join('');
  $('empty').classList.toggle('hidden', accounts.length > 0);
}

$('role').addEventListener('change', () => $('campusField').classList.toggle('hidden', $('role').value === 'SUPER_ADMIN'));
$('temporaryPassword').value = password();
$('createForm').addEventListener('submit', async (event) => {
  event.preventDefault(); notice('');
  const form = event.currentTarget;
  const temporaryPassword = $('temporaryPassword').value;
  try {
    await api('/api/auth/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: $('displayName').value, loginId: $('loginId').value, role: $('role').value, campusId: $('role').value === 'SUPER_ADMIN' ? null : $('campusId').value, temporaryPassword }) });
    $('temporaryResult').textContent = `임시 비밀번호: ${temporaryPassword}`;
    $('temporaryResult').classList.remove('hidden');
    form.reset(); $('temporaryPassword').value = password(); await load();
  } catch (error) { notice(error.message); }
});
$('accountsBody').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const input = { revokeSessions: button.dataset.action === 'sessions' };
  if (button.dataset.action === 'status') input.status = button.dataset.status === 'active' ? 'disabled' : 'active';
  if (button.dataset.action === 'reset') input.temporaryPassword = password();
  try { await api(`/api/auth/accounts/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (input.temporaryPassword) { $('temporaryResult').textContent = `새 임시 비밀번호: ${input.temporaryPassword}`; $('temporaryResult').classList.remove('hidden'); } await load(); } catch (error) { notice(error.message); }
});
$('refreshBtn').addEventListener('click', load);
load();

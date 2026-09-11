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
    await loadPresence();
  } catch (error) {
    notice(error.message);
    if (/로그인/.test(error.message)) location.assign('/data-core/login?next=/data-core/accounts');
  }
}

function render(accounts) {
  $('accountsBody').innerHTML = accounts.map((account) => `<tr><td>${escapeHtml(account.display_name)}</td><td>${escapeHtml(account.login_id)}</td><td>${escapeHtml(account.campus_name || '조직 공통')} · ${escapeHtml(account.role)}</td><td><span class="status-${escapeHtml(account.status)}">${account.status === 'active' ? '사용 중' : '비활성'}</span></td><td>${account.last_login_at ? new Date(account.last_login_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) : '-'}</td><td><div class="account-actions"><button class="ghost-btn" data-action="reset" data-id="${escapeHtml(account.id)}">비밀번호 초기화</button><button class="ghost-btn" data-action="sessions" data-id="${escapeHtml(account.id)}">세션 해제</button><button class="ghost-btn" data-action="status" data-status="${escapeHtml(account.status)}" data-id="${escapeHtml(account.id)}">${account.status === 'active' ? '비활성화' : '다시 사용'}</button></div></td></tr>`).join('');
  $('empty').classList.toggle('hidden', accounts.length > 0);
}

$('role').addEventListener('change', () => $('campusField').classList.toggle('hidden', ['MASTER','SUPER_ADMIN'].includes($('role').value)));
$('temporaryPassword').value = password();
$('createForm').addEventListener('submit', async (event) => {
  event.preventDefault(); notice('');
  const form = event.currentTarget;
  const temporaryPassword = $('temporaryPassword').value;
  try {
    await api('/api/auth/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: $('displayName').value, loginId: $('loginId').value, role: $('role').value, campusId: ['MASTER','SUPER_ADMIN'].includes($('role').value) ? null : $('campusId').value, temporaryPassword }) });
    $('temporaryResult').textContent = `임시 비밀번호: ${temporaryPassword}`;
    $('temporaryResult').classList.remove('hidden');
    form.reset(); $('temporaryPassword').value = password(); await load();
  } catch (error) { notice(error.message); }
});
async function manageAccount(event) {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const input = { revokeSessions: button.dataset.action === 'sessions' };
  if (button.dataset.action === 'status') input.status = button.dataset.status === 'active' ? 'disabled' : 'active';
  if (button.dataset.action === 'reset') input.temporaryPassword = password();
  try { await api(`/api/auth/accounts/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (input.temporaryPassword) { $('temporaryResult').textContent = `새 임시 비밀번호: ${input.temporaryPassword}`; $('temporaryResult').classList.remove('hidden'); } await load(); } catch (error) { notice(error.message); }
}
$('accountsBody').addEventListener('click', manageAccount);
$('campusPresence').addEventListener('click', manageAccount);
function kst(value) { return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)) : '로그인 기록 없음'; }
let presenceLoading = false;
async function loadPresence() {
  if (presenceLoading || document.hidden) return;
  presenceLoading = true;
  try {
    const data = await api('/api/auth/campuses', {cache:'no-store'});
    $('presenceError').textContent = '';
    $('campusTotal').textContent = data.summary.total;
    $('campusOnline').textContent = data.summary.online;
    $('campusToday').textContent = data.summary.today;
    $('campusPresence').innerHTML = data.campuses.map(c => `<article class="presence-item"><header><strong>${escapeHtml(c.campusName)}</strong><span class="presence-state ${c.online?'online':''}">${c.online?'접속중':'오프라인'}</span></header><p>${escapeHtml(c.loginId)} · 캠퍼스 관리자 · ${c.status==='active'?'사용중':c.status==='disabled'?'비활성':'계정 준비 중'}</p><p>최근 로그인 ${escapeHtml(kst(c.lastLoginAt))}</p><p>최근 활동 ${escapeHtml(c.lastSeenAt?kst(c.lastSeenAt):'-')}</p>${c.accountId?`<div class="account-actions"><button class="ghost-btn" data-action="status" data-status="${escapeHtml(c.status)}" data-id="${escapeHtml(c.accountId)}">${c.status==='active'?'비활성화':'다시 사용'}</button><button class="ghost-btn" data-action="reset" data-id="${escapeHtml(c.accountId)}">비밀번호 초기화</button></div>`:''}</article>`).join('');
    $('recentLogins').innerHTML = data.recentLogins.length ? data.recentLogins.map(e=>`<li><time>${escapeHtml(kst(e.loginAt))}</time><span>${escapeHtml(e.campusName)}</span><span>로그인</span></li>`).join('') : '<li>로그인 기록 없음</li>';
  } catch (error) { $('presenceError').textContent = error.message; }
  finally { presenceLoading = false; }
}
$('presenceRefresh').addEventListener('click',loadPresence);
window.addEventListener('focus',loadPresence);
setInterval(loadPresence,60_000);
$('refreshBtn').addEventListener('click', load);
load();

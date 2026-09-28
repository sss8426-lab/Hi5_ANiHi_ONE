import { initAccountRoles } from './account-roles.js?v=20260929-admin-navigation';
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
let accountRows = [];
let rolesInitialized = false;
function passwordStatus(account) {
  if (account.locked_until && Date.parse(account.locked_until) > Date.now()) return '로그인 잠금 · ' + kst(account.locked_until) + ' 이후 재시도';
  return account.must_change_password ? '비밀번호 변경 대기' : '비밀번호 설정 완료';
}
function passwordActions(account) {
  const id = escapeHtml(account.id);
  const direct = account.campus_id && !['MASTER','SUPER_ADMIN'].includes(account.role);
  return `${direct ? `<button class="ghost-btn" data-action="password" data-id="${id}">비밀번호 변경</button>` : ''}<button class="ghost-btn" data-action="reset" data-id="${id}">비밀번호 초기화</button>`;
}
async function load() {
  try {
    const [session, campusData, accountData] = await Promise.all([api('/api/auth/session'), api('/api/data-core/campuses'), api('/api/auth/accounts')]);
    if (!session.isSuperAdmin) throw new Error('계정 관리는 마스터 관리자만 사용할 수 있습니다.');
    campuses = campusData.campuses || [];
    $('campusId').innerHTML = campuses.map((campus) => `<option value="${escapeHtml(campus.id)}">${escapeHtml(campus.name)}</option>`).join('');
    accountRows = accountData.accounts || [];
    $('retiredAccountsFilter').hidden = !accountRows.some(account => account.retiredCampus);
    render(accountRows);
    if (!rolesInitialized) {
      rolesInitialized = true;
      initAccountRoles({ api, escapeHtml, onChanged: load });
    }
    await loadPresence(false);
  } catch (error) {
    notice(error.message);
    if (/로그인/.test(error.message)) location.assign('/data-core/login?next=/data-core/accounts');
  }
}

function render(accounts) {
  accounts = accounts.filter(account => !account.retiredCampus || $('showRetiredAccounts').checked);
  $('accountsBody').innerHTML = accounts.map((account) => `<tr><td>${escapeHtml(account.display_name)}${account.position || account.phone ? `<p>${escapeHtml([account.position, account.phone].filter(Boolean).join(' · '))}</p>` : ''}</td><td>${escapeHtml(account.login_id)}</td><td>${escapeHtml(account.campus_name || '조직 공통')} · ${escapeHtml(account.role)}</td><td><span class="status-${escapeHtml(account.status)}">${account.status === 'active' ? '사용 중' : '비활성'}</span><p>${escapeHtml(passwordStatus(account))}</p></td><td>${account.last_login_at ? new Date(account.last_login_at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) : '-'}</td><td><div class="account-actions">${passwordActions(account)}<button class="ghost-btn danger-btn" data-action="delete" data-id="${escapeHtml(account.id)}">회원삭제</button></div></td></tr>`).join('');
  $('empty').classList.toggle('hidden', accounts.length > 0);
}

$('role').addEventListener('change', () => $('campusField').classList.toggle('hidden', ['MASTER','SUPER_ADMIN'].includes($('role').value)));
$('showRetiredAccounts').addEventListener('change', () => render(accountRows));
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
// 회원삭제: the login ID stops working at once and becomes free; the person's files and records stay.
async function deleteAccount(button) {
  const account = accountRows.find(row => row.id === button.dataset.id);
  if (!account) return;
  const who = `${account.display_name}(${account.login_id})`;
  if (!confirm(`${who} 회원을 삭제할까요?\n\n삭제하면 이 아이디로 다시 로그인할 수 없고, 되돌릴 수 없습니다.\n다시 사용하려면 직원인증을 새로 신청해야 합니다.\n(올린 자료와 기록은 그대로 남습니다)`)) return;
  button.disabled = true;
  try {
    await api(`/api/auth/accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
    notice(`${who} 회원을 삭제했습니다.`);
    await load();
  } catch (error) { notice(error.message); button.disabled = false; }
}
async function manageAccount(event) {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  if (['password', 'reset'].includes(button.dataset.action)) { openPasswordDialog(button.dataset.id, button.dataset.action); return; }
  if (button.dataset.action === 'delete') { await deleteAccount(button); return; }
  const input = { revokeSessions: button.dataset.action === 'sessions' };
  if (button.dataset.action === 'status') input.status = button.dataset.status === 'active' ? 'disabled' : 'active';
  try { await api(`/api/auth/accounts/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); if (input.temporaryPassword) { $('temporaryResult').textContent = `새 임시 비밀번호: ${input.temporaryPassword}`; $('temporaryResult').classList.remove('hidden'); } await load(); } catch (error) { notice(error.message); }
}
let passwordTarget = null;
let passwordSaving = false;
function openPasswordDialog(id, mode) {
  const account = accountRows.find(row => row.id === id);
  if (!account || passwordSaving) return;
  passwordTarget = { id, mode };
  $('managePasswordForm').reset();
  $('targetLoginId').value = account.login_id;
  $('passwordTarget').textContent = `${account.campus_name || account.display_name} · ${account.login_id}`;
  $('passwordDialogTitle').textContent = mode === 'reset' ? '임시 비밀번호 초기화' : '비밀번호 변경';
  $('forceChangeOption').hidden = mode === 'reset';
  $('forcePasswordChange').checked = true;
  $('forcePasswordChange').disabled = false;
  $('managedPassword').value = $('managedPasswordConfirm').value = mode === 'reset' ? password() : '';
  for (const key of ['managedPassword', 'managedPasswordConfirm']) { $(key).type = 'password'; $(key).readOnly = false; }
  $('managedPasswordMessage').textContent = '';
  $('savePasswordChange').hidden = false;
  $('cancelPasswordChange').textContent = '취소';
  $('passwordDialog').showModal();
  $('managedPassword').focus();
}
$('showManagedPassword').addEventListener('change', () => {
  for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).type = $('showManagedPassword').checked ? 'text' : 'password';
});
for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).addEventListener('input', () => { $('managedPasswordMessage').textContent = ''; });
$('cancelPasswordChange').addEventListener('click', () => { if (!passwordSaving) $('passwordDialog').close(); });
$('passwordDialog').addEventListener('cancel', event => { if (passwordSaving) event.preventDefault(); });
$('passwordDialog').addEventListener('close', () => {
  $('managePasswordForm').reset();
  for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).value = '';
  passwordTarget = null;
});
$('managePasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (passwordSaving || !passwordTarget || $('savePasswordChange').hidden) return;
  const value = $('managedPassword').value;
  if (value.length < 12 || value !== $('managedPasswordConfirm').value) { $('managedPasswordMessage').textContent = '12자 이상 비밀번호를 동일하게 입력하세요.'; return; }
  passwordSaving = true;
  for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).readOnly = true;
  $('forcePasswordChange').disabled = true;
  $('savePasswordChange').disabled = $('cancelPasswordChange').disabled = true;
  const { id, mode } = passwordTarget;
  const input = mode === 'reset' ? { temporaryPassword: value } : { newPassword: value, mustChangePassword: $('forcePasswordChange').checked };
  try {
    await api(`/api/auth/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    $('managedPasswordMessage').textContent = '변경 완료. 이 창을 닫으면 입력한 비밀번호는 다시 조회할 수 없습니다.';
    for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).readOnly = true;
    $('savePasswordChange').hidden = true;
    $('cancelPasswordChange').textContent = '닫기';
    await load();
  } catch (error) { $('managedPasswordMessage').textContent = error.message; }
  finally {
    passwordSaving = false; $('savePasswordChange').disabled = $('cancelPasswordChange').disabled = false;
    if (!$('savePasswordChange').hidden) {
      for (const key of ['managedPassword', 'managedPasswordConfirm']) $(key).readOnly = false;
      $('forcePasswordChange').disabled = false;
    }
  }
});
$('accountsBody').addEventListener('click', manageAccount);
$('campusPresence').addEventListener('click', manageAccount);
function kst(value) { return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)) : '로그인 기록 없음'; }
let presenceLoading = false;
async function loadPresence(refreshAccounts = true) {
  if (presenceLoading || document.hidden) return;
  presenceLoading = true;
  try {
    const [data, accounts] = await Promise.all([
      api('/api/auth/campuses', {cache:'no-store'}),
      refreshAccounts ? api('/api/auth/accounts', {cache:'no-store'}) : null,
    ]);
    if (accounts) { accountRows = accounts.accounts || []; render(accountRows); }
    $('presenceError').textContent = '';
    $('campusTotal').textContent = data.summary.total;
    $('campusOnline').textContent = data.summary.online;
    $('campusToday').textContent = data.summary.today;
    $('campusPresence').innerHTML = data.campuses.map(c => {
      const account = accountRows.find(row => row.id === c.accountId);
      return `<article class="presence-item"><header><strong>${escapeHtml(c.campusName)}</strong><span class="presence-state ${c.online?'online':''}">${c.online?'접속중':'오프라인'}</span></header><p>${escapeHtml(c.loginId)} · 캠퍼스 관리자 · ${c.status==='active'?'사용중':c.status==='disabled'?'비활성':'계정 준비 중'}</p><p>최근 로그인 ${escapeHtml(kst(c.lastLoginAt))}</p><p>최근 활동 ${escapeHtml(c.lastSeenAt?kst(c.lastSeenAt):'-')}</p>${account ? `<p>${escapeHtml(passwordStatus(account))}</p><div class="account-actions"><button class="ghost-btn" data-action="status" data-status="${escapeHtml(c.status)}" data-id="${escapeHtml(c.accountId)}">${c.status==='active'?'비활성화':'다시 사용'}</button>${passwordActions(account)}</div>`:''}</article>`;
    }).join('');
    $('recentLogins').innerHTML = data.recentLogins.length ? data.recentLogins.map(e=>`<li><time>${escapeHtml(kst(e.loginAt))}</time><span>${escapeHtml(e.campusName)}</span><span>로그인</span></li>`).join('') : '<li>로그인 기록 없음</li>';
  } catch (error) { $('presenceError').textContent = error.message; }
  finally { presenceLoading = false; }
}
$('presenceRefresh').addEventListener('click',loadPresence);
window.addEventListener('focus',loadPresence);
setInterval(loadPresence,60_000);
$('refreshBtn').addEventListener('click', load);
load();

// 직원인증 신청: the applicant chose their own ID and password; accepting creates the account as-is.
const SIGNUP_ROLES = [['CAMPUS_ADMIN', '캠퍼스 관리자'], ['CAMPUS_DIRECTOR', '캠퍼스 원장'], ['TEACHER', '교사'], ['STAFF', '직원'], ['MASTER', '마스터 관리자']];
let signupRows = [];
let signupBusy = false;
function renderSignups() {
  $('signupCount').textContent = signupRows.length ? `${signupRows.length}건` : '';
  $('signupEmpty').classList.toggle('hidden', signupRows.length > 0);
  $('signupBody').innerHTML = signupRows.map((row) => {
    const id = escapeHtml(row.id);
    return `<tr><td>${escapeHtml(kst(row.created_at))}</td><td>${escapeHtml(row.display_name)}</td><td>${escapeHtml(row.campus_name || row.campus_id)}</td><td>${escapeHtml(row.position)}</td><td>${escapeHtml(row.login_id)}</td><td>${escapeHtml(row.phone)}</td>`
      + `<td><select data-signup-role="${id}" aria-label="${escapeHtml(row.display_name)} 권한">${SIGNUP_ROLES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></td>`
      + `<td><div class="account-actions"><button class="primary-btn" data-signup="approve" data-id="${id}">수락</button><button class="ghost-btn" data-signup="reject" data-id="${id}">거절</button></div></td></tr>`;
  }).join('');
}
async function loadSignups() {
  try {
    signupRows = (await api('/api/auth/signup-requests', { cache: 'no-store' })).requests || [];
    $('signupError').textContent = '';
    renderSignups();
  } catch (error) { $('signupError').textContent = error.message; }
}
$('signupBody').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-signup]');
  if (!button || signupBusy) return;
  const row = signupRows.find((item) => item.id === button.dataset.id);
  if (!row) return;
  const approve = button.dataset.signup === 'approve';
  const role = $('signupBody').querySelector(`[data-signup-role="${CSS.escape(row.id)}"]`)?.value || 'CAMPUS_ADMIN';
  const roleLabel = SIGNUP_ROLES.find(([value]) => value === role)?.[1] || role;
  const question = approve
    ? `${row.display_name}(${row.login_id}) 님을 ${roleLabel}(으)로 수락할까요?${role === 'MASTER' ? '\n마스터 관리자는 모든 캠퍼스와 계정 관리 권한을 가집니다.' : ''}`
    : `${row.display_name}(${row.login_id}) 님의 신청을 거절할까요?`;
  if (!confirm(question)) return;
  signupBusy = true;
  $('signupBody').querySelectorAll('button').forEach((node) => { node.disabled = true; });
  try {
    await api(`/api/auth/signup-requests/${encodeURIComponent(row.id)}/${approve ? 'approve' : 'reject'}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approve ? { role, campusId: role === 'MASTER' ? null : row.campus_id } : {}),
    });
    notice(approve ? `${row.display_name} 님을 수락했습니다. 이제 ${row.login_id} 아이디로 로그인할 수 있습니다.` : `${row.display_name} 님의 신청을 거절했습니다.`);
    await Promise.all([loadSignups(), approve ? load() : null]);
  } catch (error) { notice(error.message); await loadSignups(); }
  finally { signupBusy = false; }
});
$('signupRefresh').addEventListener('click', loadSignups);
window.addEventListener('focus', loadSignups);
loadSignups();

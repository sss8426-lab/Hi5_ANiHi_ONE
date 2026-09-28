const $ = (id) => document.getElementById(id);
let authAttempt = 0;
const nextPath = (() => {
  const value = new URLSearchParams(location.search).get('next') || '/data-core/work';
  return value.startsWith('/data-core/') || /^\/admissions-web\/renderer\/(?:index\.html)?(?:[?#]|$)/.test(value) ? value : '/data-core/work';
})();

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

function showPasswordChange(loginId = '') {
  $('changeLoginId').value = loginId;
  $('loginFormWrap').classList.add('hidden');
  $('passwordFormWrap').classList.remove('hidden');
  $('currentPassword').focus();
}

async function resumeActiveSession() {
  const attempt = authAttempt;
  try {
    const session = await request('/api/auth/session');
    if (attempt !== authAttempt || !session.authenticated) return;
    if (session.mustChangePassword) {
      showPasswordChange(session.user?.loginId || '');
      return;
    }
    location.assign(nextPath);
  } catch {
    // The login page remains available when no valid session exists.
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  authAttempt++;
  const button = event.currentTarget.querySelector('button');
  $('message').textContent = '';
  button.disabled = true;
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginId: $('loginId').value, password: $('password').value }),
    });
    if (result.mustChangePassword) showPasswordChange($('loginId').value.trim().toLowerCase());
    else location.assign(nextPath);
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  $('passwordMessage').textContent = '';
  if ($('nextPassword').value !== $('confirmPassword').value) {
    $('passwordMessage').textContent = '새 비밀번호가 일치하지 않습니다.';
    return;
  }
  button.disabled = true;
  try {
    await request('/api/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: $('currentPassword').value, nextPassword: $('nextPassword').value }),
    });
    $('password').value = '';
    $('currentPassword').value = '';
    $('nextPassword').value = '';
    $('confirmPassword').value = '';
    location.assign(nextPath);
  } catch (error) {
    $('passwordMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

void resumeActiveSession();

// 직원인증: apply with name/campus/position/ID/password/phone; a MASTER approves before first login.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
let signupCampusesLoaded = false;
function showPanel(id) {
  for (const panel of ['loginFormWrap', 'signupFormWrap', 'signupDoneWrap']) $(panel).classList[panel === id ? 'remove' : 'add']('hidden');
}
async function loadSignupCampuses() {
  if (signupCampusesLoaded) return;
  try {
    const options = await request('/api/auth/signup/options');
    $('signupCampus').innerHTML = '<option value="">캠퍼스를 선택하세요</option>' + (options.campuses || [])
      .map((campus) => `<option value="${escapeHtml(campus.id)}">${escapeHtml(campus.name)}</option>`).join('');
    signupCampusesLoaded = true;
  } catch (error) { $('signupMessage').textContent = `캠퍼스 목록을 불러오지 못했습니다. ${error.message}`; }
}
function signupProblem(values) {
  if (!values.displayName) return ['signupName', '이름을 입력하세요.'];
  if (!values.campusId) return ['signupCampus', '캠퍼스를 선택하세요.'];
  if (!values.position) return ['signupPosition', '직책을 입력하세요.'];
  if (!/^[a-z0-9][a-z0-9._-]{3,29}$/.test(values.loginId)) return ['signupLoginId', '아이디는 영문 소문자·숫자로 시작하는 4~30자(영문·숫자·. _ -)로 입력하세요.'];
  if (values.password.length < 12) return ['signupPassword', '비밀번호는 12자 이상으로 입력하세요.'];
  if (values.password !== $('signupPasswordConfirm').value) return ['signupPasswordConfirm', '비밀번호 확인이 일치하지 않습니다.'];
  const digits = values.phone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 12) return ['signupPhone', '연락처를 숫자로 입력하세요. 예: 010-1234-5678'];
  return null;
}
$('openSignup').addEventListener('click', () => {
  $('signupMessage').textContent = '';
  showPanel('signupFormWrap');
  $('signupName').focus();
  void loadSignupCampuses();
});
for (const id of ['closeSignup', 'signupDoneBack']) $(id).addEventListener('click', () => { showPanel('loginFormWrap'); $('loginId').focus(); });
$('signupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const values = {
    displayName: $('signupName').value.trim(), campusId: $('signupCampus').value, position: $('signupPosition').value.trim(),
    loginId: $('signupLoginId').value.trim().toLowerCase(), password: $('signupPassword').value, phone: $('signupPhone').value.trim(),
  };
  const problem = signupProblem(values);
  if (problem) { $('signupMessage').textContent = problem[1]; $(problem[0]).focus(); return; }
  $('signupMessage').textContent = '';
  button.disabled = true;
  try {
    await request('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
    for (const id of ['signupName', 'signupPosition', 'signupLoginId', 'signupPassword', 'signupPasswordConfirm', 'signupPhone']) $(id).value = '';
    $('signupDoneText').textContent = `아이디 ${values.loginId}로 신청했습니다. 마스터 관리자가 수락하면 이 아이디와 비밀번호로 로그인할 수 있습니다.`;
    $('loginId').value = values.loginId;
    showPanel('signupDoneWrap');
  } catch (error) {
    $('signupMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('switchAccount').addEventListener('click', async () => {
  authAttempt++;
  $('switchAccount').disabled = true;
  try {
    await request('/api/auth/logout', { method: 'POST' });
    for (const id of ['password', 'currentPassword', 'nextPassword', 'confirmPassword', 'changeLoginId']) $(id).value = '';
    $('passwordFormWrap').classList.add('hidden');
    $('loginFormWrap').classList.remove('hidden');
    $('passwordMessage').textContent = '';
    $('loginId').focus();
  } catch (error) { $('passwordMessage').textContent = error.message; }
  finally { $('switchAccount').disabled = false; }
});

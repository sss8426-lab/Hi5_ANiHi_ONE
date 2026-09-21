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

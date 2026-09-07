const $ = (id) => document.getElementById(id);
const nextPath = (() => {
  const value = new URLSearchParams(location.search).get('next') || '/data-core/work';
  return value.startsWith('/data-core/') ? value : '/data-core/work';
})();

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}

function showPasswordChange() {
  $('loginFormWrap').classList.add('hidden');
  $('passwordFormWrap').classList.remove('hidden');
  $('currentPassword').focus();
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  $('message').textContent = '';
  button.disabled = true;
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginId: $('loginId').value, password: $('password').value }),
    });
    if (result.mustChangePassword) showPasswordChange();
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
    location.assign(nextPath);
  } catch (error) {
    $('passwordMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

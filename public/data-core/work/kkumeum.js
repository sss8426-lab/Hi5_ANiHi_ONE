(() => {
  const userEl = document.getElementById('kkUser');

  async function loadContext() {
    try {
      const response = await fetch('/api/data-core/context', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const context = await response.json();
      if (!context?.authenticated) return;
      const name = context.user?.displayName || context.user?.email || '사용자';
      const role = context.isSuperAdmin ? '마스터 관리자' : '업무용 사용자';
      const avatar = String(name).trim().slice(0, 1).toUpperCase() || 'H';
      if (userEl) {
        userEl.innerHTML = `<span>${escapeHtml(avatar)}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(role)}</small></div>`;
      }
    } catch {
      if (userEl) userEl.querySelector('small').textContent = 'CORE 연결 확인 필요';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  loadContext();
})();

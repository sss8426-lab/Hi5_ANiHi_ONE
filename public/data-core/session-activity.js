// Activity, not background polling, is the signal for staff presence.
if (!window.__coreActivityInstalled) {
  window.__coreActivityInstalled = true;
  let enabled = false, lastSent = 0, pending = false;
  const interval = 5 * 60_000;
  async function activity(event) {
    if (event && !event.isTrusted) return;
    if (!enabled || pending || document.visibilityState !== 'visible' || Date.now() - lastSent < interval) return;
    pending = true;
    lastSent = Date.now();
    try {
      const response = await fetch('/api/auth/activity', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if ([401,403].includes(response.status)) enabled = false;
    } catch { /* Retry on the next real activity interval. */ }
    finally { pending = false; }
  }
  fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()).then(session => {
    enabled = Boolean(session.authenticated && session.canWrite && !session.mustChangePassword);
    if (enabled) activity();
    const membership = session.memberships?.find(m => m.role === 'CAMPUS_ADMIN');
    if (membership && !session.isSuperAdmin) {
      for (const el of document.querySelectorAll('#userName, #userDisplayName, .core-user-name')) el.textContent = membership.campusName;
      for (const el of document.querySelectorAll('#userRole, .core-user-role')) el.textContent = '캠퍼스 관리자';
    }
    if (!session.isSuperAdmin && location.pathname.startsWith('/admissions-web/renderer')) {
      document.querySelectorAll('[data-page="settings"], #homeSettingsBtn').forEach(el => el.hidden = true);
    }
    if (session.isSuperAdmin && location.pathname.startsWith('/admissions-web/renderer')) {
      const label = document.createElement('label');
      label.className = 'admissions-campus-filter';
      label.textContent = '캠퍼스 ';
      const select = document.createElement('select'); select.setAttribute('aria-label','캠퍼스');
      select.add(new Option('전체 캠퍼스', ''));
      fetch('/api/data-core/campuses',{cache:'no-store'}).then(r=>r.json()).then(({campuses}) => {
        for (const campus of campuses || []) select.add(new Option(campus.name,campus.id));
        select.value = new URL(location.href).searchParams.get('campusId') || '';
      });
      select.addEventListener('change', () => { const url = new URL(location.href); if(select.value)url.searchParams.set('campusId',select.value);else url.searchParams.delete('campusId');location.assign(url.href); });
      label.append(select);
      (document.querySelector('.topbar, header') || document.body).append(label);
    }
  }).catch(() => {});
  for (const name of ['pointerdown','keydown','scroll','touchstart']) window.addEventListener(name, activity, {passive:true,capture:true});
}

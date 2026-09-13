(() => {
  'use strict';
  const storageKey = 'data-core.brand-presentation.v1';
  const start = document.getElementById('brandPresentationStart');
  const exit = document.getElementById('brandPresentationExit');
  if (!start || !exit) return;
  let context = { active: false, ready: false, master: false };
  let requested = false;
  try { requested = sessionStorage.getItem(storageKey) === 'on'; } catch { /* Storage can be disabled. */ }

  function persist() {
    try {
      if (requested) sessionStorage.setItem(storageKey, 'on');
      else sessionStorage.removeItem(storageKey);
    } catch { /* The in-memory toggle still works. */ }
  }

  function render() {
    // This only changes presentation. API authorization remains server-owned.
    const eligible = context.active && context.ready && context.master;
    const presenting = eligible && requested;
    document.body.classList.toggle('brand-presenting', presenting);
    start.hidden = !eligible || presenting;
    start.setAttribute('aria-pressed', String(presenting));
    exit.hidden = !presenting;
  }

  start.addEventListener('click', () => {
    if (!context.active || !context.ready || !context.master) return;
    requested = true;
    persist();
    render();
    exit.focus();
  });
  exit.addEventListener('click', () => {
    requested = false;
    persist();
    render();
    if (!start.hidden) start.focus();
  });
  window.DataCoreBrandHome = {
    update(next) {
      context = next;
      // Do not discard a saved choice while the authentication request is pending.
      if (context.ready && !context.master) { requested = false; persist(); }
      render();
    },
    reset() { requested = false; persist(); render(); },
  };
  render();
})();

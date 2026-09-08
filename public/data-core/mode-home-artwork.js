(() => {
  function modeHomeIsActive() {
    return document.getElementById('view-mode-home')?.classList.contains('active') || false;
  }

  function syncBodyState() {
    document.body.classList.toggle('mode-home-artwork-active', modeHomeIsActive());
  }

  function init() {
    syncBodyState();

    const view = document.getElementById('view-mode-home');
    if (view) {
      new MutationObserver(syncBodyState).observe(view, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

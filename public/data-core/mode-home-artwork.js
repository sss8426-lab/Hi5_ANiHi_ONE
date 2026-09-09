(() => {
  const COMPETITION_LIVE_SRC = '/data-core/competition-live-enhancement.js?v=20260909-counseling';

  function modeHomeIsActive() {
    return document.getElementById('view-mode-home')?.classList.contains('active') || false;
  }

  function syncBodyState() {
    document.body.classList.toggle('mode-home-artwork-active', modeHomeIsActive());
  }

  function loginRequired(chip) {
    return chip?.querySelector('strong')?.textContent.trim() === '로그인이 필요합니다';
  }

  function loginTarget() {
    const next = location.pathname.startsWith('/data-core/work')
      ? `${location.pathname}${location.search}`
      : '/data-core/work';
    return `/data-core/login?next=${encodeURIComponent(next)}`;
  }

  function openLogin() {
    location.assign(loginTarget());
  }

  function syncLoginChip() {
    const chip = document.getElementById('userChip');
    if (!chip) return;
    const interactive = loginRequired(chip);
    chip.classList.toggle('login-chip-action', interactive);
    if (interactive) {
      chip.setAttribute('role', 'link');
      chip.setAttribute('tabindex', '0');
      chip.setAttribute('aria-label', 'DATA CORE 로그인 화면 열기');
      chip.setAttribute('title', '로그인');
    } else {
      chip.removeAttribute('role');
      chip.removeAttribute('tabindex');
      chip.removeAttribute('aria-label');
      chip.removeAttribute('title');
    }
  }

  function addLoginChipStyle() {
    if (document.getElementById('login-chip-action-style')) return;
    const style = document.createElement('style');
    style.id = 'login-chip-action-style';
    style.textContent = `
      .user-chip.login-chip-action{
        cursor:pointer;
        border-radius:14px;
        padding:8px 10px;
        transition:background .16s ease,box-shadow .16s ease,transform .16s ease;
      }
      .user-chip.login-chip-action:hover,
      .user-chip.login-chip-action:focus-visible{
        background:#eff6ff;
        box-shadow:0 0 0 3px rgba(37,99,235,.10);
        transform:translateY(-1px);
        outline:none;
      }
    `;
    document.head.appendChild(style);
  }

  function loadCompetitionLiveEnhancement() {
    if (document.querySelector(`script[src="${COMPETITION_LIVE_SRC}"]`)) return;
    const script = document.createElement('script');
    script.src = COMPETITION_LIVE_SRC;
    script.defer = true;
    document.body.appendChild(script);
  }

  function init() {
    syncBodyState();
    addLoginChipStyle();
    loadCompetitionLiveEnhancement();

    const view = document.getElementById('view-mode-home');
    if (view) {
      new MutationObserver(syncBodyState).observe(view, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    const chip = document.getElementById('userChip');
    if (chip) {
      syncLoginChip();
      new MutationObserver(syncLoginChip).observe(chip, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      chip.addEventListener('click', () => {
        if (loginRequired(chip)) openLogin();
      });
      chip.addEventListener('keydown', (event) => {
        if (!loginRequired(chip) || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        openLogin();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

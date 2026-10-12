// 업무용 | 상담용 스위치: every DATA CORE sidebar shows it right under the logo, and the phone 전체메뉴 too.
// Pressing the other mode opens that mode's home and nothing else: on the DATA CORE page itself the view
// changes in place (no reload), elsewhere the browser goes straight to that home. There is no separate
// "모드 선택으로 돌아가기" menu any more; the big 모드 선택 screen is still where /data-core starts.
(() => {
  if (window.DataCoreModeSwitch) return;
  const HOMES = { work: '/data-core/work', counseling: '/data-core/counseling' };
  const COUNSELING = /^\/data-core\/(counseling|curriculum|roadmap)(\/|$)/;
  const path = location.pathname.replace(/\/+$/, '');
  // A DATA CORE page opened at a mode address must never show the 모드 선택 screen first; app.js lifts this.
  if (path !== '/data-core' && /^\/data-core\/(work|counseling|curriculum)(\/|$)/.test(path)) document.documentElement.classList.add('core-mode-direct');
  const css = `html.core-mode-direct #view-mode-home, html.core-mode-direct [data-nav-scope="mode"] { display:none!important; }
.core-mode-switch { display:grid; grid-template-columns:1fr 1fr; gap:2px; padding:4px; margin:0 0 16px; border-radius:14px; background:rgb(255 255 255 / 9%); }
.core-mode-switch button { min-height:42px; min-width:0; padding:0 6px; border:0; border-radius:11px; background:transparent; color:rgb(255 255 255 / 74%); font:inherit; font-size:15px; font-weight:800; letter-spacing:0; cursor:pointer; box-shadow:none; }
.core-mode-switch button:hover:not(.is-on) { color:#fff; background:rgb(255 255 255 / 7%); }
.core-mode-switch button.is-on { background:#fff; color:#16352d; box-shadow:0 2px 6px rgb(0 0 0 / 28%); cursor:default; }
.core-mode-switch button:focus-visible { outline:2px solid #8fd1b9; outline-offset:2px; }
.core-mode-switch.is-light { background:#eef0ed; margin:14px 0 6px; }
.core-mode-switch.is-light button { color:#4b5a53; }
.core-mode-switch.is-light button:hover:not(.is-on) { color:#16352d; background:rgb(0 0 0 / 4%); }
.core-mode-switch.is-light button.is-on { box-shadow:0 1px 4px rgb(0 0 0 / 16%); }`;
  let mode = COUNSELING.test(path) ? 'counseling' : path === '/data-core' ? null : 'work';

  function build(light = false) {
    const box = document.createElement('div');
    box.className = 'core-mode-switch' + (light ? ' is-light' : '');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '모드 전환');
    box.innerHTML = '<button type="button" data-core-mode="work">업무용</button><button type="button" data-core-mode="counseling">상담용</button>';
    box.addEventListener('click', event => {
      const target = event.target.closest('[data-core-mode]')?.dataset.coreMode;
      if (target) go(target);
    });
    paint(box);
    return box;
  }
  function paint(box) {
    box.querySelectorAll('[data-core-mode]').forEach(button => {
      const on = button.dataset.coreMode === mode;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }
  function go(target) {
    if (target === mode || !HOMES[target]) return;
    // The DATA CORE page (index.html) switches its view in place; it returns false when it cannot.
    if (typeof window.DataCoreSwitchMode === 'function' && window.DataCoreSwitchMode(target)) return;
    (window.top !== window ? window.top : window).location.href = HOMES[target];
  }
  function sync(next) {
    mode = next || null;
    document.querySelectorAll('.core-mode-switch').forEach(paint);
  }
  function mount() {
    if (document.body.classList.contains('admissions-counseling')) mode = 'counseling';
    for (const sidebar of document.querySelectorAll('.sidebar, .kk-sidebar')) {
      if (sidebar.querySelector('.core-mode-switch')) continue;
      const brand = sidebar.querySelector(':scope > .brand, :scope > .kk-brand, :scope > .core-brand');
      if (brand) brand.after(build());
    }
  }
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  window.DataCoreModeSwitch = { build, sync, go, mount, mode: () => mode };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

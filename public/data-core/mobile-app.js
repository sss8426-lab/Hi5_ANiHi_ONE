// Phone layout for 업무용 pages: app bar, bottom tabs and a 전체메뉴 sheet.
// Menu taps reuse the page's own navigation nodes (same handlers and permissions); the server still enforces access.
(() => {
  if (document.body.classList.contains('kk-mobile') || window.DataCoreMobileApp) return;
  const media = matchMedia('(max-width: 760px)');
  const work = [
    ['library','자료보관함','/data-core/work/library','Folder'],
    ['blog','블로그 자동화','/data-core/content/blog','PenLine'],
    ['instagram','인스타 자동화','/data-core/content/instagram','Image'],
    ['attendance','출석부','/data-core/work/attendance','BookOpen'],
    ['reports','월간 업무보고','/data-core/reports','ClipboardList'],
    ['kkumeum','꿈이음','/data-core/kkumeum','Users'],
  ];
  const admin = [
    ['operations','운영관리','/data-core/operations','RotateCcw'],
    ['accounts','계정·권한 관리','/data-core/accounts','Settings'],
  ];
  const all = [['work-home','업무용 홈','/data-core/work','House'], ...work, ...admin, ['mode-home','모드 선택','/data-core','ArrowLeft']];
  const svg = name => `<svg class="ma-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#${name}"></use></svg>`;
  const state = { context: null, signups: 0, listeners: new Set() };

  const isWorkPage = () => {
    const path = location.pathname.replace(/\/+$/, '');
    return path === '/data-core/work' || path.startsWith('/data-core/work/') || path.startsWith('/data-core/content')
      || ['/data-core/reports','/data-core/reports.html','/data-core/operations','/data-core/operations.html','/data-core/accounts','/data-core/accounts.html'].includes(path);
  };
  const isHome = () => location.pathname.replace(/\/+$/, '') === '/data-core/work' && !location.search.includes('view=');
  const currentId = () => {
    const path = location.pathname.replace(/\/+$/, '').replace(/\.html$/, '');
    return all.find(item => item[2] === path)?.[0] || (path.startsWith('/data-core/content') ? 'blog' : '');
  };

  function go(id) {
    const item = all.find(entry => entry[0] === id);
    if (!item) return;
    // On the 업무용 page the sidebar has SPA buttons for 홈·자료보관함·출석부; others are links.
    const local = document.querySelector(`button[data-work-menu="${id}"]`);
    sheet.close();
    if (local) { local.click(); window.scrollTo(0, 0); sync(); return; }
    location.href = item[2];
  }

  const bar = document.createElement('header');
  bar.className = 'ma-bar';
  bar.innerHTML = `<button type="button" class="ma-back" aria-label="업무용 홈으로">${svg('ChevronLeft')}</button>
    <div class="ma-heading"><small>HI5·ANiHi DATA CORE</small><strong data-ma-title>업무용</strong></div>
    <button type="button" class="ma-avatar" aria-haspopup="dialog" aria-controls="maSheet" aria-label="내 정보와 전체메뉴" data-ma-avatar>S</button>`;
  const tabs = document.createElement('nav');
  tabs.className = 'ma-tabs';
  tabs.setAttribute('aria-label', '업무용 탭');
  tabs.innerHTML = [['home','House','홈'],['library','Folder','자료'],['calendar','LayoutDashboard','일정'],['menu','Menu','전체메뉴']]
    .map(([key, icon, label]) => `<button type="button" data-ma-tab="${key}"${key === 'menu' ? ' aria-haspopup="dialog" aria-controls="maSheet"' : ''}>${svg(icon)}<span>${label}</span></button>`).join('');
  const sheet = document.createElement('dialog');
  sheet.id = 'maSheet';
  sheet.className = 'ma-sheet';
  sheet.setAttribute('aria-label', '전체메뉴');
  const row = ([id, label, href, icon]) => `<a class="ma-row" href="${href}" data-ma-go="${id}">${svg(icon)}<span>${label}</span>${id === 'accounts' ? '<b class="ma-badge" data-ma-signups hidden></b>' : ''}${svg('ChevronRight')}</a>`;
  sheet.innerHTML = `<div class="ma-grab" aria-hidden="true"></div>
    <div class="ma-profile"><span class="ma-avatar big" data-ma-avatar>S</span><div><strong data-ma-name>사용자 확인 중</strong><small data-ma-role></small></div>
      <button type="button" class="ma-logout" data-ma-logout data-logout hidden>로그아웃</button></div>
    <p class="ma-group">업무</p><div class="ma-list">${row(all[0])}${work.map(row).join('')}</div>
    <div data-ma-admin hidden><p class="ma-group">관리자</p><div class="ma-list">${admin.map(row).join('')}</div></div>
    <a class="ma-mode" href="/data-core" data-ma-go="mode-home">${svg('ArrowLeft')}모드 선택으로 돌아가기</a>`;

  bar.querySelector('.ma-back').addEventListener('click', () => go('work-home'));
  bar.querySelector('.ma-avatar').addEventListener('click', () => sheet.showModal());
  tabs.addEventListener('click', event => {
    const key = event.target.closest('[data-ma-tab]')?.dataset.maTab;
    if (key === 'menu') sheet.showModal();
    else if (key === 'home') go('work-home');
    else if (key === 'library') go('library');
    else if (key === 'calendar') {
      if (!document.getElementById('view-work-home')) { location.href = '/data-core/work#calendar'; return; }
      if (!isHome()) go('work-home');
      requestAnimationFrame(() => document.querySelector('#view-work-home .calendar-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  });
  sheet.addEventListener('click', event => {
    const link = event.target.closest('[data-ma-go]');
    if (link) { event.preventDefault(); go(link.dataset.maGo); return; }
    if (event.target.closest('[data-ma-logout]')) { void logout(); return; }
    const rect = sheet.getBoundingClientRect();
    if (event.clientY < rect.top) sheet.close();
  });

  async function logout() {
    const pageButton = document.getElementById('logoutBtn');
    if (pageButton) { sheet.close(); pageButton.click(); return; }
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (response.ok) location.assign('/data-core/counseling');
    } catch { /* stay on the page; the next request shows the login state */ }
  }

  function roleText(context) {
    if (context.isSuperAdmin) return '마스터 관리자';
    const labels = { MASTER:'마스터 관리자', SUPER_ADMIN:'마스터 관리자', CAMPUS_ADMIN:'캠퍼스 관리자', CAMPUS_DIRECTOR:'캠퍼스 원장', TEACHER:'교사', STAFF:'직원' };
    return (context.memberships || []).map(m => `${m.campusName || '공통'} · ${labels[m.role] || m.role}`).join(' / ') || '권한 미부여';
  }
  function renderContext() {
    const context = state.context;
    const user = context?.user || {};
    const name = context?.authenticated ? (user.displayName || user.email || '사용자') : '로그인이 필요합니다';
    document.querySelectorAll('[data-ma-avatar]').forEach(node => { node.textContent = context?.authenticated ? String(name).trim().slice(0, 1).toUpperCase() : '?'; });
    sheet.querySelector('[data-ma-name]').textContent = name;
    sheet.querySelector('[data-ma-role]').textContent = context?.authenticated ? roleText(context) : '';
    sheet.querySelector('[data-ma-logout]').hidden = !String(user.internalUserId || '').startsWith('local:');
    sheet.querySelector('[data-ma-admin]').hidden = !(context?.authenticated && context.isSuperAdmin);
    sheet.querySelectorAll('[data-ma-signups]').forEach(node => { node.hidden = !state.signups; node.textContent = `신청 ${state.signups}`; });
    state.listeners.forEach(listener => listener({ context, signups: state.signups }));
  }
  async function loadContext() {
    try {
      const response = await fetch('/api/data-core/context', { credentials: 'include', cache: 'no-store' });
      state.context = response.ok ? await response.json() : null;
    } catch { state.context = null; }
    renderContext();
    if (!state.context?.authenticated || !state.context.isSuperAdmin) return;
    try {
      const response = await fetch('/api/auth/signup-requests', { credentials: 'include', cache: 'no-store' });
      if (response.ok) state.signups = ((await response.json()).requests || []).length;
    } catch { /* the count is optional */ }
    renderContext();
  }

  const titleNode = () => document.querySelector('#pageTitle, #contentPageTitle, main h1');
  function sync() {
    const active = media.matches && isWorkPage();
    document.body.classList.toggle('mobile-app', active);
    document.body.classList.toggle('mobile-app-home', active && isHome());
    if (!active) { if (sheet.open) sheet.close(); return; }
    bar.querySelector('[data-ma-title]').textContent = (titleNode()?.textContent || '업무용').trim();
    const id = isHome() ? 'home' : currentId() === 'library' ? 'library' : '';
    tabs.querySelectorAll('[data-ma-tab]').forEach(tab => {
      if (tab.dataset.maTab === id) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
    sheet.querySelectorAll('[data-ma-go]').forEach(link => link.classList.toggle('active', link.dataset.maGo === (isHome() ? 'work-home' : currentId())));
  }

  document.body.prepend(bar);
  document.body.append(tabs, sheet);
  const title = titleNode();
  if (title) new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true });
  addEventListener('popstate', sync);
  media.addEventListener('change', sync);
  sync();
  void loadContext();
  if (location.hash === '#calendar') addEventListener('load', () => document.querySelector('#view-work-home .calendar-panel')?.scrollIntoView({ block: 'start' }), { once: true });

  window.DataCoreMobileApp = {
    sync,
    subscribe(listener) { state.listeners.add(listener); listener({ context: state.context, signups: state.signups }); },
  };

  // 업무용 홈: 오늘 widget and the admin-only app icons.
  const today = document.querySelector('[data-work-today]');
  if (!today) return;
  const set = (name, text) => { today.querySelector(`[data-work-today-${name}]`).textContent = text; };
  const md = key => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
  set('date', new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()));
  document.addEventListener('academy-calendar:today', ({ detail }) => {
    set('date', new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(detail.today + 'T12:00:00+09:00')));
    if (!detail.authenticated) { set('count', '로그인 후 일정 확인'); set('first', ''); set('next', ''); return; }
    if (detail.loading) { set('count', '오늘 일정 확인 중'); return; }
    if (detail.error) { set('count', '일정을 불러오지 못했어요'); set('first', ''); set('next', ''); return; }
    set('count', detail.events.length ? `오늘 일정 ${detail.events.length}건` : '오늘 일정 없음');
    set('first', detail.events[0]?.title || '');
    set('next', detail.next ? `다음 · ${md(detail.next.startDate)} ${detail.next.title}` : '');
  });
  window.DataCoreMobileApp.subscribe(({ context, signups }) => {
    const master = Boolean(context?.authenticated && context.isSuperAdmin);
    document.querySelectorAll('[data-work-app-admin]').forEach(node => { node.hidden = !master; });
    const badge = document.querySelector('[data-work-app-signups]');
    if (badge) { badge.hidden = !(master && signups); badge.textContent = String(signups); badge.title = `직원인증 신청 ${signups}건`; }
  });
})();

(() => {
  const KKUMEUM_HREF = '/data-core/kkumeum';
  const HQ_LIBRARY_SRC = '/data-core/work/hq-library.js';
  const COMPETITION_SOURCES_SRC = '/data-core/counseling/competition-sources.js';

  function addWorkSidebarLink() {
    const workNav = document.querySelector('[data-nav-scope="work"]');
    if (!workNav || workNav.querySelector('[data-kkumeum-nav]')) return;
    const returnButton = [...workNav.children].find((node) => node.matches?.('[data-view="mode-home"]'));
    const link = document.createElement('a');
    link.className = 'nav-item';
    link.href = KKUMEUM_HREF;
    link.dataset.kkumeumNav = 'true';
    link.innerHTML = '<span class="nav-icon">↗</span><span>꿈이음</span>';
    workNav.insertBefore(link, returnButton || null);
  }

  function addWorkHomeCard() {
    const grid = document.querySelector('#view-work-home .menu-card-grid');
    if (!grid || grid.querySelector('[data-kkumeum-card]')) return;
    grid.classList.remove('exact-three');
    grid.classList.add('work-four');
    const card = document.createElement('a');
    card.className = 'feature-card';
    card.href = KKUMEUM_HREF;
    card.dataset.kkumeumCard = 'true';
    card.innerHTML = [
      '<span class="feature-icon">↗</span>',
      '<strong>꿈이음</strong>',
      '<small>학생 작품·월간 평가·보호자 소식을 한곳에서 관리합니다.</small>',
    ].join('');
    grid.appendChild(card);
  }

  function addResponsiveStyle() {
    if (document.getElementById('kkumeum-work-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'kkumeum-work-nav-style';
    style.textContent = '@media (min-width: 1100px){.menu-card-grid.work-four{grid-template-columns:repeat(4,minmax(0,1fr));}}';
    document.head.appendChild(style);
  }

  function loadScriptOnce(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  function loadPageEnhancements() {
    if (document.getElementById('folderGroups')) loadScriptOnce(HQ_LIBRARY_SRC);
    if (document.getElementById('view-competitions')) loadScriptOnce(COMPETITION_SOURCES_SRC);
  }

  addWorkSidebarLink();
  addWorkHomeCard();
  addResponsiveStyle();
  loadPageEnhancements();
})();

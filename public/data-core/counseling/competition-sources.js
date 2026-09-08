(() => {
  const STORAGE_KEY = 'data-core:competition-news-collapsed';
  const state = { context: null, collapsed: false, sourceMap: new Map() };
  const $ = (selector) => document.querySelector(selector);

  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof body === 'object' && body?.error ? body.error : String(body || `HTTP ${response.status}`);
      throw new Error(message);
    }
    return body;
  }

  function h(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function providerLabel(provider) {
    return provider === 'artmd' ? '미대입시' : provider === 'mgood' ? '엠굿' : provider;
  }

  function addStyle() {
    if ($('#competition-source-style')) return;
    const style = document.createElement('style');
    style.id = 'competition-source-style';
    style.textContent = `
      #view-competitions .competition-filter-stack{display:none!important}
      #view-competitions .competition-workspace.source-drawer-enabled{grid-template-columns:minmax(0,1fr) minmax(360px,.9fr);overflow:hidden;transition:grid-template-columns .28s ease}
      #view-competitions .competition-workspace.source-drawer-enabled .competition-news{min-width:0;transition:transform .28s ease,opacity .2s ease,padding .28s ease,border-width .28s ease}
      #view-competitions .competition-workspace.source-drawer-enabled.news-collapsed{grid-template-columns:minmax(0,1fr) 0fr}
      #view-competitions .competition-workspace.source-drawer-enabled.news-collapsed .competition-news{width:0;min-width:0;padding-left:0;padding-right:0;border-left-width:0;border-right-width:0;overflow:hidden;opacity:0;transform:translateX(110%);pointer-events:none}
      .competition-source-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px;padding:12px;border:1px solid var(--line,#e5e7eb);border-radius:14px;background:rgba(248,250,252,.72)}
      .competition-source-toolbar .source-status{flex:1 1 100%;font-size:12px;color:var(--muted,#667085);min-height:18px}
      .competition-source-toolbar button{white-space:nowrap}
      .competition-source-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}
      .competition-source-badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:#eef4ff;color:#344054;font-size:11px;font-weight:700}
      .competition-news-toggle{white-space:nowrap}
      @media(max-width:900px){
        #view-competitions .competition-workspace.source-drawer-enabled{display:block;overflow:visible}
        #view-competitions .competition-workspace.source-drawer-enabled .competition-news{max-height:5000px;transform:translateY(0);transition:max-height .28s ease,transform .28s ease,opacity .2s ease,margin .28s ease,padding .28s ease}
        #view-competitions .competition-workspace.source-drawer-enabled.news-collapsed .competition-news{width:auto;max-height:0;margin:0;padding-top:0;padding-bottom:0;border-width:0;opacity:0;transform:translateY(-18px);overflow:hidden}
      }
      @media(prefers-reduced-motion:reduce){
        #view-competitions .competition-workspace.source-drawer-enabled,#view-competitions .competition-workspace.source-drawer-enabled .competition-news{transition:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function setCollapsed(value) {
    const workspace = $('.competition-workspace');
    const button = $('#competitionNewsToggle');
    if (!workspace || !button) return;
    state.collapsed = Boolean(value);
    workspace.classList.toggle('news-collapsed', state.collapsed);
    button.setAttribute('aria-expanded', String(!state.collapsed));
    button.textContent = state.collapsed ? '소식 보기' : '소식 접기';
    try { localStorage.setItem(STORAGE_KEY, state.collapsed ? '1' : '0'); } catch {}
  }

  function installToggle() {
    const workspace = $('.competition-workspace');
    const news = $('.competition-news');
    const hero = $('#view-competitions .hero-row');
    if (!workspace || !news || !hero) return;
    workspace.classList.add('source-drawer-enabled');
    news.id = news.id || 'competitionNewsDrawer';
    let button = $('#competitionNewsToggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'competitionNewsToggle';
      button.type = 'button';
      button.className = 'ghost-btn competition-news-toggle';
      button.setAttribute('aria-controls', news.id);
      const register = $('#openCompetitionBtn');
      if (register) register.before(button);
      else hero.appendChild(button);
      button.addEventListener('click', () => setCollapsed(!state.collapsed));
    }
    let saved = false;
    try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
    setCollapsed(saved);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !state.collapsed && document.querySelector('#view-competitions.active')) setCollapsed(true);
    });
  }

  function sourceSummary(result) {
    if (!result) return '';
    const errorText = Array.isArray(result.sourceErrors) && result.sourceErrors.length
      ? ` · 일부 소스 확인 실패 ${result.sourceErrors.length}건`
      : '';
    return `불러오기 완료 · 신규 ${Number(result.created) || 0} · 갱신 ${Number(result.updated) || 0} · 기존 ${Number(result.unchanged) || 0}${errorText}`;
  }

  async function importProvider(provider, button) {
    const status = $('#competitionSourceStatus');
    const buttons = document.querySelectorAll('[data-competition-source-import]');
    buttons.forEach((item) => { item.disabled = true; });
    if (status) status.textContent = `${provider === 'all' ? '전체 소스' : providerLabel(provider)}를 확인하고 있습니다...`;
    try {
      const response = await api('/api/data-core/competitions/sources/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const message = sourceSummary(response.import);
      try { sessionStorage.setItem('competition-source-import-message', message); } catch {}
      location.reload();
    } catch (error) {
      if (status) status.textContent = `불러오기 실패 · ${error.message}`;
      buttons.forEach((item) => { item.disabled = false; });
      if (button) button.focus();
    }
  }

  function installToolbar() {
    const news = $('.competition-news');
    const head = news?.querySelector('.panel-head');
    if (!news || !head || $('#competitionSourceToolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'competitionSourceToolbar';
    toolbar.className = 'competition-source-toolbar';
    if (state.context?.isSuperAdmin) {
      toolbar.innerHTML = `
        <button type="button" class="secondary-btn" data-competition-source-import="artmd">미대입시 불러오기</button>
        <button type="button" class="secondary-btn" data-competition-source-import="mgood">엠굿 불러오기</button>
        <button type="button" class="ghost-btn" data-competition-source-import="all">전체 새로고침</button>
        <div class="source-status" id="competitionSourceStatus">공개 소스의 대회명·주최·접수기간·원문 링크만 DATA CORE에 구조화합니다.</div>`;
    } else {
      toolbar.innerHTML = '<div class="source-status" id="competitionSourceStatus">미대입시·엠굿 공개 소식을 마스터가 확인해 DATA CORE에 반영합니다.</div>';
    }
    head.after(toolbar);
    toolbar.querySelectorAll('[data-competition-source-import]').forEach((button) => {
      button.addEventListener('click', () => importProvider(button.dataset.competitionSourceImport, button));
    });
    try {
      const message = sessionStorage.getItem('competition-source-import-message');
      if (message) {
        $('#competitionSourceStatus').textContent = message;
        sessionStorage.removeItem('competition-source-import-message');
      }
    } catch {}
  }

  async function loadSourceMap() {
    if (!state.context?.authenticated) return;
    try {
      const response = await api('/api/data-core/competitions?limit=100');
      state.sourceMap.clear();
      for (const competition of response.competitions || []) {
        const sources = Array.isArray(competition?.metadata?.externalSources) ? competition.metadata.externalSources : [];
        const providers = Array.from(new Set(sources.map((source) => source?.provider).filter((provider) => provider === 'artmd' || provider === 'mgood')));
        if (providers.length) state.sourceMap.set(String(competition.id), providers);
      }
      renderBadges();
    } catch {}
  }

  function renderBadges() {
    const list = $('#competitionList');
    if (!list) return;
    list.querySelectorAll('[data-competition-id]').forEach((card) => {
      const id = String(card.dataset.competitionId || '');
      const providers = state.sourceMap.get(id) || [];
      let root = card.querySelector('.competition-source-badges');
      if (!providers.length) {
        root?.remove();
        return;
      }
      if (!root) {
        root = document.createElement('span');
        root.className = 'competition-source-badges';
        card.appendChild(root);
      }
      root.innerHTML = providers.map((provider) => `<span class="competition-source-badge">${h(providerLabel(provider))}</span>`).join('');
    });
  }

  function observeList() {
    const list = $('#competitionList');
    if (!list) return;
    const observer = new MutationObserver(() => renderBadges());
    observer.observe(list, { childList: true, subtree: false });
  }

  async function init() {
    if (!$('#view-competitions')) return;
    addStyle();
    installToggle();
    try {
      state.context = await api('/api/data-core/context');
    } catch {
      state.context = null;
    }
    installToolbar();
    observeList();
    await loadSourceMap();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

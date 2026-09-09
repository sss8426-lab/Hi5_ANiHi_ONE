(() => {
  const CACHE_KEY = 'hi5:competition-live-news:v2';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const SOURCES = ['mgood', 'artmd'];
  let liveItems = [];
  let loading = false;
  let loadedAt = 0;
  let lastErrors = [];
  let calendarObservers = [];

  const h = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function validLiveItem(item) {
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    return item && (item.sourceStatus === 'open' || item.sourceStatus === 'upcoming')
      && (!item.applicationEnd || item.applicationEnd >= today);
  }

  function dday(value) {
    if (!value) return '마감일 확인 필요';
    const end = new Date(`${value}T00:00:00`);
    if (Number.isNaN(end.getTime())) return '마감일 확인 필요';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((end.getTime() - today.getTime()) / 86400000);
    if (days === 0) return 'D-day';
    return days > 0 ? `D-${days}` : `마감 ${Math.abs(days)}일 경과`;
  }

  function dedupe(items) {
    const map = new Map();
    for (const item of items.filter(validLiveItem)) {
      const sourceUrl = String(item.sourceUrl || '');
      const title = String(item.title || '').trim();
      if (!sourceUrl || !title) continue;
      let parsed;
      try { parsed = new URL(sourceUrl); } catch { continue; }
      if (!['https:', 'http:'].includes(parsed.protocol)) continue;
      const externalId = item.externalSourceId || parsed.searchParams.get('c_seq') || parsed.searchParams.get('it_id');
      const key = externalId ? `${item.source}:${externalId}` : `${parsed.origin}${parsed.pathname}|${title}|${item.applicationStart}|${item.applicationEnd}`;
      if (!map.has(key)) map.set(key, item);
    }
    return [...map.values()].sort((a, b) => {
      const aStatus = a.sourceStatus === 'open' ? 0 : 1;
      const bStatus = b.sourceStatus === 'open' ? 0 : 1;
      return String(a.applicationEnd || '9999-99-99').localeCompare(String(b.applicationEnd || '9999-99-99'))
        || aStatus - bStatus
        || String(a.title || '').localeCompare(String(b.title || ''), 'ko');
    });
  }

  function saveCache() {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: liveItems }));
    } catch {
      // Browser storage may be unavailable; live rendering still works.
    }
  }

  function readCache() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.items) || Date.now() - Number(parsed.savedAt || 0) > CACHE_TTL_MS) return false;
      liveItems = dedupe(parsed.items);
      loadedAt = Number(parsed.savedAt || 0);
      return true;
    } catch {
      return false;
    }
  }

  async function previewSource(source) {
    const response = await fetch(`/api/data-core/competition-sources/${encodeURIComponent(source)}/preview`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `${source} 소식을 불러오지 못했습니다.`);
    return body;
  }

  function renderNews() {
    liveItems = dedupe(liveItems);
    const list = document.getElementById('competitionSourceList');
    if (!list) return;
    if (!liveItems.length) {
      list.innerHTML = '<div class="empty-state compact">현재 접수중·예정인 공개 공모전 소식을 찾지 못했습니다.</div>';
      return;
    }
    list.innerHTML = liveItems.map((item) => {
      const dates = [item.applicationStart, item.applicationEnd].filter(Boolean).join(' ~ ');
      const statusLabel = item.sourceStatus === 'open' ? '접수중' : '예정';
      return `<article class="competition-source-card live-source-card">
        <div class="source-card-head">
          <span class="source-badge ${h(item.source)}">${h(item.sourceName || '외부 소식')}</span>
          <span class="live-source-status ${h(item.sourceStatus)}">${h(statusLabel)}</span>
        </div>
        <strong>${h(item.title)}</strong>
        <small>${h(item.organizer || item.hostSchool || '주최·주관 확인 필요')}</small>
        <span>${dates ? `접수 ${h(dates)}` : '접수기간 확인 필요'} · ${h(dday(item.applicationEnd))}</span>
        <a class="ghost-btn" href="${h(item.sourceUrl)}" target="_blank" rel="noopener">자세히 보기</a>
      </article>`;
    }).join('');
  }

  function statusText(errors = lastErrors) {
    const status = document.getElementById('competitionSourceStatus');
    if (!status) return;
    const openCount = liveItems.filter((item) => item.sourceStatus === 'open').length;
    const upcomingCount = liveItems.filter((item) => item.sourceStatus === 'upcoming').length;
    const checked = loadedAt ? new Date(loadedAt + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
    const suffix = errors.length ? ` · 일부 출처 확인 필요: ${errors.join(', ')}` : '';
    status.textContent = `접수중 ${openCount}건 · 예정 ${upcomingCount}건${checked ? ` · ${checked} 확인` : ''}${suffix}`;
  }

  function deadlineItems(date) {
    return liveItems.filter((item) => item.applicationEnd === date);
  }

  function disconnectCalendarObservers() {
    calendarObservers.forEach((observer) => observer.disconnect());
  }

  function observeCalendars() {
    calendarObservers = [];
    document.querySelectorAll('[data-calendar-home]').forEach((home) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        renderCalendarDeadlines();
        observer.observe(home, { childList: true, subtree: true });
      });
      observer.observe(home, { childList: true, subtree: true });
      calendarObservers.push(observer);
    });
  }

  function renderCalendarDeadlines() {
    disconnectCalendarObservers();
    document.querySelectorAll('[data-external-competition-deadline]').forEach((node) => node.remove());
    document.querySelectorAll('[data-calendar-home]').forEach((home) => {
      home.querySelectorAll('[data-calendar-date]').forEach((day) => {
        const date = day.dataset.calendarDate || '';
        const deadlines = deadlineItems(date);
        if (!deadlines.length) return;
        const chip = document.createElement('span');
        chip.className = 'calendar-event-chip competition external-competition-deadline';
        chip.dataset.externalCompetitionDeadline = 'true';
        chip.textContent = deadlines.length === 1 ? `공모전 마감 · ${deadlines[0].title}` : `공모전 마감 ${deadlines.length}건`;
        chip.title = deadlines.map((item) => item.title).join('\n');
        day.appendChild(chip);
      });

      const selected = home.querySelector('.calendar-day.selected[data-calendar-date]');
      const list = home.querySelector('[data-calendar-list]');
      if (!selected || !list) return;
      const deadlines = deadlineItems(selected.dataset.calendarDate || '');
      if (!deadlines.length) return;
      const section = document.createElement('section');
      section.className = 'external-calendar-deadlines';
      section.dataset.externalCompetitionDeadline = 'true';
      section.innerHTML = `<h4>공모전 접수 마감</h4><div class="calendar-event-list">${deadlines.map((item) => `<article class="calendar-event-row external-deadline-row"><div><strong>${h(item.title)}</strong><small>${h(item.sourceName || '외부 소식')} · ${h(item.sourceStatusLabel || (item.sourceStatus === 'open' ? '접수중' : '예정'))} · 마감 ${h(item.applicationEnd || '')}</small></div><a class="ghost-btn" href="${h(item.sourceUrl)}" target="_blank" rel="noopener">원문</a></article>`).join('')}</div>`;
      list.appendChild(section);
    });
    observeCalendars();
  }

  async function refreshLiveNews(force = false) {
    if (loading) return;
    if (!force && liveItems.length && Date.now() - loadedAt < CACHE_TTL_MS) {
      renderNews();
      statusText();
      renderCalendarDeadlines();
      return;
    }
    loading = true;
    const status = document.getElementById('competitionSourceStatus');
    const button = document.getElementById('refreshCompetitionSourcesBtn');
    if (button) button.disabled = true;
    if (status) status.textContent = '공모전 소식을 확인하고 있습니다.';
    const results = await Promise.allSettled(SOURCES.map((source) => previewSource(source)));
    const errors = [];
    let items = [...liveItems];
    results.forEach((result, index) => {
      const source = SOURCES[index];
      const name = source === 'mgood' ? '엠굿' : '아트앤디자인';
      if (result.status !== 'fulfilled') { errors.push(name); return; }
      const body = result.value;
      for (const page of body.pages || []) {
        if (!page.ok) { errors.push(`${name}${page.url.includes('state=other') ? ' 기타' : ''}`); continue; }
        items = items.filter((item) => item.sourcePage !== page.url);
        items.push(...(body.items || []).filter((item) => item.sourcePage === page.url));
      }
    });
    liveItems = dedupe(items);
    lastErrors = errors;
    loadedAt = Date.now();
    saveCache();
    renderNews();
    statusText(errors);
    renderCalendarDeadlines();
    loading = false;
    if (button) button.disabled = false;
  }

  function replaceControl(id, setup) {
    const current = document.getElementById(id);
    if (!current) return null;
    const next = current.cloneNode(true);
    current.replaceWith(next);
    setup(next);
    return next;
  }

  function configureControls() {
    document.querySelectorAll('[data-competition-source]').forEach((button) => button.remove());
    document.querySelectorAll('.source-import-btn').forEach((button) => button.remove());

    replaceControl('refreshCompetitionSourcesBtn', (button) => {
      button.textContent = '새로고침';
      button.onclick = () => refreshLiveNews(true);
    });

    const actions = document.querySelector('.competition-source-actions');
    if (actions) actions.classList.add('live-only-refresh');
  }

  function addStyle() {
    if (document.getElementById('competition-live-enhancement-style')) return;
    const style = document.createElement('style');
    style.id = 'competition-live-enhancement-style';
    style.textContent = `
      .competition-source-actions.live-only-refresh{display:flex;justify-content:flex-end}
      .live-source-status{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:800}
      .live-source-status.open{background:#fff1f2;color:#e11d48}
      .live-source-status.upcoming{background:#eff6ff;color:#2563eb}
      .external-competition-deadline{background:#eff6ff!important;color:#1d4ed8!important;border:1px solid #bfdbfe}
      .external-calendar-deadlines{margin-top:14px;padding-top:12px;border-top:1px solid #e4e7ec}
      .external-calendar-deadlines h4{margin:0 0 8px;font-size:13px;color:#1d4ed8}
      .external-deadline-row .ghost-btn{flex:0 0 auto}
      @media(max-width:760px){.external-deadline-row{align-items:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function watchCompetitionView() {
    const view = document.getElementById('view-competitions');
    if (!view) return;
    const maybeRefresh = () => {
      if (!view.classList.contains('active')) return;
      renderNews();
      statusText();
      refreshLiveNews(false);
    };
    new MutationObserver(maybeRefresh).observe(view, { attributes: true, attributeFilter: ['class'] });
    maybeRefresh();
  }

  function init() {
    addStyle();
    configureControls();
    readCache();
    renderNews();
    statusText();
    observeCalendars();
    renderCalendarDeadlines();
    watchCompetitionView();
    // Fetch once after the main DATA CORE app has had time to restore the login context.
    setTimeout(() => refreshLiveNews(false), 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

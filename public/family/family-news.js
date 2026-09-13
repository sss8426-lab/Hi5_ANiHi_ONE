(() => {
  const panel = document.querySelector('[data-panel="news"]');
  const navButton = document.querySelector('[data-tab="news"]');
  const familyView = document.getElementById('familyView');
  if (!panel || !navButton || !familyView) return;

  const state = {
    notices: [],
    unreadCount: 0,
    loaded: false,
    loading: false,
    filter: null,
  };

  function text(value, fallback = '') {
    const result = String(value ?? '').trim();
    return result || fallback;
  }

  function typeLabel(type) {
    return ({
      'child-message': '개별소식',
      'class-news': '반소식',
      'campus-news': '캠퍼스공지',
      'organization-notice': '전체공지',
      'selected-delivery': '선택전달',
    })[type] || '소식';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error || `요청을 처리하지 못했습니다. (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function ensureNavBadge() {
    let badge = document.getElementById('newsNavBadge');
    if (badge) return badge;
    badge = document.createElement('em');
    badge.id = 'newsNavBadge';
    badge.className = 'news-nav-badge hidden';
    badge.setAttribute('aria-label', '읽지 않은 소식');
    navButton.append(badge);
    return badge;
  }

  function updateUnreadBadges() {
    const badge = ensureNavBadge();
    badge.textContent = state.unreadCount > 99 ? '99+' : String(state.unreadCount);
    badge.classList.toggle('hidden', state.unreadCount < 1);
    const count = document.getElementById('newsUnreadCount');
    if (count) count.textContent = state.unreadCount ? `읽지 않음 ${state.unreadCount}개` : '모두 읽음';
  }

  function emptyState(title, copy) {
    const article = document.createElement('article');
    article.className = 'empty-card';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.textContent = '◌';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = copy;
    article.append(icon, heading, paragraph);
    return article;
  }

  async function markRead(notice, article) {
    if (!notice.unread) return;
    try {
      await api(`/api/family/notices/${encodeURIComponent(notice.announcementId)}/read`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      notice.unread = false;
      state.unreadCount = Math.max(0, state.unreadCount - 1);
      article.classList.remove('unread');
      article.classList.add('read');
      article.querySelector('.news-unread-dot')?.remove();
      updateUnreadBadges();
    } catch (error) {
      const status = document.getElementById('newsStatus');
      if (status) status.textContent = error?.status === 401 ? '로그인 시간이 만료되었습니다.' : '읽음 상태를 저장하지 못했습니다.';
    }
  }

  function noticeCard(notice) {
    const article = document.createElement('article');
    article.className = `news-card ${notice.unread ? 'unread' : 'read'}`;

    const meta = document.createElement('div');
    meta.className = 'news-meta';
    const type = document.createElement('span');
    type.className = 'news-type';
    type.textContent = typeLabel(notice.announcementType);
    const date = document.createElement('time');
    date.textContent = formatDate(notice.publishedAt);
    meta.append(type, date);
    if (notice.unread) {
      const dot = document.createElement('i');
      dot.className = 'news-unread-dot';
      dot.setAttribute('aria-label', '읽지 않음');
      meta.append(dot);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'news-open-button';
    const title = document.createElement('strong');
    title.textContent = text(notice.title, '소식');
    const preview = document.createElement('span');
    const bodyText = text(notice.body);
    preview.textContent = bodyText.length > 90 ? `${bodyText.slice(0, 90)}…` : bodyText;
    button.append(title, preview);

    const body = document.createElement('div');
    body.className = 'news-body hidden';
    body.textContent = bodyText;

    button.addEventListener('click', async () => {
      const opening = body.classList.contains('hidden');
      body.classList.toggle('hidden', !opening);
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) await markRead(notice, article);
    });
    button.setAttribute('aria-expanded', 'false');

    article.append(meta, button, body);
    return article;
  }

  function render() {
    panel.replaceChildren();

    const titleWrap = document.createElement('div');
    titleWrap.className = 'page-title';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'NEWS';
    const row = document.createElement('div');
    row.className = 'news-title-row';
    const heading = document.createElement('h2');
    heading.textContent = '소식';
    const count = document.createElement('span');
    count.id = 'newsUnreadCount';
    count.className = 'news-unread-count';
    row.append(heading, count);
    const intro = document.createElement('p');
    intro.textContent = '개별소식·반소식·캠퍼스공지·전체공지를 한곳에서 확인하세요.';
    titleWrap.append(eyebrow, row, intro);
    panel.append(titleWrap);

    const status = document.createElement('p');
    status.id = 'newsStatus';
    status.className = 'news-status';
    panel.append(status);

    const list = document.createElement('div');
    list.className = 'news-list';
    const notices = state.filter ? state.notices.filter(n => state.filter.includes(n.announcementType)) : state.notices;
    if (!notices.length) {
      list.append(emptyState('새로운 소식이 없습니다', '선생님이 전달한 소식이 생기면 이곳에 표시됩니다.'));
    } else {
      notices.forEach((notice) => list.append(noticeCard(notice)));
    }
    panel.append(list);
    updateUnreadBadges();
  }

  function renderError(error) {
    panel.replaceChildren();
    const title = error?.status === 503 ? '소식 연결을 준비하고 있습니다' : '소식을 불러오지 못했습니다';
    const copy = error?.status === 503
      ? '보호자 전용 FAMILY_DB가 연결되기 전에는 다른 저장소의 데이터를 대신 보여주지 않습니다.'
      : '잠시 뒤 다시 소식 탭을 열어 주세요.';
    panel.append(emptyState(title, copy));
    state.loaded = false;
  }

  async function loadNotices({ force = false } = {}) {
    if (state.loading || (state.loaded && !force)) return;
    state.loading = true;
    try {
      const response = await api('/api/family/notices');
      state.notices = Array.isArray(response.notices) ? response.notices : [];
      state.unreadCount = Number(response.unreadCount) || 0;
      state.loaded = true;
      render();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        state.notices = [];
        state.unreadCount = 0;
        updateUnreadBadges();
      }
      renderError(error);
    } finally {
      state.loading = false;
    }
  }

  function reset() {
    state.notices = [];
    state.unreadCount = 0;
    state.loaded = false;
    updateUnreadBadges();
  }

  navButton.addEventListener('click', () => loadNotices({ force: true }));
  window.addEventListener('family:news-filter', event => {
    state.filter = Array.isArray(event.detail) ? event.detail : null;
    if (state.loaded) render();
    else void loadNotices();
  });
  document.getElementById('logoutBtn')?.addEventListener('click', reset);
  document.getElementById('logoutTopBtn')?.addEventListener('click', reset);

  const observer = new MutationObserver(() => {
    if (!familyView.classList.contains('hidden')) loadNotices();
    else reset();
  });
  observer.observe(familyView, { attributes: true, attributeFilter: ['class'] });

  ensureNavBadge();
  if (!familyView.classList.contains('hidden')) loadNotices();
})();

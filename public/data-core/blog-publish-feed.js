// 블로그 발행 소식 — the right-hand panel of 블로그 자동화. Every campus sees what every campus published
// (최근 30개), like 공모전 소식. Data: GET /api/data-core/content/blog/publications (worker/blog-publications.ts).
(() => {
  const API = '/api/data-core/content/blog/publications';
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KINDS = { homefeed: '홈피드형', search: '검색형', balanced: '균형형', list: '목록형', curious: '궁금증형' };
  let aside = null, wrapper = null, campus = '', loading = 0, visible = false;

  function mount() {
    const workspace = document.querySelector('.content-workspace');
    if (!workspace || aside) return;
    wrapper = document.createElement('div');
    wrapper.className = 'content-with-feed';
    workspace.before(wrapper);
    wrapper.append(workspace);
    aside = document.createElement('aside');
    aside.className = 'blog-feed';
    aside.setAttribute('aria-labelledby', 'blogFeedTitle');
    aside.innerHTML = `<div class="blog-feed-heading"><img src="/data-core/assets/work-visuals/story-v1.webp" alt="" width="1440" height="960" loading="lazy" decoding="async"><h3 id="blogFeedTitle">블로그 발행 소식</h3></div>
      <div class="blog-feed-tools"><label><span class="sr-only">캠퍼스</span><select id="blogFeedCampus"><option value="">전체 캠퍼스</option></select></label><button type="button" class="ghost-btn" id="blogFeedRefresh">새로고침</button></div>
      <p class="blog-feed-status" id="blogFeedStatus" role="status" aria-live="polite">발행 소식을 불러오는 중입니다.</p>
      <div class="blog-feed-list" id="blogFeedList"></div>`;
    wrapper.append(aside);
    aside.querySelector('#blogFeedCampus').addEventListener('change', event => { campus = event.target.value; void refresh(); });
    aside.querySelector('#blogFeedRefresh').addEventListener('click', () => void refresh());
  }

  function card(item) {
    const meta = [item.authorName, item.photoCount ? `사진 ${item.photoCount}장` : '', KINDS[item.titleKind] || ''].filter(Boolean).join(' · ');
    const tags = (item.hashtags || []).slice(0, 4).map(tag => `<span>${h(tag)}</span>`).join('');
    return `<article class="blog-feed-card${item.mine ? ' mine' : ''}">
      <div class="blog-feed-card-head"><span class="blog-feed-campus">${h(item.campusName)}</span><time datetime="${h(item.date)}">${h(item.date.slice(5).replace('-', '.'))}</time></div>
      <strong>${h(item.title)}</strong>
      <small>${h(meta)}${item.mine ? ' · 내 글' : ''}</small>
      ${item.summary ? `<p>${h(item.summary)}</p>` : ''}
      ${tags ? `<div class="blog-feed-tags">${tags}</div>` : ''}
      <a class="ghost-btn" href="${h(item.url)}" target="_blank" rel="noopener noreferrer">네이버에서 보기</a>
    </article>`;
  }

  async function refresh() {
    if (!aside || !visible) return;
    const token = ++loading;
    const status = aside.querySelector('#blogFeedStatus'), list = aside.querySelector('#blogFeedList');
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (campus) params.set('campusId', campus);
      const response = await fetch(`${API}?${params}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (token !== loading) return;
      if (!response.ok) throw new Error(body.error || '발행 소식을 불러오지 못했습니다.');
      const select = aside.querySelector('#blogFeedCampus');
      const all = (body.campuses || []).reduce((sum, c) => sum + c.count, 0);
      select.innerHTML = `<option value="">전체 캠퍼스 (${all})</option>` + (body.campuses || []).filter(c => c.campusId)
        .sort((a, b) => b.count - a.count).map(c => `<option value="${h(c.campusId)}">${h(c.campusName)} (${c.count})</option>`).join('');
      select.value = campus;
      status.textContent = body.total ? `발행 ${body.total}건${body.total > body.items.length ? ` · 최근 ${body.items.length}개 표시` : ''}` : '';
      list.innerHTML = body.items.length ? body.items.map(card).join('')
        : '<div class="empty-state compact">아직 발행 기록이 없습니다. 네이버에 올린 뒤 ‘실제 게시·성과 기록’에 주소와 게시일을 넣으면 모든 캠퍼스가 여기서 함께 봅니다.</div>';
    } catch (error) {
      if (token !== loading) return;
      status.textContent = error.message;
    }
  }

  function show(on) {
    mount();
    if (!aside) return;
    visible = Boolean(on);
    aside.hidden = !visible;
    wrapper.classList.toggle('with-feed', visible);
    if (visible) void refresh();
  }

  window.BlogPublishFeed = { show, refresh };
})();

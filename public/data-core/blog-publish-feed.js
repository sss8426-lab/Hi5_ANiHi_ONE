// 블로그 발행 소식 — the right-hand panel of 블로그 자동화. Every campus sees what every campus published
// (최근 30개), like 공모전 소식. Posts arrive three ways (worker/blog-publications.ts): 캠퍼스 블로그 자동 수집,
// 발행 주소 넣기 (API), and 블로그 자동화 posts saved as 발행. 블로그 글 검색 searches every saved post;
// AI로 변환하기 hands a post to content.js (window.BlogConvert), which writes it for the teacher's campus.
(() => {
  const API = '/api/data-core/content/blog/publications';
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KINDS = { homefeed: '홈피드형', search: '검색형', balanced: '균형형', list: '목록형', curious: '궁금증형' };
  let aside = null, wrapper = null, campus = '', query = '', loading = 0, visible = false, last = null;

  async function send(url, method, body) {
    const response = await fetch(url, { method, credentials: 'include', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '저장하지 못했습니다.');
    return data;
  }

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
      <form class="blog-feed-search" id="blogFeedSearch" role="search"><label><span class="sr-only">블로그 글 검색</span><input name="q" type="search" maxlength="80" placeholder="블로그 글 검색 (예: 공모전, 원근법, 오픈)" autocomplete="off" enterkeyhint="search"></label><button type="submit" class="ghost-btn">검색</button></form>
      <div class="blog-feed-actions"><button type="button" class="ghost-btn" id="blogFeedLinkOpen" hidden>캠퍼스 블로그 연결</button></div>
      <form class="blog-feed-form" id="blogFeedLink" hidden>
        <p class="blog-feed-hint">캠퍼스 네이버 블로그 주소를 넣으면 새 글이 여기에 자동으로 모입니다. 원장·마스터만 바꿀 수 있습니다.</p>
        <div id="blogFeedLinkRows"></div>
        <div class="blog-feed-row"><button type="button" class="ghost-btn" data-close>닫기</button></div>
        <p class="blog-feed-error" role="alert"></p>
      </form>
      <p class="blog-feed-status" id="blogFeedStatus" role="status" aria-live="polite">발행 소식을 불러오는 중입니다.</p>
      <div class="blog-feed-list" id="blogFeedList"></div>`;
    wrapper.append(aside);
    const $ = id => aside.querySelector('#' + id);
    $('blogFeedCampus').addEventListener('change', event => { campus = event.target.value; void refresh(); });
    $('blogFeedRefresh').addEventListener('click', () => void refresh(true));
    $('blogFeedLinkOpen').addEventListener('click', () => toggle('blogFeedLink'));
    $('blogFeedSearch').addEventListener('submit', event => { event.preventDefault(); query = event.target.q.value.trim(); void refresh(); });
    $('blogFeedSearch').q.addEventListener('search', event => { if (!event.target.value && query) { query = ''; void refresh(); } });
    aside.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { button.closest('form').hidden = true; }));
    $('blogFeedList').addEventListener('click', async event => {
      const convert = event.target.closest('[data-convert]');
      if (convert) {
        const item = last?.items?.find(i => i.id === convert.dataset.convert);
        if (!item || !window.BlogConvert) return;
        convert.disabled = true;
        try { await window.BlogConvert(item); } finally { convert.disabled = false; }
        return;
      }
      const button = event.target.closest('[data-hide]');
      if (!button || !confirm('이 발행 기록을 목록에서 숨길까요? 기록 자체는 남습니다.')) return;
      try { await send(`${API}/${encodeURIComponent(button.dataset.hide)}`, 'DELETE'); await refresh(); } catch (e) { alert(e.message); }
    });
    $('blogFeedLinkRows').addEventListener('submit', event => event.preventDefault());
    $('blogFeedLinkRows').addEventListener('click', async event => {
      const button = event.target.closest('[data-link]');
      if (!button) return;
      const row = button.closest('.blog-feed-link'), error = aside.querySelector('#blogFeedLink .blog-feed-error');
      error.textContent = ''; button.disabled = true;
      try {
        await send('/api/data-core/content/blog/campus-blogs', 'PUT', { campusId: button.dataset.link, blogUrl: row.querySelector('input').value.trim() || null });
        button.textContent = '저장됨';
        await refresh();
      } catch (e) { error.textContent = e.message; } finally { button.disabled = false; setTimeout(() => { button.textContent = '저장'; }, 1500); }
    });
  }

  function toggle(id) {
    for (const form of aside.querySelectorAll('.blog-feed-form')) form.hidden = form.id !== id ? true : !form.hidden;

  }

  function card(item) {
    const who = item.source === 'rss' && !item.authorName ? '자동 수집' : item.authorName || '선생님';
    const meta = [who, item.category, item.photoCount ? `사진 ${item.photoCount}장` : '', KINDS[item.titleKind] || ''].filter(Boolean).join(' · ');
    const tags = (item.hashtags || []).slice(0, 4).map(tag => `<span>${h(tag)}</span>`).join('');
    return `<article class="blog-feed-card${item.mine ? ' mine' : ''}">
      <div class="blog-feed-card-head"><span class="blog-feed-campus">${h(item.campusName)}</span><time datetime="${h(item.date)}">${h(item.date.slice(5).replace('-', '.'))}</time></div>
      <strong>${h(item.title)}</strong>
      <small>${h(meta)}${item.mine ? ' · 내 글' : ''}</small>
      ${item.summary ? `<p>${h(item.summary)}</p>` : ''}
      ${tags ? `<div class="blog-feed-tags">${tags}</div>` : ''}
      <div class="blog-feed-row"><a class="ghost-btn" href="${h(item.url)}" target="_blank" rel="noopener noreferrer">네이버에서 보기</a><button type="button" class="primary-btn blog-feed-convert" data-convert="${h(item.id)}" title="이 글의 구조와 흐름으로 우리 캠퍼스 글을 새로 씁니다">AI로 변환하기</button></div>
      ${item.canHide ? `<button type="button" class="blog-feed-hide" data-hide="${h(item.id)}" aria-label="${h(item.title)} 기록 숨기기">목록에서 숨기기</button>` : ''}
    </article>`;
  }

  function renderForms(body) {
    const links = body.linkCampuses || [];
    aside.querySelector('#blogFeedLinkOpen').hidden = !links.length;
    const rows = aside.querySelector('#blogFeedLinkRows');
    if (!rows.contains(document.activeElement)) rows.innerHTML = links.map(c => `<div class="blog-feed-link"><label><span>${h(c.campusName)}</span><input type="url" inputmode="url" value="${h(c.blogUrl || '')}" placeholder="https://blog.naver.com/아이디" autocomplete="off"></label><button type="button" class="ghost-btn" data-link="${h(c.campusId)}">저장</button></div>`).join('');
  }

  // Saved posts show at once; new posts from the campus blogs are fetched after that, then shown.
  let syncing = false;
  async function sync(fresh) {
    if (syncing) return; syncing = true;
    try { const r = await send(`${API}/sync`, 'POST', { refresh: fresh }); if (r.synced) await refresh(false, true); } catch { /* the saved list stays */ } finally { syncing = false; }
  }

  async function refresh(fresh = false, afterSync = false) {
    if (!aside || !visible) return;
    if (fresh) { aside.querySelector('#blogFeedStatus').textContent = '캠퍼스 블로그에서 새 글을 확인하고 있습니다.'; return sync(true); }
    const token = ++loading;
    const status = aside.querySelector('#blogFeedStatus'), list = aside.querySelector('#blogFeedList');
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (campus) params.set('campusId', campus);
      if (query) params.set('q', query);
      const response = await fetch(`${API}?${params}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (token !== loading) return;
      if (!response.ok) throw new Error(body.error || '발행 소식을 불러오지 못했습니다.');
      last = body;
      if (body.syncDue && !afterSync) void sync(false);
      const select = aside.querySelector('#blogFeedCampus');
      const all = (body.campuses || []).reduce((sum, c) => sum + c.count, 0);
      select.innerHTML = `<option value="">전체 캠퍼스 (${all})</option>` + (body.campuses || []).filter(c => c.campusId)
        .sort((a, b) => b.count - a.count).map(c => `<option value="${h(c.campusId)}">${h(c.campusName)} (${c.count})</option>`).join('');
      select.value = campus;
      renderForms(body);
      const linked = body.linkedCount ? `자동 수집 블로그 ${body.linkedCount}곳` : '자동 수집할 캠퍼스 블로그가 아직 없습니다';
      status.textContent = query
        ? `‘${query}’ 관련 글 ${body.total}건${body.total > body.items.length ? ` · 관련 높은 ${body.items.length}개` : ''} · 관련 높은 순`
        : `${body.total ? `발행 ${body.total}건${body.total > body.items.length ? ` · 최근 ${body.items.length}개 표시` : ''} · ` : ''}${linked}`;
      list.innerHTML = body.items.length ? body.items.map(card).join('')
        : query ? `<div class="empty-state compact">‘${h(query)}’와 관련된 글이 없습니다. 다른 낱말로 찾아보세요.</div>`
        : `<div class="empty-state compact">아직 발행 기록이 없습니다.${body.linkCampuses?.length ? ' ‘캠퍼스 블로그 연결’에 캠퍼스 네이버 블로그 주소를 넣으면 새 글이 자동으로 모입니다.' : ''}</div>`;
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
    if (visible && !last) void refresh();
  }

  window.BlogPublishFeed = { show, refresh };
})();

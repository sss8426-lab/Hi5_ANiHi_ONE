// 뒤로가기 = 한 단계 위로.
// In every DATA CORE screen the browser's back button goes to the screen one level up — 수업 3/14쪽 → 기초과정 →
// 웹툰·게임·애니메이션 → 꿈을 향한 커리큘럼 → 상담용 홈 — instead of to the previous click (2/14쪽).
// How: the history entry right behind the current screen is always its parent screen.
// - Moving within the same level (쪽 넘김, 정렬, 다른 탭, 같은 과정의 다른 수업) replaces the entry instead of adding one.
// - Moving one level down adds an entry. Any other jump first turns the current entry into the target's parent.
// - Landing on a screen by back, by a link from another page or by typing the address puts its parent behind it.
// Folder-like screens (자료보관함 · 수상작 폴더 · 꿈이음 대화) tell their parent through DataCoreUpHistory.resolve().
(() => {
  if (window.DataCoreUpHistory) return;
  const native = { push: history.pushState.bind(history), replace: history.replaceState.bind(history) };
  const resolvers = [];
  const trim = path => path.replace(/\/+$/, '') || '/';
  const rel = url => trim(url.pathname) + url.search + url.hash;
  const norm = value => {
    const url = new URL(value, location.origin);
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
    return trim(url.pathname) + (params.length ? '?' + new URLSearchParams(params) : '') + url.hash;
  };
  const same = (a, b) => a != null && b != null && norm(a) === norm(b);

  // Which page (HTML document) shows a path — the same table as worker/router.ts.
  function documentOf(pathValue) {
    const path = trim(pathValue);
    if (path === '/data-core' || path === '/data-core/index.html' || /^\/data-core\/(counseling|curriculum)(\/|$)/.test(path)
      || ['/data-core/work', '/data-core/work/library', '/data-core/work/attendance'].includes(path)) return 'index';
    if (path === '/data-core/kkumeum' || path === '/data-core/work/kkumeum.html') return 'kkumeum';
    if (/^\/data-core\/content(\/|\.html|$)/.test(path)) return 'content';
    const page = /^\/data-core\/(reports|accounts|operations|roadmap)(\.html)?$/.exec(path);
    return page ? page[1] : path;
  }
  const home = documentOf(location.pathname);

  // The parent screen of a URL by its address alone; folder screens refine it through resolvers.
  function addressParent(url) {
    const path = trim(url.pathname), query = url.searchParams;
    const strip = (...keys) => { const next = new URL(url); keys.forEach(key => next.searchParams.delete(key)); next.hash = ''; return rel(next); };
    if (path === '/data-core' || path === '/data-core/index.html') return null;
    if (path === '/data-core/counseling') return '/data-core';
    if (path === '/data-core/counseling/competitions' || path === '/data-core/counseling/works') {
      return [...query.keys()].some(key => /AwardFolder$|^awardFolder$/.test(key)) ? strip(...[...query.keys()].filter(key => /AwardFolder$|^awardFolder$/.test(key))) : '/data-core/counseling';
    }
    if (path.startsWith('/data-core/curriculum')) {
      if (url.search) return path; // 수업(?lesson=…&slide=…) → 그 과정의 수업 목록
      return path === '/data-core/curriculum' ? '/data-core/counseling' : path.slice(0, path.lastIndexOf('/'));
    }
    if (path === '/data-core/roadmap' || path === '/data-core/roadmap.html') {
      const hash = new URLSearchParams(url.hash.slice(1));
      if (hash.get('career')) return hash.get('family') ? `/data-core/roadmap#family=${encodeURIComponent(hash.get('family'))}` : '/data-core/roadmap';
      return hash.get('family') ? '/data-core/roadmap' : '/data-core/counseling';
    }
    if (path === '/data-core/work/library') return query.get('folder') ? '/data-core/work/library' : url.search ? '/data-core/work/library' : '/data-core/work';
    if (path === '/data-core/kkumeum' || path === '/data-core/work/kkumeum.html') {
      const view = query.get('view');
      if (!view) return '/data-core/work';
      const up = { 'attendance-settings': 'attendance', 'talk-settings': 'inquiries', thread: 'answers' }[view];
      const next = new URL('/data-core/kkumeum', location.origin);
      if (query.get('tab')) next.searchParams.set('tab', query.get('tab'));
      if (up) next.searchParams.set('view', up);
      return rel(next);
    }
    if (path === '/data-core/work') return query.get('view') ? '/data-core/work' : '/data-core';
    if (documentOf(path) !== path || path.startsWith('/data-core/')) return '/data-core/work';
    return null;
  }
  function parentOf(value) {
    const url = new URL(value, location.origin);
    for (const resolve of resolvers) {
      try { const parent = resolve(url); if (parent !== undefined) return parent; } catch { /* a folder screen without data falls back to the address */ }
    }
    return addressParent(url);
  }

  // Inside another screen (대학 합격 로드맵 shows DATA CORE in a frame) the frame never adds entries of its own,
  // so the outer page keeps its back button.
  if (window.top !== window) {
    history.pushState = (state, title, url) => native.replace(state, title, url);
    window.DataCoreUpHistory = { resolve() {}, parentOf };
    return;
  }

  const marked = (state, extra) => Object.assign({}, state && typeof state === 'object' ? state : {}, extra);
  history.pushState = function pushState(state, title, url) {
    if (url == null) return native.replace(marked(state, { __up: 1 }), title);
    const next = new URL(url, location.href), here = rel(new URL(location.href));
    if (next.origin !== location.origin) return native.push(state, title, url);
    if (same(rel(next), here)) return native.replace(marked(state, { __up: 1 }), title, url);
    const parent = parentOf(next);
    if (parent == null) return native.replace(marked(state, { __up: 1 }), title, url); // a top screen
    if (same(parent, here)) return native.push(marked(state, { __up: 1 }), title, url); // one level down
    if (same(parent, parentOf(here))) return native.replace(marked(state, { __up: 1 }), title, url); // same level
    native.replace({ __upParent: 1, __child: rel(next) }, '', parent); // any other jump: its parent goes right behind
    return native.push(marked(state, { __up: 1 }), title, url);
  };
  history.replaceState = function replaceState(state, title, url) {
    const current = history.state || {};
    const keep = current.__up ? { __up: 1 } : current.__upParent ? { __upParent: 1, __child: current.__child } : {};
    return native.replace(marked(state, keep), title, url);
  };

  // Put the parent right behind the screen we are on (after a link, a typed address, a reload or a back step).
  function settle() {
    if (history.state?.__up) return;
    const here = rel(new URL(location.href)), parent = parentOf(here);
    if (parent == null || same(parent, here)) return;
    const state = history.state && typeof history.state === 'object' ? history.state : {};
    native.replace({ __upParent: 1, __child: here }, '', parent);
    native.push(marked(state, { __up: 1 }), '', here);
  }

  // Runs before the screens' own popstate handlers (this file loads first), so they render the corrected address.
  window.addEventListener('popstate', event => {
    const state = history.state || {};
    // A parent placed while the child's folder was still loading: now that it is known, use the real parent.
    if (state.__upParent && state.__child) {
      const parent = parentOf(state.__child);
      if (parent != null && !same(parent, rel(new URL(location.href)))) native.replace(state, '', new URL(parent, location.origin).href);
    }
    if (documentOf(location.pathname) !== home) { event.stopImmediatePropagation(); location.reload(); return; }
    settle();
  });

  // 꿈·전공 로드맵 moves between screens with #links: route them through the same rules.
  if (home === 'roadmap') {
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href^="#"]');
      if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target) return;
      const oldURL = location.href;
      event.preventDefault();
      history.pushState(null, '', link.getAttribute('href'));
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
    });
  }

  settle();
  window.DataCoreUpHistory = {
    // resolver(url) → parent address, null for a top screen, or undefined when it does not know that URL.
    resolve(resolver) { resolvers.push(resolver); },
    parentOf,
  };
})();

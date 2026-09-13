(() => {
  if (window.DataCoreImageGallery) return;
  let current = null;
  const icon = name => `<svg aria-hidden="true" width="22" height="22" stroke-linecap="round" stroke-linejoin="round"><use href="/data-core/assets/core-icons.svg?v=20260913-gallery#${name}"></use></svg>`;
  const safeSource = value => {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      return (url.origin === location.origin && ['http:', 'https:', 'blob:'].includes(url.protocol)) || /^data:image\/(png|jpeg|webp|gif|avif);/i.test(value) ? url.href : '';
    } catch { return ''; }
  };
  function close(scope) { if (!scope || current?.scope === scope) current?.close(); }
  function open({items, index = 0, title = '이미지', scope = 'images', anchor = document.activeElement, onChange, onClose, actions = []}) {
    close();
    if (!items?.length) return null;
    items = items.slice();
    let selected = -1, revision = 0, ended = false, request, pointers = new Set(), gesture = null, neighbors = new Map();
    const modal = document.createElement('dialog');
    modal.className = 'core-image-gallery'; modal.setAttribute('aria-label', `${title} 크게 보기`);
    modal.innerHTML = `<header class="cig-toolbar"><strong class="cig-title"></strong><output class="cig-counter" aria-live="polite"></output><div class="cig-actions"><button type="button" data-cig-zoom aria-label="원본 크기로 확대" title="원본 크기로 확대">${icon('ZoomIn')}</button><button type="button" data-cig-close aria-label="닫기" title="닫기">${icon('X')}</button></div></header><div class="cig-stage"><button type="button" data-cig-prev aria-label="이전 그림" title="이전 그림">${icon('ChevronLeft')}</button><div class="cig-canvas" tabindex="0" aria-label="확대 그림"><img class="cig-image" alt="" decoding="async" draggable="false"><div class="cig-feedback" role="status"><span></span><button type="button" data-cig-retry hidden>다시 시도</button></div></div><button type="button" data-cig-next aria-label="다음 그림" title="다음 그림">${icon('ChevronRight')}</button></div><p class="cig-caption"></p>`;
    const $ = s => modal.querySelector(s), canvas = $('.cig-canvas'), img = $('.cig-image'), zoom = $('[data-cig-zoom]');
    $('.cig-title').textContent = title;
    const previousOverflow = document.body.style.overflow;
    const finish = () => {
      if (ended) return;
      ended = true; revision++; request?.abort(); observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      img.removeAttribute('src'); neighbors.forEach(image => image.removeAttribute('src')); neighbors.clear();
      document.body.style.overflow = previousOverflow;
      modal.remove(); if (current === handle) current = null;
      if (anchor?.isConnected) anchor.focus({preventScroll:true});
      onClose?.();
    };
    const handle = {scope, close:finish, goTo:next => show(next), get isOpen() { return !ended; }, get index() { return selected; }};
    const observer = new MutationObserver(() => { if (anchor && !anchor.isConnected) finish(); });
    function setZoom(actual) {
      modal.classList.toggle('cig-actual', actual);
      zoom.querySelector('use').setAttribute('href', `/data-core/assets/core-icons.svg?v=20260913-gallery#${actual ? 'ZoomOut' : 'ZoomIn'}`);
      zoom.title = actual ? '화면에 맞추기' : '원본 크기로 확대'; zoom.setAttribute('aria-label', zoom.title);
      canvas.scrollTo(0, 0); gesture = null;
    }
    function feedback(message, retry = false) {
      $('.cig-feedback span').textContent = message;
      $('[data-cig-retry]').hidden = !retry;
      $('.cig-feedback').hidden = !message;
    }
    function prefetch() {
      const next = new Map();
      for (const n of [selected - 1, selected + 1]) {
        const entry = items[n]; if (!entry) continue;
        // Only adjacent display images; never traverse folders or bulk-fetch originals.
        const src = safeSource(entry.previewSrc || (entry.load ? '' : entry.src));
        if (!src) continue;
        const image = neighbors.get(src) || new Image(); image.decoding = 'async'; image.src = src; next.set(src, image);
      }
      neighbors.forEach((image, src) => { if (!next.has(src)) image.removeAttribute('src'); }); neighbors = next;
    }
    async function show(next, notify = true) {
      if (ended) return;
      selected = Math.max(0, Math.min(items.length - 1, Math.trunc(Number(next)) || 0));
      const entry = items[selected], stamp = ++revision;
      request?.abort(); request = new AbortController();
      setZoom(false); img.hidden = true; img.removeAttribute('src'); img.alt = entry.alt || entry.title || `${title} ${selected + 1}`;
      $('.cig-caption').textContent = entry.title || '';
      $('.cig-counter').textContent = `${selected + 1} / ${items.length}`;
      $('[data-cig-prev]').disabled = selected === 0; $('[data-cig-next]').disabled = selected === items.length - 1;
      $('[data-cig-prev]').hidden = $('[data-cig-next]').hidden = items.length === 1;
      modal.classList.toggle('cig-single', items.length === 1);
      feedback('불러오는 중…');
      if (notify) onChange?.(selected, entry);
      const valid = () => !ended && stamp === revision;
      try {
        const preview = safeSource(entry.previewSrc);
        if (preview) { img.src = preview; img.hidden = false; }
        const src = safeSource(entry.load ? await entry.load({signal:request.signal}) : entry.src);
        if (!valid()) return;
        if (!src) throw new Error('invalid image source');
        img.src = src; img.fetchPriority = 'high';
        await img.decode();
        if (!valid()) return;
        img.hidden = false; feedback(''); prefetch();
      } catch {
        if (!valid()) return;
        img.hidden = true; img.removeAttribute('src'); feedback('이미지를 불러오지 못했습니다.', true);
      }
    }
    function keydown(e) {
      if (ended || !modal.open) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); return; }
      if (e.key === 'Tab') {
        const targets=[...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(el=>el.getClientRects().length);
        const at=targets.indexOf(document.activeElement), next=(at+(e.shiftKey?-1:1)+targets.length)%targets.length;
        e.preventDefault(); e.stopImmediatePropagation(); targets[next]?.focus(); return;
      }
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      const next = {ArrowLeft:selected-1, ArrowRight:selected+1, Home:0, End:items.length-1}[e.key];
      if (next !== undefined) { e.preventDefault(); e.stopImmediatePropagation(); if (next >= 0 && next < items.length && next !== selected) show(next); }
    }
    $('[data-cig-close]').onclick = finish;
    $('[data-cig-prev]').onclick = () => show(selected-1); $('[data-cig-next]').onclick = () => show(selected+1);
    $('[data-cig-retry]').onclick = () => show(selected, false);
    zoom.onclick = () => setZoom(!modal.classList.contains('cig-actual'));
    for (const action of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.title = action.label; button.setAttribute('aria-label', action.label);
      button.innerHTML = icon(action.icon); button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        try { await action.run(selected, handle); }
        finally { button.disabled = false; }
      };
      $('.cig-actions').prepend(button);
    }
    canvas.addEventListener('pointerdown', e => {
      pointers.add(e.pointerId);
      if (pointers.size !== 1 || e.button !== 0 || modal.classList.contains('cig-actual') || e.target.closest('button')) { gesture = null; return; }
      gesture = {id:e.pointerId, x:e.clientX, y:e.clientY}; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', e => {
      const start = gesture; gesture = null; pointers.delete(e.pointerId);
      if (!start || start.id !== e.pointerId || pointers.size) return;
      const dx = e.clientX-start.x, dy = e.clientY-start.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)*1.5) {
        const next = selected + (dx < 0 ? 1 : -1); if (next >= 0 && next < items.length) show(next);
      }
    });
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = null; });
    modal.addEventListener('cancel', e => { e.preventDefault(); finish(); });
    modal.addEventListener('close', finish);
    modal.addEventListener('click', e => { if (e.target !== modal) return; const r=modal.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) finish(); });
    current = handle; document.body.append(modal); document.body.style.overflow = 'hidden';
    observer.observe(document.body, {childList:true, subtree:true});
    document.addEventListener('keydown', keydown, true); modal.showModal(); $('[data-cig-close]').focus();
    show(index, false); return handle;
  }
  for (const event of ['pagehide','popstate','hashchange']) window.addEventListener(event, () => close());
  document.addEventListener('click', e => { if (e.target.closest('#logoutBtn, #logoutButton, [data-logout]')) close(); }, true);
  window.DataCoreImageGallery = {open, close, get isOpen() { return Boolean(current); }};
})();

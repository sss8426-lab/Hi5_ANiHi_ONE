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
  const caches = new Set();
  function createCache() {
    const entries = new Map(), pending = new Map();
    let generation = 0, bytes = 0;
    const remove = key => { const e=entries.get(key); if(e){if(e.owned)URL.revokeObjectURL(e.src);bytes-=e.size;entries.delete(key);} };
    const clear = () => { generation++; for(const job of pending.values())job.controller.abort();pending.clear();for(const key of entries.keys())remove(key); };
    const cache = {
      clear,
      dispose() { clear(); caches.delete(cache); },
      peek(key) { const e=entries.get(key);if(e && Date.now()-e.created<300000)return e.src;remove(key);return ''; },
      retain(keys) { for(const [key,job] of pending)if(!keys.has(key)){job.controller.abort();pending.delete(key);} },
      async get(key, {loader, priority='high'} = {}) {
        const hit=cache.peek(key);if(hit){const e=entries.get(key);entries.delete(key);entries.set(key,e);return hit;}
        if(pending.has(key))return pending.get(key).promise;
        const controller=new AbortController(), stamp=generation, job={controller};
        const timer=setTimeout(()=>controller.abort(),45000);
        const valid=()=>!controller.signal.aborted&&stamp===generation;
        job.promise=(async()=>{
          let src='',owned=false,size=0;
          try {
            src=safeSource(loader?await loader({signal:controller.signal,priority}):key);
            if(!src)throw Error('Invalid image');
            if(!/^(blob:|data:)/.test(src)) {
              const response=await fetch(src,{credentials:'same-origin',cache:'no-cache',signal:controller.signal,priority});
              if([401,403].includes(response.status)){clear();close();throw Error('Unauthorized');}
              if(!response.ok||!/^image\/(png|jpeg|webp|avif|gif)(;|$)/i.test(response.headers.get('content-type')||''))throw Error('Image unavailable');
              const limit=100*1024*1024, reader=response.body.getReader(),chunks=[];
              try { while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit){await reader.cancel();throw Error('Image too large');}chunks.push(r.value);} }
              finally { reader.releaseLock(); }
              src=URL.createObjectURL(new Blob(chunks,{type:response.headers.get('content-type')}));owned=true;
            }
            const image=new Image();image.decoding='async';image.src=src;await image.decode();
            if(!valid())throw new DOMException('Cancelled','AbortError');
            // Budget decoded pixels as well as encoded bytes on memory-constrained tablets.
            size=Math.max(size,image.naturalWidth*image.naturalHeight*4);
            while(entries.size&&(entries.size>=6||bytes+size>96*1024*1024))remove(entries.keys().next().value);
            entries.set(key,{src,owned,size,created:Date.now()});bytes+=size;return src;
          } catch(error) { if(owned)URL.revokeObjectURL(src);throw error; }
          finally { clearTimeout(timer);if(pending.get(key)===job)pending.delete(key); }
        })();
        pending.set(key,job);return job.promise;
      },
    };
    caches.add(cache);return cache;
  }
  function close(scope) { if (!scope || current?.scope === scope) current?.close(); }
  function open({items, index = 0, title = '이미지', scope = 'images', anchor = document.activeElement, onChange, onClose, actions = [], cache: suppliedCache}) {
    close();
    if (!items?.length) return null;
    items = items.slice();
    const cache=suppliedCache||createCache();
    let selected = -1, revision = 0, ended = false, pointers = new Set(), gesture = null, originalReady=false;
    const key=(entry,i,original=false)=>original?entry.src||`original:${i}`:entry.displaySrc||entry.src||`original:${i}`;
    const load=(entry,i,original=false,priority='high')=>cache.get(key(entry,i,original),{loader:(!entry.displaySrc||original)?entry.load:undefined,priority});
    const modal = document.createElement('dialog');
    modal.className = 'core-image-gallery'; modal.setAttribute('aria-label', `${title} 크게 보기`);
    modal.innerHTML = `<header class="cig-toolbar"><strong class="cig-title"></strong><output class="cig-counter" aria-live="polite"></output><div class="cig-actions"><button type="button" data-cig-zoom aria-label="원본 크기로 확대" title="원본 크기로 확대">${icon('ZoomIn')}</button><button type="button" data-cig-close aria-label="닫기" title="닫기">${icon('X')}</button></div></header><div class="cig-stage"><button type="button" data-cig-prev aria-label="이전 그림" title="이전 그림">${icon('ChevronLeft')}</button><div class="cig-canvas" tabindex="0" aria-label="확대 그림"><img class="cig-image" alt="" decoding="async" draggable="false"><div class="cig-feedback" role="status"><span></span><button type="button" data-cig-retry hidden>다시 시도</button></div></div><button type="button" data-cig-next aria-label="다음 그림" title="다음 그림">${icon('ChevronRight')}</button></div><p class="cig-caption"></p>`;
    const $ = s => modal.querySelector(s), canvas = $('.cig-canvas'), img = $('.cig-image'), zoom = $('[data-cig-zoom]');
    $('.cig-title').textContent = title;
    const previousOverflow = document.body.style.overflow;
    const finish = () => {
      if (ended) return;
      ended = true; revision++; if(!suppliedCache)cache.dispose(); observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      img.removeAttribute('src');
      document.body.style.overflow = previousOverflow;
      modal.remove(); if (current === handle) current = null;
      if (anchor?.isConnected) anchor.focus({preventScroll:true});
      onClose?.();
    };
    const handle = {scope, close:finish, goTo:next => show(next), get isOpen() { return !ended; }, get index() { return selected; }};
    const observer = new MutationObserver(() => { if (anchor && !anchor.isConnected) finish(); });
    function setZoom(actual) {
      modal.classList.toggle('cig-actual', actual);
      const use=zoom.querySelector('use'), href=`/data-core/assets/core-icons.svg?v=20260913-gallery#${actual ? 'ZoomOut' : 'ZoomIn'}`;
      if(use.getAttribute('href')!==href)use.setAttribute('href',href);
      zoom.title = actual ? '화면에 맞추기' : '원본 크기로 확대'; zoom.setAttribute('aria-label', zoom.title);
      canvas.scrollTo(0, 0); gesture = null;
    }
    function feedback(message, retry = false) {
      $('.cig-feedback span').textContent = message;
      $('[data-cig-retry]').hidden = !retry;
      $('.cig-feedback').hidden = !message;
    }
    function prefetch() {
      if(document.hidden||navigator.connection?.saveData||/^(slow-)?2g$/.test(navigator.connection?.effectiveType||''))return;
      for(const n of [selected+1,selected-1])if(items[n])void load(items[n],n,false,'low').catch(()=>{});
    }
    async function show(next, notify = true) {
      if (ended) return;
      selected = Math.max(0, Math.min(items.length - 1, Math.trunc(Number(next)) || 0));
      const entry = items[selected], stamp = ++revision;
      cache.retain(new Set([selected-1,selected,selected+1].filter(n=>items[n]).flatMap(n=>[key(items[n],n),key(items[n],n,true),safeSource(items[n].previewSrc)])));
      originalReady=false;
      setZoom(false); img.hidden = true; img.removeAttribute('src'); img.alt = entry.alt || entry.title || `${title} ${selected + 1}`;
      img.dataset.source=safeSource(entry.displaySrc||entry.src);
      $('.cig-caption').textContent = entry.title || '';
      $('.cig-counter').textContent = `${selected + 1} / ${items.length}`;
      $('[data-cig-prev]').disabled = selected === 0; $('[data-cig-next]').disabled = selected === items.length - 1;
      $('[data-cig-prev]').hidden = $('[data-cig-next]').hidden = items.length === 1;
      modal.classList.toggle('cig-single', items.length === 1);
      feedback('불러오는 중…');
      modal.classList.remove('cig-has-preview');
      if (notify) onChange?.(selected, entry);
      const valid = () => !ended && stamp === revision;
      try {
        const preview = cache.peek(key(entry,selected)) || safeSource(entry.previewSrc);
        if (preview) {
          img.src=preview;img.hidden=false;
          void img.decode().then(()=>{if(valid())modal.classList.add('cig-has-preview');}).catch(()=>{});
        }
        const display = await load(entry,selected);
        if (!valid()) return;
        const original=cache.peek(key(entry,selected,true));
        const src=modal.classList.contains('cig-actual')&&original?original:display;
        if (!src) throw new Error('invalid image source');
        img.hidden = false; img.src = src; img.fetchPriority = 'high';
        await img.decode();
        if (!valid()) return;
        originalReady=!entry.displaySrc||entry.displaySrc===entry.src||Boolean(original);
        img.hidden = false; modal.classList.add('cig-has-preview');
        feedback(modal.classList.contains('cig-actual')&&!originalReady?'원본을 불러오는 중…':''); prefetch();
      } catch {
        if (!valid()) return;
        feedback('이미지를 불러오지 못했습니다.', true);
      }
    }
    async function toggleZoom() {
      const actual=!modal.classList.contains('cig-actual');setZoom(actual);
      if(!actual)return;
      if(originalReady){const src=cache.peek(key(items[selected],selected,true));if(src)img.src=src;return;}
      const stamp=revision,entry=items[selected];feedback('원본을 불러오는 중…');
      try { const src=await load(entry,selected,true);if(ended||stamp!==revision)return;
        originalReady=true;if(modal.classList.contains('cig-actual')){img.src=src;img.dataset.source=safeSource(entry.src);}feedback('');
      } catch {if(!ended&&stamp===revision){setZoom(false);feedback('원본을 불러오지 못했습니다.',true);}}
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
    zoom.onclick = toggleZoom;
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
  const clearAll=()=>{close();for(const cache of caches)cache.clear();};
  for (const event of ['pagehide','popstate','hashchange']) window.addEventListener(event, clearAll);
  document.addEventListener('click', e => { if (e.target.closest('#logoutBtn, #logoutButton, [data-logout]')) clearAll(); }, true);
  window.DataCoreImageGallery = {open, close, createCache, get isOpen() { return Boolean(current); }};
})();

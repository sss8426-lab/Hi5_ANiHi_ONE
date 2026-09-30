(() => {
  const api = '/api/data-core/curriculum';
  const families = {start:'꿈 그림의 시작',content:'웹툰·게임·애니메이션',design:'디자이너'};
  const titles = {basic:'기초과정',advanced:'심화과정',admission:'입시과정',main:'꿈 그림의 시작'};
  const descriptions = {basic:'기초부터 차근차근, 스스로 성장할 수 있는 힘을 만듭니다.',advanced:'기초에서 익힌 표현력을 바탕으로 전공에 필요한 구조·연출·완성도를 깊이 있게 확장합니다.',admission:'목표 대학과 실기 유형에 맞춰 실전 작품의 완성도와 시험 대응력을 높입니다.',main:'처음 연필과 물감을 잡는 초등학생을 위한 첫걸음 과정입니다.'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg aria-hidden="true" width="22" height="22"><use href="/data-core/assets/core-icons.svg?v=20260912-curriculum#${name}"></use></svg>`;
  const safeUrl = url => /^\/api\/data-core\/files\/[a-zA-Z0-9_-]+$/.test(url || '') ? url : '';
  let dispose = () => {}, sequence = 0;
  const naturalOrder = new Intl.Collator('ko', {numeric:true, sensitivity:'base'});
  const post = async (url, body, method = 'POST') => {
    const r = await fetch(url, {method, credentials:'same-origin', cache:'no-store', body, headers: body instanceof FormData || body === undefined ? {} : {'content-type':'application/json'}});
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(json.error || json.message || '저장하지 못했습니다.');
    return json;
  };
  // Same renditions the desktop importer makes: preview 2200 WebP, thumbnail 640 WebP, print 3200 JPEG.
  async function rendition(bitmap, size, type, quality) {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob) throw Error('이미지를 변환하지 못했습니다.');
    return blob;
  }
  async function uploadOne(folderId, file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw Error(`${file.name}: JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.`);
    const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'}).catch(() => { throw Error(`${file.name}: 이미지를 열 수 없습니다.`); });
    try {
      const form = new FormData();
      form.set('original', file, file.name);
      form.set('preview', await rendition(bitmap, 2200, 'image/webp', .88), 'preview.webp');
      form.set('thumbnail', await rendition(bitmap, 640, 'image/webp', .82), 'thumbnail.webp');
      form.set('print', await rendition(bitmap, 3200, 'image/jpeg', .93), 'print.jpg');
      form.set('width', String(bitmap.width)); form.set('height', String(bitmap.height));
      return await post(`${api}/folders/${encodeURIComponent(folderId)}/pages`, form);
    } finally { bitmap.close?.(); }
  }
  // Master-only controls: the server also checks 마스터 권한 on every write.
  function manage({host, data, status, active, navigate, lessonUrl, family, stage, rerender}) {
    if (!data.canManage) return;
    const form = host.querySelector('[data-new-folder]');
    if (form) {
      const fields = form.querySelector('div'), open = form.querySelector('[data-new-folder-open]'), input = form.querySelector('input');
      open.onclick = () => { open.hidden = true; fields.hidden = false; input.focus(); };
      form.querySelector('[data-new-folder-cancel]').onclick = () => { fields.hidden = true; open.hidden = false; input.value = ''; };
      form.onsubmit = async event => {
        event.preventDefault();
        const title = input.value.trim(); if (!title) return;
        form.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
        try { const {folder} = await post(`${api}/folders`, JSON.stringify({family, stage, title})); if (active()) navigate(lessonUrl(folder.id)); }
        catch (e) { if (active()) { status.textContent = e.message; form.querySelectorAll('button,input').forEach(el => { el.disabled = false; }); } }
      };
    }
    const renameButton = host.querySelector('[data-rename]'), deleteButton = host.querySelector('[data-delete]');
    if (renameButton) renameButton.onclick = () => {
      const heading = host.querySelector('.lesson-heading h2'), old = data.folder.title;
      const editor = document.createElement('form');
      editor.className = 'lesson-rename';
      editor.innerHTML = `<input maxlength="60" required aria-label="폴더 이름"><button type="submit">저장</button><button type="button" data-cancel>취소</button>`;
      const input = editor.querySelector('input'); input.value = old;
      heading.replaceWith(editor); renameButton.disabled = true; input.select();
      editor.querySelector('[data-cancel]').onclick = () => { editor.replaceWith(heading); renameButton.disabled = false; };
      editor.onsubmit = async event => {
        event.preventDefault();
        const title = input.value.trim(); if (!title || title === old) { editor.querySelector('[data-cancel]').click(); return; }
        editor.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
        try { await post(`${api}/folders/${encodeURIComponent(data.folder.id)}`, JSON.stringify({title}), 'PATCH'); if (active()) rerender(); }
        catch (e) { if (active()) { status.textContent = e.message; editor.querySelectorAll('button,input').forEach(el => { el.disabled = false; }); } }
      };
    };
    if (deleteButton) deleteButton.onclick = async () => {
      const count = data.pages.length;
      if (!confirm(`'${data.folder.title}' ${count ? `폴더와 수업자료 ${count}장을` : '폴더를'} 삭제할까요?\n삭제하면 목록과 인쇄에서 사라집니다.`)) return;
      deleteButton.disabled = true;
      try { await post(`${api}/folders/${encodeURIComponent(data.folder.id)}`, undefined, 'DELETE'); if (active()) navigate(stage === 'main' ? `/data-core/curriculum/${family}` : `/data-core/curriculum/${family}/${stage}`); }
      catch (e) { if (active()) { status.textContent = e.message; deleteButton.disabled = false; } }
    };
    const button = host.querySelector('[data-upload]'), picker = host.querySelector('[data-upload-input]');
    if (!button || !picker) return;
    button.onclick = () => picker.click();
    picker.onchange = async () => {
      const chosen = [...picker.files].sort((a, b) => naturalOrder.compare(a.name, b.name));
      picker.value = '';
      if (!chosen.length) return;
      button.disabled = true;
      let done = 0; const failed = [];
      for (const file of chosen) {
        if (!active()) return;
        status.textContent = `수업자료를 올리는 중입니다. ${done + failed.length + 1} / ${chosen.length}`;
        try { await uploadOne(data.folder.id, file); done++; } catch (e) { failed.push(e.message); }
      }
      if (!active()) return;
      if (failed.length) { button.disabled = false; status.textContent = `${done}장 업로드 완료, ${failed.length}장 실패: ${failed.join(' / ')}`; if (done) setTimeout(() => active() && rerender(), 2500); }
      else rerender();
    };
  }
  async function mount(host, family, stage, rerender) {
    const current = ++sequence, controller = new AbortController(), query = new URLSearchParams(location.search), lesson = query.get('lesson');
    let removed = false, printing = false, dialog, printRoot, keyHandler, slideRevision=0;
    const imageCache=window.DataCoreImageGallery.createCache();
    const clearPrint=()=>{printRoot?.remove();printRoot=null;document.body.classList.remove('curriculum-printing');};
    window.addEventListener('afterprint',clearPrint);
    dispose = () => { removed = true; controller.abort(); document.removeEventListener('keydown',keyHandler); window.removeEventListener('afterprint',clearPrint); dialog?.close(); clearPrint(); imageCache.dispose(); };
    const active = () => !removed && sequence === current && host.classList.contains('active');
    const get = async url => { const r = await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal}); if(!r.ok) { const error = new Error(r.status===401?'로그인이 필요합니다.':'수업자료를 불러오지 못했습니다.'); error.status=r.status;throw error; } return r.json(); };
    const navigate = url => { history.pushState({},'',url); rerender(); };
    const root = `/data-core/curriculum/${family}`, stageUrl = stage === 'main' ? root : `${root}/${stage}`;
    const lessonUrl = id => `${stageUrl}?lesson=${encodeURIComponent(id)}`;
    const decode = img => img.decode ? img.decode() : new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
    const image = (url,alt) => {const img = new Image();img.src=url?.startsWith(`blob:${location.origin}/`)?url:safeUrl(url);img.alt=alt;return img;};
    host.innerHTML = '<p role="status">수업자료를 불러오는 중입니다.</p>';
    try {
      const data = await get(lesson ? `${api}/folders/${encodeURIComponent(lesson)}` : `${api}?family=${family}&stage=${stage}`);
      if (!active()) return;
      if (data.family !== family || data.stage !== stage) throw Error('선택한 과정의 수업이 아닙니다.');
      const crumbs = [{title:'꿈을 향한 커리큘럼',url:'/data-core/curriculum'},{title:families[family],url:root},...(stage==='main'?[]:[{title:titles[stage],url:stageUrl}]),...(data.breadcrumbs||[]).map(f=>({title:f.title,url:lessonUrl(f.id)}))];
      host.innerHTML = `<nav class="lesson-breadcrumb" aria-label="현재 위치">${crumbs.map((c,i)=>`<a href="${escape(c.url)}" ${i===crumbs.length-1?'aria-current="page"':''}>${escape(c.title)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>
        <header class="lesson-heading"><div><h2>${escape(data.folder?.title||titles[stage])}</h2><p>${data.folder?`${data.pages.length}장의 수업자료`:descriptions[stage]}</p></div><div class="lesson-actions">${data.canManage&&data.folder?.webManaged?`<button type="button" data-rename>이름 변경</button><button type="button" data-delete>삭제</button>`:''}${data.canManage&&data.folder?.webManaged?`<button type="button" data-upload>${icon('Image')}<span>업로드</span></button><input type="file" data-upload-input accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>`:''}<button type="button" data-print ${!(lesson?data.pages.length||data.folders.length:data.totalPages)?'disabled':''}>${icon('Printer')}<span>${lesson?'이 수업 인쇄':'전체 인쇄'}</span></button></div></header>
        <p class="lesson-status" role="status" aria-live="polite"></p>
        <div class="lesson-grid">${data.folders.map((f,i)=>`<a class="lesson-card" href="${escape(lessonUrl(f.id))}"><div class="lesson-card-media">${safeUrl(f.representativeUrl)?`<img src="${escape(f.representativeUrl)}" data-fallback="${escape(safeUrl(f.fallbackRepresentativeUrl))}" alt="${escape(f.coverAlt||`${f.title} 대표 수업자료`)}" loading="${i<4?'eager':'lazy'}" fetchpriority="${i<4?'high':'auto'}" decoding="async" width="640" height="480">`:icon('Folder')}</div><div class="lesson-card-copy"><h3>${escape(f.title)}</h3><p>${f.pageCount}장의 수업자료</p><span aria-hidden="true">→</span></div></a>`).join('')}</div>
        ${lesson&&data.pages.length?'<section class="lesson-reader" aria-label="수업자료 슬라이드"><div class="lesson-reader-toolbar"><button data-prev aria-label="이전 페이지" title="이전 페이지">←</button><output class="lesson-counter" aria-live="polite"></output><button data-next aria-label="다음 페이지" title="다음 페이지">→</button></div><button class="lesson-canvas" aria-label="원본 크게 보기" title="원본 크게 보기"></button><div class="lesson-pages" aria-label="전체 페이지 목록"></div></section>':''}
        ${!data.pages.length&&!data.folders.length?`<p class="lesson-empty">${data.canManage&&data.folder?.webManaged?'아직 수업자료가 없습니다. 오른쪽 위 업로드 버튼으로 이미지를 올려 주세요.':'등록된 수업자료가 없습니다.'}</p>`:''}
        ${data.canManage&&!lesson?'<form class="lesson-new-folder" data-new-folder><button type="button" data-new-folder-open>+ 새 폴더</button><div hidden><input name="title" maxlength="60" placeholder="수업 폴더 이름 (예: 5-8 소품 그리기)" required><button type="submit">만들기</button><button type="button" data-new-folder-cancel>취소</button></div></form>':''}`;
      host.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>{if(e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.getAttribute('href'));}));
      host.querySelectorAll('.lesson-card img').forEach(img=>img.addEventListener('error',()=>{
        const fallback=safeUrl(img.dataset.fallback);delete img.dataset.fallback;
        if(fallback&&img.getAttribute('src')!==fallback){img.src=fallback;return;}
        img.replaceWith(Object.assign(document.createElement('span'),{textContent:'표지 확인 필요'}));
      }));
      const status = host.querySelector('.lesson-status');
      async function print() {
        if (printing) return;
        printing=true;host.querySelector('[data-print]').disabled=true;printRoot?.remove();
        try {
          status.textContent='인쇄할 수업자료를 확인하고 있습니다.';
          const payload=await get(`${api}/print?family=${family}&stage=${stage}${lesson?'&lesson='+encodeURIComponent(lesson):''}`);
          if(!payload.pages.length)throw Error('인쇄할 수업자료가 없습니다.');
          printRoot=document.createElement('div');printRoot.className='curriculum-print-root';document.body.append(printRoot);
          let loaded=0,failed=0,cursor=0;
          const sheets=payload.pages.map((p,i)=>{const sheet=document.createElement('section');sheet.className='curriculum-print-sheet';sheet.dataset.page=p.id;const img=new Image();img.alt=`수업자료 ${i+1}`;sheet.append(img);printRoot.append(sheet);return img;});
          // Bounded decoding keeps failed pages explicit; never print an incomplete lesson.
          async function next(){while(cursor<sheets.length&&active()){const i=cursor++;sheets[i].src=safeUrl(payload.pages[i].printUrl);try{await decode(sheets[i]);}catch{failed++;}loaded++;if(!active())return;status.textContent=`${titles[stage]} ${sheets.length}장의 인쇄를 준비 중입니다. ${loaded} / ${sheets.length}`;}}
          await Promise.all(Array.from({length:Math.min(4,sheets.length)},next));
          if(!active())return;
          if(failed)throw Error(`${failed}개의 수업자료를 불러오지 못했습니다.`);
          document.body.classList.add('curriculum-printing');
          status.textContent='인쇄 준비가 완료되었습니다.';
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          if(active())window.print();
        }catch(e){if(active()){printRoot?.remove();document.body.classList.remove('curriculum-printing');status.textContent=e.message;const retry=document.createElement('button');retry.textContent='다시 시도';retry.onclick=print;status.append(retry);}}
        finally{printing=false;if(active())host.querySelector('[data-print]').disabled=false;}
      }
      host.querySelector('[data-print]').onclick=print;
      manage({host,data,status,active,navigate,lessonUrl,family,stage,rerender});
      if(!lesson||!data.pages.length)return;
      const pages=data.pages, canvas=host.querySelector('.lesson-canvas'), strip=host.querySelector('.lesson-pages');
      let index=Math.min(pages.length-1,Math.max(0,(parseInt(query.get('slide'),10)||1)-1));
      strip.innerHTML=pages.map((p,i)=>`<button data-slide="${i}" aria-label="${i+1} 페이지"><img src="${escape(safeUrl(p.thumbnailUrl))}" alt="" width="80" height="64" loading="lazy"><span>${i+1}</span></button>`).join('');
      function show(next,push=true){
        index=Math.max(0,Math.min(pages.length-1,next));const p=pages[index];
        const stamp=++slideRevision;
        if(!dialog?.isOpen)imageCache.retain(new Set([pages[index-1],p,pages[index+1]].filter(Boolean).flatMap(page=>[page.previewUrl,page.originalUrl])));
        if(push){const u=new URL(location.href);u.searchParams.set('slide',String(index+1));history.pushState({},'',u.pathname+u.search);}
        const img=image(imageCache.peek(p.previewUrl)||p.thumbnailUrl,`${data.folder.title} 수업자료 ${index+1}`);img.fetchPriority='high';img.decoding='async';img.draggable=false;
        img.onerror=()=>{img.hidden=true;};
        delete canvas.dataset.failed;canvas.replaceChildren(img);
        host.querySelector('.lesson-counter').textContent=`${index+1} / ${pages.length}`;
        host.querySelector('[data-prev]').disabled=index===0;host.querySelector('[data-next]').disabled=index===pages.length-1;
        strip.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-current',i===index?'true':'false'));
        void imageCache.get(p.previewUrl).then(src=>{
          if(!active()||stamp!==slideRevision)return;
          img.hidden=false;img.src=src;
          if(!navigator.connection?.saveData&&!/^(slow-)?2g$/.test(navigator.connection?.effectiveType||''))
            for(const page of [pages[index+1],pages[index-1]].filter(Boolean))void imageCache.get(page.previewUrl,{priority:'low'}).catch(()=>{});
        }).catch(()=>{if(active()&&stamp===slideRevision){canvas.textContent='이미지를 불러오지 못했습니다. 다시 시도';canvas.dataset.failed='true';}});
      }
      strip.querySelectorAll('button').forEach(b=>b.onclick=()=>show(Number(b.dataset.slide)));
      host.querySelector('[data-prev]').onclick=()=>show(index-1);host.querySelector('[data-next]').onclick=()=>show(index+1);
      keyHandler=e=>{if(!active()||dialog?.isOpen||printing||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;const next={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:pages.length-1}[e.key];if(next!==undefined){e.preventDefault();show(next);}};
      document.addEventListener('keydown',keyHandler);
      let start,swiped=false;
      canvas.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};swiped=false;canvas.setPointerCapture(e.pointerId);});
      canvas.addEventListener('pointercancel',()=>{start=null;});
      canvas.addEventListener('pointerup',e=>{if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)){swiped=true;show(index+(e.clientX<start.x?1:-1));}start=null;});
      canvas.onclick=()=>{
        if(swiped){swiped=false;return;}if(canvas.dataset.failed){show(index,false);return;}
        dialog=window.DataCoreImageGallery.open({scope:'curriculum',title:data.folder.title,anchor:canvas,index,cache:imageCache,
          items:pages.map((p,i)=>({src:safeUrl(p.originalUrl),displaySrc:safeUrl(p.previewUrl),previewSrc:imageCache.peek(p.previewUrl)||safeUrl(p.thumbnailUrl),title:`${data.folder.title} ${i+1}`})),
          onChange:next=>show(next)});
      };
      show(index,false);
    }catch(e){if(active()&&e.name!=='AbortError'){host.innerHTML=`<p role="alert">${escape(e.message)}</p>${e.status===401?`<a href="/data-core/login?next=${encodeURIComponent(location.pathname+location.search)}">로그인</a>`:'<button data-retry>다시 시도</button>'}`;host.querySelector('[data-retry]')?.addEventListener('click',rerender);}}
  }
  window.DataCoreCurriculumLibrary={mount,dispose:()=>{sequence++;dispose();}};
})();

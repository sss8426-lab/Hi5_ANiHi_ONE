(() => {
  const root = '/data-core/curriculum/content', api = '/api/data-core/curriculum';
  const titles = {basic:'기초과정',advanced:'심화과정',admission:'입시과정'};
  const descriptions = {basic:'기초부터 차근차근, 스스로 성장할 수 있는 힘을 만듭니다.',advanced:'기초에서 익힌 표현력을 바탕으로 전공에 필요한 구조·연출·완성도를 깊이 있게 확장합니다.',admission:'목표 대학과 실기 유형에 맞춰 실전 작품의 완성도와 시험 대응력을 높입니다.'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg aria-hidden="true" width="22" height="22"><use href="/data-core/assets/core-icons.svg?v=20260912-curriculum#${name}"></use></svg>`;
  const safeUrl = url => /^\/api\/data-core\/files\/[a-zA-Z0-9_-]+$/.test(url || '') ? url : '';
  let dispose = () => {}, sequence = 0;
  async function mount(host, family, stage, rerender) {
    const current = ++sequence, controller = new AbortController(), query = new URLSearchParams(location.search), lesson = query.get('lesson');
    let removed = false, printing = false, dialog, printRoot, prefetched = [], keyHandler;
    const clearPrint=()=>{printRoot?.remove();printRoot=null;document.body.classList.remove('curriculum-printing');};
    window.addEventListener('afterprint',clearPrint);
    dispose = () => { removed = true; controller.abort(); document.removeEventListener('keydown',keyHandler); window.removeEventListener('afterprint',clearPrint); dialog?.remove(); clearPrint(); prefetched = []; };
    const active = () => !removed && sequence === current && host.classList.contains('active');
    const get = async url => { const r = await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal}); if(!r.ok) { const error = new Error(r.status===401?'로그인이 필요합니다.':'수업자료를 불러오지 못했습니다.'); error.status=r.status;throw error; } return r.json(); };
    const navigate = url => { history.pushState({},'',url); rerender(); };
    const lessonUrl = id => `${root}/${stage}?lesson=${encodeURIComponent(id)}`;
    const decode = img => img.decode ? img.decode() : new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
    const image = (url,alt) => {const img = new Image();img.src=safeUrl(url);img.alt=alt;return img;};
    host.innerHTML = '<p role="status">수업자료를 불러오는 중입니다.</p>';
    try {
      const data = await get(lesson ? `${api}/folders/${encodeURIComponent(lesson)}` : `${api}?family=${family}&stage=${stage}`);
      if (!active()) return;
      if (data.family !== family || data.stage !== stage) throw Error('선택한 과정의 수업이 아닙니다.');
      const crumbs = [{title:'꿈을 향한 커리큘럼',url:'/data-core/curriculum'},{title:'웹툰·게임·애니메이션',url:root},{title:titles[stage],url:`${root}/${stage}`},...(data.breadcrumbs||[]).map(f=>({title:f.title,url:lessonUrl(f.id)}))];
      host.innerHTML = `<nav class="lesson-breadcrumb" aria-label="현재 위치">${crumbs.map((c,i)=>`<a href="${escape(c.url)}" ${i===crumbs.length-1?'aria-current="page"':''}>${escape(c.title)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>
        <header class="lesson-heading"><div><h2>${escape(data.folder?.title||titles[stage])}</h2><p>${data.folder?`${data.pages.length}장의 수업자료`:descriptions[stage]}</p></div><button type="button" data-print ${!(lesson?data.pages.length||data.folders.length:data.totalPages)?'disabled':''}>${icon('Printer')}<span>${lesson?'이 수업 인쇄':'전체 인쇄'}</span></button></header>
        <p class="lesson-status" role="status" aria-live="polite"></p>
        <div class="lesson-grid">${data.folders.map(f=>`<a class="lesson-card" href="${escape(lessonUrl(f.id))}"><div class="lesson-card-media">${safeUrl(f.representativeUrl)?`<img src="${escape(f.representativeUrl)}" alt="${escape(f.title)} 대표 수업자료" loading="lazy" decoding="async" width="640" height="480">`:icon('Folder')}</div><div class="lesson-card-copy"><h3>${escape(f.title)}</h3><p>${f.pageCount}장의 수업자료</p><span aria-hidden="true">→</span></div></a>`).join('')}</div>
        ${lesson&&data.pages.length?'<section class="lesson-reader" aria-label="수업자료 슬라이드"><div class="lesson-reader-toolbar"><button data-prev aria-label="이전 페이지" title="이전 페이지">←</button><output class="lesson-counter" aria-live="polite"></output><button data-next aria-label="다음 페이지" title="다음 페이지">→</button></div><button class="lesson-canvas" aria-label="원본 크게 보기" title="원본 크게 보기"></button><div class="lesson-pages" aria-label="전체 페이지 목록"></div></section>':''}
        ${!data.pages.length&&!data.folders.length?'<p class="lesson-empty">등록된 수업자료가 없습니다.</p>':''}`;
      host.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>{if(e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.getAttribute('href'));}));
      host.querySelectorAll('.lesson-card img').forEach(img=>img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('span'),{textContent:'표지 확인 필요'}));}));
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
      if(!lesson||!data.pages.length)return;
      const pages=data.pages, canvas=host.querySelector('.lesson-canvas'), strip=host.querySelector('.lesson-pages');
      let index=Math.min(pages.length-1,Math.max(0,(parseInt(query.get('slide'),10)||1)-1));
      strip.innerHTML=pages.map((p,i)=>`<button data-slide="${i}" aria-label="${i+1} 페이지"><img src="${escape(safeUrl(p.thumbnailUrl))}" alt="" width="80" height="64" loading="lazy"><span>${i+1}</span></button>`).join('');
      function show(next,push=true){
        index=Math.max(0,Math.min(pages.length-1,next));const p=pages[index];
        if(push){const u=new URL(location.href);u.searchParams.set('slide',String(index+1));history.pushState({},'',u.pathname+u.search);}
        const img=image(p.previewUrl,`${data.folder.title} 수업자료 ${index+1}`);img.fetchPriority='high';img.decoding='async';img.draggable=false;
        img.onerror=()=>{if(active()){canvas.textContent='이미지를 불러오지 못했습니다.';const retry=document.createElement('span');retry.textContent='다시 시도';canvas.append(retry);canvas.dataset.failed='true';}};
        delete canvas.dataset.failed;canvas.replaceChildren(img);
        host.querySelector('.lesson-counter').textContent=`${index+1} / ${pages.length}`;
        host.querySelector('[data-prev]').disabled=index===0;host.querySelector('[data-next]').disabled=index===pages.length-1;
        strip.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-current',i===index?'true':'false'));
        const neighbors=[pages[index-1],pages[index+1]].filter(Boolean);
        prefetched=neighbors.map(p=>prefetched.find(img=>img.getAttribute('src')===p.previewUrl)||image(p.previewUrl,''));
      }
      strip.querySelectorAll('button').forEach(b=>b.onclick=()=>show(Number(b.dataset.slide)));
      host.querySelector('[data-prev]').onclick=()=>show(index-1);host.querySelector('[data-next]').onclick=()=>show(index+1);
      keyHandler=e=>{if(!active()||dialog?.open||printing||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;const next={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:pages.length-1}[e.key];if(next!==undefined){e.preventDefault();show(next);}};
      document.addEventListener('keydown',keyHandler);
      let start,swiped=false;
      canvas.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};swiped=false;canvas.setPointerCapture(e.pointerId);});
      canvas.addEventListener('pointercancel',()=>{start=null;});
      canvas.addEventListener('pointerup',e=>{if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)){swiped=true;show(index+(e.clientX<start.x?1:-1));}start=null;});
      canvas.onclick=()=>{
        if(swiped){swiped=false;return;}if(canvas.dataset.failed){show(index,false);return;}
        dialog=document.createElement('dialog');dialog.className='lesson-zoom';dialog.innerHTML='<button data-close aria-label="닫기" title="닫기">×</button><button data-zoom aria-label="원본 크기로 확대" title="원본 크기로 확대">+</button><div></div>';
        const img=image(pages[index].originalUrl,`${data.folder.title} 원본 ${index+1}`);dialog.querySelector('div').append(img);
        dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-zoom]').onclick=e=>{const zoom=dialog.classList.toggle('actual-size');e.currentTarget.textContent=zoom?'−':'+';e.currentTarget.setAttribute('aria-label',zoom?'화면에 맞추기':'원본 크기로 확대');};dialog.onclick=e=>{if(e.target===dialog)dialog.close();};dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
      };
      show(index,false);
    }catch(e){if(active()&&e.name!=='AbortError'){host.innerHTML=`<p role="alert">${escape(e.message)}</p>${e.status===401?`<a href="/data-core/login?next=${encodeURIComponent(location.pathname+location.search)}">로그인</a>`:'<button data-retry>다시 시도</button>'}`;host.querySelector('[data-retry]')?.addEventListener('click',rerender);}}
  }
  window.DataCoreCurriculumLibrary={mount,dispose:()=>{sequence++;dispose();}};
})();

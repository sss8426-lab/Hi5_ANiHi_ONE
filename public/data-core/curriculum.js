(() => {
  const root = '/data-core/curriculum';
  const families = {
    start: { title: '꿈 그림의 시작', description: '처음 연필과 물감을 잡는 초등학생을 위한 첫걸음 과정', image: 'start-v1.webp', alt: '크레파스, 색연필, 수채 물감과 집·해·고양이를 그린 스케치북이 놓인 책상', tag: '초등 · 첫걸음', width: 1440, height: 960 },
    content: { title: '웹툰 · 게임 · 애니메이션', description: '웹툰, 게임그래픽, 애니메이션 전공을 준비하는 성장 과정', image: 'story-academy-work-v1.webp', alt: '애니하이 만화학원 작품 · 흑백 펜선 만화 원고', width: 1440, height: 1039 },
    design: { title: '디자이너', description: '디자인 계열 진학과 진로를 준비하는 성장 과정', image: 'design-academy-work-v1.webp', alt: '하이파이브 미술학원 작품 · 유리 질감 발상과 표현', width: 1440, height: 1051 },
  };
  const stages = { basic: '기초과정', advanced: '심화과정', admission: '입시과정' };
  const startFolders = {
    drawing: { title: '꿈 그림 기초', image: 'start-drawing-v1.webp', description: '선과 색으로 시작하는 그림 놀이', detail: '다양한 선과 색을 만나고, 보고 느낀 것을 자유롭게 그려요.', alt: '색연필과 물감으로 무지개와 집을 즐겁게 그리는 초등학생들' },
    comics: { title: '만화그리기 기초', image: 'start-comics-v1.webp', description: '표정과 이야기로 만드는 나만의 만화', detail: '캐릭터의 표정과 움직임을 배우고, 재미있는 이야기를 만화로 표현해요.', alt: '직접 그린 네 칸 만화와 캐릭터 표정을 보여주는 초등학생들' },
    design: { title: '디자인하기 기초', image: 'start-design-v1.webp', description: '모양과 색으로 만드는 즐거운 디자인', detail: '모양과 색을 조합하고, 나만의 생각을 멋진 작품으로 만들어요.', alt: '색종이 도형과 꽃으로 나만의 콜라주를 만드는 초등학생들' },
  };
  const stageImages = {
    content: {
      basic: { image: 'content-basic-v2.webp', description: '기초 인체 · 비례와 움직임', detail: '인체의 비례와 구조, 자연스러운 동작을 익힙니다.', alt: '미술학원에 처음 와서 인체 드로잉을 어려워하는 학생과 도와주는 선생님' },
      advanced: { image: 'content-advanced-v2.webp', description: '3점 투시 · 배경과 공간', detail: '투시로 공간을 만들고 인물과 배경을 한 화면에 담습니다.', alt: '투시 배경 그림을 자신 있게 보여주며 함께 그리는 친구들' },
      admission: { image: 'content-admission-v1.webp', description: '상황표현 · 인물과 이야기', detail: '주제를 한 장면의 이야기로 완성하는 입시 실기를 준비합니다.', alt: '바람에 날리는 그림을 잡는 인물들의 상황표현 작품' },
    },
    design: {
      basic: { image: 'design-basic-v2.webp', description: '기초 도형 · 형태와 명암', detail: '기본 도형으로 형태와 빛, 명암을 익힙니다.', alt: '처음으로 도형 소묘를 배우며 고민하는 학생과 빛의 방향을 알려주는 선생님' },
      advanced: { image: 'design-advanced-v2.webp', description: '3점 투시 · 사물과 구조', detail: '실제 사물을 투시로 관찰하고 재질과 색을 표현합니다.', alt: '카메라와 상자를 투시로 그리며 색을 고르는 친구들' },
      admission: { image: 'design-admission-v2.webp', description: '기초디자인 · 구성과 질감', detail: '사물과 주제를 구성해 기초디자인 입시를 준비합니다.', alt: '대학 캠퍼스에서 기초디자인 작품을 들고 꿈을 향해 달리는 학생들' },
    },
  };
  // Separate catalog slots; do not invent lessons or write an empty seed to production.
  const courses = { start: [], content: { basic: [], advanced: [], admission: [] }, design: { basic: [], advanced: [], admission: [] } };
  const icon = name => `<svg aria-hidden="true" width="24" height="24" ${name==='ArrowRight'?'class="curriculum-forward"':''}><use href="/data-core/assets/core-icons.svg#${name==='ArrowRight'?'ArrowLeft':name}"></use></svg>`;
  let countController;
  function render(path = location.pathname) {
    countController?.abort();
    window.DataCoreCurriculumLibrary?.dispose();
    const match = path.replace(/\/+$/, '').match(/^\/data-core\/curriculum(?:\/(start|content|design)(?:\/(basic|advanced|admission|drawing|comics|design))?)?$/);
    const host = document.getElementById('view-curriculum');
    if (!host) return;
    if (!match || (match[2] && !Object.hasOwn(match[1] === 'start' ? startFolders : stages, match[2]))) { host.classList.remove('curriculum-library'); host.innerHTML = '<h2>과정을 찾을 수 없습니다.</h2>'; return; }
    const [, family, stage] = match, selected = families[family];
    const labels = family === 'start' ? Object.fromEntries(Object.entries(startFolders).map(([key, item]) => [key, item.title])) : stages;
    host.classList.toggle('curriculum-library', family === 'content' && Object.hasOwn(stages, stage));
    if (family === 'content' && Object.hasOwn(stages, stage)) {
      window.DataCoreCurriculumLibrary?.mount(host, family, stage, () => render());
      return;
    }
    const title = stage ? labels[stage] : selected ? `${selected.title} 커리큘럼` : '꿈을 향한 커리큘럼';
    const back = stage ? `${root}/${family}` : selected ? root : '/data-core/counseling';
    host.innerHTML = `<div class="curriculum-heading"><a class="curriculum-back" href="${back}" aria-label="${stage ? '과정 선택' : selected ? '커리큘럼 선택' : '상담용 홈'}으로 돌아가기">${icon('ArrowLeft')}</a><div>${stage ? `<p>${selected.title} 커리큘럼</p>` : ''}<h2>${title}</h2></div></div>` +
      (!selected ? `<div class="curriculum-cards">${Object.entries(families).map(([key, item]) => `<a class="curriculum-card${item.tag ? ' curriculum-start-card' : ''}" href="${root}/${key}">${item.tag ? `<span class="curriculum-card-tag">${item.tag}</span>` : ''}<img src="/data-core/assets/work-visuals/${item.image}" alt="${item.alt}" width="${item.width || 1440}" height="${item.height || 960}" decoding="async"><div><h3>${item.title}</h3><p>${item.description}</p>${icon('ArrowRight')}</div></a>`).join('')}</div>`
        : !stage ? `<div class="curriculum-folders">${Object.entries(labels).map(([key, label]) => {
          const art = family === 'start' ? startFolders[key] : stageImages[family][key];
          return `<a class="curriculum-card curriculum-stage-card" href="${root}/${family}/${key}"><img src="/data-core/assets/curriculum/${art.image}" alt="${art.alt}" width="1200" height="800" decoding="async"><div><h3>${label}</h3><p class="curriculum-stage-focus">${art.description}</p><p class="curriculum-stage-detail">${art.detail}</p>${family==='content'?`<p data-stage-count="${key}" aria-live="polite" hidden></p>`:''}${icon('ArrowRight')}</div></a>`;
        }).join('')}</div>`
          : `<section class="curriculum-empty" data-family="${family}" data-stage="${stage}" data-course-count="${family === 'start' ? courses.start.length : courses[family][stage].length}">${icon('BookOpen')}<p>${family === 'start' ? '이 폴더에 등록된 수업자료가 없습니다.' : '등록된 커리큘럼이 없습니다.'}</p></section>`);
    if (family === 'content' && !stage) {
      countController = new AbortController();
      const { signal } = countController;
      host.querySelectorAll('[data-stage-count]').forEach(async label => {
        try {
          const response = await fetch(`/api/data-core/curriculum?family=content&stage=${label.dataset.stageCount}`, { credentials: 'same-origin', cache: 'no-store', signal });
          if (!response.ok) throw Error('count unavailable');
          const data = await response.json();
          if (!Number.isSafeInteger(data.totalFolders) || data.totalFolders < 0) throw Error('invalid count');
          if (!signal.aborted && label.isConnected) { label.textContent = `${data.totalFolders}개 수업`; label.hidden = false; }
        } catch {
          if (!signal.aborted && label.isConnected) label.remove();
        }
      });
    }
    host.querySelectorAll(`a[href^="${root}"]`).forEach(link => link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); history.pushState({}, '', link.getAttribute('href')); render();
    }));
  }
  window.DataCoreCurriculum = { render };
})();

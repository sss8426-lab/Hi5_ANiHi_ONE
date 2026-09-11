(() => {
  const root = '/data-core/curriculum';
  const families = {
    content: { title: '웹툰 · 게임 · 애니메이션', description: '웹툰, 게임그래픽, 애니메이션 전공을 준비하는 성장 과정', image: 'family-story-photo-v1.webp', alt: '드로잉 모니터와 스토리보드를 함께 검토하는 창작자들' },
    design: { title: '디자이너', description: '디자인 계열 진학과 진로를 준비하는 성장 과정', image: 'family-design-photo-v1.webp', alt: '색채와 패키지 시안을 검토하는 디자이너들' },
  };
  const stages = { basic: '기초과정', advanced: '심화과정', admission: '입시과정' };
  const stageImages = {
    content: {
      basic: { image: 'content-basic-v1.webp', description: '기초 인체 · 비례와 움직임', alt: '인체의 비례와 관절, 동작을 연습하는 연필 드로잉' },
      advanced: { image: 'content-advanced-v1.webp', description: '3점 투시 · 배경과 공간', alt: '높은 곳에서 내려다본 도시의 3점 투시 배경 드로잉' },
      admission: { image: 'content-admission-v1.webp', description: '상황표현 · 인물과 이야기', alt: '바람에 날리는 그림을 잡는 인물들의 상황표현 작품' },
    },
    design: {
      basic: { image: 'design-basic-v1.webp', description: '기초 도형 · 형태와 명암', alt: '정육면체, 구, 원기둥과 원뿔의 형태와 명암 소묘' },
      advanced: { image: 'design-advanced-v1.webp', description: '3점 투시 · 사물과 구조', alt: '상자와 카메라, 스피커의 3점 투시 사물 드로잉' },
      admission: { image: 'design-admission-v1.webp', description: '기초디자인 · 구성과 질감', alt: '금속 거품기, 유리컵과 오렌지를 구성한 기초디자인 작품' },
    },
  };
  // Separate catalog slots; do not invent lessons or write an empty seed to production.
  const courses = { content: { basic: [], advanced: [], admission: [] }, design: { basic: [], advanced: [], admission: [] } };
  const icon = name => `<svg aria-hidden="true" width="24" height="24" ${name==='ArrowRight'?'class="curriculum-forward"':''}><use href="/data-core/assets/core-icons.svg#${name==='ArrowRight'?'ArrowLeft':name}"></use></svg>`;
  function render(path = location.pathname) {
    const match = path.replace(/\/+$/, '').match(/^\/data-core\/curriculum(?:\/(content|design)(?:\/(basic|advanced|admission))?)?$/);
    const host = document.getElementById('view-curriculum');
    if (!host) return;
    if (!match) { host.innerHTML = '<h2>과정을 찾을 수 없습니다.</h2>'; return; }
    const [, family, stage] = match, selected = families[family];
    const title = stage ? stages[stage] : selected ? `${selected.title} 커리큘럼` : '꿈을 향한 커리큘럼';
    const back = stage ? `${root}/${family}` : selected ? root : '/data-core/counseling';
    host.innerHTML = `<div class="curriculum-heading"><a class="curriculum-back" href="${back}" aria-label="${stage ? '과정 선택' : selected ? '커리큘럼 선택' : '상담용 홈'}으로 돌아가기">${icon('ArrowLeft')}</a><div>${stage ? `<p>${selected.title} 커리큘럼</p>` : ''}<h2>${title}</h2></div></div>` +
      (!selected ? `<div class="curriculum-cards">${Object.entries(families).map(([key, item]) => `<a class="curriculum-card" href="${root}/${key}"><img src="/data-core/assets/roadmap/${item.image}" alt="${item.alt}" width="1440" height="960" decoding="async"><div><h3>${item.title}</h3><p>${item.description}</p>${icon('ArrowRight')}</div></a>`).join('')}</div>`
        : !stage ? `<div class="curriculum-folders">${Object.entries(stages).map(([key, label]) => {
          const art = stageImages[family][key];
          return `<a class="curriculum-card curriculum-stage-card" href="${root}/${family}/${key}"><img src="/data-core/assets/curriculum/${art.image}" alt="${art.alt}" width="1200" height="800" decoding="async"><div><h3>${label}</h3><p>${art.description}</p>${icon('ArrowRight')}</div></a>`;
        }).join('')}</div>`
          : `<section class="curriculum-empty" data-family="${family}" data-stage="${stage}" data-course-count="${courses[family][stage].length}">${icon('BookOpen')}<p>등록된 커리큘럼이 없습니다.</p></section>`);
    host.querySelectorAll(`a[href^="${root}"]`).forEach(link => link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); history.pushState({}, '', link.getAttribute('href')); render();
    }));
  }
  window.DataCoreCurriculum = { render };
})();

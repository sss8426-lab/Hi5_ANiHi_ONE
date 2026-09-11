(() => {
  const root = '/data-core/curriculum';
  const families = {
    content: { title: '웹툰 · 게임 · 애니메이션', description: '웹툰, 게임그래픽, 애니메이션 전공을 준비하는 성장 과정', image: 'family-story-photo-v1.webp', alt: '드로잉 모니터와 스토리보드를 함께 검토하는 창작자들' },
    design: { title: '디자이너', description: '디자인 계열 진학과 진로를 준비하는 성장 과정', image: 'family-design-photo-v1.webp', alt: '색채와 패키지 시안을 검토하는 디자이너들' },
  };
  const stages = { basic: '기초과정', advanced: '심화과정', admission: '입시과정' };
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
        : !stage ? `<div class="curriculum-folders">${Object.entries(stages).map(([key, label]) => `<a href="${root}/${family}/${key}">${icon('Folder')}<h3>${label}</h3>${icon('ArrowRight')}</a>`).join('')}</div>`
          : `<section class="curriculum-empty" data-family="${family}" data-stage="${stage}" data-course-count="${courses[family][stage].length}">${icon('BookOpen')}<p>등록된 커리큘럼이 없습니다.</p></section>`);
    host.querySelectorAll(`a[href^="${root}"]`).forEach(link => link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); history.pushState({}, '', link.getAttribute('href')); render();
    }));
  }
  window.DataCoreCurriculum = { render };
})();

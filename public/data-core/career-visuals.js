const keys = ['learning', 'competencies', 'portfolio'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function visualSections(career) {
  return keys.map((key,index) => {
    const section = career.visualContent?.[key];
    if (!section) return '';
    const heading = `career-${key}-title`;
    const image = section.available
      ? `<img src="${escape(section.image)}?v=${escape(section.version)}" alt="${escape(section.imageAlt)}" width="${section.width}" height="${section.height}" loading="lazy" decoding="async">`
      : `<div class="career-visual-unavailable" role="img" aria-label="${escape(section.imageAlt)}">시각 자료 준비 중</div>`;
    const extra = key === 'learning'
      ? `<div class="career-related"><h3>관련 전공</h3><div class="major-grid" id="majorGrid">${career.majors.map(major => `<span class="major-item">${escape(major)}</span>`).join('')}</div></div>`
      : key === 'portfolio' ? `<p class="career-output-summary" id="careerOutcome">${escape(career.outcome)}</p>` : '';
    return `<section class="career-visual-section career-visual-${key}" aria-labelledby="${heading}" data-career="${escape(career.id)}" data-section="${key}">
      <div class="career-visual-media" style="aspect-ratio:${section.width}/${section.height}">${image}<p class="career-visual-error" hidden>이미지를 불러오지 못했습니다.</p></div>
      <div class="career-visual-copy"><span class="career-visual-number" aria-hidden="true">0${index+1}</span><h2 id="${heading}">${escape(section.title)}</h2><p class="career-visual-intro">${escape(section.intro)}</p>
        <ul class="career-visual-items" ${key === 'competencies' ? 'id="skillGrid"' : ''}>${section.items.map(item => `<li><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p></li>`).join('')}</ul>${extra}
      </div>
    </section>`;
  }).join('');
}

export function renderCareerVisuals(container, career) {
  container.innerHTML = visualSections(career);
  for (const image of container.querySelectorAll('img')) {
    image.addEventListener('error', () => {
      image.hidden = true;
      const message = image.parentElement.querySelector('.career-visual-error');
      message.hidden = false;
      message.textContent = `${image.alt} · 이미지를 불러오지 못했습니다.`;
    }, {once:true});
  }
}

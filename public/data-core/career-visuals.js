import { careerWorks, artists as artistBook } from './career-works.js?v=20260930-pictures';
import { careerWorkVisuals } from './career-work-visuals.js?v=matched-works-v1';

const keys = ['learning', 'competencies', 'portfolio'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pad = n => String(n).padStart(2, '0');
// Section labels shown above each title (the consultation reads them as chapter markers).
const LABELS = {learning: '배움의 순서', competencies: '핵심역량', portfolio: '포트폴리오'};

// 01 배움: an ordered path — each step numbered on a connecting line.
function learningItems(items) {
  return `<ol class="career-steps">${items.map((item, i) => `<li><span class="career-step-index" aria-hidden="true">${pad(i + 1)}</span><div><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p></div></li>`).join('')}</ol>`;
}
// 02 핵심역량: a ruled list, then what the admission 실기 looks for (completionFocus).
function competencyItems(items, career) {
  const focus = career.completionFocus ? `<aside class="career-focus"><span>입시 실기에서 보는 완성도</span><p>${escape(career.completionFocus)}</p></aside>` : '';
  return `<ul class="career-competencies" id="skillGrid">${items.map((item, i) => `<li><span aria-hidden="true">${pad(i + 1)}</span><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p></li>`).join('')}</ul>${focus}`;
}
// 03 대표 작품: one card per work (opens its detail when there is one), then the outcome the portfolio adds up to.
function portfolioItems(items, career) {
  const details = careerWorks[career.id] || [];
  return `<ul class="career-works">${items.map((item, i) => details[i]
    ? `<li><button type="button" class="career-work-open" data-work="${i}" aria-haspopup="dialog"><span class="career-work-label">WORK ${pad(i + 1)}</span><strong>${escape(item.title)}</strong><span class="career-work-desc">${escape(item.description)}</span><span class="career-work-more">자세히 보기 · 대표 작가 <b aria-hidden="true">→</b></span></button></li>`
    : `<li><span class="career-work-label">WORK ${pad(i + 1)}</span><h3>${escape(item.title)}</h3><p>${escape(item.description)}</p></li>`).join('')}</ul>`;
}

// The educational artwork belongs to a work, never to its reference artist.
export function workSlides(career) {
  return (careerWorks[career.id] || []).map((work, index) => {
    const item = career.visualContent.portfolio.items[index];
    const people = work.artists.filter(id => artistBook[id]).map(id => artistBook[id]);
    const visual = careerWorkVisuals[career.id]?.[index];
    const image = visual?.available && visual.title === item.title ? visual : null;
    return {index, item, work, people, image};
  });
}
const safeLink = value => /^https?:\/\/[^\s"<>]+$/i.test(value) ? value : null;
function artistHtml(artist) {
  const links = (artist.links || []).filter(link => safeLink(link.url));
  return `<article class="work-viewer-artist"><header><h4>${escape(artist.name)}</h4><span>${escape(artist.nameEn)} · ${escape(artist.meta)}</span></header><p>${escape(artist.bio)}</p><p class="work-viewer-works"><b>대표 작품</b> ${artist.works.map(escape).join(' · ')}</p>${links.length ? `<div class="work-artist-links">${links.map(link => `<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div>` : ''}</article>`;
}
export function slideHtml(career, slide, at, total) {
  const {index, item, work, people, image} = slide;
  const list = (values) => `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
  const picture = image
    ? `<img src="${escape(image.image)}?v=${escape(image.version)}" alt="${escape(image.alt)}" width="${image.width}" height="${image.height}" decoding="async"><p class="work-viewer-error" role="status" hidden>이미지를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>`
    : '<p class="work-viewer-empty" role="status">이 작품의 교육용 이미지를 준비하고 있습니다.</p>';
  return `<header class="work-viewer-bar"><span aria-live="polite" aria-atomic="true">${at + 1} / ${total}</span><span class="work-viewer-crumb">${escape(career.name)} · WORK ${pad(index + 1)}</span><button type="button" class="work-viewer-close" aria-label="닫기" title="닫기">×</button></header>
    <section class="work-viewer-top"><span class="career-work-label">WORK ${pad(index + 1)}</span><h3 id="workDetailTitle">${escape(item.title)}</h3><p>${escape(work.about)}</p></section>
    <figure class="work-viewer-stage"><div class="work-viewer-picture${image ? '' : ' is-unavailable'}">${picture}
      <button type="button" class="work-viewer-nav work-viewer-prev" aria-label="이전 그림" title="이전 그림"${at === 0 ? ' disabled' : ''}>←</button><button type="button" class="work-viewer-nav work-viewer-next" aria-label="다음 그림" title="다음 그림"${at === total - 1 ? ' disabled' : ''}>→</button></div>
      ${image ? '<figcaption>교육용 예시 이미지 · AI 생성 <span>아래 대표 작가의 실제 작품과는 별개의 예시입니다.</span></figcaption>' : ''}</figure>
    <section class="work-viewer-bottom" aria-label="대표 작가와 포트폴리오 참고"><div class="work-viewer-artists"><h4 class="work-viewer-reference-label">대표 작가</h4>${people.map(artistHtml).join('')}</div>
      <div class="work-viewer-lists"><section><h4>이런 곳에 쓰여요</h4>${list(work.uses)}</section><section><h4>포트폴리오에 담을 것</h4>${list(work.portfolio)}</section></div></section>`;
}
function openWork(career, index, opener) {
  let dialog = document.getElementById('workDetail');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'workDetail'; dialog.className = 'work-viewer'; dialog.setAttribute('aria-labelledby', 'workDetailTitle');
    document.body.append(dialog);
  }
  const slides = workSlides(career);
  if (!slides.length) return;
  let at = Math.max(0, slides.findIndex((slide) => slide.index === index));
  const show = (next) => {
    if (next < 0 || next >= slides.length) return;
    const active = document.activeElement?.closest('.work-viewer-nav, .work-viewer-close')?.classList;
    const focusClass = active?.contains('work-viewer-next') ? '.work-viewer-next' : active?.contains('work-viewer-prev') ? '.work-viewer-prev' : '.work-viewer-close';
    at = next; dialog.innerHTML = slideHtml(career, slides[at], at, slides.length);
    dialog.scrollTop = 0;
    dialog.querySelector('.work-viewer-close').onclick = () => dialog.close();
    dialog.querySelector('.work-viewer-prev').onclick = () => show(at - 1);
    dialog.querySelector('.work-viewer-next').onclick = () => show(at + 1);
    const img = dialog.querySelector('.work-viewer-picture img');
    img?.addEventListener('error', () => { img.hidden = true; img.parentElement.classList.add('is-unavailable'); img.parentElement.querySelector('.work-viewer-error').hidden = false; }, {once: true});
    for (const neighbour of [slides[at - 1], slides[at + 1]]) if (neighbour?.image) Object.assign(new Image(), {src: `${neighbour.image.image}?v=${neighbour.image.version}`});
    if (dialog.open) (dialog.querySelector(`${focusClass}:not(:disabled)`) || dialog.querySelector('.work-viewer-close')).focus({preventScroll:true});
  };
  dialog.onkeydown = (event) => { if (event.altKey || event.ctrlKey || event.metaKey) return; if (event.key === 'ArrowLeft') { event.preventDefault(); show(at - 1); } if (event.key === 'ArrowRight') { event.preventDefault(); show(at + 1); } };
  let touch = null;
  dialog.ontouchstart = (event) => { touch = event.touches.length === 1 && event.target.closest('.work-viewer-picture') ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null; };
  dialog.ontouchcancel = () => { touch = null; };
  dialog.ontouchend = (event) => { if (!touch || !event.changedTouches.length) return; const dx = event.changedTouches[0].clientX - touch.x; const dy = event.changedTouches[0].clientY - touch.y; touch = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(at + (dx < 0 ? 1 : -1)); };
  dialog.onclose = () => { document.documentElement.classList.remove('work-viewer-open'); opener?.focus(); };
  show(at);
  document.documentElement.classList.add('work-viewer-open');
  dialog.showModal();
}

export function visualSections(career) {
  return keys.map((key, index) => {
    const section = career.visualContent?.[key];
    if (!section) return '';
    const heading = `career-${key}-title`;
    const image = section.available
      ? `<img src="${escape(section.image)}?v=${escape(section.version)}" alt="${escape(section.imageAlt)}" width="${section.width}" height="${section.height}" loading="lazy" decoding="async">`
      : `<div class="career-visual-unavailable" role="img" aria-label="${escape(section.imageAlt)}">시각 자료 준비 중</div>`;
    const items = key === 'learning' ? learningItems(section.items) : key === 'competencies' ? competencyItems(section.items, career) : portfolioItems(section.items, career);
    const extra = key === 'learning'
      ? `<div class="career-related"><h3>관련 전공</h3><div class="major-grid" id="majorGrid">${career.majors.map(major => `<span class="major-item">${escape(major)}</span>`).join('')}</div></div>`
      : key === 'portfolio' ? `<p class="career-output-summary" id="careerOutcome"><span>대표 결과물</span>${escape(career.outcome)}</p>` : '';
    return `<section class="career-visual-section career-visual-${key}" aria-labelledby="${heading}" data-career="${escape(career.id)}" data-section="${key}">
      <div class="career-visual-media" style="aspect-ratio:${section.width}/${section.height}">${image}<p class="career-visual-error" hidden>이미지를 불러오지 못했습니다.</p></div>
      <div class="career-visual-copy"><p class="career-visual-number"><b aria-hidden="true">${pad(index + 1)}</b>${LABELS[key]}</p><h2 id="${heading}">${escape(section.title)}</h2><p class="career-visual-intro">${escape(section.intro)}</p>
        ${items}${extra}
      </div>
    </section>`;
  }).join('');
}

export function renderCareerVisuals(container, career) {
  container.innerHTML = visualSections(career);
  for (const button of container.querySelectorAll('.career-work-open')) button.onclick = () => openWork(career, Number(button.dataset.work), button);
  for (const image of container.querySelectorAll('img')) {
    image.addEventListener('error', () => {
      image.hidden = true;
      const message = image.parentElement.querySelector('.career-visual-error');
      message.hidden = false;
      message.textContent = `${image.alt} · 이미지를 불러오지 못했습니다.`;
    }, {once:true});
  }
}

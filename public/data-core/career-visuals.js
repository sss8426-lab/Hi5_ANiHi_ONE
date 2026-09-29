import { careerWorks, artists as artistBook } from './career-works.js?v=20260930-pictures';
import { artistImages as workImages } from './career-work-images.js?v=20260930-pictures';

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

// 대표 작품 viewer: full screen, one slide per artist picture across this career's works (← → buttons,
// arrow keys, swipe). The picture sits in the middle as large as possible; the work sits above it and the
// artist and what goes in a portfolio below it.
function workSlides(career) {
  return (careerWorks[career.id] || []).flatMap((work, index) => {
    const item = career.visualContent.portfolio.items[index];
    const people = work.artists.filter((id) => artistBook[id]).map((id) => ({...artistBook[id], images: artistBook[id].images?.length ? artistBook[id].images : workImages[id] || []}));
    const slides = people.flatMap((artist) => artist.images.map((image) => ({index, item, work, artist, image})));
    return slides.length ? slides : [{index, item, work, artist: people[0], image: null}];
  });
}
function slideHtml(career, slide, at, total) {
  const {index, item, work, artist, image} = slide;
  const list = (values) => `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
  const picture = image
    ? `<a class="work-viewer-picture" href="${escape(image.href)}" target="_blank" rel="noopener noreferrer" title="원본 페이지에서 보기"><img src="${escape(image.src)}" alt="${escape(artist.name)} · ${escape(image.caption)}" decoding="async" referrerpolicy="no-referrer"></a>`
    : '<div class="work-viewer-picture work-viewer-empty">그림을 불러올 수 없어요</div>';
  const links = artist?.links.length ? `<div class="work-artist-links">${artist.links.map((link) => `<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div>` : '';
  return `<header class="work-viewer-bar"><span>${at + 1} / ${total}</span><span class="work-viewer-crumb">${escape(career.name)} · WORK ${pad(index + 1)}</span><button type="button" class="work-viewer-close" aria-label="닫기">×</button></header>
    <section class="work-viewer-top"><span class="career-work-label">WORK ${pad(index + 1)}</span><h3 id="workDetailTitle">${escape(item.title)}</h3><p>${escape(work.about)}</p></section>
    <figure class="work-viewer-stage">${picture}${image ? `<figcaption>${escape(image.caption)} <span>출처: ${escape(image.source)}</span></figcaption>` : ''}</figure>
    <section class="work-viewer-bottom">${artist ? `<article class="work-viewer-artist"><header><h4>${escape(artist.name)}</h4><span>${escape(artist.nameEn)} · ${escape(artist.meta)}</span></header><p>${escape(artist.bio)}</p><p class="work-viewer-works"><b>대표 작품</b> ${artist.works.map(escape).join(' · ')}</p>${links}</article>` : ''}
      <div class="work-viewer-lists"><section><h4>이런 곳에 쓰여요</h4>${list(work.uses)}</section><section><h4>포트폴리오에 담을 것</h4>${list(work.portfolio)}</section></div></section>
    <button type="button" class="work-viewer-nav work-viewer-prev" aria-label="이전 그림"${at === 0 ? ' disabled' : ''}>←</button><button type="button" class="work-viewer-nav work-viewer-next" aria-label="다음 그림"${at === total - 1 ? ' disabled' : ''}>→</button>`;
}
function openWork(career, index, opener) {
  let dialog = document.getElementById('workDetail');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'workDetail'; dialog.className = 'work-viewer'; dialog.setAttribute('aria-labelledby', 'workDetailTitle');
    document.body.append(dialog);
  }
  const slides = workSlides(career);
  let at = Math.max(0, slides.findIndex((slide) => slide.index === index));
  const show = (next) => {
    if (next < 0 || next >= slides.length) return;
    at = next; dialog.innerHTML = slideHtml(career, slides[at], at, slides.length);
    dialog.querySelector('.work-viewer-close').onclick = () => dialog.close();
    dialog.querySelector('.work-viewer-prev').onclick = () => show(at - 1);
    dialog.querySelector('.work-viewer-next').onclick = () => show(at + 1);
    const img = dialog.querySelector('.work-viewer-picture img');
    img?.addEventListener('error', () => { img.closest('a').outerHTML = '<div class="work-viewer-picture work-viewer-empty">그림을 불러올 수 없어요</div>'; }, {once: true});
    for (const neighbour of [slides[at - 1], slides[at + 1]]) if (neighbour?.image) Object.assign(new Image(), {referrerPolicy: 'no-referrer', src: neighbour.image.src});
  };
  dialog.onkeydown = (event) => { if (event.key === 'ArrowLeft') show(at - 1); if (event.key === 'ArrowRight') show(at + 1); };
  let startX = null;
  dialog.ontouchstart = (event) => { startX = event.touches[0].clientX; };
  dialog.ontouchend = (event) => { if (startX === null) return; const dx = event.changedTouches[0].clientX - startX; startX = null; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); };
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

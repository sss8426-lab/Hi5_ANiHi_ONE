import { careerWorks, artists as artistBook } from './career-works.js?v=20260929-all';
import { artistImages as workImages } from './career-work-images.js?v=20260929-all';

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

// Artwork shown from the official https address, with its source; a picture that fails to load is hidden.
function artistImages(artist) {
  if (!artist.images?.length) return '';
  return `<div class="work-artist-images">${artist.images.map((image) => `<figure><a href="${escape(image.href)}" target="_blank" rel="noopener noreferrer"><img src="${escape(image.src)}" alt="${escape(artist.name)} · ${escape(image.caption)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a><figcaption>${escape(image.caption)}<span>출처: ${escape(image.source)}</span></figcaption></figure>`).join('')}</div>`;
}
// The work's detail: what it is, where it is used, what to put in a portfolio, and representative artists.
function workDetail(career, index) {
  const item = career.visualContent.portfolio.items[index], work = careerWorks[career.id][index];
  const list = (values) => `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
  const artists = work.artists.filter((id) => artistBook[id]).map((id) => ({...artistBook[id], images: artistBook[id].images?.length ? artistBook[id].images : workImages[id] || []})).map((artist) => `<article class="work-artist"><header><h4>${escape(artist.name)}</h4><span>${escape(artist.nameEn)} · ${escape(artist.meta)}</span></header><p>${escape(artist.bio)}</p>${artistImages(artist)}<h5>대표 작품</h5>${list(artist.works)}${artist.links.length ? `<div class="work-artist-links">${artist.links.map((link) => `<a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a>`).join('')}</div>` : ''}</article>`).join('');
  return `<header class="work-detail-head"><span class="career-work-label">WORK ${pad(index + 1)} · ${escape(career.name)}</span><h3 id="workDetailTitle">${escape(item.title)}</h3><p>${escape(work.about)}</p></header>`
    + `<div class="work-detail-grid"><section><h4>이런 곳에 쓰여요</h4>${list(work.uses)}</section><section><h4>포트폴리오에 담을 것</h4>${list(work.portfolio)}</section></div>`
    + `<section class="work-artists"><h4>이 분야의 대표 작가</h4>${artists}<p class="work-note">작품 이미지는 작가·출판사·스튜디오의 공식 페이지나 자유 이용 허락된 위키미디어 공용 사진을 그대로 불러오며, 누르면 원본 페이지로 이동해요. 저작권은 각 작가와 권리자에게 있어요.</p></section>`;
}
function openWork(career, index, opener) {
  let dialog = document.getElementById('workDetail');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'workDetail'; dialog.className = 'work-detail'; dialog.setAttribute('aria-labelledby', 'workDetailTitle');
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  dialog.innerHTML = `<button type="button" class="work-detail-close" aria-label="닫기">×</button>${workDetail(career, index)}`;
  dialog.querySelector('.work-detail-close').onclick = () => dialog.close();
  for (const img of dialog.querySelectorAll('.work-artist-images img')) img.addEventListener('error', () => img.closest('figure').remove(), {once: true});
  dialog.onclose = () => opener?.focus();
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

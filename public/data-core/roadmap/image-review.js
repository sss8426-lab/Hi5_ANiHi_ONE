import {occupationImageConcepts} from '../occupation-image-concepts.js?v=20260919-work-v2';

const grid = document.getElementById('reviewGrid');
grid.replaceChildren(...occupationImageConcepts.map(c => {
  const career = window.HI5_ROADMAP_CONTENT.careers.find(x => x.id === c.occupationId);
  const link = document.createElement('a');
  link.className = 'review-item';
  link.href = `/data-core/roadmap#family=${career.family}&career=${c.occupationId}`;
  const image = document.createElement('img');
  image.src = `${c.asset}?v=${c.version}`;
  image.alt = c.alt;
  image.width = c.width;
  image.height = c.height;
  image.loading = 'lazy';
  image.decoding = 'async';
  const label = document.createElement('div');
  label.className = 'review-label';
  const title = document.createElement('strong');
  title.textContent = career.name;
  const meta = document.createElement('small');
  meta.textContent = `${c.occupationId} · ${c.category}`;
  label.append(title, meta);
  link.append(image, label);
  return link;
}));
document.getElementById('hideLabels').addEventListener('change', event => {
  grid.classList.toggle('hide-labels', event.target.checked);
});

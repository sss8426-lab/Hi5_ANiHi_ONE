// AI 수정 방향 (공모전·실기대회 수상작 아래): 현재 그림 업로드 → 같은 대학 작품과 대조 → 고칠 곳 3가지.
// 대학을 고르면 실기 유형 체크 칩과 작품 체크 목록(스크롤)이 나오고, 체크한 작품(최대 8장)과만 비교한다.
// The picture and the result stay in this page only; nothing is saved.
/* global AwardImageCache */
(() => {
  const root = document.getElementById('awardAiDirection');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const api = '/api/data-core/awards/ai-direction';
  const NO_TYPE = '구분 없음';
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const images = typeof AwardImageCache === 'function' ? new AwardImageCache({ maxEntries: 40 }) : null;
  const st = { limit: 8, image: null, imageUrl: '', university: '', types: [], works: [], on: new Set(), picked: new Set(), busy: false, request: 0, loaded: false };

  async function getJson(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || '불러오지 못했습니다. 다시 시도해주세요.'); error.status = response.status; throw error; }
    return body;
  }
  const status = (text, error = false) => { $('awardAiStatus').textContent = text; $('awardAiStatus').classList.toggle('is-error', error); };
  const label = work => [work.year, work.type === NO_TYPE && work.year ? '' : work.type].filter(Boolean).join(' · ');
  const visible = () => st.works.filter(work => st.on.has(work.type));

  async function loadUniversities() {
    if (st.loaded) return;
    st.loaded = true;
    try {
      const result = await getJson(`${api}/universities`);
      st.limit = result.referenceLimit || st.limit;
      const list = result.universities || [];
      $('awardAiUniversity').innerHTML = `<option value="">${list.length ? '대학을 고르세요' : '아직 비교할 작품이 없습니다'}</option>` +
        list.map(item => `<option value="${h(item.name)}">${h(item.name)} (${item.count}장)</option>`).join('');
    } catch (error) {
      if ([401, 403].includes(error.status)) { root.hidden = true; return; }
      st.loaded = false;
      status(error.message, true);
    }
  }

  async function chooseUniversity(name) {
    const request = ++st.request;
    st.university = name; st.works = []; st.types = []; st.on.clear(); st.picked.clear();
    $('awardAiTypesWrap').hidden = !name;
    if (!name) { render(); return; }
    $('awardAiWorks').innerHTML = '<p class="award-ai-empty">불러오는 중...</p>';
    $('awardAiTypes').innerHTML = '';
    try {
      const result = await getJson(`${api}/works?university=${encodeURIComponent(name)}`);
      if (request !== st.request) return;
      st.works = result.works || []; st.types = result.types || [];
      st.types.forEach(type => st.on.add(type.name));
      autoPick();
      status(result.truncated ? '작품이 많아 최근 작품부터 일부만 보여 줍니다.' : '');
    } catch (error) {
      if (request !== st.request) return;
      status(error.message, true);
    }
    render();
  }

  // Keep what is still visible; when nothing is left, check the first works (up to the limit).
  function autoPick() {
    const shown = visible(), ids = new Set(shown.map(work => work.id));
    for (const id of [...st.picked]) if (!ids.has(id)) st.picked.delete(id);
    if (!st.picked.size) shown.slice(0, st.limit).forEach(work => st.picked.add(work.id));
  }

  let thumbObserver;
  function render() {
    const shown = visible();
    $('awardAiTypes').innerHTML = st.types.map(type => `<label class="award-ai-chip${st.on.has(type.name) ? ' is-on' : ''}"><input type="checkbox" value="${h(type.name)}"${st.on.has(type.name) ? ' checked' : ''}><span>${h(type.name)}</span><small>${type.count}장</small></label>`).join('');
    $('awardAiCount').innerHTML = st.university ? `고른 유형의 작품 <b>${shown.length}장</b> · 비교할 작품을 체크하세요 (최대 ${st.limit}장)` : '';
    const full = st.picked.size >= st.limit;
    $('awardAiWorks').innerHTML = shown.length ? `<div class="award-ai-grid">${shown.map(work => {
      const on = st.picked.has(work.id);
      return `<label class="award-ai-work${on ? ' is-on' : ''}${!on && full ? ' is-full' : ''}" title="${h(work.fileName)}"><input type="checkbox" value="${h(work.id)}"${on ? ' checked' : ''}${!on && full ? ' disabled' : ''} aria-label="${h(label(work) || work.fileName)}"><span class="award-ai-thumb"><img alt="" data-ai-thumb="${h(work.id)}" decoding="async"${images?.peekPreview(work.id) ? ` src="${h(images.peekPreview(work.id))}"` : ''}></span><span class="award-ai-tag">${h(label(work) || '작품')}</span></label>`;
    }).join('')}</div>` : `<p class="award-ai-empty">${st.university ? '실기 유형을 하나 이상 고르세요.' : ''}</p>`;
    thumbObserver?.disconnect();
    thumbObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      thumbObserver.unobserve(entry.target);
      showThumb(entry.target);
    }), { root: $('awardAiWorks'), rootMargin: '200px' });
    $('awardAiWorks').querySelectorAll('[data-ai-thumb]:not([src])').forEach(img => thumbObserver.observe(img));
    updateButton();
  }
  // Checking a work only changes marks in place, so loaded thumbnails and the scroll position stay.
  function updatePicks() {
    const full = st.picked.size >= st.limit;
    $('awardAiWorks').querySelectorAll('.award-ai-work').forEach(tile => {
      const input = tile.querySelector('input'), on = st.picked.has(input.value);
      input.checked = on; input.disabled = !on && full;
      tile.classList.toggle('is-on', on); tile.classList.toggle('is-full', !on && full);
    });
    updateButton();
  }
  async function showThumb(img) {
    const work = st.works.find(item => item.id === img.dataset.aiThumb);
    if (!work || !images) return;
    try { img.src = await images.getThumbnail(work.id, work.thumbnailUrl); } catch { img.closest('.award-ai-thumb')?.classList.add('is-missing'); }
  }
  function updateButton() {
    const n = st.picked.size;
    $('awardAiGo').textContent = st.busy ? 'AI가 비교하고 있어요...' : n ? `분석하기 · 체크한 ${n}장과 비교` : '분석하기';
    $('awardAiGo').disabled = st.busy || !st.image || !n;
  }

  // Phone photos are large: send a 1600px JPEG, which also drops the photo's location data.
  async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) throw new Error();
      return blob;
    } finally { bitmap.close(); canvas.width = canvas.height = 0; }
  }
  async function chooseImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { status('그림 파일(JPG·PNG·WebP)을 올려주세요.', true); return; }
    try {
      const blob = await shrink(file);
      if (st.imageUrl) URL.revokeObjectURL(st.imageUrl);
      st.image = blob; st.imageUrl = URL.createObjectURL(blob);
      $('awardAiPreview').src = st.imageUrl; $('awardAiPreview').hidden = false;
      $('awardAiDropText').hidden = true; $('awardAiChange').hidden = false;
      $('awardAiResult').hidden = true;
      status('');
    } catch { status('이 그림은 열 수 없습니다. JPG나 PNG로 저장해서 올려주세요.', true); }
    updateButton();
  }

  async function analyze() {
    if (st.busy || !st.image || !st.picked.size) return;
    st.busy = true; updateButton();
    status('AI가 비교하고 있어요. 30초쯤 걸립니다.');
    const ids = visible().filter(work => st.picked.has(work.id)).map(work => work.id);
    const body = new FormData();
    body.set('image', st.image, 'current.jpg');
    body.set('fileIds', JSON.stringify(ids));
    try {
      const result = await getJson(`${api}/analyze`, { method: 'POST', body });
      showResult(result);
      status('');
    } catch (error) {
      status(error.status === 503 ? 'AI 연결 설정이 아직 되어 있지 않습니다. 마스터 관리자에게 문의해주세요.' : error.message, true);
    } finally { st.busy = false; updateButton(); }
  }
  function showResult(result) {
    const directions = result.directions || [];
    $('awardAiResultImage').src = st.imageUrl;
    $('awardAiMarks').innerHTML = directions.map((item, n) => {
      const box = item.box || {};
      return `<span class="award-ai-mark m${n + 1}" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%"><b>${n + 1}</b></span>`;
    }).join('');
    $('awardAiDirections').innerHTML = directions.map((item, n) => `<li class="m${n + 1}"><b>${n + 1}</b><p><strong>${h(item.title)}</strong>${h(item.detail)}</p></li>`).join('');
    const compared = (result.compared || []).map(id => st.works.find(work => work.id === id)).filter(Boolean);
    $('awardAiRefsLabel').textContent = `비교한 ${st.university} 작품 ${compared.length}장`;
    $('awardAiRefs').innerHTML = compared.map(work => `<img alt="${h(label(work))}" title="${h(label(work))}" data-ai-ref="${h(work.id)}">`).join('');
    $('awardAiRefs').querySelectorAll('[data-ai-ref]').forEach(img => {
      const work = st.works.find(item => item.id === img.dataset.aiRef);
      images?.getThumbnail(work.id, work.thumbnailUrl).then(url => { img.src = url; }).catch(() => {});
    });
    $('awardAiResult').hidden = false;
    $('awardAiResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('awardAiFile').onchange = event => { chooseImage(event.target.files?.[0]); event.target.value = ''; };
  $('awardAiChange').onclick = () => $('awardAiFile').click();
  const drop = $('awardAiDrop');
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-over'); chooseImage(event.dataTransfer?.files?.[0]); });
  $('awardAiUniversity').onchange = event => chooseUniversity(event.target.value);
  $('awardAiTypes').onchange = event => {
    const input = event.target.closest('input'); if (!input) return;
    if (input.checked) st.on.add(input.value); else st.on.delete(input.value);
    autoPick(); render();
  };
  $('awardAiWorks').onchange = event => {
    const input = event.target.closest('input'); if (!input) return;
    if (input.checked && st.picked.size >= st.limit) { input.checked = false; return; }
    if (input.checked) st.picked.add(input.value); else st.picked.delete(input.value);
    updatePicks();
  };
  $('awardAiAll').onclick = () => { visible().forEach(work => { if (st.picked.size < st.limit) st.picked.add(work.id); }); updatePicks(); };
  $('awardAiNone').onclick = () => { st.picked.clear(); updatePicks(); };
  $('awardAiGo').onclick = analyze;
  new IntersectionObserver((entries, observer) => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); loadUniversities(); }
  }).observe(root);
  updateButton();
})();

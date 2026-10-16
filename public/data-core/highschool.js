// 고교 진학 상담 화면: 상담 학생 목록 → 입력(학생·지망·성적표 사진·통학) → A4 9쪽 상담 자료(인쇄·PDF).
// 화면 상태는 주소 #의 뒷부분으로 나눈다(#new, #edit=ID, #report=ID). 뒤로 가기가 한 단계씩 돌아간다.
import { renderReport, analyze, gradeBook, bandOf, academyDefault, segment, regionFromAddress, SEMS, SUBJECTS, ACHIEVEMENTS, esc } from './highschool-report.js?v=20261016-hs2';

const API = '/api/data-core/highschool';
const $ = (id) => document.getElementById(id);
const form = $('hsForm');
const state = { students: [], schools: null, canManage: false, me: '', kakao: false, current: null, dirty: false };
const SEM_LABEL = { '1-1': '중1 1학기', '1-2': '중1 2학기', '2-1': '중2 1학기', '2-2': '중2 2학기', '3-1': '중3 1학기', '3-2': '중3 2학기' };

async function api(path, init = {}) {
  const res = await fetch(new Request(API + path, { cache: 'no-store', ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }));
  let body = {};
  try { body = await res.json(); } catch { body = {}; }
  if (res.status === 401) { location.href = `/data-core/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('로그인이 필요합니다.'); }
  if (!res.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  return body;
}
function notice(message, kind = '') {
  const el = $('hsNotice');
  el.textContent = message || '';
  el.className = `notice${message ? '' : ' hidden'}${kind ? ` ${kind}` : ''}`;
}
const schoolList = () => state.schools?.schools || [];
const schoolByName = (name) => schoolList().find((s) => s.name === name);
const dn = (name) => schoolByName(name)?.display || name;

// ── 목록 ──
function statusChips(s) {
  const book = gradeBook(s), chips = [];
  const wishes = (s.wishes || []).filter(Boolean);
  if (book.sems.length) chips.push(['ok', `성적 ${book.sems.length}학기`]);
  else chips.push(['gray', s.bandManual ? `성적표 없음 · ${s.bandManual}` : '성적표 없음']);
  if (!wishes.length) chips.push(['warn', '지망 학교 없음']);
  else {
    const A = analyze(s, state.schools);
    const missing = A.rows.filter((x) => x.total == null).length;
    chips.push(missing ? ['warn', `통학 ${missing}곳 미확인`] : ['ok', `통학 ${A.rows.length}곳 확인`]);
  }
  return chips.map(([k, t]) => `<span class="hs-chip ${k}">${esc(t)}</span>`).join('');
}
function renderList() {
  const q = $('hsSearch').value.trim();
  const rows = state.students.filter((s) => !q || [s.name, s.middleSchool, ...(s.wishes || [])].join(' ').includes(q));
  $('hsRows').innerHTML = rows.length ? rows.map((s) => `<article class="hs-row">
    <div class="hs-who"><strong>${esc(s.name)}</strong><small>${esc([s.middleSchool, s.grade ? `${s.grade}학년` : ''].filter(Boolean).join(' '))}</small></div>
    <div class="hs-where"><small>${esc(s.campusLabel || '')}</small><small>${esc((s.wishes || []).filter(Boolean).map(dn).join(' → ') || '지망 미입력')}</small></div>
    <div class="hs-chips">${statusChips(s)}</div>
    <div class="hs-row-actions"><a class="secondary-btn" href="#edit=${encodeURIComponent(s.id)}">입력 고치기</a><a class="primary-btn" href="#report=${encodeURIComponent(s.id)}">자료 보기</a></div>
    <small class="hs-by">${esc(s.createdByName || '')} · ${esc(String(s.updatedAt || '').slice(0, 10))}</small>
  </article>`).join('') : `<p class="hs-empty">${q ? '찾는 학생이 없습니다.' : '아직 상담 학생이 없습니다. ‘＋ 새 상담’으로 시작하세요.'}</p>`;
}

// ── 입력 ──
function schoolOptions(selected) {
  const groups = [['부천', (s) => s.region === '부천' && !s.special], ['인천', (s) => s.region === '인천' && !s.special], ['특성화고', (s) => s.special]];
  const known = schoolByName(selected) || !selected;
  return `<option value="">선택 안 함</option>${known ? '' : `<option selected>${esc(selected)}</option>`}${groups.map(([label, f]) => `<optgroup label="${label}">${schoolList().filter(f).map((s) => `<option value="${esc(s.name)}"${s.name === selected ? ' selected' : ''}>${esc(s.display || s.name)}</option>`).join('')}</optgroup>`).join('')}`;
}
function renderWishes(s) {
  $('hsWishes').innerHTML = [0, 1, 2, 3, 4].map((i) => `<label><span>${i + 1}지망</span><select data-wish="${i}">${schoolOptions((s.wishes || [])[i] || '')}</select></label>`).join('');
  $('hsExtras').innerHTML = [0, 1, 2].map((i) => `<label><span>비교 ${i + 1}</span><select data-extra="${i}">${schoolOptions((s.extras || [])[i] || '')}</select></label>`).join('');
}
function gradeCell(sem, sub, v = {}) {
  const id = `${sem}-${sub}`;
  return `<td><div class="hs-cell"><input inputmode="decimal" data-g="${id}" data-f="s" value="${esc(v.s ?? '')}" aria-label="${SEM_LABEL[sem]} ${sub} 원점수" placeholder="점수"><input inputmode="decimal" data-g="${id}" data-f="m" value="${esc(v.m ?? '')}" aria-label="${SEM_LABEL[sem]} ${sub} 과목평균" placeholder="평균"><select data-g="${id}" data-f="a" aria-label="${SEM_LABEL[sem]} ${sub} 성취도"><option value="">-</option>${ACHIEVEMENTS.map((a) => `<option${v.a === a ? ' selected' : ''}>${a}</option>`).join('')}</select></div></td>`;
}
function renderGrades(s) {
  const sems = SEMS.filter((q) => s.grades?.[q] || state.extraSems?.has(q));
  $('hsGrades').innerHTML = sems.length ? `<thead><tr><th>학기</th>${SUBJECTS.map((x) => `<th>${x}</th>`).join('')}<th></th></tr></thead><tbody>${sems.map((sem) => `<tr><th>${SEM_LABEL[sem]}</th>${SUBJECTS.map((sub) => gradeCell(sem, sub, s.grades?.[sem]?.[sub])).join('')}<td><button class="hs-x" type="button" data-drop-sem="${sem}" aria-label="${SEM_LABEL[sem]} 지우기">×</button></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="hs-empty">아직 성적이 없습니다. 사진을 넣거나 학기를 추가해 직접 적으세요.</td></tr></tbody>';
  const left = SEMS.filter((q) => !sems.includes(q));
  $('hsSemAdd').innerHTML = left.map((q) => `<option value="${q}">${SEM_LABEL[q]}</option>`).join('');
  $('hsSemAddBtn').disabled = !left.length;
  $('hsPhotoSem').innerHTML = `<option value="">사진에서 자동</option>${SEMS.map((q) => `<option value="${q}">${SEM_LABEL[q]}</option>`).join('')}`;
  renderBand();
}
function renderBand() {
  const s = readForm();
  const bd = bandOf(gradeBook(s));
  $('hsBand').innerHTML = bd
    ? `<span class="hs-hint">성적대 (${bd.sems.map((q) => SEM_LABEL[q]).join('·')} 국어·영어·사탐의 점수−학교평균 평균)</span><b>${bd.gap > 0 ? '+' : ''}${bd.gap} → ${bd.band}</b><span class="hs-hint">+3 이상 상위권 · −10 이상 중위권 · 그 아래 하위권${s.bandManual ? ` · 지금은 직접 고른 ‘${s.bandManual}’을 씁니다` : ''}</span>`
    : `<span class="hs-hint">점수와 학교 평균이 들어가면 성적대(상위·중위·하위권)를 자동으로 계산합니다.${s.bandManual ? ` 지금은 직접 고른 ‘${s.bandManual}’을 씁니다.` : ''}</span>`;
}
const segFields = (seg, key, v = seg || {}) => `<div class="hs-seg" data-seg="${key}"><input inputmode="numeric" data-k="min" value="${esc(v.min ?? '')}" placeholder="분" aria-label="${key} 분"><select data-k="mode" aria-label="${key} 방법"><option value="transit"${v.mode !== 'walk' ? ' selected' : ''}>대중교통</option><option value="walk"${v.mode === 'walk' ? ' selected' : ''}>도보</option></select><input data-k="bus" value="${esc(v.bus ?? '')}" placeholder="버스 번호" aria-label="${key} 버스 번호"><input type="hidden" data-k="transfers" value="${esc(v.transfers ?? '')}"><input type="hidden" data-k="walk" value="${esc(v.walk ?? '')}"><input type="hidden" data-k="alt" value="${esc(v.alt ?? '')}">${v.auto ? '<span class="hs-auto">자동</span>' : ''}</div>`;
function renderCommute(s) {
  const A = analyze(s, state.schools);
  const names = [...new Set([...(s.wishes || []), ...(s.extras || [])].filter(Boolean))];
  const kakaoLink = (name) => `https://map.kakao.com/?sName=${encodeURIComponent(s.address || '')}&eName=${encodeURIComponent(name.replace(/여고$/, '여자고등학교').replace(/고$/, '고등학교'))}`;
  const rows = names.map((name) => {
    const c = s.commute?.schools?.[name] || {};
    const def = segment(academyDefault(schoolByName(name)));
    const row = A.rows.find((x) => x.s === name);
    const out = A.out.includes(name);
    return `<tr data-school="${esc(name)}"><th>${esc(dn(name))}${out ? '<small>다른 지역 · 자료에서 빠짐</small>' : ''}</th><td>${segFields(c.home, `${name} 집→학교`)}</td><td>${segFields(c.academy, `${name} 학교→학원`)}${def && !c.academy ? `<small class="hs-def">비우면 기본 ${esc(def.head)}</small>` : ''}</td><td class="hs-total">${row && row.total != null ? `<b>${row.total}분</b>` : '<span class="hs-miss">미확인</span>'}</td><td><a href="${kakaoLink(name)}" target="_blank" rel="noopener">카카오맵</a></td></tr>`;
  }).join('');
  $('hsCommute').innerHTML = names.length
    ? `<thead><tr><th>학교</th><th>집 → 학교 (07:30)</th><th>학교 → 학원 (16:30)</th><th>하루 합계</th><th>경로 확인</th></tr></thead><tbody>${rows}<tr class="hs-back"><th>학원 → 집 (22:00)</th><td colspan="2">${segFields(s.commute?.back, '학원→집')}<small class="hs-def">모든 학교에 같게 더합니다</small></td><td></td><td></td></tr></tbody>`
    : '<tbody><tr><td class="hs-empty">지망 학교를 고르면 통학 표가 생깁니다.</td></tr></tbody>';
  $('hsRouteBtn').disabled = !state.kakao || !names.length;
  if (!state.kakao) $('hsRouteStatus').textContent = '카카오 길찾기 키가 연결되면 자동으로 채웁니다. 지금은 카카오맵에서 확인한 분을 적어 주세요.';
}
function readSeg(el) {
  if (!el) return null;
  const v = Object.fromEntries([...el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value.trim()]));
  if (v.min === '') return null;
  return { ...v, auto: Boolean(el.querySelector('.hs-auto')) };
}
function readForm() {
  const f = new FormData(form);
  const base = state.current || {};
  const grades = {};
  for (const input of form.querySelectorAll('[data-g]')) {
    const [y, q, sub] = input.dataset.g.split('-');
    const sem = `${y}-${q}`;
    ((grades[sem] ??= {})[sub] ??= {})[input.dataset.f] = input.value.trim();
  }
  for (const sem of Object.keys(grades)) for (const sub of Object.keys(grades[sem])) { const v = grades[sem][sub]; if (v.s === '' && !v.a) delete grades[sem][sub]; }
  const schools = {};
  for (const tr of form.querySelectorAll('#hsCommute tr[data-school]')) {
    const segs = tr.querySelectorAll('.hs-seg');
    schools[tr.dataset.school] = { home: readSeg(segs[0]), academy: readSeg(segs[1]) };
  }
  return {
    ...base,
    name: String(f.get('name') || '').trim(), middleSchool: String(f.get('middleSchool') || '').trim(), grade: Number(f.get('grade') || 3),
    entryYear: Number(f.get('entryYear')) || '', address: String(f.get('address') || '').trim(), region: String(f.get('region') || ''),
    consultDate: String(f.get('consultDate') || '').trim(), campusLabel: String(f.get('campusLabel') || '').trim(),
    wishes: [...form.querySelectorAll('[data-wish]')].map((el) => el.value), extras: [...form.querySelectorAll('[data-extra]')].map((el) => el.value).filter(Boolean),
    fixedOrder: f.get('fixedOrder') === 'on', bandManual: String(f.get('bandManual') || ''),
    grades, commute: { checkedAt: base.commute?.checkedAt || '', back: readSeg(form.querySelector('.hs-back .hs-seg')), schools },
    commuteNote: String(f.get('commuteNote') || '').trim(), memo: String(f.get('memo') || ''),
  };
}
function fillForm(s) {
  state.current = s;
  state.extraSems = new Set();
  const year = new Date().getFullYear();
  $('hsEntryYear').innerHTML = [year, year + 1, year + 2].map((y) => `<option value="${y}">${y}학년도 고등학교 진학</option>`).join('');
  form.elements.name.value = s.name || '';
  form.elements.middleSchool.value = s.middleSchool || '';
  form.elements.grade.value = String(s.grade || 3);
  form.elements.entryYear.value = String(s.entryYear || year + 1);
  form.elements.address.value = s.address || '';
  form.elements.region.value = s.region || '';
  form.elements.consultDate.value = s.consultDate || '';
  form.elements.campusLabel.value = s.campusLabel || '상동 본원 · 입시기초반';
  form.elements.fixedOrder.checked = Boolean(s.fixedOrder);
  form.elements.bandManual.value = s.bandManual || '';
  form.elements.commuteNote.value = s.commuteNote || '';
  form.elements.memo.value = s.memo || '';
  renderWishes(s); renderGrades(s); renderCommute(s); renderRegion();
  state.dirty = false;
}
function renderRegion() {
  const auto = regionFromAddress(form.elements.address.value);
  $('hsRegionAuto').textContent = auto ? `주소로 보면 ${auto}` : '';
}
function refreshDerived() { const s = readForm(); state.current = s; renderCommute(s); renderBand(); }
// 통학 칸을 고칠 때는 표를 다시 그리지 않고(입력 중인 칸이 사라지지 않게) 하루 합계만 바꾼다
function refreshTotals() {
  const s = readForm(); state.current = s;
  const A = analyze(s, state.schools);
  for (const tr of form.querySelectorAll('#hsCommute tr[data-school]')) {
    const row = A.rows.find((x) => x.s === tr.dataset.school);
    tr.querySelector('.hs-total').innerHTML = row && row.total != null ? `<b>${row.total}분</b>` : '<span class="hs-miss">미확인</span>';
  }
}

async function save() {
  const s = readForm();
  if (!s.name) { form.elements.name.focus(); notice('학생 이름을 넣어 주세요.', 'warn'); return null; }
  const body = JSON.stringify({ student: s });
  const res = s.id ? await api(`/students/${encodeURIComponent(s.id)}`, { method: 'PATCH', body }) : await api('/students', { method: 'POST', body });
  const saved = res.student;
  state.students = [saved, ...state.students.filter((x) => x.id !== saved.id)];
  state.current = saved; state.dirty = false;
  notice(`${saved.name} 학생을 저장했습니다.`);
  return saved;
}

// 성적표 사진: 2400px JPEG로 줄여 한 장씩 읽고, 학기·과목 칸에 채운다
async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 줄이지 못했습니다.'))), 'image/jpeg', 0.86));
}
async function readPhotos(files) {
  const status = $('hsPhotoStatus');
  const forced = $('hsPhotoSem').value;
  const s = readForm();
  let filled = 0, skipped = 0;
  const notes = [];
  for (const [i, file] of [...files].entries()) {
    status.textContent = `사진 ${i + 1}/${files.length} 읽는 중… (한 장에 20~40초)`;
    try {
      const body = new FormData();
      body.append('image', await shrink(file), 'grade.jpg');
      body.append('gradeHint', `중학교 ${s.grade || 3}학년`);
      const r = await api('/grade-photo', { method: 'POST', body });
      if (r.kind !== 'report') { notes.push(`${i + 1}번째 사진은 성적표가 아닌 것 같습니다.`); continue; }
      if (!s.middleSchool && r.school) s.middleSchool = r.school;
      for (const row of r.rows) {
        const sem = forced || row.sem;
        if (!sem || !SEMS.includes(sem) || !SUBJECTS.includes(row.subject)) { skipped++; continue; }
        ((s.grades[sem] ??= {})[row.subject] = { s: row.s, m: row.m, a: row.a });
        filled++;
      }
      notes.push(...r.uncertain.map((u) => `${i + 1}번째 사진: ${u}`));
    } catch (error) { notes.push(`${i + 1}번째 사진: ${error.message}`); }
  }
  state.current = s;
  fillForm(s); state.dirty = true;
  status.textContent = `${filled}칸을 채웠습니다.${skipped ? ` 학기를 알 수 없거나 비교하지 않는 과목 ${skipped}칸은 넣지 않았습니다(필요하면 ‘사진 학기’를 고르고 다시 넣으세요).` : ''}${notes.length ? ` 확인할 점: ${notes.join(' / ')}` : ''}`;
}

async function autoRoutes() {
  const s = readForm();
  const names = [...new Set([...s.wishes, ...s.extras].filter(Boolean))];
  $('hsRouteStatus').textContent = '카카오맵에서 경로를 찾는 중…';
  $('hsRouteBtn').disabled = true;
  try {
    const r = await api('/routes', { method: 'POST', body: JSON.stringify({ address: s.address, schools: names }) });
    const fails = [];
    for (const name of names) {
      const got = r.schools[name];
      if (!got || !got.home) { fails.push(dn(name)); continue; }
      const cur = (s.commute.schools[name] ||= {});
      cur.home = got.home;
      if (got.academy && !cur.academy) cur.academy = got.academy;
    }
    if (r.back) s.commute.back = r.back;
    s.commute.checkedAt = r.checkedAt;
    state.current = s; renderCommute(s); state.dirty = true;
    $('hsRouteStatus').textContent = `카카오맵 조회(${r.checkedAt}) 결과를 채웠습니다. 저장해야 남습니다.${fails.length ? ` ${fails.join('·')}는 찾지 못해 직접 적어 주세요.` : ''}`;
  } catch (error) { $('hsRouteStatus').textContent = error.message; }
  finally { $('hsRouteBtn').disabled = false; }
}

// ── 결과 ──
function showReport(s) {
  const withGuide = $('hsWithGuide').checked;
  $('hsReport').innerHTML = renderReport(s, state.schools, { withGuide }).html;
  fitReport();
}
// 휴대폰에서는 A4 쪽을 화면 너비에 맞춰 줄여 보여 준다(인쇄는 원래 크기)
function fitReport() {
  const box = $('hsReport'), width = box.parentElement.clientWidth;
  box.style.zoom = width && width < 830 ? String(Math.max(0.3, (width - 8) / 820)) : '';
}
window.addEventListener('resize', fitReport);

// ── 학교 정보(원장·마스터) ──
function renderSchools() {
  const can = state.canManage;
  $('hsSchools').innerHTML = schoolList().map((s) => {
    const def = academyDefault(s);
    return `<div class="hs-school" data-name="${esc(s.name)}"><h3>${esc(s.display || s.name)} <small>${esc(s.region)}${s.special ? ' · 특성화고' : ''}</small></h3>
      <label><span>재원생 평가</span><textarea rows="3" maxlength="600" data-f="review"${can ? '' : ' readonly'}>${esc(s.review || '')}</textarea></label>
      <div class="hs-school-row"><span>학교 → 학원</span>${segFields(def || {}, `${s.name} 학교→학원 기본`)}${can ? '<button class="secondary-btn" type="button" data-save-school>저장</button>' : ''}</div></div>`;
  }).join('');
  if (!can) for (const el of $('hsSchools').querySelectorAll('input,select')) el.disabled = true;
}

// ── 화면 전환 ──
function setActions(html) { $('hsActions').innerHTML = html; }
function show(view) {
  $('hsList').hidden = view !== 'list';
  form.hidden = view !== 'form';
  $('hsReportView').hidden = view !== 'report';
}
async function route() {
  notice('');
  const hash = decodeURIComponent(location.hash.slice(1));
  const [kind, id] = hash.split('=');
  const found = id ? state.students.find((s) => s.id === id) : null;
  if (kind === 'new' || (kind === 'edit' && found)) {
    $('hsTitle').textContent = found ? `${found.name} · 상담 입력` : '새 상담 입력';
    setActions(`<button class="secondary-btn" type="button" data-act="list">목록</button>${found && (found.createdBy === state.me || state.canManage) ? '<button class="ghost-btn danger" type="button" data-act="delete">삭제</button>' : ''}<button class="secondary-btn" type="button" data-act="save">저장</button><button class="primary-btn" type="button" data-act="make">상담 자료 만들기</button>`);
    if (state.current?.id !== found?.id || kind === 'new' || !state.dirty) fillForm(found ? structuredClone(found) : { grade: 3, wishes: [] });
    show('form');
  } else if (kind === 'report' && found) {
    $('hsTitle').textContent = `${found.name} · 상담 자료`;
    setActions('<button class="secondary-btn" type="button" data-act="list">목록</button><a class="secondary-btn" href="#edit=' + encodeURIComponent(found.id) + '">입력 고치기</a><button class="primary-btn" type="button" data-act="print">인쇄 · PDF 저장</button>');
    state.current = found; state.dirty = false;
    showReport(found);
    show('report');
  } else {
    $('hsTitle').textContent = '고교 진학 상담';
    setActions('');
    renderList();
    show('list');
  }
  window.scrollTo(0, 0);
}

document.addEventListener('click', async (event) => {
  const act = event.target.closest('[data-act]')?.dataset.act;
  try {
    if (act === 'list') { if (!state.dirty || confirm('저장하지 않은 내용이 있습니다. 목록으로 갈까요?')) { state.dirty = false; location.hash = ''; } }
    if (act === 'save') { const saved = await save(); if (saved) { history.replaceState(null, '', `#edit=${encodeURIComponent(saved.id)}`); route(); notice(`${saved.name} 학생을 저장했습니다.`); } }
    if (act === 'make') { const saved = await save(); if (saved) location.hash = `report=${encodeURIComponent(saved.id)}`; }
    if (act === 'print') window.print();
    if (act === 'delete' && state.current?.id && confirm(`${state.current.name} 학생 상담을 지울까요?`)) {
      await api(`/students/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
      state.students = state.students.filter((s) => s.id !== state.current.id);
      state.dirty = false; state.current = null; location.hash = '';
    }
  } catch (error) { notice(error.message, 'warn'); }
  const drop = event.target.closest('[data-drop-sem]')?.dataset.dropSem;
  if (drop) { const s = readForm(); delete s.grades[drop]; state.extraSems?.delete(drop); state.current = s; renderGrades(s); state.dirty = true; }
  const saveSchool = event.target.closest('[data-save-school]');
  if (saveSchool) {
    const box = saveSchool.closest('.hs-school');
    try {
      const academy = readSeg(box.querySelector('.hs-seg'));
      const r = await api('/schools', { method: 'PATCH', body: JSON.stringify({ name: box.dataset.name, review: box.querySelector('[data-f=review]').value, academy }) });
      state.schools = r.schools;
      saveSchool.textContent = '저장됨';
    } catch (error) { alert(error.message); }
  }
});
$('hsNewBtn').addEventListener('click', () => { state.current = null; state.dirty = false; location.hash = 'new'; });
$('hsSearch').addEventListener('input', renderList);
$('hsSchoolsBtn').addEventListener('click', () => { renderSchools(); $('hsSchoolsDialog').showModal(); });
$('hsSemAddBtn').addEventListener('click', () => { const s = readForm(); const sem = $('hsSemAdd').value; if (!sem) return; state.extraSems.add(sem); s.grades[sem] ||= {}; state.current = s; renderGrades(s); });
$('hsPhoto').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) readPhotos(files); });
$('hsRouteBtn').addEventListener('click', autoRoutes);
$('hsWithGuide').addEventListener('change', () => state.current && showReport(state.current));
form.addEventListener('input', (e) => { state.dirty = true; if (e.target.name === 'address') renderRegion(); if (e.target.closest('#hsGrades') || e.target.name === 'bandManual') renderBand(); });
form.addEventListener('change', (e) => { state.dirty = true; if (e.target.matches('[data-wish],[data-extra]') || e.target.name === 'region' || e.target.name === 'address') refreshDerived(); else if (e.target.closest('#hsCommute .hs-seg')) refreshTotals(); if (e.target.name === 'bandManual') renderBand(); });
form.addEventListener('submit', (e) => e.preventDefault());
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('beforeprint', () => { $('hsPrint').innerHTML = $('hsReport').innerHTML; document.body.classList.add('hs-printing'); });
window.addEventListener('afterprint', () => { document.body.classList.remove('hs-printing'); $('hsPrint').innerHTML = ''; });

(async () => {
  try {
    const r = await api('');
    Object.assign(state, { students: r.students || [], schools: r.schools, canManage: r.canManage, me: r.me, kakao: r.kakao });
    route();
  } catch (error) { $('hsRows').innerHTML = `<p class="hs-empty">${esc(error.message)}</p>`; }
})();

// 고교 진학 상담 화면: 이름·학교·주소·캠퍼스·1~5지망·성적표 사진만 넣으면 → A4 9쪽 상담 자료 → PDF·이미지로 바로 저장.
// 성적표 사진은 학년·학기를 스스로 나눠 채우고, 통학은 상담 자료를 만들 때 카카오맵으로 자동 계산한다.
// 화면 상태는 주소 #의 뒷부분으로 나눈다(#new, #edit=ID, #report=ID). 뒤로 가기가 한 단계씩 돌아간다.
import { renderReport, gradeBook, SEMS, SUBJECTS, esc } from './highschool-report.js?v=20261016-hs4';
import { savePdf, saveImages } from './highschool-export.js?v=20261016-hs4';

const API = '/api/data-core/highschool';
const $ = (id) => document.getElementById(id);
const form = $('hsForm');
const state = { students: [], schools: null, canManage: false, me: '', kakao: false, current: null, dirty: false };
const SEM_LABEL = { '1-1': '중1 1학기', '1-2': '중1 2학기', '2-1': '중2 1학기', '2-2': '중2 2학기', '3-1': '중3 1학기', '3-2': '중3 2학기' };
// 진학 연도: 3월부터는 다음 해 고등학교 진학(2026년 10월 → 2027학년도)
const ENTRY_YEAR = new Date().getMonth() >= 2 ? new Date().getFullYear() + 1 : new Date().getFullYear();

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
const campuses = () => state.schools?.academies || [];
const campusName = (id) => campuses().find((c) => c.campusId === id)?.name || '';
const dn = (name) => schoolList().find((s) => s.name === name)?.display || name;

// ── 목록: 학생 이름 · 캠퍼스로 찾기 ──
function renderList() {
  $('hsCampusFilterBox').hidden = campuses().length < 2;
  const filter = $('hsCampusFilter');
  if (!filter.options.length) filter.innerHTML = `<option value="">전체 캠퍼스</option>${campuses().map((c) => `<option value="${esc(c.campusId)}">${esc(c.name)}</option>`).join('')}`;
  const q = $('hsSearch').value.trim(), campus = filter.value;
  const rows = state.students.filter((s) => (!q || String(s.name).includes(q)) && (!campus || s.campusId === campus));
  $('hsRows').innerHTML = rows.length ? rows.map((s) => `<article class="hs-row">
    <div class="hs-who"><strong>${esc(s.name)}</strong><small>${esc(s.middleSchool || '')}</small></div>
    <div class="hs-where"><small>${esc(campusName(s.campusId))}</small><small>${esc((s.wishes || []).filter(Boolean).map(dn).join(' → ') || '지망 미입력')}</small></div>
    <div class="hs-row-actions"><a class="secondary-btn" href="#edit=${encodeURIComponent(s.id)}">입력 고치기</a><a class="primary-btn" href="#report=${encodeURIComponent(s.id)}">자료 보기</a></div>
  </article>`).join('') : `<p class="hs-empty">${q || campus ? '찾는 학생이 없습니다.' : '아직 상담 학생이 없습니다. ‘＋ 새 상담’으로 시작하세요.'}</p>`;
}

// ── 입력 ──
function schoolOptions(selected) {
  const groups = [['부천', (s) => s.region === '부천' && !s.special], ['인천', (s) => s.region === '인천' && !s.special], ['특성화고', (s) => s.special]];
  const known = !selected || schoolList().some((s) => s.name === selected);
  return `<option value="">선택 안 함</option>${known ? '' : `<option selected>${esc(selected)}</option>`}${groups.map(([label, f]) => `<optgroup label="${label}">${schoolList().filter(f).map((s) => `<option value="${esc(s.name)}"${s.name === selected ? ' selected' : ''}>${esc(s.display || s.name)}</option>`).join('')}</optgroup>`).join('')}`;
}
function renderCampus(selected) {
  $('hsCampus').innerHTML = campuses().map((c) => `<button type="button" class="hs-campus-chip" role="radio" aria-checked="${c.campusId === selected}" data-campus="${esc(c.campusId)}">${esc(c.name)}</button>`).join('');
}
const selectedCampus = () => $('hsCampus').querySelector('[aria-checked=true]')?.dataset.campus || '';
function renderGradeStatus(s) {
  const book = gradeBook(s);
  $('hsPhotoStatus').textContent = book.sems.length
    ? `읽은 성적: ${book.sems.map((q) => `${SEM_LABEL[q]}(${Object.keys(s.grades[q]).length}과목)`).join(' · ')}`
    : '성적통지표를 찍어 올리면 학년·학기를 스스로 나눠 과목별 점수·과목평균·성취도를 채웁니다. 여러 장을 한 번에 넣어도 됩니다.';
}
function readForm() {
  const f = new FormData(form);
  const base = state.current || {};
  return {
    ...base,
    name: String(f.get('name') || '').trim(), middleSchool: String(f.get('middleSchool') || '').trim(), address: String(f.get('address') || '').trim(),
    campusId: selectedCampus(), grade: base.grade || 3, entryYear: base.entryYear || ENTRY_YEAR,
    wishes: [...form.querySelectorAll('[data-wish]')].map((el) => el.value),
    grades: base.grades || {}, commute: base.commute || {},
  };
}
function fillForm(s) {
  state.current = s;
  form.elements.name.value = s.name || '';
  form.elements.middleSchool.value = s.middleSchool || '';
  form.elements.address.value = s.address || '';
  renderCampus(s.campusId || (campuses().length === 1 ? campuses()[0].campusId : ''));
  $('hsWishes').innerHTML = [0, 1, 2, 3, 4].map((i) => `<label><span>${i + 1}지망</span><select data-wish="${i}">${schoolOptions((s.wishes || [])[i] || '')}</select></label>`).join('');
  renderGradeStatus(s);
  state.dirty = false;
}

async function save(s) {
  const body = JSON.stringify({ student: s });
  const res = s.id ? await api(`/students/${encodeURIComponent(s.id)}`, { method: 'PATCH', body }) : await api('/students', { method: 'POST', body });
  const saved = res.student;
  state.students = [saved, ...state.students.filter((x) => x.id !== saved.id)];
  state.current = saved; state.dirty = false;
  return saved;
}

// 성적표 사진: 2400px JPEG로 줄여 한 장씩 읽고, 학년·학기·과목 칸에 채운다
async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 줄이지 못했습니다.'))), 'image/jpeg', 0.86));
}
// 학년이 안 찍힌 성적표는 학년도로 학년을 정한다(지금 학년을 다니는 해 = 진학 연도 - 1)
function semOf(row, student) {
  let grade = Number(row.grade) || 0;
  if (!grade && row.academicYear) grade = (Number(student.grade) || 3) - ((Number(student.entryYear) || ENTRY_YEAR) - 1 - Number(row.academicYear));
  const sem = `${grade}-${Number(row.semester) || 0}`;
  return SEMS.includes(sem) ? sem : '';
}
async function readPhotos(files) {
  const status = $('hsPhotoStatus');
  const s = readForm();
  const grades = structuredClone(s.grades || {});
  const notes = [];
  let skipped = 0;
  for (const [i, file] of [...files].entries()) {
    status.textContent = `사진 ${i + 1}/${files.length} 읽는 중… (한 장에 20~40초)`;
    try {
      const body = new FormData();
      body.append('image', await shrink(file), 'grade.jpg');
      body.append('gradeHint', `지금 중학교 ${s.grade || 3}학년, ${(s.entryYear || ENTRY_YEAR) - 1}학년도`);
      const r = await api('/grade-photo', { method: 'POST', body });
      if (r.kind !== 'report') { notes.push(`${i + 1}번째 사진은 성적표가 아닌 것 같습니다`); continue; }
      if (!form.elements.middleSchool.value && r.school) form.elements.middleSchool.value = r.school;
      for (const row of r.rows) {
        if (!SUBJECTS.includes(row.subject)) continue; // 기술·가정·예체능 등은 상담 자료에 쓰지 않는다
        const sem = semOf(row, s);
        if (!sem) { skipped++; continue; }
        (grades[sem] ??= {})[row.subject] = { s: row.s, m: row.m, a: row.a };
      }
    } catch (error) { notes.push(`${i + 1}번째 사진: ${error.message}`); }
  }
  state.current = { ...readForm(), grades }; state.dirty = true;
  renderGradeStatus(state.current);
  if (skipped) notes.unshift(`학년·학기를 알 수 없는 ${skipped}과목은 넣지 않았습니다(학년·학기가 보이게 다시 찍어 주세요)`);
  if (notes.length) status.textContent += ` — ${notes.join(' / ')}`;
}

// 통학: 주소·캠퍼스·지망이 바뀌었거나 아직 없으면 카카오맵으로 다시 찾는다
async function ensureRoutes(s) {
  const names = [...new Set(s.wishes.filter(Boolean))];
  const key = `${s.address}|${s.campusId}`;
  const have = s.commute?.key === key && names.every((n) => s.commute.schools?.[n]?.home);
  if (!state.kakao || !s.address || !names.length || have) return s;
  const r = await api('/routes', { method: 'POST', body: JSON.stringify({ address: s.address, campusId: s.campusId, schools: names }) });
  const schools = {};
  for (const n of names) if (r.schools[n]) schools[n] = { home: r.schools[n].home, academy: r.schools[n].academy };
  return { ...s, commute: { key, checkedAt: r.checkedAt, back: r.back, schools } };
}
async function makeReport() {
  let s = readForm();
  if (!s.name) { form.elements.name.focus(); throw new Error('학생 이름을 넣어 주세요.'); }
  if (!s.campusId) throw new Error('캠퍼스를 골라 주세요.');
  const button = document.querySelector('[data-act=make]');
  if (button) button.disabled = true;
  try {
    if (state.reading) { notice('성적표 사진을 다 읽을 때까지 기다리는 중…'); await state.reading; s = readForm(); }
    notice('통학 시간을 찾고 자료를 만드는 중…');
    try { s = await ensureRoutes(s); } catch (error) { notice(`통학 시간을 찾지 못했습니다: ${error.message} (통학은 ‘미확인’으로 나옵니다)`, 'warn'); }
    const saved = await save(s);
    location.hash = `report=${encodeURIComponent(saved.id)}`;
  } finally { if (button) button.disabled = false; }
}

// ── 결과: 9쪽 → PDF·이미지 저장 ──
let reportPages = [];
function showReport(s) {
  const { pages } = renderReport(s, state.schools);
  const box = $('hsReport');
  box.innerHTML = pages.map((p) => p.html).join('\n');
  reportPages = [...box.children].map((section, i) => ({ name: pages[i].name, section }));
  fitReport();
}
// 휴대폰에서는 A4 쪽을 화면 너비에 맞춰 줄여 보여 준다(저장은 원래 크기)
function fitReport() {
  const box = $('hsReport'), width = box.parentElement.clientWidth;
  box.style.zoom = width && width < 830 ? String(Math.max(0.3, (width - 8) / 820)) : '';
}
async function exportReport(kind) {
  const s = state.current, status = $('hsSaveStatus');
  const buttons = [...document.querySelectorAll('[data-act=pdf],[data-act=images]')];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await (kind === 'pdf' ? savePdf : saveImages)(s.name, reportPages, (i, n) => { status.textContent = `${kind === 'pdf' ? 'PDF' : '이미지'} 만드는 중… ${i}/${n}쪽`; });
    status.textContent = kind === 'pdf' ? 'PDF를 저장했습니다.' : `쪽별 이미지 ${reportPages.length}장을 한 파일(zip)로 저장했습니다.`;
  } catch (error) { status.textContent = `저장하지 못했습니다: ${error.message}`; }
  finally { buttons.forEach((b) => { b.disabled = false; }); }
}

// ── 화면 전환 ──
function show(view) {
  $('hsList').hidden = view !== 'list';
  form.hidden = view !== 'form';
  $('hsReportView').hidden = view !== 'report';
}
function route() {
  notice('');
  const [kind, id] = decodeURIComponent(location.hash.slice(1)).split('=');
  const found = id ? state.students.find((s) => s.id === id) : null;
  if (kind === 'new' || (kind === 'edit' && found)) {
    $('hsTitle').textContent = found ? `${found.name} · 상담 입력` : '새 상담';
    $('hsActions').innerHTML = `<button class="secondary-btn" type="button" data-act="list">목록</button>${found && (found.createdBy === state.me || state.canManage) ? '<button class="ghost-btn danger" type="button" data-act="delete">삭제</button>' : ''}<button class="primary-btn" type="button" data-act="make">상담 자료 만들기</button>`;
    if (kind === 'new' || state.current?.id !== found?.id || !state.dirty) fillForm(found ? structuredClone(found) : { grade: 3, entryYear: ENTRY_YEAR, wishes: [] });
    show('form');
  } else if (kind === 'report' && found) {
    $('hsTitle').textContent = `${found.name} · 상담 자료`;
    $('hsActions').innerHTML = `<button class="secondary-btn" type="button" data-act="list">목록</button><a class="secondary-btn" href="#edit=${encodeURIComponent(found.id)}">입력 고치기</a><button class="secondary-btn" type="button" data-act="images">이미지 저장</button><button class="primary-btn" type="button" data-act="pdf">PDF 저장</button>`;
    state.current = found; state.dirty = false;
    $('hsSaveStatus').textContent = '';
    showReport(found);
    show('report');
  } else {
    $('hsTitle').textContent = '고교 진학 상담';
    $('hsActions').innerHTML = '';
    renderList();
    show('list');
  }
  window.scrollTo(0, 0);
}

document.addEventListener('click', async (event) => {
  const chip = event.target.closest('[data-campus]');
  if (chip) { for (const b of $('hsCampus').children) b.setAttribute('aria-checked', String(b === chip)); state.dirty = true; return; }
  const act = event.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  try {
    if (act === 'list' && (!state.dirty || confirm('저장하지 않은 내용이 있습니다. 목록으로 갈까요?'))) { state.dirty = false; location.hash = ''; }
    if (act === 'make') await makeReport();
    if (act === 'pdf' || act === 'images') await exportReport(act);
    if (act === 'delete' && state.current?.id && confirm(`${state.current.name} 학생 상담을 지울까요?`)) {
      await api(`/students/${encodeURIComponent(state.current.id)}`, { method: 'DELETE' });
      state.students = state.students.filter((s) => s.id !== state.current.id);
      state.dirty = false; state.current = null; location.hash = '';
    }
  } catch (error) { notice(error.message, 'warn'); }
});
$('hsNewBtn').addEventListener('click', () => { state.current = null; state.dirty = false; location.hash = 'new'; });
$('hsSearch').addEventListener('input', renderList);
$('hsCampusFilter').addEventListener('change', renderList);
// 사진을 읽는 동안 '상담 자료 만들기'를 누르면 다 읽을 때까지 기다렸다가 만든다(성적이 빠지지 않게)
$('hsPhoto').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const reading = (state.reading || Promise.resolve()).then(() => readPhotos(files)).finally(() => { if (state.reading === reading) state.reading = null; });
  state.reading = reading;
});
form.addEventListener('input', () => { state.dirty = true; });
form.addEventListener('change', () => { state.dirty = true; });
form.addEventListener('submit', (e) => e.preventDefault());
window.addEventListener('hashchange', route);
window.addEventListener('resize', fitReport);
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try {
    const r = await api('');
    Object.assign(state, { students: r.students || [], schools: r.schools, canManage: r.canManage, me: r.me, kakao: r.kakao });
    route();
  } catch (error) { $('hsRows').innerHTML = `<p class="hs-empty">${esc(error.message)}</p>`; }
})();

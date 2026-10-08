// 월간 업무보고: every staff member writes one report a month and reads everyone's, with 공감, 댓글 and 읽음.
import { shiftMonth } from './fixed-task-rules.js?v=20261008-reports';

const $ = id => document.getElementById(id);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATEGORIES = ['행사', '홍보', '수업', '상담', '운영'];
const GRADES = ['초', '중1', '중2', '중3', '고1', '고2', '고3'];
const TAG = { 행사: 't-event', 홍보: 't-promo', 수업: 't-class', 상담: 't-consult', 운영: 't-ops' };
const state = { context: null, campuses: [], month: '', campus: '', category: '', q: '', data: null, open: new Set(), details: new Map(), editing: null, photos: [], busy: false };

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) { const error = new Error(body?.error || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error; }
  return body;
}
function toast(message, type = 'success') { const el = $('toast'); el.textContent = message; el.className = `toast ${type}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 3200); }
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const todayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const monthLabel = month => `${Number(month.slice(5))}월`;
const dateLabel = iso => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(iso.length === 10 ? iso + 'T00:00:00+09:00' : iso));
const timeLabel = iso => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const photoUrl = key => '/api/data-core/staff-reports/photos/' + key.split('/').slice(1).map(encodeURIComponent).join('/');
const gradeText = counts => GRADES.filter(g => counts?.[g]).map(g => `${g} ${counts[g]}`).join(' · ');
const total = counts => GRADES.reduce((sum, g) => sum + (Number(counts?.[g]) || 0), 0);
const awardTotal = awards => (awards || []).reduce((sum, a) => sum + (Number(a.count) || 1), 0);

function showNotice(message) { const el = $('reportNotice'); el.textContent = message; el.classList.toggle('hidden', !message); }

async function init() {
  // A report is usually written early in the next month, so the page opens on last month.
  state.month = shiftMonth(todayKey().slice(0, 7), -1);
  $('reportMonth').value = state.month;
  try {
    state.context = await api('/api/data-core/context');
    window.DataCoreWorkNavigation?.setContext(state.context);
    const chip = $('userChip');
    if (!state.context?.authenticated) { chip.querySelector('strong').textContent = '로그인이 필요합니다'; showNotice('월간 업무보고를 보려면 로그인해야 합니다.'); return; }
    chip.querySelector('strong').textContent = state.context.user?.displayName || '직원';
    chip.querySelector('small').textContent = (state.context.memberships || []).map(m => m.campusName).filter(Boolean)[0] || (state.context.isSuperAdmin ? 'MASTER' : '');
    chip.querySelector('.avatar').textContent = (state.context.user?.displayName || 'H').slice(0, 1);
    if (!state.context.canWrite) { showNotice('DATA CORE 사용 권한이 아직 부여되지 않았습니다.'); return; }
    state.campuses = (await api('/api/data-core/campuses')).campuses || [];
  } catch (error) { showNotice(error.message); return; }
  await load();
}

function renderCampusChips() {
  const seen = new Map((state.data?.reports || []).map(r => [r.campusId, r.campusName]));
  if (state.campus && !seen.has(state.campus)) seen.set(state.campus, state.campuses.find(c => c.id === state.campus)?.name || '');
  const chips = [['', '전체 캠퍼스'], ...[...seen].filter(([id]) => id)];
  $('reportCampuses').innerHTML = chips.map(([id, name]) => `<button type="button" class="report-chip" data-campus="${h(id)}" aria-pressed="${state.campus === id}">${h(name)}</button>`).join('');
}

async function load() {
  $('reportFeed').innerHTML = '<p class="report-empty">불러오는 중…</p>';
  try {
    const params = new URLSearchParams({ month: state.month });
    state.data = await api('/api/data-core/staff-reports?' + params);
  } catch (error) { $('reportFeed').innerHTML = `<p class="report-empty">${h(error.message)}</p>`; return; }
  render();
}

const matches = report => {
  if (state.campus && report.campusId !== state.campus) return false;
  const b = report.body || {}, lines = [...(b.done || []), ...(b.planned || [])];
  if (state.category && !lines.some(line => line.category === state.category)) return false;
  if (!state.q) return true;
  const all = [report.authorName, report.campusName, ...lines.map(l => l.text), ...(b.classes || []).map(l => l.text), ...(b.awards || []).map(a => `${a.contest} ${a.prize}`)].join('\n').toLocaleLowerCase();
  return all.includes(state.q.toLocaleLowerCase());
};

function lineHtml(line) { return `<div class="report-line">${line.category ? `<span class="report-tag ${TAG[line.category] || ''}">${h(line.category)}</span>` : ''}<span>${h(line.text)}</span></div>`; }

function cardHtml(report) {
  const b = report.body || {}, open = state.open.has(report.id), detail = state.details.get(report.id);
  const done = b.done || [], shown = open ? done : done.slice(0, 3);
  const photos = b.photos || [];
  const sections = open ? `${(b.planned || []).length ? `<div class="report-sec"><h4>예정업무</h4>${b.planned.map(lineHtml).join('')}</div>` : ''}
      ${(b.classes || []).length ? `<div class="report-sec"><h4>수업내용</h4>${b.classes.map(lineHtml).join('')}</div>` : ''}
      ${(b.awards || []).length ? `<div class="report-sec"><h4>수상·성과</h4>${b.awards.map(a => `<div class="report-line"><span>🏆 ${h(a.contest)} · ${h(a.prize)}${a.count ? ` · ${h(a.count)}명` : ''}</span></div>`).join('')}</div>` : ''}` : '';
  const rest = Math.max(0, done.length - 3) + (b.planned || []).length + (b.classes || []).length + (b.awards || []).length;
  const comments = open && detail ? `<div class="report-comments">${detail.comments.map(c => `<div class="report-comment"><b>${h(c.authorName)}</b> ${h(c.body)} <small>${h(timeLabel(c.createdAt))}</small>${c.canDelete ? ` <button type="button" class="report-link" data-comment-delete="${h(c.id)}" data-report="${h(report.id)}">지우기</button>` : ''}</div>`).join('')}
      <form class="report-comment-form" data-comment-form="${h(report.id)}"><input name="body" maxlength="1000" placeholder="댓글 쓰기" aria-label="댓글 쓰기" required><button class="ghost-btn" type="submit">등록</button></form></div>` : '';
  return `<article class="report-item" data-report-id="${h(report.id)}">
    <header class="report-who"><span class="report-avatar">${h(report.authorName.slice(0, 1))}</span><div><b>${h(report.authorName)}</b> <span>${h(report.campusName)}</span><small>${h(timeLabel(report.createdAt))}${report.updatedAt !== report.createdAt ? ' · 수정됨' : ''}</small></div>
      <span class="report-badge">${h(monthLabel(report.month))} 업무보고</span>${report.canManage ? `<button type="button" class="report-link" data-edit="${h(report.id)}">수정</button><button type="button" class="report-link danger" data-delete="${h(report.id)}">삭제</button>` : ''}</header>
    ${done.length ? `<div class="report-sec"><h4>진행업무</h4>${shown.map(lineHtml).join('')}</div>` : ''}
    ${sections}
    ${!open && rest ? `<button type="button" class="report-link report-more" data-open="${h(report.id)}">…더보기 (${rest}줄 더)</button>` : !open ? `<button type="button" class="report-link report-more" data-open="${h(report.id)}">자세히 보기</button>` : `<button type="button" class="report-link report-more" data-close="${h(report.id)}">접기</button>`}
    <div class="report-nums"><div><span>신입</span><b>${total(b.joins)}</b><small>${h(gradeText(b.joins)) || '-'}</small></div><div><span>퇴원</span><b>${total(b.leaves)}</b><small>${h(gradeText(b.leaves)) || '-'}</small></div><div><span>수상</span><b>${awardTotal(b.awards)}</b><small>${h(b.awards?.[0] ? `${b.awards[0].contest} ${b.awards[0].prize}${b.awards.length > 1 ? ' 외' : ''}` : '-')}</small></div></div>
    ${photos.length ? `<div class="report-photo-grid${photos.length === 1 ? ' one' : open ? ' all' : ''}">${(open ? photos : photos.slice(0, 3)).map((key, i) => `<button type="button" class="report-photo" data-photo="${h(key)}" aria-label="사진 ${i + 1} 크게 보기"><img loading="lazy" src="${h(photoUrl(key))}" alt="">${!open && i === 2 && photos.length > 3 ? `<span>+${photos.length - 3}</span>` : ''}</button>`).join('')}</div>` : ''}
    <footer class="report-foot"><button type="button" class="report-react" data-react="${h(report.id)}" aria-pressed="${report.reacted}">👏 공감 ${report.reactionCount}</button><button type="button" class="report-link" data-open="${h(report.id)}">💬 댓글 ${report.commentCount}</button><button type="button" class="report-read" data-readers="${h(report.id)}">${report.readCount}명 읽음 ›</button></footer>
    ${comments}
  </article>`;
}

function render() {
  const data = state.data; if (!data) return;
  renderCampusChips();
  const reports = data.reports.filter(matches);
  $('reportFeed').innerHTML = reports.length ? reports.map(cardHtml).join('') : `<p class="report-empty">${data.reports.length ? '조건에 맞는 업무보고가 없습니다.' : `${monthLabel(state.month)} 업무보고가 아직 없습니다. 첫 보고를 써 보세요.`}</p>`;
  const deadline = data.deadline, days = Math.round((Date.parse(deadline) - Date.parse(todayKey())) / 86400000);
  const ratio = data.staffCount ? Math.min(100, Math.round(data.submittedCount / data.staffCount * 100)) : 0;
  $('reportSubmit').innerHTML = `<h3>${h(monthLabel(state.month))} 제출 현황 <small>마감 ${h(dateLabel(deadline))}</small></h3>
    <p class="report-big">${data.submittedCount}<small> / ${data.staffCount}명 제출</small></p><div class="report-bar"><i style="width:${ratio}%"></i></div>
    <p class="report-hint">${days > 0 ? `마감까지 ${days}일 남았어요.` : days === 0 ? '오늘이 마감일이에요.' : '마감일이 지났어요.'} 마감일은 매월 첫째 주 토요일(첫 주가 3일 이하면 다음 주 토요일)이에요.</p>`;
  const all = data.reports.filter(r => !state.campus || r.campusId === state.campus);
  $('reportTotals').innerHTML = `<h3>${h(monthLabel(state.month))} 합계 <small>${state.campus ? '선택한 캠퍼스' : '전체 캠퍼스'} · 자동</small></h3>
    <div class="report-row"><span>신입</span><b class="ok">+${all.reduce((s, r) => s + total(r.body?.joins), 0)}명</b></div>
    <div class="report-row"><span>퇴원</span><b class="warn">−${all.reduce((s, r) => s + total(r.body?.leaves), 0)}명</b></div>
    <div class="report-row"><span>수상·입상</span><b>${all.reduce((s, r) => s + awardTotal(r.body?.awards), 0)}건</b></div>`;
  $('reportWriteBtn').textContent = data.reports.some(r => r.mine) ? `내 ${monthLabel(state.month)} 업무보고 고치기` : `＋ ${monthLabel(state.month)} 업무보고 쓰기`;
}

async function openReport(id) {
  state.open.add(id);
  try { state.details.set(id, await api(`/api/data-core/staff-reports/${encodeURIComponent(id)}?read=1`)); patch(state.details.get(id).report); }
  catch (error) { toast(error.message, 'error'); }
  render();
}
function patch(report) { if (!state.data) return; const i = state.data.reports.findIndex(r => r.id === report.id); if (i >= 0) state.data.reports[i] = report; }

// ---------- editor ----------
function rowHtml(kind, item = {}) {
  const category = kind === 'done' || kind === 'planned';
  if (kind === 'awards') return `<div class="report-edit-row award"><input data-k="contest" maxlength="120" placeholder="대회명" value="${h(item.contest)}" aria-label="대회명"><input data-k="prize" maxlength="60" placeholder="상" value="${h(item.prize)}" aria-label="상"><input data-k="count" type="number" min="0" max="999" placeholder="인원" value="${h(item.count || '')}" aria-label="인원"><button type="button" class="report-x" data-remove aria-label="이 칸 삭제">×</button></div>`;
  return `<div class="report-edit-row">${category ? `<select data-k="category" aria-label="분류">${CATEGORIES.map(c => `<option${c === (item.category || '운영') ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}<input data-k="text" maxlength="300" placeholder="한 줄로 적어 주세요" value="${h(item.text)}" aria-label="내용"><button type="button" class="report-x" data-remove aria-label="이 칸 삭제">×</button></div>`;
}
const LISTS = { done: 'reportDone', planned: 'reportPlanned', classes: 'reportClasses', awards: 'reportAwards' };
function addRow(kind, item, focus = false) {
  $(LISTS[kind]).insertAdjacentHTML('beforeend', rowHtml(kind, item));
  if (focus) $(LISTS[kind]).lastElementChild.querySelector('input')?.focus();
}
function renderCounts(joins = {}, leaves = {}) {
  $('reportCounts').innerHTML = `<tr><th></th>${GRADES.map(g => `<th>${g}</th>`).join('')}</tr>` + [['joins', '신입', joins], ['leaves', '퇴원', leaves]].map(([k, label, v]) => `<tr><th>${label}</th>${GRADES.map(g => `<td><input type="number" inputmode="numeric" min="0" max="999" data-count="${k}" data-grade="${g}" value="${v[g] || ''}" aria-label="${label} ${g}"></td>`).join('')}</tr>`).join('');
  countSummary();
}
function countValues(kind) { return Object.fromEntries(GRADES.map(g => [g, Number($('reportCounts').querySelector(`[data-count="${kind}"][data-grade="${g}"]`)?.value) || 0])); }
function countSummary() { const j = countValues('joins'), l = countValues('leaves'); $('reportCountSummary').textContent = `신입 ${total(j)}명${gradeText(j) ? ` (${gradeText(j)})` : ''} · 퇴원 ${total(l)}명${gradeText(l) ? ` (${gradeText(l)})` : ''}`; }
function renderPhotos() { $('reportPhotos').innerHTML = state.photos.map((key, i) => `<div class="report-photo-edit"><img src="${h(photoUrl(key))}" alt="사진 ${i + 1}"><button type="button" class="report-x" data-photo-remove="${i}" aria-label="사진 ${i + 1} 빼기">×</button></div>`).join(''); }

const draftKey = () => `report-draft:${state.context?.user?.internalUserId}:${$('reportFormMonth').value}`;
function openEditor(report = null) {
  if (!state.context?.canWrite) return;
  const mine = report || state.data?.reports.find(r => r.mine) || null;
  state.editing = mine?.id || null;
  const b = mine?.body || {};
  $('reportEditorTitle').textContent = mine ? `${monthLabel(mine.month)} 업무보고 고치기` : '업무보고 쓰기';
  $('reportFormMonth').value = mine?.month || state.month;
  const campuses = state.context.isSuperAdmin ? state.campuses : state.campuses.filter(c => state.context.campusIds?.includes(c.id));
  $('reportFormCampus').innerHTML = campuses.map(c => `<option value="${h(c.id)}">${h(c.name)}</option>`).join('');
  if (mine?.campusId) $('reportFormCampus').value = mine.campusId;
  $('reportCampusField').hidden = Boolean(mine) || campuses.length < 2;
  $('reportEditorWho').textContent = `${state.context.user?.displayName || ''} (계정에서 자동)`;
  for (const id of Object.values(LISTS)) $(id).innerHTML = '';
  let draft = null;
  if (!mine) { try { draft = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { draft = null; } }
  const source = draft || b;
  for (const kind of Object.keys(LISTS)) { const items = source[kind] || []; (items.length ? items : kind === 'awards' ? [] : [{}]).forEach(item => addRow(kind, item)); }
  renderCounts(source.joins, source.leaves);
  state.photos = [...(source.photos || [])]; renderPhotos();
  $('reportFormError').textContent = draft ? '임시저장한 내용을 불러왔어요.' : '';
  $('reportEditor').showModal();
}
function collect() {
  const rows = kind => [...$(LISTS[kind]).children].map(row => Object.fromEntries([...row.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value.trim()])));
  return { month: $('reportFormMonth').value, campusId: $('reportFormCampus').value || null,
    done: rows('done').filter(r => r.text), planned: rows('planned').filter(r => r.text), classes: rows('classes').filter(r => r.text),
    awards: rows('awards').filter(r => r.contest).map(r => ({ ...r, count: Number(r.count) || 0 })), joins: countValues('joins'), leaves: countValues('leaves'), photos: state.photos };
}
async function save(event) {
  event.preventDefault(); if (state.busy) return;
  const body = collect();
  if (!body.done.length && !body.planned.length && !body.classes.length && !body.awards.length) { $('reportFormError').textContent = '진행업무·예정업무·수업내용 중 하나 이상을 적어 주세요.'; return; }
  state.busy = true; $('reportSaveBtn').disabled = true; $('reportSaveBtn').textContent = '저장 중…';
  try {
    const result = await api(state.editing ? `/api/data-core/staff-reports/${encodeURIComponent(state.editing)}` : '/api/data-core/staff-reports', json(state.editing ? 'PATCH' : 'POST', body));
    try { localStorage.removeItem(draftKey()); } catch { /* optional */ }
    $('reportEditor').close(); toast(state.editing ? '업무보고를 고쳤습니다.' : '업무보고를 게시했습니다.');
    state.month = result.report.month; $('reportMonth').value = state.month; await load();
  } catch (error) { $('reportFormError').textContent = error.message; }
  finally { state.busy = false; $('reportSaveBtn').disabled = false; $('reportSaveBtn').textContent = '게시하기'; }
}

// Photos are made smaller in the browser (long side 1600px, WEBP) before upload.
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
}
async function uploadPhotos(files) {
  for (const file of files) {
    if (state.photos.length >= 20) { toast('사진은 20장까지 올릴 수 있어요.', 'error'); break; }
    try {
      const blob = await shrink(file), form = new FormData(); form.set('file', new File([blob], 'photo.webp', { type: 'image/webp' }));
      const result = await api('/api/data-core/staff-reports/photos', { method: 'POST', body: form });
      state.photos.push(result.key); renderPhotos();
    } catch (error) { toast(error.message || '사진을 올리지 못했습니다.', 'error'); }
  }
}

// ---------- events ----------
$('reportMonth').addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test($('reportMonth').value)) { state.month = $('reportMonth').value; state.open.clear(); void load(); } });
$('reportCampuses').addEventListener('click', event => { const b = event.target.closest('[data-campus]'); if (!b) return; state.campus = b.dataset.campus; renderCampusChips(); render(); });
$('reportCategory').addEventListener('change', () => { state.category = $('reportCategory').value; render(); });
$('reportSearch').addEventListener('input', () => { state.q = $('reportSearch').value.trim(); render(); });
$('reportWriteBtn').addEventListener('click', () => openEditor());
$('reportFeed').addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.dataset.open) return openReport(b.dataset.open);
  if (b.dataset.close) { state.open.delete(b.dataset.close); return render(); }
  if (b.dataset.edit) return openEditor(state.data.reports.find(r => r.id === b.dataset.edit));
  if (b.dataset.photo) { $('reportPhotoImage').src = photoUrl(b.dataset.photo); return $('reportPhotoView').showModal(); }
  if (b.dataset.delete) {
    if (!confirm('이 업무보고를 삭제할까요? 되돌릴 수 없습니다.')) return;
    try { await api(`/api/data-core/staff-reports/${encodeURIComponent(b.dataset.delete)}`, { method: 'DELETE' }); toast('업무보고를 삭제했습니다.'); await load(); } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (b.dataset.react) {
    try { const d = await api(`/api/data-core/staff-reports/${encodeURIComponent(b.dataset.react)}/reactions`, { method: 'POST' }); patch(d.report); if (state.open.has(d.report.id)) state.details.set(d.report.id, d); render(); } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (b.dataset.readers) {
    try { const d = await api(`/api/data-core/staff-reports/${encodeURIComponent(b.dataset.readers)}`); $('reportReadersList').innerHTML = d.readers.length ? d.readers.map(r => `<li>${h(r.name)} <small>${h(timeLabel(r.readAt))}</small></li>`).join('') : '<li>아직 읽은 사람이 없습니다.</li>'; $('reportReaders').showModal(); } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (b.dataset.commentDelete) {
    try { const d = await api(`/api/data-core/staff-reports/${encodeURIComponent(b.dataset.report)}/comments/${encodeURIComponent(b.dataset.commentDelete)}`, { method: 'DELETE' }); state.details.set(d.report.id, d); patch(d.report); render(); } catch (error) { toast(error.message, 'error'); }
  }
});
$('reportFeed').addEventListener('submit', async event => {
  const form = event.target.closest('[data-comment-form]'); if (!form) return; event.preventDefault();
  const body = form.elements.body.value.trim(); if (!body) return;
  try { const d = await api(`/api/data-core/staff-reports/${encodeURIComponent(form.dataset.commentForm)}/comments`, json('POST', { body })); state.details.set(d.report.id, d); patch(d.report); render(); } catch (error) { toast(error.message, 'error'); }
});
$('reportForm').addEventListener('submit', save);
$('reportForm').addEventListener('click', event => {
  const add = event.target.closest('[data-add]'); if (add) return addRow(add.dataset.add, {}, true);
  const remove = event.target.closest('[data-remove]'); if (remove) return remove.closest('.report-edit-row').remove();
  const photo = event.target.closest('[data-photo-remove]'); if (photo) { state.photos.splice(Number(photo.dataset.photoRemove), 1); renderPhotos(); }
});
$('reportForm').addEventListener('input', event => { if (event.target.dataset.count) countSummary(); });
$('reportPhotoInput').addEventListener('change', async () => { const files = [...$('reportPhotoInput').files]; $('reportPhotoInput').value = ''; await uploadPhotos(files); });
$('reportCancelBtn').addEventListener('click', () => $('reportEditor').close());
$('reportDraftBtn').addEventListener('click', () => { try { localStorage.setItem(draftKey(), JSON.stringify(collect())); toast('이 기기에 임시저장했어요.'); } catch { toast('임시저장을 할 수 없는 브라우저예요.', 'error'); } });
$('reportReadersClose').addEventListener('click', () => $('reportReaders').close());
$('reportPhotoClose').addEventListener('click', () => $('reportPhotoView').close());
void init();

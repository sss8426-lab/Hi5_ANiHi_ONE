// 꿈이음 보호자: 신청/동의서 · 학원 일정.
// 신청/동의서는 자녀마다 한 번 제출하고, 마감 전에는 다시 제출해 고칠 수 있습니다. 알림을 누르면 그 양식이 열립니다.
// 학원 일정은 휴일과 학원이 "학부모에게도 보이기"로 고른 일정만 보여 줍니다.
(() => {
  const familyView = document.getElementById('familyView');
  if (!familyView) return;
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const st = { key: '', box: null, list: null, form: null, child: '', month: '', schedule: null, busy: false, waiting: 0, pending: '' };
  const KIND = { application: '신청서', consent: '동의서' };
  const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
  const kstDate = iso => iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }) : '';
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = d => `${md(d)} (${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

  async function api(path, options = {}) {
    const res = await fetch(path, { cache: 'no-store', credentials: 'include', ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'), { status: res.status });
    return body;
  }
  const say = text => { const el = st.box?.querySelector('p.ft-status'); if (el) { el.textContent = text; el.hidden = !text; } };
  const fail = e => e.status === 401 ? '로그인이 필요합니다.' : e.message;

  // ---- 더보기 배지: 아직 제출하지 않은 양식 수 ----
  function paintBadges() {
    for (const el of [document.querySelector('.km-bottom [data-family-menu="more"]'), document.querySelector('.km-more [data-open="consents"]')]) {
      if (!el) continue;
      let badge = el.querySelector('.ff-badge');
      if (!st.waiting) { badge?.remove(); continue; }
      if (!badge) { badge = document.createElement('em'); badge.className = 'ft-badge ff-badge'; el.append(badge); }
      badge.textContent = String(st.waiting);
    }
  }
  async function refresh() {
    try { st.waiting = (await api('/api/family/forms')).waiting || 0; } catch { st.waiting = 0; }
    paintBadges();
  }

  // ---- 신청/동의서 ----
  function listView() {
    const d = st.list;
    const head = '<h2>신청/동의서</h2><p class="ft-intro">학원에서 보낸 신청서와 동의서입니다. 마감일 전까지 제출하고 고칠 수 있어요.</p>';
    if (!d) return `${head}<p class="km-state">불러오는 중...</p>`;
    const rows = d.forms.map(f => `<button type="button" class="ft-item${f.waiting ? ' ft-unread' : ''}" data-ff-open="${h(f.id)}">
      <span class="ft-item-top"><b>${h(f.title)}</b><em class="ft-status">${f.open ? (f.waiting ? '제출 필요' : '제출 완료') : '마감'}</em></span>
      <span class="ft-item-sub">${KIND[f.kind] || '신청서'}${f.deadline ? ` · 마감 ${h(md(f.deadline))}` : ''}</span>
      <span class="ff-kids">${f.children.map(c => `<span class="ff-kid${c.submitted ? ' ff-done' : ''}">${h(c.name)} ${c.submitted ? '제출함' : '미제출'}</span>`).join('')}</span></button>`).join('');
    return `${head}<p class="ft-status" role="status" hidden></p><div class="ft-list">${rows || '<p class="km-state">받은 신청서·동의서가 없습니다.</p>'}</div>`;
  }
  function question(q, answer, locked) {
    const name = `ff-${q.id}`, req = q.required ? ' <small class="ff-req">필수</small>' : '';
    if (q.type === 'text') return `<label class="ff-q"><span>${h(q.label)}${req}</span><textarea name="${name}" maxlength="1000" rows="3" ${locked ? 'disabled' : ''}>${h(answer || '')}</textarea></label>`;
    const multi = q.type === 'multi', picked = multi ? (Array.isArray(answer) ? answer : []) : [answer];
    return `<fieldset class="ff-q"><legend>${h(q.label)}${req}${multi ? ' <small>여러 개 고를 수 있어요</small>' : ''}</legend>${q.options.map(o => `<label class="ff-option"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${h(o)}" ${picked.includes(o) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${h(o)}</span></label>`).join('')}</fieldset>`;
  }
  function formView() {
    const d = st.form; if (!d) return '<p class="km-state">불러오는 중...</p>';
    const f = d.form, child = d.children.find(c => c.id === st.child) || d.children[0];
    const picker = d.children.length > 1 ? `<div class="ff-children" role="group" aria-label="자녀 고르기">${d.children.map(c => `<button type="button" data-ff-child="${h(c.id)}" aria-pressed="${c.id === child.id}">${h(c.name)}${c.submitted ? ' ✓' : ''}</button>`).join('')}</div>` : '';
    const locked = !f.open;
    const done = child.submitted ? `<p class="ff-done-note">${h(child.guardianName || '보호자')}님이 ${h(kstDate(child.submittedAt))}에 제출했어요.${f.open ? ' 고치려면 다시 제출하세요.' : ''}</p>` : '';
    const consent = f.kind === 'consent' ? `<fieldset class="ff-q ff-consent"><legend>위 내용에 동의하십니까? <small class="ff-req">필수</small></legend>
      <label class="ff-option"><input type="radio" name="ff-consent" value="agree" ${child.consent === 'agree' ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>동의합니다</span></label>
      <label class="ff-option"><input type="radio" name="ff-consent" value="disagree" ${child.consent === 'disagree' ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>동의하지 않음</span></label></fieldset>` : '';
    return `<button type="button" class="secondary-button ft-back" data-ff-back>신청/동의서 목록</button>
      <h2>${h(f.title)}</h2><p class="ft-intro">${KIND[f.kind] || '신청서'} · ${h(f.createdByName)}${f.deadline ? ` · 마감 ${h(dayLabel(f.deadline))}` : ''}${f.open ? '' : ' · 마감됨'}</p>
      ${f.body ? `<div class="ff-body">${h(f.body)}</div>` : ''}${picker}
      <form class="ft-compose ff-form" data-ff-form><input type="hidden" name="studentId" value="${h(child.id)}">
        <p class="ff-for">${h(child.name)} 몫으로 제출합니다.</p>${done}
        ${f.questions.map(q => question(q, child.answers[q.id], locked)).join('')}${consent}
        <p class="ft-status" role="status" hidden></p>
        ${f.open ? `<button type="submit" class="primary-button" ${st.busy ? 'disabled' : ''}>${child.submitted ? '다시 제출하기' : '제출하기'}</button>` : '<p class="km-state">마감된 양식이라 더 제출할 수 없어요.</p>'}</form>`;
  }

  // ---- 학원 일정 ----
  function scheduleView() {
    const month = st.month, [y, m] = month.split('-').map(Number);
    const nav = `<div class="ff-month"><button type="button" class="secondary-button" data-ff-month="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button type="button" class="secondary-button" data-ff-month="1" aria-label="다음 달">›</button></div>`;
    const head = `<h2>학원 일정</h2><p class="ft-intro">휴일과 학원 행사를 알려 드려요.</p>${nav}`;
    const d = st.schedule;
    if (!d) return `${head}<p class="km-state">불러오는 중...</p>`;
    const TAG = { holiday: '<em class="ff-tag ff-holiday">휴일</em>', 'class-day': '<em class="ff-tag ff-class">정상 수업</em>', event: '' };
    const rows = d.events.map(e => {
      const days = e.endDate && e.endDate !== e.startDate ? `${dayLabel(e.startDate)} ~ ${dayLabel(e.endDate)}` : dayLabel(e.startDate);
      const time = e.startTime ? `${e.startTime}${e.endTime ? `~${e.endTime}` : ''}` : '';
      const sub = [time, e.location, e.campusName].filter(Boolean).map(h).join(' · ');
      return `<li class="ff-event"><span class="ff-date">${h(days)}</span><span class="ff-what"><b>${h(e.title)}</b>${TAG[e.kind] || ''}${sub ? `<small>${sub}</small>` : ''}</span></li>`;
    }).join('');
    return `${head}<ul class="ff-events">${rows || '<li class="km-state">이 달에는 안내할 일정이 없습니다.</li>'}</ul>`;
  }

  function paint() {
    if (!st.box) return;
    st.box.innerHTML = `<div class="ft-wrap ff-wrap">${st.key === 'schedule' ? scheduleView() : st.form ? formView() : listView()}</div>`;
  }
  async function loadList() {
    st.form = null; st.list = null; paint();
    try { st.list = await api('/api/family/forms'); st.waiting = st.list.waiting || 0; paintBadges(); paint(); }
    catch (e) { if (st.box) st.box.innerHTML = `<p class="km-state">${h(fail(e))}</p>`; }
  }
  async function openForm(id) {
    st.form = null; paint();
    try {
      st.form = await api(`/api/family/forms/${encodeURIComponent(id)}`);
      const first = st.form.children.find(c => !c.submitted) || st.form.children[0];
      st.child = first?.id || ''; paint();
    } catch (e) { if (st.box) st.box.innerHTML = `<button type="button" class="secondary-button ft-back" data-ff-back>신청/동의서 목록</button><p class="km-state">${h(fail(e))}</p>`; }
  }
  async function loadSchedule() {
    st.schedule = null; paint();
    try { st.schedule = await api(`/api/family/schedule?month=${encodeURIComponent(st.month)}`); paint(); }
    catch (e) { if (st.box) st.box.innerHTML = `<p class="km-state">${h(fail(e))}</p>`; }
  }

  document.addEventListener('click', (e) => {
    if (!st.box || !st.box.contains(e.target)) return;
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.ffOpen) void openForm(b.dataset.ffOpen);
    if (b.hasAttribute('data-ff-back')) void loadList();
    if (b.dataset.ffChild) { st.child = b.dataset.ffChild; paint(); }
    if (b.dataset.ffMonth) {
      const [y, m] = st.month.split('-').map(Number), next = new Date(Date.UTC(y, m - 1 + Number(b.dataset.ffMonth), 1));
      st.month = next.toISOString().slice(0, 7); void loadSchedule();
    }
  });
  document.addEventListener('submit', (e) => {
    if (!st.box || !st.box.contains(e.target) || !e.target.matches('[data-ff-form]')) return;
    e.preventDefault(); if (st.busy) return;
    const f = e.target, data = new FormData(f), form = st.form.form, answers = {};
    for (const q of form.questions) {
      const values = data.getAll(`ff-${q.id}`).map(String).filter(Boolean);
      if (q.type === 'multi') answers[q.id] = values; else if (values[0]) answers[q.id] = values[0];
    }
    const body = { studentId: data.get('studentId'), answers, ...(form.kind === 'consent' ? { consent: data.get('ff-consent') || '' } : {}) };
    st.busy = true; f.querySelector('[type=submit]').disabled = true;
    api(`/api/family/forms/${encodeURIComponent(form.id)}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((next) => { st.form = next; st.busy = false; paint(); say('제출했습니다. 마감 전에는 다시 고칠 수 있어요.'); void refresh(); })
      .catch((err) => { st.busy = false; say(err.message); const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = false; });
  });

  window.FamilyForms = {
    open(key, box) {
      st.key = key; st.box = box;
      if (key === 'schedule') { st.month = st.month || new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7); void loadSchedule(); return; }
      if (st.pending) { const id = st.pending; st.pending = ''; void openForm(id); } else void loadList();
    },
    refresh,
  };

  // 신청/동의서 알림은 /family/?openForm=<id>로 열린다.
  const params = new URLSearchParams(location.search);
  const openId = params.get('openForm');
  if (openId) { params.delete('openForm'); history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`); st.pending = openId; }
  function whenVisible() {
    if (familyView.classList.contains('hidden')) return;
    void refresh();
    if (st.pending) setTimeout(() => { if (st.pending) document.querySelector('.km-more [data-open="consents"]')?.click(); }, 450);
  }
  new MutationObserver(whenVisible).observe(familyView, { attributes: true, attributeFilter: ['class'] });
  whenVisible();
})();

// 꿈이음 보호자: 소식 답변 · 답변모음 · 1:1 문의모음. Answers and 문의 are seen only by this guardian and the
// child's 학원 선생님. Photos (up to 3, 8MB each) go with a message. A push for a 학원 답장 opens the thread.
(() => {
  const familyView = document.getElementById('familyView');
  if (!familyView) return;
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STATUS = { open: '학원 확인 중', answered: '답변 도착', closed: '완료' };
  const st = { key: '', box: null, data: null, thread: null, composing: false, files: [], busy: false, unread: {}, pending: '' };
  const when = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); };

  async function api(path, options = {}) {
    const res = await fetch(path, { cache: 'no-store', credentials: 'include', ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'), { status: res.status });
    return body;
  }
  function form(body, files, fields = {}) {
    const data = new FormData();
    data.append('body', body);
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    files.forEach((f) => data.append('files', f));
    return { method: 'POST', body: data };
  }
  const say = text => { const el = st.box?.querySelector('.ft-status'); if (el) { el.textContent = text; el.hidden = !text; } };

  // ---- 하단 메뉴 배지 ----
  function paintBadges() {
    for (const [key, kind] of [['answers', 'reply'], ['inquiries', 'inquiry']]) {
      const button = document.querySelector(`.km-bottom [data-family-menu="${key}"]`); if (!button) continue;
      let badge = button.querySelector('.ft-badge'); const n = st.unread[kind] || 0;
      if (!n) { badge?.remove(); continue; }
      if (!badge) { badge = document.createElement('em'); badge.className = 'ft-badge'; button.append(badge); }
      badge.textContent = n > 99 ? '99+' : String(n);
    }
  }
  async function refreshUnread() {
    try { st.unread = (await api('/api/family/threads?kind=inquiry')).unread || {}; } catch { st.unread = {}; }
    paintBadges();
  }

  // ---- views ----
  function bubble(m) {
    const files = (m.files || []).map((f) => `<a href="/api/family/talk-files/${encodeURIComponent(f.id)}" target="_blank" rel="noopener"><img src="/api/family/talk-files/${encodeURIComponent(f.id)}" alt="첨부 사진" loading="lazy"></a>`).join('');
    const who = m.author === 'guardian' ? 'ft-me' : m.author === 'auto' ? 'ft-auto' : 'ft-them';
    const name = m.author === 'guardian' ? '나' : m.author === 'auto' ? '자동 안내' : `${m.authorName} (학원)`;
    return `<div class="ft-msg ${who}"><small>${h(name)} · ${h(when(m.createdAt))}</small>${m.body ? `<p>${h(m.body)}</p>` : ''}${files ? `<div class="ft-files">${files}</div>` : ''}</div>`;
  }
  function composer(placeholder, submit) {
    const chips = st.files.map((f, i) => `<span class="ft-chip">${h(f.name)}<button type="button" data-ft-unfile="${i}" aria-label="${h(f.name)} 빼기">×</button></span>`).join('');
    return `<form class="ft-compose" data-ft-form="${submit}"><textarea name="body" maxlength="2000" rows="3" placeholder="${h(placeholder)}" aria-label="${h(placeholder)}"></textarea>
      <div class="ft-row"><label class="ft-photo">사진 첨부<input type="file" data-ft-files accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>${chips}</div>
      <button type="submit" class="primary-button" ${st.busy ? 'disabled' : ''}>보내기</button></form>`;
  }
  function listView() {
    const d = st.data, inquiry = st.key === 'inquiries';
    const title = inquiry ? '문의모음' : '답변모음';
    const intro = inquiry ? '학원에 1:1로 문의하고 답변을 받습니다. 다른 보호자에게는 보이지 않습니다.' : '소식에 남긴 내 답변과 학원 답장을 모아 봅니다.';
    if (!d) return `<h2>${title}</h2><p class="km-state">불러오는 중...</p>`;
    const hours = inquiry ? Object.entries(d.hours || {}).filter(([, v]) => v.enabled).map(([, v]) => `<p class="ft-hours">문의 운영시간 · ${h(v.label)}${v.open ? '' : ' · 지금은 운영시간이 아니에요'}</p>`).join('') : '';
    const rows = d.threads.map((t) => `<button type="button" class="ft-item${t.unread ? ' ft-unread' : ''}" data-ft-open="${h(t.id)}">
      <span class="ft-item-top"><b>${h(t.title)}</b><em class="ft-status ft-${h(t.status)}">${t.unread ? '새 답장' : h(STATUS[t.status] || '')}</em></span>
      <span class="ft-item-sub">${h(t.studentName)} · ${h(when(t.lastMessageAt))}</span><span class="ft-item-preview">${h(t.lastPreview)}</span></button>`).join('');
    const empty = inquiry ? '아직 보낸 문의가 없습니다.' : '소식을 열고 아래 "선생님께 답변 남기기"로 답변할 수 있습니다.';
    return `<h2>${title}</h2><p class="ft-intro">${intro}</p>${hours}
      ${inquiry ? `<button type="button" class="primary-button ft-new" data-ft-new ${d.children.length ? '' : 'disabled'}>새 문의 쓰기</button>` : ''}
      <p class="ft-status" role="status" hidden></p><div class="ft-list">${rows || `<p class="km-state">${empty}</p>`}</div>`;
  }
  function newView() {
    const d = st.data, children = d.children;
    const pick = children.length > 1 ? `<label>자녀<select name="studentId">${children.map((c) => `<option value="${h(c.id)}">${h(c.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="studentId" value="${h(children[0]?.id || '')}">`;
    const closed = Object.values(d.hours || {}).some((v) => v.enabled && !v.open);
    return `<button type="button" class="secondary-button ft-back" data-ft-back>문의모음으로</button><h2>새 문의</h2>
      ${closed ? '<p class="ft-hours">지금은 학원 운영시간이 아니에요. 문의를 남기면 운영시간에 답변드려요.</p>' : ''}
      <form class="ft-compose ft-new-form" data-ft-form="inquiry">${pick}<label>제목 (선택)<input name="title" maxlength="80" placeholder="예: 다음 주 보강 문의"></label>
        <label>내용<textarea name="body" maxlength="2000" rows="6" placeholder="궁금한 점을 적어 주세요" required></textarea></label>
        <div class="ft-row"><label class="ft-photo">사진 첨부<input type="file" data-ft-files accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>${st.files.map((f, i) => `<span class="ft-chip">${h(f.name)}<button type="button" data-ft-unfile="${i}" aria-label="${h(f.name)} 빼기">×</button></span>`).join('')}</div>
        <p class="ft-status" role="status" hidden></p><button type="submit" class="primary-button" ${st.busy ? 'disabled' : ''}>문의 보내기</button></form>`;
  }
  function threadView() {
    const d = st.thread; if (!d) return '<p class="km-state">불러오는 중...</p>';
    const t = d.thread;
    return `<button type="button" class="secondary-button ft-back" data-ft-back>${t.kind === 'reply' ? '답변모음' : '문의모음'}으로</button>
      <h2>${h(t.title)}</h2><p class="ft-intro">${h(t.studentName)} · ${t.kind === 'reply' ? '소식 답변' : '1:1 문의'} · ${h(STATUS[t.status] || '')}</p>
      <div class="ft-thread">${d.messages.map(bubble).join('')}</div><p class="ft-status" role="status" hidden></p>${composer('학원에 더 남길 말', 'thread')}`;
  }
  function paint() {
    if (!st.box) return;
    // Keep what was typed (제목 · 자녀 · 내용) when the screen redraws, e.g. after picking a photo.
    const typed = new Map([...st.box.querySelectorAll('form [name]')].map((el) => [el.name, el.value]));
    st.box.innerHTML = `<div class="ft-wrap">${st.thread ? threadView() : st.composing ? newView() : listView()}</div>`;
    st.box.querySelectorAll('form [name]').forEach((el) => { if (typed.get(el.name)) el.value = typed.get(el.name); });
    const thread = st.box.querySelector('.ft-thread'); if (thread) thread.scrollTop = thread.scrollHeight;
  }

  async function loadList() {
    st.thread = null; st.composing = false; st.data = null; paint();
    try { st.data = await api(`/api/family/threads?kind=${st.key === 'inquiries' ? 'inquiry' : 'reply'}`); st.unread = st.data.unread || {}; paintBadges(); paint(); }
    catch (e) { if (st.box) st.box.innerHTML = `<p class="km-state">${h(e.status === 401 ? '로그인이 필요합니다.' : e.message)}</p>`; }
  }
  async function openThread(id) {
    st.thread = null; st.files = []; paint();
    try { st.thread = await api(`/api/family/threads/${encodeURIComponent(id)}`); paint(); void refreshUnread(); }
    catch (e) { say(e.message); }
  }
  async function run(work, done) {
    if (st.busy) return; st.busy = true;
    try { await work(); if (done) say(done); } catch (e) { say(e.status === 429 ? e.message : e.message || '보내지 못했습니다.'); } finally { st.busy = false; }
  }

  // ---- 소식 아래 "선생님께 답변 남기기" ----
  async function mountNoticeReply(announcementId, container) {
    if (container.dataset.ready) return; container.dataset.ready = '1';
    const draw = (data, files = []) => {
      const messages = data?.messages || [];
      container.innerHTML = `${messages.length ? `<div class="ft-thread ft-inline">${messages.map(bubble).join('')}</div>` : ''}
        <details class="ft-reply" ${messages.length ? 'open' : ''}><summary>선생님께 답변 남기기</summary><p class="ft-intro">답변은 학원 선생님만 볼 수 있어요.</p>
        <form class="ft-compose" data-ft-notice="${h(announcementId)}"><textarea name="body" maxlength="2000" rows="3" placeholder="소식에 대한 답변을 적어 주세요" aria-label="소식 답변"></textarea>
        <div class="ft-row"><label class="ft-photo">사진 첨부<input type="file" data-ft-notice-files accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><span class="ft-picked">${files.length ? `사진 ${files.length}장` : ''}</span></div>
        <p class="ft-status" role="status" hidden></p><button type="submit" class="primary-button">답변 보내기</button></form></details>`;
    };
    container.ftFiles = [];
    try { draw(await api(`/api/family/notices/${encodeURIComponent(announcementId)}/replies`)); } catch { draw(null); }
    container.addEventListener('change', (e) => {
      if (!e.target.matches('[data-ft-notice-files]')) return;
      container.ftFiles = [...e.target.files].slice(0, 3).filter((f) => f.size <= 8 * 1024 * 1024);
      container.querySelector('.ft-picked').textContent = container.ftFiles.length ? `사진 ${container.ftFiles.length}장` : '';
    });
    container.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target, body = f.elements.body.value.trim(), status = f.querySelector('.ft-status');
      if (!body && !container.ftFiles.length) { status.hidden = false; status.textContent = '답변을 입력해 주세요.'; return; }
      f.querySelector('[type=submit]').disabled = true;
      try { const data = await api(`/api/family/notices/${encodeURIComponent(announcementId)}/replies`, form(body, container.ftFiles)); container.ftFiles = []; draw(data);
        const s = container.querySelector('.ft-status'); s.hidden = false; s.textContent = '답변을 보냈습니다. 학원 답장은 답변모음에서 볼 수 있어요.'; }
      catch (err) { status.hidden = false; status.textContent = err.message; f.querySelector('[type=submit]').disabled = false; }
    });
  }

  // ---- events inside 답변모음 / 문의모음 ----
  document.addEventListener('click', (e) => {
    if (!st.box || !st.box.contains(e.target)) return;
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.ftOpen) void openThread(b.dataset.ftOpen);
    if (b.hasAttribute('data-ft-back')) void loadList();
    if (b.hasAttribute('data-ft-new')) { st.composing = true; st.files = []; paint(); }
    if (b.dataset.ftUnfile) { st.files.splice(Number(b.dataset.ftUnfile), 1); paint(); }
  });
  document.addEventListener('change', (e) => {
    if (!st.box || !st.box.contains(e.target) || !e.target.matches('[data-ft-files]')) return;
    const picked = [...e.target.files], room = 3 - st.files.length;
    st.files.push(...picked.slice(0, Math.max(0, room)).filter((f) => f.size <= 8 * 1024 * 1024)); paint();
    if (picked.length > room) say('사진은 한 번에 3장까지 보낼 수 있습니다.');
    else if (picked.some((f) => f.size > 8 * 1024 * 1024)) say('8MB가 넘는 사진은 뺐습니다.');
  });
  document.addEventListener('submit', (e) => {
    if (!st.box || !st.box.contains(e.target)) return;
    const f = e.target, kind = f.dataset.ftForm; if (!kind) return;
    e.preventDefault(); const body = f.elements.body.value.trim();
    if (!body && !st.files.length) return say('내용을 입력해 주세요.');
    if (kind === 'inquiry') {
      void run(async () => { st.thread = await api('/api/family/threads', form(body, st.files, { studentId: f.elements.studentId.value, title: f.elements.title.value })); f.reset(); st.files = []; st.composing = false; paint(); }, '문의를 보냈습니다. 답변이 오면 알림으로 알려 드려요.');
    } else {
      void run(async () => { st.thread = await api(`/api/family/threads/${encodeURIComponent(st.thread.thread.id)}/messages`, form(body, st.files)); f.reset(); st.files = []; paint(); }, '보냈습니다.');
    }
  });

  window.FamilyTalk = {
    open(key, box) { st.key = key; st.box = box; st.files = []; if (st.pending) { const id = st.pending; st.pending = ''; void openThread(id); } else void loadList(); },
    mountNoticeReply,
    refresh: refreshUnread,
  };

  // A push for a 학원 답장 opens /family/?openThread=<id>.
  const params = new URLSearchParams(location.search);
  const openId = params.get('openThread');
  if (openId) { params.delete('openThread'); history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`); st.pending = openId; }
  function whenVisible() {
    if (familyView.classList.contains('hidden')) return;
    void refreshUnread();
    // After family-mobile.js has shown its first 소식 tab, so the conversation stays on screen.
    if (st.pending) setTimeout(() => { if (st.pending) document.querySelector('.km-bottom [data-family-menu="inquiries"]')?.click(); }, 400);
  }
  new MutationObserver(whenVisible).observe(familyView, { attributes: true, attributeFilter: ['class'] });
  whenVisible();
})();

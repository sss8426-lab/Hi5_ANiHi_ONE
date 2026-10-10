// 꿈이음 출결기: a tablet at the academy door. Students type their 등하원 번호 and press 등원 or 하원; the
// record lands in 꿈이음 출석체크 and the guardians get an alert. The tablet is paired once with a 6-digit
// 연결번호 from 출결 설정 (no staff login here). Presses made while offline are kept and sent later.
(() => {
  const $ = (id) => document.getElementById(id);
  const QUEUE_KEY = 'kkumeum-kiosk-queue';
  const state = { mode: 'loading', label: '', campus: '', digits: '', busy: false, resultTimer: 0, wake: null };
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
  function writeQueue(list) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-200))); } catch { /* Storage may be full or blocked. */ } }
  async function api(path, body) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || '처리하지 못했습니다.'), { status: response.status });
    return data;
  }
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* Voice is optional. */ }
  }
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !state.wake) { state.wake = await navigator.wakeLock.request('screen'); state.wake.addEventListener('release', () => { state.wake = null; }); } } catch { /* Not supported here. */ }
  }
  function tick() {
    const now = new Date();
    $('kTime').textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('kDate').textContent = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  }
  function renderDisplay() {
    const max = state.mode === 'pair' ? 6 : Math.max(4, Math.min(6, state.digits.length));
    $('kDisplay').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < state.digits.length ? 'on' : ''}">${h(state.digits[i] || '')}</i>`).join('');
    const ready = state.mode === 'pair' ? state.digits.length === 6 : state.digits.length >= 4;
    document.querySelectorAll('[data-action]').forEach((b) => { b.disabled = !ready || state.busy; });
    $('kPairGo').disabled = !ready || state.busy;
  }
  function renderNet() {
    const queued = readQueue().length;
    $('kNet').hidden = navigator.onLine && !queued;
    $('kNet').textContent = !navigator.onLine ? `인터넷 연결이 끊겼어요 · 누른 기록은 보관했다가 자동으로 보냅니다${queued ? ` (${queued}건)` : ''}` : `보관한 기록 ${queued}건을 보내는 중입니다`;
  }
  function setMode(mode) {
    state.mode = mode; state.digits = '';
    $('kPair').hidden = mode !== 'pair';
    $('kGo').hidden = mode !== 'main';
    $('kPairGo').hidden = mode !== 'pair';
    $('kLabel').textContent = mode === 'main' ? state.label : '꿈이음 출결기';
    $('kCampus').textContent = mode === 'main' ? state.campus : '';
    renderDisplay(); renderNet();
  }
  function showResult(kind, html, ms = 3000) {
    clearTimeout(state.resultTimer);
    const box = $('kResult');
    box.className = `k-result ${kind}`; box.innerHTML = `${html}<div class="bar"><i style="animation-duration:${ms}ms"></i></div>`; box.hidden = false;
    state.resultTimer = setTimeout(hideResult, ms);
  }
  function hideResult() { clearTimeout(state.resultTimer); $('kResult').hidden = true; }

  function resultFor(r, action) {
    if (r.duplicate) {
      showResult('dup', `<div class="big">!</div><h2>${h(r.name)}</h2><p>이미 ${h(r.time)}에 ${h(r.label)}했어요</p><small>${action === 'arrive' ? '하원할 때는 [하원]을 눌러 주세요' : '오늘 하원은 이미 기록되어 있어요'}</small>`, 3500);
      speak(`${r.name}, 이미 ${r.label}했어요`);
      return;
    }
    const slot = r.slot ? `오늘 ${h(r.slot)}타임${r.slotStart ? ` (${h(r.slotStart)})` : ''} 수업<br>` : '';
    const sent = r.notified ? `보호자님께 ${h(r.label)} 알림을 보냈어요` : r.guardians ? '' : '';
    if (r.status === 'late') {
      showResult('late', `<div class="big">⏰</div><h2>${h(r.name)}</h2><p>${h(r.time)} 등원 (지각)</p><small>${slot}${sent}</small>`);
      speak(`${r.name}, 등원했어요`);
    } else if (r.status === 'leave') {
      showResult('leave', `<div class="big">👋</div><h2>${h(r.name)}</h2><p>${h(r.time)} 하원했어요</p><small>${sent || '안녕히 가세요'}</small>`);
      speak(`${r.name}, 안녕히 가세요`);
    } else {
      showResult('ok', `<div class="big">✓</div><h2>${h(r.name)}</h2><p>${h(r.time)} 등원했어요</p><small>${slot}${sent}</small>`);
      speak(`${r.name}, 등원했어요`);
    }
  }
  async function press(action) {
    if (state.busy || state.digits.length < 4) return;
    const code = state.digits, at = new Date().toISOString();
    state.busy = true; state.digits = ''; renderDisplay();
    try {
      resultFor(await api('/api/kiosk/checkin', { code, action }), action);
    } catch (error) {
      if (error.status === 401) { setMode('pair'); showResult('err', '<div class="big">✕</div><h2>연결이 해제되었어요</h2><small>출결 설정에서 받은 연결번호로 다시 연결해 주세요</small>', 4000); }
      else if (error.status === 404) { showResult('err', '<div class="big">✕</div><h2>번호를 다시 확인해 주세요</h2><small>번호를 모르면 선생님께 물어보세요</small>', 2500); speak('번호를 다시 확인해 주세요'); }
      else if (error.status) showResult('err', `<div class="big">✕</div><h2>${h(error.message)}</h2>`, 3000);
      else {
        // Offline: keep the press with its own time and send it when the network is back.
        writeQueue([...readQueue(), { code, action, at }]);
        showResult('queued', `<div class="big">⌛</div><h2>${action === 'arrive' ? '등원' : '하원'} 기록을 보관했어요</h2><small>인터넷이 다시 연결되면 자동으로 보내고<br>보호자님께도 알림이 갑니다</small>`, 3000);
        speak(action === 'arrive' ? '등원 기록을 보관했어요' : '하원 기록을 보관했어요');
      }
    } finally { state.busy = false; renderDisplay(); renderNet(); }
  }
  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine || state.mode !== 'main') return;
    const list = readQueue(); if (!list.length) return renderNet();
    flushing = true;
    try {
      while (readQueue().length) {
        const [item, ...rest] = readQueue();
        try { await api('/api/kiosk/checkin', item); }
        catch (error) { if (!error.status) break; if (error.status === 401) { setMode('pair'); break; } }
        writeQueue(rest);
      }
    } finally { flushing = false; renderNet(); }
  }
  async function pair() {
    if (state.busy || state.digits.length !== 6) return;
    const code = state.digits; state.busy = true; state.digits = ''; renderDisplay();
    try {
      const r = await api('/api/kiosk/pair', { code });
      state.label = r.label; state.campus = r.campusName || '';
      setMode('main');
      showResult('ok', `<div class="big">✓</div><h2>${h(r.label)}</h2><p>출결기로 연결되었어요</p><small>${h(r.campusName || '')}</small>`, 3000);
    } catch (error) {
      showResult('err', `<div class="big">✕</div><h2>${h(error.status ? error.message : '인터넷 연결을 확인해 주세요')}</h2>`, 3500);
    } finally { state.busy = false; renderDisplay(); }
  }
  function key(k) {
    hideResult(); void keepAwake();
    const max = state.mode === 'pair' ? 6 : 6;
    if (k === 'clear') state.digits = '';
    else if (k === 'back') state.digits = state.digits.slice(0, -1);
    else if (/^\d$/.test(k) && state.digits.length < max) state.digits += k;
    renderDisplay();
  }
  document.querySelector('.k-pad').addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) key(b.dataset.key); });
  $('kGo').addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b && !b.disabled) void press(b.dataset.action); });
  $('kPairGo').addEventListener('click', () => void pair());
  $('kResult').addEventListener('click', hideResult);
  document.addEventListener('keydown', (e) => {
    if ($('kMenu').open) return;
    if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('back'); else if (e.key === 'Escape') key('clear');
  });
  // 메뉴: hold the title for 1.5 s (students tapping by accident never open it).
  let holdTimer = 0;
  const hold = () => { holdTimer = setTimeout(() => { $('kMenuInfo').textContent = state.mode === 'main' ? `${state.label} · ${state.campus}` : '아직 연결되지 않은 태블릿입니다.'; $('kMenu').showModal(); }, 1500); };
  const release = () => clearTimeout(holdTimer);
  $('kLabel').addEventListener('pointerdown', hold); ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => $('kLabel').addEventListener(t, release));
  $('kLabel').addEventListener('contextmenu', (e) => e.preventDefault());
  $('kMenu').addEventListener('click', async (e) => {
    const m = e.target.closest('[data-menu]')?.dataset.menu; if (!m) return;
    if (m === 'close') $('kMenu').close();
    if (m === 'reload') location.reload();
    if (m === 'fullscreen') { $('kMenu').close(); try { await document.documentElement.requestFullscreen(); } catch { /* Not available. */ } }
    if (m === 'unpair' && confirm('이 태블릿의 출결기 연결을 해제할까요? 다시 쓰려면 새 연결번호가 필요합니다.')) {
      try { await api('/api/kiosk/unpair', {}); } catch { /* Disconnect locally anyway. */ }
      $('kMenu').close(); setMode('pair');
    }
  });
  window.addEventListener('online', () => { renderNet(); void flush(); });
  window.addEventListener('offline', renderNet);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void keepAwake(); void flush(); } });
  setInterval(tick, 1000); setInterval(() => void flush(), 15000); tick();

  async function start() {
    try {
      const s = await api('/api/kiosk/session');
      if (s.paired) { state.label = s.label; state.campus = s.campusName || ''; setMode('main'); void flush(); }
      else setMode('pair');
    } catch {
      // Offline at start: keep working as the last paired kiosk would; the server checks the pairing later.
      if (readQueue().length || !navigator.onLine) { state.label = '꿈이음 출결기'; setMode('main'); } else setMode('pair');
    }
  }
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/kiosk/sw.js', { scope: '/kiosk/' }).catch(() => {}));
  void start();
})();

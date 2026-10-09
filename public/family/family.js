const state = {
  session: null,
  children: [],
  selectedChildId: '',
  reports: [],
  artworks: [],
  activeTab: 'home',
  pushStatus: null,
  currentPushSubscription: null,
  attendance: { month: '', today: '', events: [], corrections: [] },
  pendingOpen: null,
};

const $ = (id) => document.getElementById(id);
let childFeedRequest = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = new Error(body?.error || `요청을 처리하지 못했습니다. (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function hideAllViews() {
  ['loadingView', 'loginView', 'passwordView', 'unavailableView', 'familyView'].forEach((id) => $(id)?.classList.add('hidden'));
  $('bottomNav')?.classList.add('hidden');
  $('logoutTopBtn')?.classList.add('hidden');
}

function showView(id) {
  hideAllViews();
  $(id)?.classList.remove('hidden');
  if (id === 'familyView') {
    $('bottomNav')?.classList.remove('hidden');
    $('logoutTopBtn')?.classList.remove('hidden');
  }
}

function setFormMessage(id, message = '') {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function clearPrivateUi() {
  childFeedRequest++;
  window.DataCoreImageGallery.close('family-artworks');
  state.children = [];
  state.selectedChildId = '';
  state.reports = [];
  state.artworks = [];
  state.attendance = { month: '', today: '', events: [], corrections: [] };
  state.pushStatus = null;
  state.currentPushSubscription = null;
  ['reportList', 'artworkGallery', 'latestReport', 'latestArtworks', 'attendanceToday', 'attendanceList'].forEach((id) => {
    const node = $(id);
    if (node) node.replaceChildren();
  });
  if ($('childSelect')) $('childSelect').replaceChildren();
}

function urlBase64ToUint8Array(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function setPushMessage(message = '') {
  const element = $('pushHelp');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('hidden', !message);
}

function renderPushStatus(status, currentSubscription = null) {
  state.pushStatus = status;
  state.currentPushSubscription = currentSubscription;
  const label = $('pushStatus');
  const button = $('pushToggleBtn');
  if (!label || !button) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    label.textContent = '이 브라우저는 푸시 알림을 지원하지 않습니다.';
    button.disabled = true;
    return;
  }
  const permission = Notification.permission;
  if (!status.configured || !status.subscriptionReady) {
    label.textContent = '알림 서비스 설정을 준비하고 있습니다.';
    button.disabled = true;
    return;
  }
  if (permission === 'denied') {
    label.textContent = '브라우저에서 알림이 차단되어 있습니다.';
    button.disabled = false;
    button.textContent = '설정 안내';
    return;
  }
  button.disabled = false;
  button.textContent = currentSubscription ? '알림 끄기' : '알림 받기';
  label.textContent = currentSubscription
    ? '이 기기에서 새 소식 알림을 받고 있습니다.'
    : permission === 'granted' ? '이 기기에서 알림을 켤 수 있습니다.' : '알림을 받으려면 버튼을 눌러 허용해 주세요.';
  setPushMessage(status.configured
    ? 'iPhone에서는 홈 화면에 추가한 뒤 알림을 허용할 수 있습니다. 로그아웃해도 이 기기의 알림 설정은 유지됩니다.'
    : '알림 발송 설정이 아직 완료되지 않았습니다. 설정이 완료되면 이 기기에서만 알림을 받을 수 있습니다.');
}

async function currentDevicePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/family/');
  return registration ? registration.pushManager.getSubscription() : null;
}

async function loadPushStatus() {
  try {
    const [status, currentSubscription] = await Promise.all([
      api('/api/family/push/status'),
      currentDevicePushSubscription().catch(() => null),
    ]);
    renderPushStatus(status, currentSubscription);
  } catch (error) {
    if (!genericAccessMessage(error)) setPushMessage('알림 상태를 확인하지 못했습니다.');
  }
}

async function togglePush() {
  const status = state.pushStatus;
  if (!status || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission === 'denied') {
    setPushMessage('브라우저 설정에서 꿈이음 알림을 허용한 뒤 다시 시도해 주세요. iPhone은 홈 화면에 추가한 앱에서 설정할 수 있습니다.');
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await api('/api/family/push/unsubscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: existing.endpoint }) });
    await existing.unsubscribe();
    setPushMessage('이 기기의 알림을 껐습니다.');
    return loadPushStatus();
  }
  if (!status.subscriptionReady || !status.publicKey) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return loadPushStatus();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(status.publicKey),
  });
  await api('/api/family/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.toJSON().keys || {}, platform: navigator.userAgent.slice(0, 120) }),
  });
  setPushMessage('이 기기에서 알림을 받도록 설정했습니다.');
  return loadPushStatus();
}

function unavailable(error) {
  clearPrivateUi();
  const message = error?.status === 503
    ? '보호자 전용 FAMILY_DB/FAMILY_FILES 연결이 아직 준비되지 않았습니다. 개인정보를 다른 저장소에 대신 저장하지 않습니다.'
    : '현재 꿈이음에 연결할 수 없습니다. 잠시 뒤 다시 확인해 주세요.';
  $('unavailableMessage').textContent = message;
  showView('unavailableView');
}

function genericAccessMessage(error) {
  if (error?.status === 401) {
    clearPrivateUi();
    state.session = null;
    showView('loginView');
    setFormMessage('loginMessage', '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');
    return true;
  }
  if (error?.status === 503) {
    unavailable(error);
    return true;
  }
  const notice = $('appNotice');
  if (notice) {
    notice.textContent = error?.status === 403 ? '이 항목을 볼 권한이 없습니다.' : '정보를 불러오지 못했습니다.';
    notice.classList.remove('hidden');
  }
  return false;
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function text(value, fallback = '-') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function childMeta(child) {
  return [child?.grade, child?.className].filter(Boolean).join(' · ') || '수업 정보 확인 중';
}

function emptyInline(message) {
  const div = document.createElement('div');
  div.className = 'empty-inline';
  div.textContent = message;
  return div;
}

function reportCard(report) {
  const article = document.createElement('article');
  article.className = 'report-card';
  const header = document.createElement('header');
  const heading = document.createElement('div');
  const label = document.createElement('span');
  label.className = 'mini-label';
  label.textContent = 'MONTHLY REPORT';
  const title = document.createElement('h3');
  title.textContent = text(report.title, '월간 성장평가');
  const time = document.createElement('time');
  time.textContent = report.sentAt ? `전달 ${String(report.sentAt).slice(0, 10)}` : '';
  heading.append(label, title, time);
  const month = document.createElement('span');
  month.className = 'month-pill';
  month.textContent = text(report.yearMonth, '월간평가');
  header.append(heading, month);
  article.append(header);

  if (report.summary) {
    const summary = document.createElement('p');
    summary.textContent = report.summary;
    article.append(summary);
  }
  if (report.evaluationText) {
    const evaluation = document.createElement('p');
    evaluation.textContent = report.evaluationText;
    article.append(evaluation);
  }
  const growth = report.growthPoints && typeof report.growthPoints === 'object' ? report.growthPoints : null;
  if (growth && Object.keys(growth).length) {
    const chips = document.createElement('div');
    chips.className = 'growth-chips';
    Object.entries(growth).slice(0, 6).forEach(([key, value]) => {
      const chip = document.createElement('span');
      chip.textContent = `${key} · ${String(value)}`;
      chips.append(chip);
    });
    article.append(chips);
  }
  if (report.nextMonthFocus) {
    const focus = document.createElement('div');
    focus.className = 'next-focus';
    const strong = document.createElement('b');
    strong.textContent = '다음 달 수업 목표';
    const content = document.createElement('span');
    content.textContent = report.nextMonthFocus;
    focus.append(strong, content);
    article.append(focus);
  }
  return article;
}

function artworkCard(artwork) {
  const figure = document.createElement('figure');
  figure.className = 'artwork-card';
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt = text(artwork.title, '학생 작품');
  image.src = artwork.fileUrl;
  image.referrerPolicy = 'same-origin';
  const caption = document.createElement('figcaption');
  const title = document.createElement('strong');
  title.textContent = text(artwork.title, '작품');
  const date = document.createElement('small');
  date.textContent = artwork.lessonDate ? String(artwork.lessonDate).slice(0, 10) : '';
  caption.append(title, date);
  const enlarge = document.createElement('button');
  enlarge.type = 'button'; enlarge.className = 'gallery-image-button';
  enlarge.setAttribute('aria-label', `${text(artwork.title, '학생 작품')} 크게 보기`);
  enlarge.append(image);
  enlarge.onclick = () => window.DataCoreImageGallery.open({scope:'family-artworks',title:'학생 작품',anchor:enlarge,
    index:state.artworks.findIndex(item=>item.id===artwork.id),
    items:state.artworks.map(item=>({src:item.fileUrl,previewSrc:item.fileUrl,title:text(item.title,'학생 작품')}))});
  figure.append(enlarge, caption);
  return figure;
}

function renderChildSelector() {
  const select = $('childSelect');
  select.replaceChildren();
  state.children.forEach((child) => {
    const option = document.createElement('option');
    option.value = child.studentId;
    option.textContent = child.displayName;
    option.selected = child.studentId === state.selectedChildId;
    select.append(option);
  });
  $('childSelectWrap').classList.toggle('hidden', state.children.length < 2);
}

function renderCurrentChild() {
  const child = state.children.find((item) => item.studentId === state.selectedChildId);
  if (!child) return;
  $('homeChildName').textContent = child.displayName;
  $('homeChildMeta').textContent = childMeta(child);
  $('childProfileName').textContent = child.displayName;
  $('childProfileMeta').textContent = childMeta(child);
  $('reportCount').textContent = String(state.reports.length);
  $('artworkCount').textContent = String(state.artworks.length);
  $('galleryCount').textContent = `${state.artworks.length}장`;
  const latest = state.reports[0];
  $('homeReportBadge').textContent = latest?.yearMonth || '이번 달';

  const latestReport = $('latestReport');
  latestReport.replaceChildren();
  latestReport.append(latest ? reportCard(latest) : emptyInline('아직 전달된 월간 평가가 없습니다.'));

  const reportList = $('reportList');
  reportList.replaceChildren();
  if (state.reports.length) state.reports.forEach((report) => reportList.append(reportCard(report)));
  else reportList.append(emptyInline('아직 전달된 성장기록이 없습니다.'));

  const gallery = $('artworkGallery');
  gallery.replaceChildren();
  if (state.artworks.length) state.artworks.forEach((artwork) => gallery.append(artworkCard(artwork)));
  else gallery.append(emptyInline('아직 확인 가능한 작품이 없습니다.'));

  const recent = $('latestArtworks');
  recent.replaceChildren();
  if (state.artworks.length) state.artworks.slice(0, 4).forEach((artwork) => recent.append(artworkCard(artwork)));
  else recent.append(emptyInline('아직 확인 가능한 작품이 없습니다.'));
}

// 출결: today's chips on 홈 and a month list on the 출결 기록 panel.
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstMonth = () => kstToday().slice(0, 7);
function attendanceChip(event) {
  const chip = document.createElement('span');
  chip.className = `attendance-chip attendance-${event.canceledAt ? 'canceled' : event.status}`;
  chip.textContent = event.canceledAt ? `정정 · ${event.label} ${event.time} 취소` : event.status === 'absent' ? event.label : `${event.label} ${event.time}`;
  if (event.message) chip.title = event.message;
  return chip;
}
function attendanceNote(event) {
  const p = document.createElement('p');
  p.className = 'attendance-note';
  p.textContent = event.canceledAt ? `${event.time} ${event.label} 기록을 취소했습니다. 해당 기록은 유효하지 않습니다.` : `${event.label} · ${event.message}`;
  return p;
}
function renderAttendance() {
  const { events, today, month, corrections = [] } = state.attendance;
  const all = [...events, ...corrections].sort((a,b)=>a.time.localeCompare(b.time));
  const todayBox = $('attendanceToday');
  if (todayBox) {
    todayBox.replaceChildren();
    const todays = all.filter((event) => event.date === (today || kstToday()));
    if (todays.length) todays.forEach((event) => todayBox.append(attendanceChip(event)));
    else todayBox.append(emptyInline('오늘은 아직 출결 기록이 없습니다.'));
    todays.filter((event) => event.message || event.canceledAt).forEach((event) => todayBox.append(attendanceNote(event)));
  }
  const label = $('attendanceMonthLabel');
  if (label && month) { const [y, m] = month.split('-').map(Number); label.textContent = `${y}년 ${m}월`; }
  if ($('attendanceNext')) $('attendanceNext').disabled = !month || month >= kstMonth();
  const list = $('attendanceList');
  if (!list) return;
  list.replaceChildren();
  const days = new Map();
  all.forEach((event) => { if (!days.has(event.date)) days.set(event.date, []); days.get(event.date).push(event); });
  if (!days.size) { list.append(emptyInline('이 달에는 출결 기록이 없습니다.')); return; }
  [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([date, items]) => {
    const row = document.createElement('article');
    row.className = 'attendance-day';
    const [y, m, d] = date.split('-').map(Number);
    const title = document.createElement('strong');
    title.textContent = `${m}월 ${d}일 (${'일월화수목금토'[new Date(y, m - 1, d).getDay()]})`;
    const chips = document.createElement('div');
    chips.className = 'attendance-chips';
    items.forEach((event) => chips.append(attendanceChip(event)));
    row.append(title, chips);
    items.filter((event) => event.message || event.canceledAt).forEach((event) => row.append(attendanceNote(event)));
    list.append(row);
  });
}
async function loadAttendance(studentId, month = kstMonth()) {
  state.attendance = { month, today: kstToday(), events: [], corrections: [] };
  renderAttendance();
  try {
    const result = await api(`/api/family/children/${encodeURIComponent(studentId)}/attendance?month=${encodeURIComponent(month)}`);
    if (state.selectedChildId !== studentId || state.attendance.month !== month) return;
    state.attendance = { month: result.month, today: result.today, events: Array.isArray(result.events) ? result.events : [], corrections: Array.isArray(result.corrections) ? result.corrections : [] };
    renderAttendance();
  } catch (error) {
    if (state.selectedChildId === studentId) genericAccessMessage(error);
  }
}
function shiftAttendanceMonth(delta) {
  const [y, m] = (state.attendance.month || kstMonth()).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
  if (next > kstMonth() || !state.selectedChildId) return;
  void loadAttendance(state.selectedChildId, next);
}

async function loadChildFeed(studentId) {
  const request = ++childFeedRequest;
  window.DataCoreImageGallery.close('family-artworks');
  state.selectedChildId = studentId;
  state.reports = [];
  state.artworks = [];
  renderChildSelector();
  renderCurrentChild();
  try {
    const [reportResponse, artworkResponse] = await Promise.all([
      api(`/api/family/children/${encodeURIComponent(studentId)}/reports`),
      api(`/api/family/children/${encodeURIComponent(studentId)}/artworks`),
    ]);
    if (request !== childFeedRequest || state.selectedChildId !== studentId) return;
    state.reports = Array.isArray(reportResponse.reports) ? reportResponse.reports : [];
    state.artworks = Array.isArray(artworkResponse.artworks) ? artworkResponse.artworks : [];
    renderCurrentChild();
  } catch (error) {
    if (request === childFeedRequest) genericAccessMessage(error);
  }
}

async function enterFamily(session) {
  state.session = session;
  $('guardianName').textContent = text(session.displayName, '보호자');
  $('guardianAccountName').textContent = text(session.displayName, '보호자');
  showView('familyView');
  switchTab('home');
  void loadPushStatus();
  try {
    const response = await api('/api/family/children');
    state.children = Array.isArray(response.children) ? response.children : [];
    if (!state.children.length) {
      $('homeChildName').textContent = '연결된 자녀가 없습니다';
      $('homeChildMeta').textContent = '학원에 자녀 연결 상태를 확인해 주세요.';
      $('latestReport').replaceChildren(emptyInline('연결된 자녀가 없습니다.'));
      $('latestArtworks').replaceChildren(emptyInline('연결된 자녀가 없습니다.'));
      return;
    }
    const wanted = state.pendingOpen?.studentId;
    state.selectedChildId = state.children.some((child) => child.studentId === wanted) ? wanted : state.children[0].studentId;
    renderChildSelector();
    if (state.pendingOpen?.tab) switchTab(state.pendingOpen.tab);
    state.pendingOpen = null;
    const feed = loadChildFeed(state.selectedChildId);
    void loadAttendance(state.selectedChildId);
    await feed;
  } catch (error) {
    genericAccessMessage(error);
  }
}

async function checkSession() {
  showView('loadingView');
  try {
    const session = await api('/api/family/auth/session');
    if (!session.authenticated) {
      clearPrivateUi();
      showView('loginView');
      return;
    }
    state.session = session;
    if (session.mustChangePassword) {
      showView('passwordView');
      return;
    }
    await enterFamily(session);
  } catch (error) {
    unavailable(error);
  }
}

async function logout() {
  try {
    await api('/api/family/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // Even if the server session already expired, clear all rendered private state locally.
  }
  clearPrivateUi();
  state.session = null;
  showView('loginView');
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormMessage('loginMessage');
  try {
    const result = await api('/api/family/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginId: $('loginId').value.trim(), password: $('loginPassword').value }),
    });
    $('loginPassword').value = '';
    state.session = result;
    if (result.mustChangePassword) showView('passwordView');
    else await enterFamily(result);
  } catch (error) {
    if (error?.status === 503) return unavailable(error);
    setFormMessage('loginMessage', error?.status === 423 ? '로그인 시도가 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.' : '로그인 정보를 확인해 주세요.');
  }
});

$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormMessage('passwordMessage');
  const currentPassword = $('currentPassword').value;
  const newPassword = $('newPassword').value;
  if (newPassword !== $('confirmPassword').value) {
    setFormMessage('passwordMessage', '새 비밀번호 확인이 일치하지 않습니다.');
    return;
  }
  try {
    await api('/api/family/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    $('currentPassword').value = '';
    $('newPassword').value = '';
    $('confirmPassword').value = '';
    await checkSession();
  } catch (error) {
    if (error?.status === 503) return unavailable(error);
    setFormMessage('passwordMessage', error?.status === 400 ? '새 비밀번호는 12자 이상으로 설정해 주세요.' : '현재 비밀번호를 확인해 주세요.');
  }
});

$('childSelect').addEventListener('change', (event) => { void loadChildFeed(event.target.value); void loadAttendance(event.target.value); });
$('retryBtn').addEventListener('click', checkSession);
$('logoutBtn').addEventListener('click', logout);
$('logoutTopBtn').addEventListener('click', logout);
$('pushToggleBtn').addEventListener('click', () => togglePush().catch((error) => setPushMessage(error?.status === 503 ? '알림 발송 설정을 준비하고 있습니다.' : '알림 설정을 완료하지 못했습니다.')));
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-go-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.goTab)));

// 인증키로 시작하기 / 자녀 추가. A shared link carries the code in the #fragment, which never reaches the server.
async function redeemCode(code, relationship) {
  return api('/api/family/auth/code', { method: 'POST', body: JSON.stringify({ code, relationship }) });
}
function codeErrorMessage(error) {
  if (error?.status === 429) return '인증키를 여러 번 잘못 입력했습니다. 15분 뒤에 다시 시도해 주세요.';
  if (error?.status === 403) return error.message || '지금은 인증키로 시작할 수 없습니다. 학원에 문의해 주세요.';
  return '인증키를 다시 확인해 주세요. 학원에서 받은 8자리입니다.';
}
$('codeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormMessage('codeMessage');
  const button = event.currentTarget.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await redeemCode($('inviteCode').value, $('inviteRelationship').value);
    $('inviteCode').value = '';
    await checkSession();
  } catch (error) {
    if (error?.status === 503) return unavailable(error);
    setFormMessage('codeMessage', codeErrorMessage(error));
  } finally { button.disabled = false; }
});
$('addChildForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('addChildMessage');
  const show = (value) => { message.textContent = value; message.classList.toggle('hidden', !value); };
  show('');
  try {
    const result = await redeemCode($('addChildCode').value, '보호자');
    $('addChildCode').value = '';
    state.pendingOpen = { studentId: result.studentId, tab: 'home' };
    await enterFamily(state.session);
    show(`${result.childName} 학생을 추가했습니다.`);
  } catch (error) { show(codeErrorMessage(error)); }
});
function takeSharedLink() {
  const code = new URLSearchParams(location.hash.slice(1)).get('code');
  const openAttendance = new URLSearchParams(location.search).get('openAttendance');
  if (openAttendance) state.pendingOpen = { studentId: openAttendance, tab: 'attendance' };
  if (code || openAttendance) history.replaceState(null, '', '/family/');
  if (code) { $('inviteCode').value = code.slice(0, 9); $('addChildCode').value = code.slice(0, 9); }
}
$('attendanceMonthBtn').addEventListener('click', () => switchTab('attendance'));
$('attendancePrev').addEventListener('click', () => shiftAttendanceMonth(-1));
$('attendanceNext').addEventListener('click', () => shiftAttendanceMonth(1));

// 앱 설치: Android/Chrome shows its install sheet; iPhone uses Safari's share menu.
let installPrompt = null;
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const status = $('installStatus');
  const button = $('installBtn');
  if (!status || !button) return;
  if (standalone()) { status.textContent = '이 기기에 설치되어 있습니다.'; button.hidden = true; return; }
  button.hidden = false;
  status.textContent = installPrompt ? '버튼을 누르면 홈 화면에 꿈이음이 추가됩니다.' : isIos() ? 'Safari 아래쪽 공유 버튼에서 [홈 화면에 추가]를 누르세요.' : '브라우저 메뉴에서 [앱 설치] 또는 [홈 화면에 추가]를 누르세요.';
}
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; renderInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
$('installBtn').addEventListener('click', async () => {
  const help = $('installHelp');
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; renderInstall(); return; }
  help.textContent = isIos()
    ? 'iPhone: Safari에서 꿈이음을 연 뒤 아래쪽 공유 버튼(□↑)을 누르고 [홈 화면에 추가]를 선택하세요. 홈 화면의 꿈이음을 열어 알림을 켜면 등·하원 알림을 받을 수 있습니다.'
    : 'Android: Chrome 오른쪽 위 메뉴(⋮)에서 [앱 설치] 또는 [홈 화면에 추가]를 누르세요.';
  help.classList.remove('hidden');
});
renderInstall();
takeSharedLink();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/family/sw.js', { scope: '/family/', updateViaCache: 'none' })
      .then(() => { if (state.session) void loadPushStatus(); })
      .catch(() => {});
  });
}

checkSession();

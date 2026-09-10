import { careerStages, programView, filterPrograms, admissionTrend, safeUrl, searchCareers } from './roadmap-model.js?v=20260909-1';
import { occupationImageConcepts } from './occupation-image-concepts.js?v=20260910-photo-v2';
import { paginate } from './pagination.js?v=20260909-1';

const content = window.HI5_ROADMAP_CONTENT || { careers: [], tracks: [], lessonAreas: [], sources: [] };
const $ = (id) => document.getElementById(id);
const state = { family: '', group: '', query: '', career: null, programs: [], page:1, visiblePrograms:[], controller: null, request: 0 };
const familyNames = { story: '만화·애니메이션·게임', design: '디자인' };
const h = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const art = (career) => {
  const concept = occupationImageConcepts.find((c) => c.occupationId === career.id);
  return concept ? `<img class="career-art job-image" src="${concept.asset}?v=${concept.version}" alt="${h(concept.action)}" width="480" height="640" loading="lazy" decoding="async">` : `<span class="career-art missing-art" data-missing-occupation="${h(career.id)}">이미지 준비 중</span>`;
};
const pathFor = (career) => `#family=${career.family}&career=${career.id}`;

function notice(message, login = false, retry = false) {
  $('notice').hidden = !message;
  $('notice').innerHTML = h(message) + (login ? ` <a href="/data-core/login?next=${encodeURIComponent('/data-core/roadmap' + pathFor(state.career))}">교직원 로그인</a>` : '') + (retry ? ' <button type="button" class="secondary-button notice-retry">다시 불러오기</button>' : '');
  if(retry)$('notice').querySelector('button').onclick=()=>{if(state.career)loadConnectedPrograms(state.career);};
}

function renderCatalog() {
  $('familyLabel').textContent = familyNames[state.family] || '전체 관심 분야';
  const groups = [...new Set(content.careers.filter((c) => c.family === state.family).map((c) => c.group))];
  $('groupTabs').innerHTML = groups.length > 1 ? ['', ...groups].map((group) => `<button class="group-tab" type="button" data-group="${h(group)}" aria-pressed="${group === state.group}">${h(group || '전체')}</button>`).join('') : '';
  const careers = searchCareers(content.careers, state.query, state.family).filter((career) => !state.group || career.group === state.group);
  $('careerCount').textContent = `${careers.length}개의 꿈`;
  $('goalGrid').innerHTML = careers.length ? careers.map((career) => `<a class="dream-card" href="${pathFor(career)}">${art(career)}<span class="dream-copy"><small>${h(career.group)}</small><strong>${h(career.name)}</strong><span class="dream-summary">${h(career.summary)}</span></span></a>`).join('') : '<p class="empty-state">검색된 꿈이 없어요. 다른 직업명이나 전공을 입력해보세요.</p>';
}

function renderEducation(career) {
  const track = content.tracks.find((t) => t.id === career.trackId);
  $('resultGroup').textContent = `${familyNames[career.family]} / ${career.group}`;
  $('resultGoal').textContent = career.name;
  $('resultGoalSummary').textContent = career.summary;
  $('resultPortrait').innerHTML = art(career);
  $('changeGoalBtn').href = `#family=${career.family}`;
  $('majorGrid').innerHTML = career.majors.map((major) => `<span class="major-item">${h(major)}</span>`).join('');
  $('skillGrid').innerHTML = career.skills.map((skill) => `<span>${h(skill)}</span>`).join('');
  $('careerOutcome').textContent = career.outcome;
  $('universityExamples').innerHTML = career.universityExamples.map((example) => `<li>${h(example)}</li>`).join('');
  $('referenceSources').innerHTML = content.sources.filter((s) => ['커리어넷', '대입정보포털 어디가', '전문대학포털'].includes(s.name) && safeUrl(s.url)).map((source) => `<a href="${h(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${h(source.name)} ↗</a>`).join('');
  const steps = careerStages(career);
  $('curriculumTimeline').innerHTML = steps.map(([name, summary]) => `<li><h3>${h(name)}</h3><p>${h(summary)}</p></li>`).join('');
  $('trackDescription').textContent = `${track?.name || career.name} · 미술 기초부터 전공 프로젝트와 입시까지 연결하는 학원 교육 가이드`;
  const preparation = [
    ['미술 기초', career.foundation.join(' → '), '관찰하고 표현하는 힘'],
    ['전공 기초', (track?.focus || career.specialization).join(' · '), '나의 전공 언어 익히기'],
    ['전공 심화', career.advanced.join(' → '), `대표 결과물: ${career.outcome}`],
    ['대학입시', career.preparation, '목표 대학의 최종 모집요강에 맞춰 준비'],
  ];
  $('preparationGrid').innerHTML = preparation.map(([name, description, note]) => `<article class="preparation-item"><h3>${h(name)}</h3><p>${h(description)}</p><small>${h(note)}</small></article>`).join('');
  $('lessonAreas').innerHTML = content.lessonAreas.filter((l) => l['단계'].startsWith('1 ')).map((l) => `<div class="lesson-row"><strong>${h(l['수업영역'])}</strong><span>${h(l['교육목표'])}<br>${h(l['권장 순서'])}</span></div>`).join('');
}

function renderUniversities() {
  const filters = { region: $('regionFilter').value, schoolType: $('schoolFilter').value, admission: $('admissionFilter').value, focus: $('focusFilter').value };
  const filtered = filterPrograms(state.programs, filters);
  const pagination = paginate(filtered, state.page);
  state.page = pagination.page;
  const rows = state.visiblePrograms = pagination.rows;
  $('universityCount').textContent = state.programs.length ? `${filtered.length}개 전형 · ${pagination.page} / ${pagination.totalPages} 페이지` : '';
  renderUniversityPagination(pagination, filtered.length);
  $('universityFilters').hidden = !state.programs.length;
  if (!rows.length) {
    $('universityContent').innerHTML = `<p class="empty-state">${state.programs.length ? '선택한 조건에 해당하는 전형이 없습니다.' : '연결된 대학별 전형 정보가 아직 없습니다. 아래 대학·학과 예시부터 살펴보세요.'}</p>`;
    return;
  }
  $('universityContent').innerHTML = `<div class="university-grid">${rows.map((p) => `<article class="university-item"><h3>${h(p.university)}</h3><p class="department">${h(p.department)}</p><p class="program-meta">${h([p.region || '지역 확인 필요', p.schoolType || '학교 유형 확인 필요', p.admission || '모집 시기 확인 필요', p.year ? `${p.year}학년도` : '학년도 확인 필요'].join(' · '))}</p><div class="ratios"><span>성적 <strong>${p.grade === null ? '확인 필요' : `${p.grade}%`}</strong></span><span>실기 <strong>${p.skill === null ? '확인 필요' : `${p.skill}%`}</strong></span></div><p class="program-meta">실기: ${h(p.practical || '모집요강 확인 필요')}</p><p class="source-line">${p.source ? `<a href="${h(p.source)}" target="_blank" rel="noopener noreferrer">${p.verified ? '검수된 모집요강' : '등록 출처 확인'} ↗</a>` : '공식 출처 확인 필요'}<br>${p.verified ? `검수 완료 · ${h(p.verifiedAt)}${p.page ? ` · p.${h(p.page)}` : ' · 원문 페이지 확인 필요'}` : '추가 검수 필요 · 전형 비율 미공개'}</p></article>`).join('')}</div>`;
}

function renderUniversityPagination(pagination, count) {
  let nav = $('universityPagination');
  if (!nav) { nav = document.createElement('nav'); nav.id = 'universityPagination'; nav.className = 'university-pagination'; nav.setAttribute('aria-label','관련 대학 페이지'); $('universityContent').after(nav); }
  nav.hidden = count <= 4;
  nav.innerHTML = `<button type="button" data-page="${pagination.page-1}" aria-label="이전 페이지" ${pagination.page===1?'disabled':''}>‹</button>${pagination.buttons.map(n => n === null ? '<span aria-hidden="true">…</span>' : `<button type="button" data-page="${n}" aria-label="${n} 페이지" ${n===pagination.page?'aria-current="page"':''}>${n}</button>`).join('')}<button type="button" data-page="${pagination.page+1}" aria-label="다음 페이지" ${pagination.page===pagination.totalPages?'disabled':''}>›</button>`;
  nav.querySelectorAll('[data-page]').forEach(button => { button.onclick = () => { state.page = Number(button.dataset.page); renderUniversities(); linkUniversitySources(); $('universityPagination').querySelector('[aria-current]')?.focus({preventScroll:true}); }; });
}

function renderTrend() {
  const trend = admissionTrend(state.programs);
  if (!trend) {
    $('trendContent').innerHTML = '<p class="empty-state">비교할 수 있는 검수된 전형 비율이 아직 충분하지 않습니다.</p><p class="trend-note">성적·실기 중요도를 임의의 비율로 정하지 않습니다. 같은 전공이라도 대학과 전형에 따라 준비 비중이 달라요.</p>';
    return;
  }
  $('trendContent').innerHTML = `<p>${h(trend.year)}학년도 · 연결된 검수 전형 ${trend.count}건의 평균</p><div class="trend-bars">${[['성적 반영', trend.grade], ['실기 반영', trend.skill]].map(([label, value]) => `<div class="bar-row"><span>${label}</span><div class="bar-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value.toFixed(1)}"><span style="width:${value.toFixed(1)}%"></span></div><strong>${value.toFixed(1)}%</strong></div>`).join('')}</div><p class="trend-note">전체 전공의 평균 중요도나 합격 가능성이 아닙니다. 위에 연결된 일부 전형만의 단순 평균이며, 면접·서류 등 다른 요소가 있을 수 있습니다. 실제 지원은 개별 대학의 최신 모집요강을 기준으로 해요.</p>`;
}

function setPrograms(programs) {
  state.page = 1;
  state.programs = programs.map(programView);
  for (const [id, key] of [['regionFilter', 'region'], ['schoolFilter', 'schoolType']]) {
    $(id).innerHTML = '<option value="">전체</option>' + [...new Set(state.programs.map((p) => p[key]).filter(Boolean))].sort().map((v) => `<option value="${h(v)}">${h(v)}</option>`).join('');
  }
  $('admissionFilter').value = '';
  $('focusFilter').value = '';
  renderUniversities();
  linkUniversitySources();
  renderTrend();
}

function linkUniversitySources() {
  const rows = state.visiblePrograms;
  $('universityContent').querySelectorAll('.university-item').forEach((item,index) => {
    const row = rows[index];
    if (!row?.sourceUniversityId && !row?.guidelineId) return;
    const link = document.createElement('a');
    link.href = row.guidelineId ? `/#page=${row.admissionSeason}&guideline=${encodeURIComponent(row.guidelineId)}` : `/#page=admin&university=${encodeURIComponent(row.sourceUniversityId)}`;
    link.className = 'university-source-link';
    link.textContent = row.guidelineId ? '저장된 입시요강 상세 보기 ↗' : '대학 데이터 관리에서 보기 ↗';
    item.append(link);
  });
}

async function api(url, signal) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) { const error = new Error('연결 실패'); error.status = response.status; throw error; }
  return response.json();
}

async function loadConnectedPrograms(career) {
  const requestId = ++state.request;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  // Goals and graph are sequential; allow cold-start D1 setup for both requests.
  const timeout = setTimeout(() => controller.abort(), 45000);
  notice('대학별 전형 정보를 확인하고 있습니다.');
  try {
    const response = await api(`/api/data-core/roadmap/programs?careerId=${encodeURIComponent(career.id)}`, controller.signal);
    if (requestId !== state.request) return;
    setPrograms(response.programs || []);
    notice('');
  } catch (error) {
    if (requestId !== state.request) return;
    setPrograms([]);
    notice(error.status === 401 ? '대학별 운영 입시정보는 교직원 로그인 후 확인할 수 있어요.' : error.status === 403 ? '대학별 전형 정보를 볼 권한이 없습니다.' : '대학별 전형 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', error.status === 401, ![401,403].includes(error.status));
  } finally { clearTimeout(timeout); }
}

function route() {
  const params = new URLSearchParams(location.hash.slice(1));
  const family = params.get('family');
  const career = content.careers.find((c) => c.id === params.get('career'));
  state.controller?.abort();
  state.request++;
  const nextFamily = career?.family || (familyNames[family] ? family : '');
  if (nextFamily !== state.family) { state.group = ''; state.query = ''; $('goalSearchInput').value = ''; }
  state.family = nextFamily;
  state.career = career || null;
  $('hero').hidden = Boolean(state.family);
  $('explore').hidden = Boolean(state.family);
  $('catalogSection').hidden = !state.family || Boolean(career);
  $('roadmapResult').hidden = !career;
  document.querySelectorAll('details').forEach((el) => { el.open = false; });
  if (career) {
    renderEducation(career);
    setPrograms([]);
    $('resultGoal').focus({ preventScroll: true });
    loadConnectedPrograms(career);
  } else if (state.family) {
    renderCatalog();
    $('catalogTitle').focus({ preventScroll: true });
  }
  document.title = `${career?.name || '꿈·전공 로드맵'} | HI5·ANiHi`;
  if (location.hash === '#explore') $('explore').scrollIntoView();
  else window.scrollTo({ top: 0, behavior: 'instant' });
}

$('groupTabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-group]');
  if (button) { state.group = button.dataset.group; renderCatalog(); }
});
$('goalSearchForm').addEventListener('submit', (event) => { event.preventDefault(); state.query = $('goalSearchInput').value; renderCatalog(); });
$('goalSearchInput').addEventListener('input', () => { state.query = $('goalSearchInput').value; renderCatalog(); });
for (const id of ['regionFilter', 'schoolFilter', 'admissionFilter', 'focusFilter']) $(id).addEventListener('change', () => { state.page = 1; renderUniversities(); linkUniversitySources(); });
document.querySelectorAll('.flow-strip a').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); document.querySelector(link.getAttribute('href')).scrollIntoView(); }));
$('printRoadmap').addEventListener('click', () => window.print());
window.addEventListener('hashchange', route);
// Revalidate private admissions on page restore; never persist the response in browser storage.
window.addEventListener('pageshow', (event) => { if (event.persisted) route(); });
route();

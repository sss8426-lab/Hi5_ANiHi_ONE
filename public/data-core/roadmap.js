import { careerStages, programView, filterPrograms, ratioFilterOptions, percent, admissionTrend, safeUrl, searchCareers } from './roadmap-model.js?v=20260911-ratio-filters';
import {detail as showGuideline} from '/admissions-web/renderer/guidelines.js?v=20260910-connected';
import {resolveUniversityLogo} from './university-logos.js?v=20260910-1';
import {foundationImages} from './foundation-images.js?v=20260910-1';
import { occupationImageConcepts } from './occupation-image-concepts.js?v=20260910-photo-v2';
import { paginate } from './pagination.js?v=20260909-1';

const content = window.HI5_ROADMAP_CONTENT || { careers: [], tracks: [], lessonAreas: [], sources: [] };
const $ = (id) => document.getElementById(id);
const state = { family: '', group: '', query: '', career: null, filters:{}, programs: [], page:1, visiblePrograms:[], pagination:null,total:0,trend:undefined,controller: null, request: 0 };
const filterControls = {region:'regionFilter',schoolType:'schoolFilter',admission:'admissionFilter',academicRatio:'academicRatioFilter',practicalRatio:'practicalRatioFilter'};
let guidelineController, guidelineRequest = 0;
const familyNames = { story: '만화·애니메이션·게임', design: '디자인' };
const h = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const art = (career) => {
  const concept = occupationImageConcepts.find((c) => c.occupationId === career.id);
  return concept ? `<img class="career-art job-image" src="${concept.asset}?v=${concept.version}" alt="${h(concept.action)}" width="480" height="640" loading="lazy" decoding="async">` : `<span class="career-art missing-art" data-missing-occupation="${h(career.id)}">이미지 준비 중</span>`;
};
const pathFor = (career) => `#family=${career.family}&career=${career.id}`;

function saveFilterRoute(push = false) {
  if (!state.career) return;
  const params = new URLSearchParams({family:state.family,career:state.career.id});
  for (const key of Object.keys(filterControls)) if (state.filters[key]) params.set(key,state.filters[key]);
  if (state.page > 1) params.set('page',String(state.page));
  const hash = '#' + params;
  if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](null,'',hash);
}

function showFilterOptions(facets = {}) {
  let reset = false;
  for (const [key,id] of Object.entries(filterControls)) {
    const selected = state.filters[key] || '';
    const numeric = key.endsWith('Ratio');
    const values = key === 'admission' ? ['수시','정시'] : facets[key] || [];
    const options = values.map(String);
    if (selected && !options.includes(selected)) { state.filters[key] = ''; reset = true; }
    $(id).innerHTML = '<option value="">전체</option>' + options.map(value => `<option value="${h(value)}">${h(value)}${numeric?'%':''}</option>`).join('');
    $(id).value = state.filters[key] || '';
  }
  return reset;
}

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
  $('careerDistinction').textContent = career.distinction || '';
  $('resultPortrait').innerHTML = art(career);
  $('changeGoalBtn').href = `#family=${career.family}`;
  $('majorGrid').innerHTML = career.majors.map((major) => `<span class="major-item">${h(major)}</span>`).join('');
  $('skillGrid').innerHTML = career.skills.map((skill) => `<span>${h(skill)}</span>`).join('');
  $('careerOutcome').textContent = career.outcome;
  $('universityExamples').innerHTML = career.universityExamples.map((example) => `<li>${h(example)}</li>`).join('');
  $('referenceSources').innerHTML = content.sources.filter((s) => ['커리어넷', '대입정보포털 어디가', '전문대학포털'].includes(s.name) && safeUrl(s.url)).map((source) => `<a href="${h(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${h(source.name)} ↗</a>`).join('');
  const steps = careerStages(career);
  $('curriculumTimeline').innerHTML = steps.map(([name, summary]) => `<li><h3>${h(name)}</h3><p>${h(summary)}</p></li>`).join('');
  $('trackDescription').textContent = `${track?.name || career.name} · 현재 작품에서 보완할 표현력과 목표 전형을 선생님과 함께 확인해요.`;
  const preparation = [
    ['미술 기초', career.foundation.join(' → '), '관찰하고 표현하는 힘'],
    ['전공 기초', career.specialization.join(' · '), '나의 전공 언어 익히기'],
    ['전공 심화', career.advanced.join(' → '), `대표 결과물: ${career.outcome}`],
    ['대학입시', career.preparation, '목표 대학의 최종 모집요강에 맞춰 준비'],
  ];
  $('preparationGrid').innerHTML = preparation.map(([name, description, note]) => `<article class="preparation-item"><h3>${h(name)}</h3><p>${h(description)}</p><small>${h(note)}</small></article>`).join('');
  $('lessonAreas').innerHTML = content.lessonAreas.filter((l) => l['단계'].startsWith('1 ')).map((l) => {
    const image=foundationImages[l['수업영역']];
    return `<article class="foundation-item">${image?`<img src="/data-core/assets/foundation/${image.asset}-v1.webp" alt="${h(image.alt)}" width="900" height="600" loading="lazy" decoding="async">`:''}<div class="foundation-copy"><h4>${h(l['수업영역'])}</h4><p><strong>${h(l['교육목표'])}</strong></p><p>${h(image?.detail||'')}</p><p>${h(l['권장 순서'])}</p><small>${h(image?.points||'')}</small></div></article>`;
  }).join('');
}

function renderUniversities() {
  cancelGuideline();
  const filtered = filterPrograms(state.programs, state.filters);
  const pagination = state.pagination ? {...state.pagination,rows:state.programs} : paginate(filtered, state.page);
  state.page = pagination.page;
  const rows = state.visiblePrograms = pagination.rows;
  const count=state.pagination?.total??filtered.length;
  $('universityCount').textContent = `${count}개 전형 · ${pagination.page} / ${pagination.totalPages} 페이지`;
  renderUniversityPagination(pagination, count);
  $('universityFilters').hidden = !(state.total||state.programs.length);
  if (!rows.length) {
    $('universityContent').innerHTML = `<p class="empty-state">${state.total||state.programs.length ? '선택한 조건에 해당하는 전형이 없습니다.' : '연결 대학 검수 필요 · 확인된 대학별 전형 정보가 아직 없습니다. 참고 예시는 최신 공식 안내를 확인해주세요.'}</p>`;
    return;
  }
  $('universityContent').innerHTML = `<div class="university-grid">${rows.map((p) => {
    const logo=resolveUniversityLogo(p.university,p.campus);
    const ratio=value=>value===null?'확인 필요':`${value}%`;
    return `<article class="university-item"><header class="university-title"><h3>${h(p.university)}</h3>${logo?`<img class="university-logo" src="${h(logo.src)}" alt="${h(logo.alt)}" title="${h(logo.title)}" width="100" height="40" loading="lazy" decoding="async">`:''}</header><p class="department">${h(p.department)}</p><p class="program-meta">${h([p.region,p.campus,p.schoolType,p.admission,p.year?`${p.year}학년도`:'학년도 확인 필요'].filter(Boolean).join(' · '))}</p><div class="ratios"><span>성적 <strong>${ratio(p.grade)}</strong></span><span>실기 <strong>${ratio(p.skill)}</strong></span>${p.other!==null?`<span>기타 <strong>${ratio(p.other)}</strong></span>`:''}</div>${p.ratioStatus==='staged'?'<p class="program-stage">단계별 전형 · 입시요강 확인</p>':''}${p.selectionFormula?`<p class="program-formula">${h(p.selectionFormula)}</p>`:''}<p class="program-meta">실기: ${h(p.practical || '모집요강 확인 필요')}</p>${p.publicFacts?`<p class="program-meta">모집 ${h(p.quota??'확인 필요')}명 · 전년도 경쟁률 ${h(p.competitionRate??'확인 필요')}</p>`:''}<p class="source-line">${p.verified?`공식 검수 완료 · ${h(p.verifiedAt)}`:p.publicFacts?'공개 입시정보 · 최종 지원 전 공식 모집요강 확인':'공식 모집요강 확인 필요'}</p></article>`;
  }).join('')}</div>`;
  $('universityContent').querySelectorAll('.university-logo').forEach(img=>{img.onerror=()=>{img.hidden=true;};});
}

function renderUniversityPagination(pagination, count) {
  let nav = $('universityPagination');
  if (!nav) { nav = document.createElement('nav'); nav.id = 'universityPagination'; nav.className = 'university-pagination'; nav.setAttribute('aria-label','관련 대학 페이지'); $('universityContent').after(nav); }
  nav.hidden = count <= 4;
  nav.innerHTML = `<button type="button" data-page="${pagination.page-1}" aria-label="이전 페이지" ${pagination.page===1?'disabled':''}>‹</button>${pagination.buttons.map(n => n === null ? '<span aria-hidden="true">…</span>' : `<button type="button" data-page="${n}" aria-label="${n} 페이지" ${n===pagination.page?'aria-current="page"':''}>${n}</button>`).join('')}<button type="button" data-page="${pagination.page+1}" aria-label="다음 페이지" ${pagination.page===pagination.totalPages?'disabled':''}>›</button>`;
  nav.querySelectorAll('[data-page]').forEach(button => { button.onclick = () => { state.page = Number(button.dataset.page); saveFilterRoute(true); loadConnectedPrograms(state.career); }; });
}

function renderTrend() {
  const trend = state.trend===undefined?admissionTrend(state.programs):state.trend;
  if (!trend) {
    $('trendContent').innerHTML = '<p class="empty-state">비교할 수 있는 검수된 전형 비율이 아직 충분하지 않습니다.</p><p class="trend-note">성적·실기 중요도를 임의의 비율로 정하지 않습니다. 같은 전공이라도 대학과 전형에 따라 준비 비중이 달라요.</p>';
    return;
  }
  $('trendContent').innerHTML = `<p>${h(trend.year)}학년도 · 연결된 검수 전형 ${trend.count}건의 평균</p><div class="trend-bars">${[['성적 반영', trend.grade], ['실기 반영', trend.skill]].map(([label, value]) => `<div class="bar-row"><span>${label}</span><div class="bar-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value.toFixed(1)}"><span style="width:${value.toFixed(1)}%"></span></div><strong>${value.toFixed(1)}%</strong></div>`).join('')}</div><p class="trend-note">전체 전공의 평균 중요도나 합격 가능성이 아닙니다. 위에 연결된 일부 전형만의 단순 평균이며, 면접·서류 등 다른 요소가 있을 수 있습니다. 실제 지원은 개별 대학의 최신 모집요강을 기준으로 해요.</p>`;
}

function setPrograms(programs,response={}) {
  state.pagination=response.pagination||null;state.total=response.total||programs.length;state.trend=response.trend;
  state.page = response.pagination?.page||state.page;
  state.programs = programs.map(programView);
  const facets = {region:[...new Set(state.programs.map(p=>p.region).filter(Boolean))].sort(),schoolType:[...new Set(state.programs.map(p=>p.schoolType).filter(Boolean))].sort(),...ratioFilterOptions(state.programs,state.filters),...response.facets};
  const reset = showFilterOptions(facets);
  if (reset && state.pagination) { state.page=1;saveFilterRoute();return false; }
  if (reset) state.page=1;
  renderUniversities();
  linkUniversitySources();
  renderTrend();
  saveFilterRoute();
  return true;
}

function linkUniversitySources() {
  const rows = state.visiblePrograms;
  $('universityContent').querySelectorAll('.university-item').forEach((item,index) => {
    const row = rows[index];
    if (!row?.guidelineId) {
      if(row?.verified && row.source){const link=document.createElement('a');link.className='university-source-link';link.href=row.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent='공식 모집요강';item.append(link);}
      return;
    }
    const link = document.createElement('button');link.type='button';
    link.className = 'university-source-link';
    link.textContent = '입시요강 보기';
    link.onclick=()=>openGuideline(row,link);
    item.append(link);
  });
}

function cancelGuideline() {
  guidelineRequest++;
  guidelineController?.abort();
  guidelineController = null;
  document.querySelector('.guideline-dialog')?.close();
}

async function openGuideline(row, button) {
  cancelGuideline();
  const request = guidelineRequest;
  const controller = guidelineController = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  button.disabled = true;
  try {
    const result = await api(`/api/data-core/admissions/guidelines?id=${encodeURIComponent(row.guidelineId)}`, controller.signal);
    if (request !== guidelineRequest || controller.signal.aborted) return;
    if (result.rows?.[0]?.id === row.guidelineId) {
      notice('');
      showGuideline(result.rows[0], { counseling: true });
    } else notice('저장된 입시요강을 찾을 수 없습니다.');
  } catch (error) {
    if (request !== guidelineRequest) return;
    notice(error.name === 'AbortError' ? '입시요강 조회 시간이 길어졌습니다. 다시 눌러주세요.' : '입시요강을 불러오지 못했습니다. 다시 시도해주세요.');
  } finally {
    clearTimeout(timeout);
    if (guidelineController === controller) guidelineController = null;
    button.disabled = false;
  }
}

async function api(url, signal) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) { const error = new Error('연결 실패'); error.status = response.status; throw error; }
  return response.json();
}

async function loadConnectedPrograms(career) {
  cancelGuideline();
  const requestId = ++state.request;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  // Goals and graph are sequential; allow cold-start D1 setup for both requests.
  const timeout = setTimeout(() => controller.abort(), 45000);
  notice('대학별 전형 정보를 확인하고 있습니다.');
  $('universityContent').setAttribute('aria-busy','true');
  $('universityContent').innerHTML = '';
  $('universityCount').textContent = '전형 조회 중';
  const pagination = $('universityPagination');
  if (pagination) pagination.hidden = true;
  try {
    const params=new URLSearchParams({careerId:career.id,page:String(state.page),...state.filters});
    const response = await api(`/api/data-core/roadmap/programs?${params}`, controller.signal);
    if (requestId !== state.request) return;
    if (!setPrograms(response.programs || [],response)) return loadConnectedPrograms(career);
    notice('');
  } catch (error) {
    if (requestId !== state.request) return;
    state.programs=[];state.pagination=null;state.total=0;state.trend=null;
    renderUniversities();renderTrend();
    notice(error.status === 401 ? '대학별 운영 입시정보는 교직원 로그인 후 확인할 수 있어요.' : error.status === 403 ? '대학별 전형 정보를 볼 권한이 없습니다.' : '대학별 전형 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', error.status === 401, ![401,403].includes(error.status));
  } finally { clearTimeout(timeout);if(requestId===state.request)$('universityContent').setAttribute('aria-busy','false'); }
}

function route() {
  cancelGuideline();
  const params = new URLSearchParams(location.hash.slice(1));
  const family = params.get('family');
  const career = content.careers.find((c) => c.id === params.get('career'));
  const sameCareer = Boolean(career && career.id === state.career?.id);
  state.controller?.abort();
  state.request++;
  const nextFamily = career?.family || (familyNames[family] ? family : '');
  if (nextFamily !== state.family) { state.group = ''; state.query = ''; $('goalSearchInput').value = ''; }
  state.family = nextFamily;
  state.career = career || null;
  state.filters = Object.fromEntries(Object.keys(filterControls).map(key=>{
    const value = params.get(key) || '';
    return [key,key.endsWith('Ratio') ? percent(value) === null ? '' : String(percent(value)) : value];
  }));
  state.page = /^\d+$/.test(params.get('page') || '') ? Math.min(1000,Math.max(1,Number(params.get('page')))) : 1;
  if (sameCareer) { loadConnectedPrograms(career);return; }
  $('hero').hidden = Boolean(state.family);
  $('explore').hidden = Boolean(state.family);
  $('catalogSection').hidden = !state.family || Boolean(career);
  $('roadmapResult').hidden = !career;
  document.querySelectorAll('details').forEach((el) => { el.open = false; });
  if (career) {
    for(const id of Object.values(filterControls))$(id).value='';
    renderEducation(career);
    state.programs=[];state.pagination=null;state.total=0;state.trend=undefined;
    $('universityFilters').hidden=true;
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
for (const [key,id] of Object.entries(filterControls)) $(id).addEventListener('change', () => {
  state.filters[key]=$(id).value;state.page=1;saveFilterRoute(true);loadConnectedPrograms(state.career);
});
document.querySelectorAll('.flow-strip a').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); document.querySelector(link.getAttribute('href')).scrollIntoView(); }));
$('printRoadmap').addEventListener('click', () => window.print());
window.addEventListener('hashchange', route);
// Revalidate private admissions on page restore; never persist the response in browser storage.
window.addEventListener('pageshow', (event) => { if (event.persisted) route(); });
route();

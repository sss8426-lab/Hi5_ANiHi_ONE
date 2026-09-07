const CATALOG = Array.isArray(window.HI5_DREAM_CATALOG) ? window.HI5_DREAM_CATALOG : [];
const PUBLIC_ROADMAP = Array.isArray(window.HI5_PUBLIC_ROADMAP) ? window.HI5_PUBLIC_ROADMAP : [];
const state = { goals: [], current: null, selectedCatalog: null, activeGroup: '전체' };
const $ = (id) => document.getElementById(id);

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[·ㆍ/\s_-]+/g, '').replace(/디자이너|디자인/g, 'design');
}

async function api(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

function setLoading(value) { $('loading').classList.toggle('hidden', !value); }
function showNotice(message) {
  $('notice').textContent = message || '';
  $('notice').classList.toggle('hidden', !message);
}

function groups() {
  return ['전체', ...Array.from(new Set(CATALOG.map((item) => item.group)))];
}

function renderGroupTabs() {
  $('groupTabs').innerHTML = groups().map((group) => `<button class="group-tab ${group === state.activeGroup ? 'active' : ''}" type="button" data-group="${h(group)}">${h(group)}</button>`).join('');
  document.querySelectorAll('[data-group]').forEach((button) => {
    button.onclick = () => {
      state.activeGroup = button.dataset.group || '전체';
      renderGroupTabs();
      renderGoals();
    };
  });
}

function exactServerGoal(catalogItem) {
  const target = normalize(catalogItem?.name);
  return state.goals.find((goal) => normalize(goal.name) === target)
    || state.goals.find((goal) => target && (normalize(goal.name).includes(target) || target.includes(normalize(goal.name))));
}

function renderGoals() {
  const items = state.activeGroup === '전체' ? CATALOG : CATALOG.filter((item) => item.group === state.activeGroup);
  $('goalGrid').innerHTML = items.map((goal) => {
    const connected = Boolean(exactServerGoal(goal));
    return `<button class="dream-card" type="button" data-catalog-name="${h(goal.name)}">
      <span class="dream-icon" aria-hidden="true">${h(goal.icon)}</span>
      <span class="dream-meta">${h(goal.group)}${connected ? ' · DATA CORE 연결' : ''}</span>
      <strong>${h(goal.name)}</strong>
      <span class="dream-summary">${h(goal.summary)}</span>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-catalog-name]').forEach((button) => {
    button.onclick = () => selectCatalogGoal(button.dataset.catalogName);
  });
}

function selectCatalogGoal(name) {
  const item = CATALOG.find((row) => row.name === name);
  if (!item) return;
  state.selectedCatalog = item;
  const serverGoal = exactServerGoal(item);
  loadRoadmap(item.name, serverGoal?.id || '');
}

function fallbackRoadmap(goalName) {
  const item = state.selectedCatalog || CATALOG.find((row) => normalize(row.name) === normalize(goalName));
  return {
    goal: goalName,
    goalMatches: item ? [{ name: item.name, summary: item.summary }] : [{ name: goalName, summary: '선택한 목표에 맞는 전공과 준비과정을 확인하세요.' }],
    roadmap: {
      majors: item?.majorHint ? [{ id: `fallback:${item.name}`, name: item.majorHint, summary: `${item.name}과 연결되는 대표 전공군` }] : [],
      universityPrograms: [],
      universities: [],
      admissionMethods: [],
      requiredSkills: [],
      curriculumSequence: [],
      missingData: { universityPrograms: true, universities: true, admissionMethods: true },
    },
    fallback: true,
  };
}

function matchFitsSelection(payload) {
  if (!state.selectedCatalog) return true;
  const match = payload?.goalMatches?.[0];
  if (!match?.name) return false;
  const a = normalize(state.selectedCatalog.name);
  const b = normalize(match.name);
  return a === b || a.includes(b) || b.includes(a);
}

function renderMajors(majors) {
  let rows = majors || [];
  if (!rows.length && state.selectedCatalog?.majorHint) {
    rows = state.selectedCatalog.majorHint.split(/[·,]/).map((name, index) => ({ id: `hint:${index}`, name: name.trim(), summary: `${state.selectedCatalog.name}과 연결되는 전공` })).filter((item) => item.name);
  }
  $('majorCount').textContent = rows.length;
  $('majorGrid').innerHTML = rows.length ? rows.map((major) => `<article class="major-item">
    <strong>${h(major.name)}</strong>
    <p>${h(major.summary || '')}</p>
  </article>`).join('') : '<div class="university-empty"><strong>연결 전공 데이터 준비 중</strong><p>DATA CORE 지식 그래프에 전공 연결이 추가되면 자동으로 표시됩니다.</p></div>';
}

function ratio(value) {
  if (value === null || value === undefined || value === '') return '확인 필요';
  const number = Number(value);
  return Number.isFinite(number) ? `${number}%` : h(value);
}

function metric(value) {
  if (value === null || value === undefined || value === '') return '확인 필요';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '확인 필요';
  if (typeof value === 'string') return value.trim() || '확인 필요';
  return '확인 필요';
}

function textOrEmpty(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function sourceUrl(value) {
  const candidate = textOrEmpty(value);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function deepScoreValue(value, wantedKeys) {
  if (!value || typeof value !== 'object') return null;
  const stack = [value];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = String(key).toLowerCase().replace(/[\s_-]/g, '');
      if (wantedKeys.some((wanted) => normalizedKey.includes(wanted))) {
        if (typeof child === 'string' || typeof child === 'number') return child;
      }
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

function programRow(program) {
  const metadata = program.metadata || {};
  const scores = metadata.requiredScores || {};
  const average = deepScoreValue(scores, ['average', 'avg', 'mean', '평균', '합격평균']);
  const minimum = deepScoreValue(scores, ['minimum', 'min', 'lowest', '최저', '최저성적']);
  return {
    university: metadata.universityName || metadata.schoolName || '대학 확인 필요',
    department: metadata.major || program.name || '학과 확인 필요',
    region: metadata.region || metadata.area || metadata.location || '확인 필요',
    skillRatio: ratio(metadata.skillRatio),
    gradeRatio: ratio(metadata.gradeRatio),
    competition: metric(metadata.rateCurrent),
    average: metric(average),
    minimum: metric(minimum),
    admission: metadata.admission || '',
    practical: metadata.practicalType || '',
    year: metadata.year || '',
    schoolType: metadata.schoolType || metadata.degreeType || '',
    source: sourceUrl(metadata.officialSourceUrl || metadata.sourceUrl || metadata.officialUrl),
    verification: textOrEmpty(metadata.verificationStatus || metadata.reviewStatus || metadata.verifiedAt),
  };
}

function renderUniversities(roadmap) {
  const programs = roadmap.universityPrograms || [];
  const universities = roadmap.universities || [];
  const rows = programs.map(programRow);
  for (const university of universities) {
    if (!rows.some((row) => row.university === university.name)) {
      rows.push({ university: university.name, department: '학과 정보 연결 중', region: '확인 필요', skillRatio: '확인 필요', gradeRatio: '확인 필요', competition: '확인 필요', average: '확인 필요', minimum: '확인 필요', admission: '', practical: '', year: '', schoolType: '', source: '', verification: '' });
    }
  }

  if (!rows.length) {
    $('universityContent').innerHTML = `<div class="university-empty">
      <strong>대학·학과 데이터 연결 준비 중</strong>
      <p>검증되지 않은 경쟁률·합격성적을 임의로 보여주지 않습니다. 기존 대학합격 로드맵의 실제 대학·입시 데이터를 DATA CORE와 연결하면 이 표에 자동으로 채워집니다.</p>
    </div>`;
    return;
  }

  $('universityContent').innerHTML = `<div class="university-table-wrap"><table class="university-table">
    <thead><tr><th>대학명</th><th>학과명</th><th>지역</th><th>실기반영비</th><th>성적반영비</th><th>경쟁률</th><th>합격평균성적</th><th>최저성적</th><th>출처·검수</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td><strong>${h(row.university)}</strong>${row.year ? `<small>${h(row.year)}학년도</small>` : ''}</td>
      <td>${h(row.department)}${[row.schoolType, row.admission, row.practical].filter(Boolean).length ? `<small>${h([row.schoolType, row.admission, row.practical].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td>${h(row.region)}</td><td>${h(row.skillRatio)}</td><td>${h(row.gradeRatio)}</td><td>${h(row.competition)}</td><td>${h(row.average)}</td><td>${h(row.minimum)}</td>
      <td><small>${row.source ? `<a class="source-link" href="${h(row.source)}" target="_blank" rel="noopener">공식 출처</a>` : '공식 출처 확인 필요'}${row.verification ? `<br>검수: ${h(row.verification)}` : '<br>검수 상태 확인 필요'}</small></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function fallbackSkills() {
  const group = state.selectedCatalog?.group;
  if (group === '디자인') {
    return [
      { name: '기초조형', summary: '형태·구성·비례를 시각적으로 정리하는 힘' },
      { name: '색채·재질', summary: '색의 관계와 소재 특성을 목적에 맞게 사용하는 힘' },
      { name: '아이디어·문제해결', summary: '주제를 분석하고 새로운 시각적 해결안을 만드는 힘' },
      { name: '디지털 제작', summary: '디지털 도구로 결과물을 정리하고 완성하는 힘' },
    ];
  }
  return [
    { name: '관찰·드로잉', summary: '형태와 비례를 정확하게 보고 표현하는 힘' },
    { name: '인체·공간', summary: '캐릭터와 배경을 자연스럽게 구성하는 힘' },
    { name: '색채·완성도', summary: '빛, 색, 재질과 화면의 집중도를 조절하는 힘' },
    { name: '스토리·전공표현', summary: '희망 전공의 방식으로 아이디어와 이야기를 전달하는 힘' },
  ];
}

function renderSkills(skills) {
  const rows = skills?.length ? skills : fallbackSkills();
  $('skillCount').textContent = rows.length;
  $('skillGrid').innerHTML = rows.map((skill, index) => `<article class="skill-item">
    <span class="skill-order">${String(index + 1).padStart(2, '0')}</span>
    <strong>${h(skill.name)}</strong>
    <p>${h(skill.summary || '')}</p>
  </article>`).join('');
}

function specificModules(sequence, index) {
  const stageMap = [
    ['기초'],
    ['중급'],
    ['전공'],
    ['입시'],
    [],
    [],
  ];
  const stages = stageMap[index] || [];
  return (sequence || []).filter((item) => stages.includes(String(item.stage || ''))).map((item) => item.name).slice(0, 4);
}

function renderCurriculum(sequence) {
  const base = PUBLIC_ROADMAP.length ? PUBLIC_ROADMAP : [
    { stage: '미술 기초', name: '표현의 기초 만들기', summary: '선·형태·관찰·명암·색채·인체·투시·배경·구도를 익힙니다.' },
    { stage: '전공 탐색/기초', name: '내 전공의 언어 익히기', summary: '전공 이해와 기초 프로젝트를 경험합니다.' },
    { stage: '전공 심화', name: '전공 프로젝트 완성하기', summary: '전공별 표현기법과 제작 능력을 강화합니다.' },
    { stage: '대학입시', name: '목표 대학 기준에 맞추기', summary: '대학별 실기·기출·모의고사·포트폴리오·면접을 준비합니다.' },
    { stage: '대학 전공교육', name: '전공을 체계적으로 확장하기', summary: '대학에서 전공교육과 협업 경험을 넓힙니다.' },
    { stage: '취업·창작·데뷔', name: '결과를 진로로 연결하기', summary: '포트폴리오와 창작·취업·데뷔로 연결합니다.' },
  ];
  $('curriculumTimeline').innerHTML = base.map((item, index) => {
    const modules = specificModules(sequence, index);
    return `<article class="timeline-item">
      <span class="timeline-step">${String(index + 1).padStart(2, '0')}</span>
      <div class="timeline-body">
        <div class="timeline-meta"><span class="stage-pill">${h(item.stage)}</span></div>
        <strong>${h(item.name)}</strong>
        <p>${h(item.summary || '')}</p>
        ${modules.length ? `<div class="module-tags">${modules.map((name) => `<span>${h(name)}</span>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }).join('');
}

function renderRoadmap(payload) {
  const roadmap = payload.roadmap;
  if (!roadmap) {
    renderRoadmap(fallbackRoadmap(payload.goal || state.selectedCatalog?.name || '선택한 목표'));
    return;
  }
  showNotice(payload.fallback ? '이 분야의 세부 대학 데이터는 연결 중이며, 확인된 정보만 표시합니다.' : '');
  state.current = payload;
  const match = payload.goalMatches?.[0];
  const catalog = state.selectedCatalog || CATALOG.find((item) => normalize(item.name) === normalize(match?.name));
  $('resultGoalIcon').textContent = catalog?.icon || '✦';
  $('resultGoal').textContent = catalog?.name || match?.name || payload.goal || '선택한 목표';
  $('resultGoalSummary').textContent = catalog?.summary || match?.summary || '꿈에서 역산한 준비 과정을 확인하세요.';
  renderMajors(roadmap.majors || []);
  renderUniversities(roadmap);
  renderSkills(roadmap.requiredSkills || []);
  renderCurriculum(roadmap.curriculumSequence || []);
  $('roadmapResult').classList.remove('hidden');
  $('roadmapResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadRoadmap(goal, goalId = '') {
  setLoading(true);
  try {
    const params = new URLSearchParams();
    if (goalId) params.set('goalId', goalId);
    else params.set('goal', goal);
    const payload = await api(`/api/data-core/roadmap?${params}`);
    if (!matchFitsSelection(payload)) renderRoadmap(fallbackRoadmap(goal));
    else renderRoadmap(payload);
  } catch (error) {
    if (state.selectedCatalog) renderRoadmap(fallbackRoadmap(state.selectedCatalog.name));
    else showNotice(error.message);
  } finally {
    setLoading(false);
  }
}

async function loadGoals() {
  try {
    const response = await api('/api/data-core/roadmap/goals');
    state.goals = response.goals || [];
  } catch (error) {
    state.goals = [];
    showNotice('DATA CORE 지식 연결을 불러오지 못했습니다. 기본 전공 카탈로그를 표시합니다.');
  }
  renderGroupTabs();
  renderGoals();
}

$('goalSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('goalSearchInput').value.trim();
  if (!value) return;
  const catalog = CATALOG.find((item) => normalize(item.name).includes(normalize(value)) || normalize(value).includes(normalize(item.name)) || normalize(item.summary).includes(normalize(value)));
  state.selectedCatalog = catalog || null;
  const serverGoal = catalog ? exactServerGoal(catalog) : null;
  loadRoadmap(catalog?.name || value, serverGoal?.id || '');
});

$('changeGoalBtn').onclick = () => {
  $('roadmapResult').classList.add('hidden');
  state.selectedCatalog = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => $('goalSearchInput').focus(), 350);
};

loadGoals();

const state = { goals: [], current: null };
const $ = (id) => document.getElementById(id);

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function api(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

function setLoading(value) { $('loading').classList.toggle('hidden', !value); }
function showNotice(message) {
  $('notice').textContent = message || '';
  $('notice').classList.toggle('hidden', !message);
}

function typeLabel(type) {
  return type === 'career' ? '꿈·직업' : type === 'major' ? '전공' : type;
}

function renderGoals() {
  $('goalGrid').innerHTML = state.goals.map((goal) => `<button class="goal-button" type="button" data-goal-id="${h(goal.id)}">
    <span class="goal-type">${h(typeLabel(goal.nodeType))}</span>
    <strong>${h(goal.name)}</strong>
    <span>${h(goal.summary || '')}</span>
  </button>`).join('');
  document.querySelectorAll('[data-goal-id]').forEach((button) => {
    button.onclick = () => loadRoadmap('', button.dataset.goalId);
  });
}

function renderMajors(majors) {
  $('majorCount').textContent = majors.length;
  $('majorGrid').innerHTML = majors.length ? majors.map((major) => `<article class="major-item">
    <strong>${h(major.name)}</strong>
    <p>${h(major.summary || '')}</p>
  </article>`).join('') : '<div class="university-empty"><strong>연결된 전공이 아직 없습니다.</strong><p>DATA CORE 지식 그래프에 관련 전공을 연결하면 자동으로 표시됩니다.</p></div>';
}

function renderUniversities(roadmap) {
  const programs = roadmap.universityPrograms || [];
  const universities = roadmap.universities || [];
  const admissionMethods = roadmap.admissionMethods || [];
  if (!programs.length && !universities.length) {
    $('universityContent').innerHTML = `<div class="university-empty">
      <strong>대학·학과 데이터 연결 준비 중</strong>
      <p>검증되지 않은 대학 정보를 임의로 보여주지 않습니다. 현재 입시컨설팅의 실제 대학·입시요강 데이터를 DATA CORE 지식 그래프에 연결하면 이 위치에 관련 대학, 학과, 성적·실기 반영방식과 실기유형이 자동으로 표시됩니다.</p>
    </div>`;
    return;
  }
  const programCards = programs.map((program) => {
    const metadata = program.metadata || {};
    const universityName = metadata.universityName || metadata.schoolName || '';
    return `<article class="university-item"><strong>${h(universityName ? `${universityName} · ${program.name}` : program.name)}</strong><p>${h(program.summary || '')}</p></article>`;
  }).join('');
  const universityCards = universities.filter((u) => !programs.some((p) => (p.metadata || {}).universityName === u.name)).map((u) => `<article class="university-item"><strong>${h(u.name)}</strong><p>${h(u.summary || '')}</p></article>`).join('');
  const tags = admissionMethods.map((item) => `<span class="admission-tag">${h(item.name)}</span>`).join('');
  $('universityContent').innerHTML = `<div class="university-grid">${programCards}${universityCards}</div>${tags ? `<div class="admission-tags">${tags}</div>` : ''}`;
}

function renderSkills(skills) {
  $('skillCount').textContent = skills.length;
  $('skillGrid').innerHTML = skills.map((skill, index) => `<article class="skill-item">
    <span class="skill-order">${String(index + 1).padStart(2, '0')}</span>
    <strong>${h(skill.name)}</strong>
    <p>${h(skill.summary || '')}</p>
  </article>`).join('');
}

function renderCurriculum(sequence) {
  $('curriculumTimeline').innerHTML = sequence.map((item) => `<article class="timeline-item">
    <span class="timeline-step">${String(item.step).padStart(2, '0')}</span>
    <div class="timeline-body">
      <div class="timeline-meta">${item.stage ? `<span class="stage-pill">${h(item.stage)}</span>` : ''}</div>
      <strong>${h(item.name)}</strong>
      <p>${h(item.summary || '')}</p>
    </div>
  </article>`).join('');
}

function renderRoadmap(payload) {
  const roadmap = payload.roadmap;
  if (!roadmap) {
    $('roadmapResult').classList.add('hidden');
    showNotice(payload.message || '로드맵을 만들 수 없습니다.');
    return;
  }
  showNotice('');
  state.current = payload;
  const match = payload.goalMatches?.[0];
  $('resultGoal').textContent = match?.name || payload.goal || '선택한 목표';
  $('resultGoalSummary').textContent = match?.summary || '꿈에서 역산한 준비 과정을 확인하세요.';
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
    renderRoadmap(await api(`/api/data-core/roadmap?${params}`));
  } catch (error) {
    showNotice(error.message);
  } finally {
    setLoading(false);
  }
}

async function loadGoals() {
  try {
    const response = await api('/api/data-core/roadmap/goals');
    state.goals = response.goals || [];
    renderGoals();
  } catch (error) {
    showNotice(error.message);
  }
}

$('goalSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('goalSearchInput').value.trim();
  if (!value) return;
  loadRoadmap(value);
});

$('changeGoalBtn').onclick = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => $('goalSearchInput').focus(), 350);
};

loadGoals();

(() => {
  const state = {
    context: null,
    campuses: [],
    health: null,
    classes: [],
    students: [],
    campusId: '',
    classId: '',
    status: 'active',
    q: '',
  };

  const $ = (id) => document.getElementById(id);
  const userEl = $('kkUser');
  const studentPanel = document.querySelector('.kk-students');
  const classGrid = document.querySelector('.kk-class-grid');
  const studentArea = document.querySelector('.kk-empty');
  const addStudentBtn = studentPanel?.querySelector('.kk-panel-head button');
  const heroBadge = document.querySelector('.kk-hero-badge');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error || body?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function health() {
    const response = await fetch('/api/kkumeum/health', {
      cache: 'no-store',
      credentials: 'include',
    });
    const body = await response.json().catch(() => ({}));
    return { statusCode: response.status, ...(body.status || {}) };
  }

  function renderUser() {
    const context = state.context;
    if (!context?.authenticated || !userEl) return;
    const name = context.user?.displayName || context.user?.email || '사용자';
    const role = context.isSuperAdmin
      ? '마스터 관리자'
      : (context.memberships || []).map((membership) => membership.role).join(' · ') || '업무용 사용자';
    const avatar = String(name).trim().slice(0, 1).toUpperCase() || 'H';
    userEl.innerHTML = `<span>${escapeHtml(avatar)}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(role)}</small></div>`;
  }

  function isManager() {
    if (state.context?.isSuperAdmin) return true;
    return (state.context?.memberships || []).some((membership) => (
      membership.campusId === state.campusId && membership.role === 'CAMPUS_DIRECTOR'
    ));
  }

  function setSetupState(message) {
    if (heroBadge) heroBadge.textContent = '연결 준비 중';
    if (addStudentBtn) addStudentBtn.disabled = true;
    const addClassBtn = $('kkAddClassBtn');
    if (addClassBtn) addClassBtn.disabled = true;
    if (classGrid) {
      classGrid.innerHTML = '<button type="button" disabled><span>FAMILY_DB 연결 필요</span><b>—</b></button>';
    }
    if (studentArea) {
      studentArea.innerHTML = `<strong>${escapeHtml(message)}</strong><p>학생·보호자 개인정보는 기존 DATA CORE DB/R2에 대신 저장하지 않습니다.</p>`;
    }
  }

  function renderBindingStatus() {
    const status = state.health || {};
    const db = $('familyDbStatus');
    const files = $('familyFilesStatus');
    if (db) db.textContent = status.database ? '연결됨' : '연결 준비 중';
    if (files) files.textContent = status.files ? '연결됨' : '연결 준비 중';
    if (heroBadge) heroBadge.textContent = status.ok ? '사용 가능' : '준비 단계';
  }

  function ensureToolbar() {
    if ($('kkToolbar')) return;
    const grid = document.querySelector('.kk-grid');
    if (!grid) return;
    const toolbar = document.createElement('section');
    toolbar.className = 'kk-toolbar';
    toolbar.id = 'kkToolbar';
    toolbar.innerHTML = `
      <label><span>캠퍼스</span><select id="kkCampus"></select></label>
      <label><span>반</span><select id="kkClass"><option value="">전체 반</option></select></label>
      <label><span>상태</span><select id="kkStatus"><option value="active">재원</option><option value="leave">휴원</option><option value="moved">이동</option><option value="graduated">졸업</option><option value="">전체</option></select></label>
      <label class="kk-search"><span>학생 검색</span><input id="kkSearch" placeholder="이름·학교 검색"></label>
      <button id="kkSearchBtn" type="button">검색</button>`;
    grid.parentNode.insertBefore(toolbar, grid);

    $('kkCampus').onchange = async (event) => {
      state.campusId = event.target.value;
      state.classId = '';
      await loadClassesAndStudents();
    };
    $('kkClass').onchange = async (event) => {
      state.classId = event.target.value;
      await loadStudents();
    };
    $('kkStatus').onchange = async (event) => {
      state.status = event.target.value;
      await loadStudents();
    };
    $('kkSearchBtn').onclick = async () => {
      state.q = $('kkSearch').value.trim();
      await loadStudents();
    };
    $('kkSearch').onkeydown = async (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      state.q = event.target.value.trim();
      await loadStudents();
    };
  }

  function renderCampusOptions() {
    const select = $('kkCampus');
    if (!select) return;
    select.innerHTML = state.campuses.map((campus) => (
      `<option value="${escapeHtml(campus.id)}" ${campus.id === state.campusId ? 'selected' : ''}>${escapeHtml(campus.name)}</option>`
    )).join('');
  }

  function renderClassFilter() {
    const select = $('kkClass');
    if (!select) return;
    select.innerHTML = '<option value="">전체 반</option>' + state.classes.map((item) => (
      `<option value="${escapeHtml(item.id)}" ${item.id === state.classId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
    )).join('');
  }

  function renderClasses() {
    if (!classGrid) return;
    const counts = new Map();
    for (const student of state.students) {
      const id = student.current_class_id || student.currentClassId || '';
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    classGrid.innerHTML = state.classes.length
      ? state.classes.map((item) => `<button type="button" data-class-id="${escapeHtml(item.id)}" class="${item.id === state.classId ? 'active' : ''}"><span>${escapeHtml(item.name)}</span><b>${counts.get(item.id) || 0}</b></button>`).join('')
      : '<button type="button" disabled><span>등록된 반 없음</span><b>0</b></button>';
    classGrid.querySelectorAll('[data-class-id]').forEach((button) => {
      button.onclick = async () => {
        state.classId = button.dataset.classId || '';
        renderClassFilter();
        await loadStudents();
      };
    });
  }

  function renderStudents() {
    if (!studentArea) return;
    if (!state.students.length) {
      studentArea.innerHTML = '<strong>조건에 맞는 학생이 없습니다.</strong><p>관리 권한이 있다면 학생을 등록하거나 검색 조건을 바꿔보세요.</p>';
      return;
    }
    studentArea.classList.add('kk-student-area');
    studentArea.innerHTML = `<div class="kk-student-list">${state.students.map((student) => {
      const className = student.class_name || student.className || '반 미지정';
      const school = student.school_name || student.schoolName || '';
      const grade = student.grade || '';
      return `<article data-student-id="${escapeHtml(student.id)}"><div><strong>${escapeHtml(student.display_name || student.displayName || student.name)}</strong><small>${escapeHtml([school, grade, className].filter(Boolean).join(' · '))}</small></div><span>${escapeHtml(student.status || 'active')}</span></article>`;
    }).join('')}</div>`;
    studentArea.querySelectorAll('[data-student-id]').forEach((row) => {
      row.onclick = () => window.dispatchEvent(new CustomEvent('kkumeum:select-student', { detail: { studentId: row.dataset.studentId } }));
    });
  }

  async function loadStudents() {
    if (!state.health?.ok || !state.campusId) return;
    const params = new URLSearchParams({ campusId: state.campusId });
    if (state.classId) params.set('classId', state.classId);
    if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);
    try {
      const result = await api(`/api/kkumeum/students?${params}`);
      state.students = result.students || [];
      renderStudents();
      renderClasses();
      window.dispatchEvent(new CustomEvent('kkumeum:students-updated', { detail: state }));
    } catch (error) {
      state.students = [];
      renderStudents();
      if (studentArea) studentArea.innerHTML = `<strong>${escapeHtml(error.message)}</strong><p>권한 또는 꿈이음 연결 상태를 확인하세요.</p>`;
    }
  }

  async function loadClassesAndStudents() {
    if (!state.health?.ok || !state.campusId) return;
    try {
      const result = await api(`/api/kkumeum/classes?campusId=${encodeURIComponent(state.campusId)}`);
      state.classes = result.classes || [];
      renderClassFilter();
      wireManagerActions();
      await loadStudents();
    } catch (error) {
      state.classes = [];
      renderClassFilter();
      if (studentArea) studentArea.innerHTML = `<strong>${escapeHtml(error.message)}</strong><p>현재 계정의 캠퍼스·반 권한을 확인하세요.</p>`;
    }
  }

  function wireManagerActions() {
    const manager = isManager();
    if (addStudentBtn) {
      addStudentBtn.disabled = !manager || !state.health?.ok;
      addStudentBtn.textContent = '+ 학생 등록';
      addStudentBtn.onclick = manager ? createStudent : null;
    }
    let addClassBtn = $('kkAddClassBtn');
    if (!addClassBtn && studentPanel) {
      addClassBtn = document.createElement('button');
      addClassBtn.type = 'button';
      addClassBtn.id = 'kkAddClassBtn';
      addClassBtn.textContent = '+ 반 추가';
      studentPanel.querySelector('.kk-panel-head')?.appendChild(addClassBtn);
    }
    if (addClassBtn) {
      addClassBtn.disabled = !manager || !state.health?.ok;
      addClassBtn.onclick = manager ? createClass : null;
    }
  }

  function openForm(title, fields, submit) {
    const dialog = document.createElement('dialog');
    dialog.className = 'kk-dialog';
    dialog.innerHTML = `<form method="dialog"><div class="kk-dialog-head"><h3>${escapeHtml(title)}</h3><button type="button" data-close aria-label="닫기">×</button></div>${fields.map((field) => `<label><span>${escapeHtml(field.label)}</span>${field.type === 'select' ? `<select name="${escapeHtml(field.name)}">${field.options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>` : `<input name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''} maxlength="${field.max || 160}" value="${escapeHtml(field.value || '')}">`}</label>`).join('')}<p class="kk-dialog-feedback" role="status"></p><div class="kk-dialog-actions"><button type="button" data-close>취소</button><button class="primary" type="submit">저장</button></div></form>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => dialog.close(); });
    dialog.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      const feedback = dialog.querySelector('.kk-dialog-feedback');
      try { await submit(data); dialog.close(); } catch (error) { feedback.textContent = error.message || '저장하지 못했습니다.'; }
    };
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  }

  function createClass() {
    openForm('반 추가', [
      { name: 'name', label: '반 이름', required: true },
      { name: 'stage', label: '수업 단계' },
    ], async (data) => {
      await api('/api/kkumeum/classes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campusId: state.campusId, ...data }) });
      await loadClassesAndStudents();
    });
  }

  function createStudent() {
    openForm('학생 등록', [
      { name: 'name', label: '학생 이름', required: true, max: 100 },
      { name: 'grade', label: '학년' },
      { name: 'schoolName', label: '학교' },
      { name: 'classId', label: '반', type: 'select', options: [{ value: '', label: '반 미지정' }, ...state.classes.map((item) => ({ value: item.id, label: item.name }))] },
      { name: 'status', label: '상태', type: 'select', options: [{ value: 'active', label: '재원' }, { value: 'leave', label: '휴원' }, { value: 'moved', label: '이동' }, { value: 'graduated', label: '졸업' }] },
    ], async (data) => {
      await api('/api/kkumeum/students', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campusId: state.campusId, ...data, classId: data.classId || null }) });
      await loadStudents();
    });
  }

  async function initialize() {
    try {
      state.context = await api('/api/data-core/context');
      if (!state.context?.authenticated) return;
      renderUser();
      ensureToolbar();

      const campuses = await api('/api/data-core/campuses');
      state.campuses = campuses.campuses || [];
      state.campusId = state.campuses[0]?.id || '';
      renderCampusOptions();

      state.health = await health();
      renderBindingStatus();
      if (!state.health.ok) {
        setSetupState('꿈이음 전용 저장소 연결 후 학생·반 관리가 활성화됩니다.');
        return;
      }
      await loadClassesAndStudents();
      window.KkumeumStaff = { state, api, loadStudents, loadClassesAndStudents, isManager };
      window.dispatchEvent(new CustomEvent('kkumeum:ready', { detail: state }));
    } catch (error) {
      if (userEl?.querySelector('small')) userEl.querySelector('small').textContent = 'CORE 연결 확인 필요';
      setSetupState(error.message || '꿈이음 연결 상태를 확인할 수 없습니다.');
    }
  }

  initialize();
})();

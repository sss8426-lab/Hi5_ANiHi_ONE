(() => {
  const state = {
    context: null,
    health: null,
    campuses: [],
    campusId: '',
    classes: [],
    students: [],
    scope: '',
    draftId: '',
    announcements: [],
  };

  const $ = (id) => document.getElementById(id);
  const form = $('kkNoticeForm');
  if (!form) return;

  const scopeEl = $('kkNoticeScope');
  const targetEl = $('kkNoticeTarget');
  const targetWrap = $('kkNoticeTargetWrap');
  const titleEl = $('kkNoticeTitle');
  const bodyEl = $('kkNoticeBody');
  const saveEl = $('kkNoticeSave');
  const updateEl = $('kkNoticeUpdate');
  const publishEl = $('kkNoticePublish');
  const refreshEl = $('kkNoticeRefresh');
  const feedbackEl = $('kkNoticeFeedback');
  const listEl = $('kkNoticeList');
  const permissionEl = $('kkNoticePermission');
  const publishedCountEl = $('kkPublishedNoticeCount');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

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
      throw error;
    }
    return body;
  }

  async function health() {
    const response = await fetch('/api/kkumeum/health', { cache: 'no-store', credentials: 'include' });
    const body = await response.json().catch(() => ({}));
    return body.status || { database: false, files: false, ok: false };
  }

  function setFeedback(message, tone = '') {
    if (!feedbackEl) return;
    feedbackEl.textContent = message || '';
    feedbackEl.classList.toggle('error', tone === 'error');
    feedbackEl.classList.toggle('success', tone === 'success');
  }

  function rolesForCampus(campusId) {
    return (state.context?.memberships || [])
      .filter((membership) => !membership.campusId || membership.campusId === campusId)
      .map((membership) => membership.role);
  }

  function scopeOptions() {
    if (state.context?.isSuperAdmin) {
      return [
        ['organization', '전체공지'],
        ['campus', '캠퍼스공지'],
        ['class', '반소식'],
        ['student', '개별소식'],
      ];
    }
    const roles = new Set(rolesForCampus(state.campusId));
    const rows = [];
    if ((roles.has('CAMPUS_DIRECTOR') || roles.has('CAMPUS_ADMIN'))) rows.push(['campus', '캠퍼스공지'], ['class', '반소식'], ['student', '개별소식']);
    if (roles.has('TEACHER')) rows.push(['class', '반소식'], ['student', '개별소식']);
    if (roles.has('STAFF')) rows.push(['campus', '캠퍼스공지']);
    return Array.from(new Map(rows.map((row) => [row[0], row])).values());
  }

  function canUseFamilyContent() {
    return Boolean(state.health?.database);
  }

  function canUseClassStudentTargets() {
    return Boolean(state.health?.ok);
  }

  function ensureCampusField() {
    if ($('kkNoticeCampus')) return;
    const label = document.createElement('label');
    label.className = 'kk-notice-campus';
    label.innerHTML = '<span>캠퍼스</span><select id="kkNoticeCampus"></select>';
    form.insertBefore(label, scopeEl.closest('label'));
    $('kkNoticeCampus').onchange = async (event) => {
      state.campusId = event.target.value;
      state.draftId = '';
      renderCampusOptions();
      renderScopes();
      await loadTargets();
      await loadAnnouncements();
      syncButtons();
    };
  }

  function visibleCampuses() {
    if (state.context?.isSuperAdmin) return state.campuses;
    const allowed = new Set(state.context?.campusIds || []);
    return state.campuses.filter((campus) => allowed.has(campus.id));
  }

  function renderCampusOptions() {
    const el = $('kkNoticeCampus');
    if (!el) return;
    const rows = visibleCampuses();
    el.innerHTML = rows.length
      ? rows.map((campus) => `<option value="${escapeHtml(campus.id)}" ${campus.id === state.campusId ? 'selected' : ''}>${escapeHtml(campus.name)}</option>`).join('')
      : '<option value="">사용 가능한 캠퍼스 없음</option>';
    el.disabled = !canUseFamilyContent() || !rows.length;
  }

  function renderScopes() {
    if (!scopeEl) return;
    let rows = scopeOptions();
    if (!canUseClassStudentTargets()) rows = rows.filter(([value]) => value === 'organization' || value === 'campus');
    if (!rows.some(([value]) => value === state.scope)) state.scope = rows[0]?.[0] || '';
    scopeEl.innerHTML = rows.length
      ? rows.map(([value, label]) => `<option value="${value}" ${value === state.scope ? 'selected' : ''}>${label}</option>`).join('')
      : '<option value="">발행 권한 없음</option>';
    scopeEl.disabled = !canUseFamilyContent() || !rows.length;
    if (permissionEl) {
      permissionEl.textContent = rows.length
        ? '현재 계정 권한 범위만 표시됩니다.'
        : '소식 발행 권한이 없습니다.';
    }
  }

  async function loadClasses() {
    if (!state.campusId || !canUseClassStudentTargets()) {
      state.classes = [];
      return;
    }
    const result = await api(`/api/kkumeum/classes?campusId=${encodeURIComponent(state.campusId)}`);
    state.classes = result.classes || [];
  }

  async function loadStudents() {
    if (!state.campusId || !canUseClassStudentTargets()) {
      state.students = [];
      return;
    }
    const result = await api(`/api/kkumeum/students?campusId=${encodeURIComponent(state.campusId)}&status=active`);
    state.students = result.students || [];
  }

  async function loadTargets() {
    if (!targetEl || !targetWrap) return;
    targetWrap.hidden = state.scope === 'organization' || state.scope === 'campus';
    if (targetWrap.hidden) {
      targetEl.disabled = true;
      targetEl.innerHTML = '<option value="">자동 지정</option>';
      return;
    }
    try {
      if (state.scope === 'class') await loadClasses();
      if (state.scope === 'student') await loadStudents();
      const rows = state.scope === 'class' ? state.classes : state.students;
      targetEl.innerHTML = '<option value="">대상 선택</option>' + rows.map((item) => {
        const id = item.id;
        const label = state.scope === 'class'
          ? item.name
          : (item.display_name || item.displayName || item.name || '학생');
        return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
      }).join('');
      targetEl.disabled = !rows.length;
      if (!rows.length) setFeedback('현재 권한 범위에서 선택할 수 있는 대상이 없습니다.', 'error');
    } catch (error) {
      targetEl.innerHTML = '<option value="">대상 불러오기 실패</option>';
      targetEl.disabled = true;
      setFeedback(error.message, 'error');
    }
  }

  function noticePayload() {
    const title = titleEl?.value.trim() || '';
    const body = bodyEl?.value.trim() || '';
    if (!state.scope) throw new Error('전달 범위를 선택하세요.');
    if (!title) throw new Error('제목을 입력하세요.');
    if (!body) throw new Error('내용을 입력하세요.');

    if (state.scope === 'organization') {
      return {
        announcementType: 'organization-notice',
        title,
        body,
        targets: [{ targetType: 'organization' }],
      };
    }
    if (!state.campusId) throw new Error('캠퍼스를 선택하세요.');
    if (state.scope === 'campus') {
      return {
        campusId: state.campusId,
        announcementType: 'campus-news',
        title,
        body,
        targets: [{ targetType: 'campus', targetId: state.campusId }],
      };
    }
    const targetId = targetEl?.value || '';
    if (!targetId) throw new Error('전달 대상을 선택하세요.');
    return {
      campusId: state.campusId,
      announcementType: state.scope === 'class' ? 'class-news' : 'child-message',
      title,
      body,
      targets: [{ targetType: state.scope, targetId }],
    };
  }

  function syncButtons() {
    const enabled = canUseFamilyContent() && Boolean(state.scope);
    if (titleEl) titleEl.disabled = !enabled;
    if (bodyEl) bodyEl.disabled = !enabled;
    if (saveEl) saveEl.disabled = !enabled || Boolean(state.draftId);
    if (updateEl) updateEl.disabled = !enabled || !state.draftId;
    if (publishEl) publishEl.disabled = !enabled || !state.draftId;
    if (refreshEl) refreshEl.disabled = !canUseFamilyContent();
  }

  function resetDraft() {
    state.draftId = '';
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    syncButtons();
  }

  async function createDraft(event) {
    event.preventDefault();
    try {
      const payload = noticePayload();
      const result = await api('/api/kkumeum/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.draftId = result.announcement?.id || '';
      setFeedback('임시저장했습니다. 내용을 다시 확인한 뒤 발행하세요.', 'success');
      syncButtons();
      await loadAnnouncements();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  async function updateDraft() {
    if (!state.draftId) return;
    try {
      await api(`/api/kkumeum/announcements/${encodeURIComponent(state.draftId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(noticePayload()),
      });
      setFeedback('수정 내용을 임시저장에 반영했습니다.', 'success');
      await loadAnnouncements();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  async function publishDraft() {
    if (!state.draftId) return;
    const confirmed = window.confirm('이 소식을 선택한 보호자에게 발행할까요? 발행 후에는 현재 화면에서 수정하지 않습니다.');
    if (!confirmed) return;
    try {
      await api(`/api/kkumeum/announcements/${encodeURIComponent(state.draftId)}/publish`, { method: 'POST' });
      setFeedback('보호자에게 소식을 발행했습니다.', 'success');
      resetDraft();
      await loadAnnouncements();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  function renderAnnouncements() {
    if (!listEl) return;
    const rows = state.announcements || [];
    if (publishedCountEl) {
      publishedCountEl.textContent = String(rows.filter((item) => item.status === 'published').length);
    }
    listEl.innerHTML = rows.length
      ? rows.map((item) => {
          const typeLabels = {
            'organization-notice': '전체공지',
            'campus-news': '캠퍼스공지',
            'class-news': '반소식',
            'child-message': '개별소식',
            'selected-delivery': '선택전달',
          };
          const status = item.status === 'published' ? '발행완료' : '임시저장';
          return `<article class="kk-announcement-card"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(typeLabels[item.announcementType] || item.announcementType)} · 대상 ${Number(item.targetCount || 0)} · ${escapeHtml(item.updatedAt || item.createdAt || '')}</small></div><span class="status ${item.status === 'published' ? 'published' : ''}">${status}</span></article>`;
        }).join('')
      : '<div class="kk-empty"><strong>등록된 소식이 없습니다.</strong><p>예시 데이터 없이 실제 작성한 소식만 표시합니다.</p></div>';
  }

  async function loadAnnouncements() {
    if (!canUseFamilyContent()) return;
    try {
      const params = new URLSearchParams();
      if (state.campusId) params.set('campusId', state.campusId);
      const result = await api(`/api/kkumeum/announcements${params.size ? `?${params}` : ''}`);
      state.announcements = result.announcements || [];
      renderAnnouncements();
    } catch (error) {
      state.announcements = [];
      renderAnnouncements();
      setFeedback(error.message, 'error');
    }
  }

  async function onScopeChange() {
    state.scope = scopeEl?.value || '';
    state.draftId = '';
    await loadTargets();
    syncButtons();
  }

  async function initialize() {
    try {
      state.context = await api('/api/data-core/context');
      if (!state.context?.authenticated) return;
      state.health = await health();
      ensureCampusField();

      if (!state.health.database) {
        renderCampusOptions();
        renderScopes();
        syncButtons();
        setFeedback('FAMILY_DB 연결 후 소식 작성 기능이 활성화됩니다. 일반 DATA CORE에는 대신 저장하지 않습니다.', 'error');
        return;
      }

      const campusResult = await api('/api/data-core/campuses');
      state.campuses = campusResult.campuses || [];
      state.campusId = visibleCampuses()[0]?.id || '';
      renderCampusOptions();
      renderScopes();
      await loadTargets();
      await loadAnnouncements();
      syncButtons();
      if (!state.health.files) {
        setFeedback('소식 본문은 작성할 수 있습니다. 학생 작품 첨부는 FAMILY_FILES 연결 후 별도 단계에서 제공합니다.');
      } else {
        setFeedback('권한 범위 안에서 소식을 임시저장하고 검토 후 발행할 수 있습니다.');
      }
    } catch (error) {
      setFeedback(error.message || '소식 기능을 불러오지 못했습니다.', 'error');
    }
  }

  scopeEl?.addEventListener('change', onScopeChange);
  form.addEventListener('submit', createDraft);
  updateEl?.addEventListener('click', updateDraft);
  publishEl?.addEventListener('click', publishDraft);
  refreshEl?.addEventListener('click', loadAnnouncements);

  initialize();
})();

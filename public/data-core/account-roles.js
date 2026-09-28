export function initAccountRoles({ api, escapeHtml: h, onChanged }) {
  const $ = id => document.getElementById(id);
  const tabs = [$('accountsTab'), $('rolesTab')];
  let loaded = false;
  let loading = false;
  let saving = false;
  const labels = { MASTER: '마스터 관리자', SUPER_ADMIN: '마스터 관리자', CAMPUS_ADMIN: '캠퍼스 관리자', CAMPUS_DIRECTOR: '캠퍼스 원장', TEACHER: '교사', STAFF: '직원' };
  const message = text => { $('membershipMessage').textContent = text; };

  async function refresh() {
    if (loading) return;
    loading = true;
    $('refreshMembershipsBtn').disabled = true;
    message('권한을 불러오는 중...');
    try {
      const [memberships, users, campuses] = await Promise.all([
        api('/api/data-core/admin/memberships'), api('/api/data-core/admin/users'), api('/api/data-core/campuses'),
      ]);
      const selectedUser = $('memberUser').value;
      const selectedCampus = $('memberCampus').value;
      $('memberUser').innerHTML = '<option value="">사용자 선택</option>' + (users.users || []).filter(user => user.status === 'active').map(user => `<option value="${h(user.id)}">${h(user.display_name)}${user.email ? ` (${h(user.email)})` : ''}</option>`).join('');
      $('memberCampus').innerHTML = (campuses.campuses || []).map(campus => `<option value="${h(campus.id)}">${h(campus.name)}</option>`).join('');
      if (selectedUser) $('memberUser').value = selectedUser;
      if (selectedCampus) $('memberCampus').value = selectedCampus;
      const rows = memberships.memberships || [];
      $('membershipList').innerHTML = rows.map(item => `<div class="membership-item"><div><strong>${h(item.display_name || item.email || item.user_id)}</strong><small>${h(item.email || '')} · ${h(item.campus_name || '전체 조직')} · ${h(labels[item.role] || item.role)}</small></div><button type="button" class="danger-btn" data-delete-membership="${h(item.id)}">해제</button></div>`).join('');
      message(rows.length ? '' : '등록된 권한이 없습니다.');
      loaded = true;
    } catch (error) { message(error.message); }
    finally { loading = false; $('refreshMembershipsBtn').disabled = false; }
  }

  function select(roles, push = false) {
    tabs.forEach((tab, index) => {
      const active = index === (roles ? 1 : 0);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $('accountsPanel').hidden = roles;
    $('rolesPanel').hidden = !roles;
    if (push) {
      const url = new URL(location.href);
      if (roles) url.searchParams.set('tab', 'roles'); else url.searchParams.delete('tab');
      history.pushState(null, '', url);
    }
    if (roles && !loaded) void refresh();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index === 1, true));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      select(next === 1, true); tabs[next].focus();
    });
  });
  window.addEventListener('popstate', () => select(new URLSearchParams(location.search).get('tab') === 'roles'));
  $('refreshMembershipsBtn').addEventListener('click', refresh);
  $('memberRole').addEventListener('change', () => { $('memberCampus').disabled = $('memberRole').value === 'SUPER_ADMIN'; });

  async function mutate(action) {
    if (saving || loading) return;
    saving = true;
    const controls = [...$('rolesPanel').querySelectorAll('button, input, select')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await action(); await refresh(); await onChanged(); }
    catch (error) { message(error.message); }
    finally { controls.forEach((control, index) => { control.disabled = disabled[index]; }); saving = false; }
  }
  $('membershipForm').addEventListener('submit', event => {
    event.preventDefault();
    const role = $('memberRole').value;
    const payload = { userId: $('memberUser').value, role, campusId: role === 'SUPER_ADMIN' ? null : $('memberCampus').value };
    void mutate(() => api('/api/data-core/admin/memberships', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
  });
  $('membershipList').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-membership]');
    if (!button || saving || !confirm('이 사용자의 DATA CORE 권한을 해제할까요?')) return;
    void mutate(() => api(`/api/data-core/admin/memberships/${encodeURIComponent(button.dataset.deleteMembership)}`, { method: 'DELETE' }));
  });
  select(new URLSearchParams(location.search).get('tab') === 'roles');
}

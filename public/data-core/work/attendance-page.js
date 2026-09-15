import { mountAttendance } from './attendance.js?v=20260915-template-recovery';

export function mountAttendancePage(host, { context, campuses }) {
  host.replaceChildren();
  if (!context?.authenticated) {
    host.textContent = '로그인 후 출석부를 사용할 수 있습니다.';
    return () => {};
  }
  const allowed = campuses.filter(campus => context.isSuperAdmin || context.memberships?.some(
    membership => membership.campusId === campus.id && ['CAMPUS_ADMIN', 'CAMPUS_DIRECTOR', 'TEACHER'].includes(membership.role)
  ));
  if (!allowed.length) {
    host.textContent = '출석부 생성은 캠퍼스 관리자와 교사만 사용할 수 있습니다.';
    return () => {};
  }
  const label = document.createElement('label');
  label.className = 'at-campus';
  label.append('캠퍼스');
  const select = document.createElement('select');
  select.id = 'atCampus';
  allowed.forEach(campus => select.add(new Option(campus.name, campus.id)));
  select.disabled = allowed.length === 1;
  label.append(select);
  const tool = document.createElement('div');
  host.append(label, tool);
  let cleanup;
  const render = () => {
    cleanup?.();
    tool.replaceChildren();
    const campus = allowed.find(item => item.id === select.value);
    if (campus) cleanup = mountAttendance(tool, { campusName: campus.name });
  };
  select.onchange = render;
  render();
  return () => { cleanup?.(); select.onchange = null; host.replaceChildren(); };
}

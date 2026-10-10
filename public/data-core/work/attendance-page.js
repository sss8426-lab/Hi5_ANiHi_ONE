import { mountRosterAttendance } from './attendance-roster.js?v=20261010-roster-review';

export const TEMPLATE_URL = '/data-core/work/templates/attendance-roster-template.xlsx?v=20260928-dist';
export const TEMPLATE_NAME = '출석부_종합입력_기본양식.xlsx';

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
  // The official blank 종합입력 form (sheet-protected, with 작성예시 and 사용안내 sheets) that the upload
  // below reads. Staff start every new term from this file.
  const template = document.createElement('a');
  template.className = 'at-template';
  template.id = 'atTemplate';
  template.href = TEMPLATE_URL;
  template.download = TEMPLATE_NAME;
  template.innerHTML = '<svg class="at-icon" aria-hidden="true"><use href="/data-core/assets/core-icons.svg#Download"/></svg>출석부 기본 양식';
  template.title = '종합입력 기본 양식(.xlsx) 다운로드';
  const head = document.createElement('div');
  head.className = 'at-head';
  head.append(label, template);
  const roster = document.createElement('div');
  host.append(head, roster);
  let cleanups = [];
  const render = () => {
    cleanups.forEach(cleanup => cleanup?.());
    cleanups = [];
    roster.replaceChildren();
    const campus = allowed.find(item => item.id === select.value);
    if (campus) cleanups = [mountRosterAttendance(roster, { campusId: campus.id, campusName: campus.name })];
  };
  select.onchange = render;
  render();
  return () => { cleanups.forEach(cleanup => cleanup?.()); select.onchange = null; host.replaceChildren(); };
}

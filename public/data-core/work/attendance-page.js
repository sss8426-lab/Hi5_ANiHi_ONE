import { mountAttendance } from './attendance.js?v=20260921-weekend-selection';
import { mountRosterAttendance } from './attendance-roster.js?v=20260928-template';

const LEGACY_OPEN_KEY = 'core.attendance.legacyOpen';
export const TEMPLATE_URL = '/data-core/work/templates/attendance-roster-template.xlsx?v=20260928';
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
  // 종합입력 → 반별 출석부 is the standard flow; the older "last month's sheet → next month" tool stays
  // available below for campuses that still keep per-class files.
  const roster = document.createElement('div');
  const legacy = document.createElement('details');
  legacy.className = 'at-legacy';
  const summary = document.createElement('summary');
  summary.textContent = '지난달 출석부로 다음 달 만들기 (기존 방식)';
  const tool = document.createElement('div');
  legacy.append(summary, tool);
  try { legacy.open = localStorage.getItem(LEGACY_OPEN_KEY) === '1'; } catch { /* storage unavailable */ }
  legacy.ontoggle = () => { try { localStorage.setItem(LEGACY_OPEN_KEY, legacy.open ? '1' : '0'); } catch { /* storage unavailable */ } };
  host.append(head, roster, legacy);
  let cleanups = [];
  const render = () => {
    cleanups.forEach(cleanup => cleanup?.());
    cleanups = [];
    roster.replaceChildren();
    tool.replaceChildren();
    const campus = allowed.find(item => item.id === select.value);
    if (campus) cleanups = [
      mountRosterAttendance(roster, { campusId: campus.id, campusName: campus.name }),
      mountAttendance(tool, { campusName: campus.name }),
    ];
  };
  select.onchange = render;
  render();
  return () => { cleanups.forEach(cleanup => cleanup?.()); select.onchange = null; legacy.ontoggle = null; host.replaceChildren(); };
}

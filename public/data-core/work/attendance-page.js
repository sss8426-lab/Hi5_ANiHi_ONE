import { mountAttendance } from './attendance.js?v=20260921-weekend-selection';
import { mountRosterAttendance } from './attendance-roster.js?v=20260924-holidays';

const LEGACY_OPEN_KEY = 'core.attendance.legacyOpen';

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
  host.append(label, roster, legacy);
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

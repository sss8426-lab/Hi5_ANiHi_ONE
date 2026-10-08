// Dates for 고정 업무 (fixed tasks on 학원 공통 일정) and the 월간 업무보고 deadline.
// Shared by the calendar page, the 월간 업무보고 page and the server, so every screen shows the same day.
export const FIXED_RULES = {
  'first-saturday': '매월 첫째 주 토요일 (첫 주가 3일 이하면 다음 주 토요일)',
  'month-end': '매월 마지막 날',
  'month-day': '매월 ○일',
  weekday: '매주 ○요일',
};
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 매월 첫째 주 토요일. When the month starts on Thursday, Friday or Saturday the first week has three days
// or fewer, so the deadline moves to the next Saturday (2026-10: the 1st is a Thursday → 10월 10일).
export function firstSaturday(year, month) {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  let day = 1 + (6 - dow);
  if (day <= 3) day += 7;
  return iso(year, month, day);
}

export function ruleDates(rule, value, year, month) {
  if (rule === 'first-saturday') return [firstSaturday(year, month)];
  if (rule === 'month-end') return [iso(year, month, daysIn(year, month))];
  if (rule === 'month-day') return [iso(year, month, Math.min(Math.max(1, Number(value) || 1), daysIn(year, month)))];
  if (rule === 'weekday') {
    const out = [];
    for (let d = 1; d <= daysIn(year, month); d++) if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === Number(value)) out.push(iso(year, month, d));
    return out;
  }
  return [];
}

export const shiftMonth = (month, n) => { const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
// The 업무보고 for a month is due on the first Saturday (rule above) of the following month.
export const reportDeadline = reportMonth => { const [y, m] = shiftMonth(reportMonth, 1).split('-').map(Number); return firstSaturday(y, m); };
export const ruleLabel = (rule, value) => rule === 'month-day' ? `매월 ${value}일` : rule === 'weekday' ? `매주 ${WEEKDAYS[value] || ''}요일` : FIXED_RULES[rule] || '';

// Manual confirmation is count-based, not a promise of a particular clock time.
export const REVIEW_DAYS = [1, 2, 3, 4, 5, 6, 0];
export function reviewSchedule(days) {
  const counts = Object.fromEntries(REVIEW_DAYS.map(day => [day, 0]));
  for (const day of days) {
    if (!Number.isInteger(day) || !(day in counts)) throw Error('수업요일을 다시 선택해주세요.');
    counts[day]++;
  }
  if (REVIEW_DAYS.some(day => counts[day] > (day === 0 || day === 6 ? 3 : 1))) throw Error('주말 수업은 각각 최대 3타임까지 선택해주세요.');
  if (!Object.values(counts).some(Boolean)) throw Error('학생별 수업요일을 선택해주세요.');
  return { counts };
}

export function confirmedCounts(value) {
  if (!value || typeof value !== 'object') return null; // Existing string overrides remain compatible.
  const counts = value.counts;
  if (!counts || REVIEW_DAYS.some(day => !Number.isInteger(counts[day]) || counts[day] < 0 || counts[day] > (day === 0 || day === 6 ? 3 : 1))) throw Error('수업요일을 다시 선택해주세요.');
  return reviewSchedule(REVIEW_DAYS.flatMap(day => Array(counts[day]).fill(day))).counts;
}

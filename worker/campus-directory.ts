// Public campus codes are stable aliases; existing foreign keys stay unchanged.
export const CAMPUS_DIRECTORY = [
  { code: 'BUCHEON_ANI', id: 'campus-anihi-admission', loginId: 'ba', name: '부천 애니입시관', displayName: '부천 애니 입시본원', displayOrder: 2 },
  { code: 'BUCHEON_DESIGN', id: 'campus-design-admission', loginId: 'bd', name: '부천 디자인입시관', displayName: '부천 디자인 입시본원', displayOrder: 1 },
  { code: 'WONJONG', id: 'campus-wonjong', loginId: 'wj', name: '부천원종', displayName: '부천 원종 캠퍼스', displayOrder: 4 },
  { code: 'BEOMBAK', id: 'campus-beombak', loginId: 'bb', name: '부천범박', displayName: '부천 범박 캠퍼스', displayOrder: 3 },
  { code: 'JUNGDONG', id: 'campus-jungdong', loginId: 'jd', name: '부천중동', displayName: '부천 중동 캠퍼스', displayOrder: 5 },
  { code: 'OKGIL', id: 'campus-okgil', loginId: 'og', name: '부천옥길', displayName: '부천 옥길 캠퍼스', displayOrder: 6 },
  { code: 'GWANGJIN', id: 'campus-gwangjin', loginId: 'gj', name: '광진', displayName: '서울 광진 입시본원', displayOrder: 7 },
  { code: 'PAJU', id: 'campus-paju', loginId: 'pj', name: '파주', displayName: '파주 입시본원', displayOrder: 10 },
  { code: 'ANSAN', id: 'campus-ansan', loginId: 'as', name: '안산', displayName: '안산 입시본원', displayOrder: 9 },
  { code: 'ULSAN', id: 'campus-ulsan', loginId: 'us', name: '울산', displayName: '울산 송정 입시본원', displayOrder: 8 },
] as const;
export function canonicalCampusId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return CAMPUS_DIRECTORY.find(c => c.code === id || c.id === id)?.id || id || null;
}
export function campusDisplayName(value: unknown, fallback: unknown = null) {
  return CAMPUS_DIRECTORY.find(c => c.id === value || c.code === value)?.displayName ?? (typeof fallback === 'string' ? fallback : null);
}

// This retired acceptance campus still owns restorable files. Hide its projection,
// never delete its identity or use presentation filtering as authorization.
export function isSelectableCampus(value: unknown) {
  return value !== 'campus-synthetic-acceptance-20260909';
}
export function presentCampuses<T extends Record<string, unknown>>(rows: T[], includeRetired = false) {
  return rows.filter(row => includeRetired || isSelectableCampus(row.id)).map(row => {
    const known = CAMPUS_DIRECTORY.find(c => c.id === row.id);
    return { ...row, code: known?.code ?? row.code, name: known?.displayName ?? row.name,
      displayOrder: known?.displayOrder ?? Number.MAX_SAFE_INTEGER };
  }).sort((a, b) => a.displayOrder - b.displayOrder);
}
export const ACTIVE_SESSION_MINUTES = 15;
export const HEARTBEAT_MINUTES = 5;

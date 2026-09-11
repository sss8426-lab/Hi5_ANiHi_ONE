// Public campus codes are stable aliases; existing foreign keys stay unchanged.
export const CAMPUS_DIRECTORY = [
  { code: 'BUCHEON_ANI', id: 'campus-anihi-admission', loginId: 'ba', name: '부천 애니입시관' },
  { code: 'BUCHEON_DESIGN', id: 'campus-design-admission', loginId: 'bd', name: '부천 디자인입시관' },
  { code: 'WONJONG', id: 'campus-wonjong', loginId: 'wj', name: '부천원종' },
  { code: 'BEOMBAK', id: 'campus-beombak', loginId: 'bb', name: '부천범박' },
  { code: 'JUNGDONG', id: 'campus-jungdong', loginId: 'jd', name: '부천중동' },
  { code: 'OKGIL', id: 'campus-okgil', loginId: 'og', name: '부천옥길' },
  { code: 'GWANGJIN', id: 'campus-gwangjin', loginId: 'gj', name: '광진' },
  { code: 'PAJU', id: 'campus-paju', loginId: 'pj', name: '파주' },
  { code: 'ANSAN', id: 'campus-ansan', loginId: 'as', name: '안산' },
  { code: 'ULSAN', id: 'campus-ulsan', loginId: 'us', name: '울산' },
] as const;
export function canonicalCampusId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return CAMPUS_DIRECTORY.find(c => c.code === id || c.id === id)?.id || id || null;
}
export const ACTIVE_SESSION_MINUTES = 15;
export const HEARTBEAT_MINUTES = 5;

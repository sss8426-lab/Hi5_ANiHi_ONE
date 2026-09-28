// User-approved school scope. Campus suffixes do not create separate schools.
export const managementUniversities = Object.freeze([
  '가천대학교','강남대학교','강동대학교','강원대학교','건국대학교','경기과학기술대학교','경기대학교','경남대학교','경민대학교','경희대학교',
  '계원예술대학교','공주대학교','국민대학교','극동대학교','남서울대학교','단국대학교','대전대학교','대진대학교','덕성여자대학교','동국대학교',
  '동덕여자대학교','동아대학교','동양대학교','동원대학교','명지대학교','명지전문대학','목원대학교','배재대학교','백석대학교','백석문화대학교',
  '백석예술대학교','부천대학교','상명대학교','상지대학교','서경대학교','서울과학기술대학교','서울여자대학교','서울예술대학교','서원대학교','서일대학교',
  '성균관대학교','성신여자대학교','세명대학교','세종대학교','세한대학교','수원대학교','순천향대학교','숭의여자대학교','신한대학교','안양대학교',
  '연성대학교','예원예술대학교','우송대학교','유한대학교','인덕대학교','인천가톨릭대학교','인하대학교','재능대학교','중부대학교','중원대학교',
  '청강문화산업대학교','청주대학교','평택대학교','한국영상대학교','한국예술종합학교','한남대학교','한서대학교','한성대학교','한세대학교','한양대학교',
  '한양여자대학교','협성대학교','호서대학교','홍익대학교',
]);
export const managementArchiveId = 'admissions-management:approved-74-20260929';
export const managementArchiveType = 'admissions-management-archive';
const key = value => String(value ?? '').normalize('NFKC').trim()
  .replace(/\s*\([^)]*\)\s*$/, '').replace(/_.*$/, '')
  .replace(/\s+(?:서울|세종|천안|죽전|춘천|수원|글로컬|국제|자연|WISE|ERICA)(?:캠퍼스)?$/i, '')
  .replace(/\s/g, '').replace(/대학교$/, '대').replace(/대학$/, '대').replace(/여대$/, '여자대');
const approved = new Map(managementUniversities.map(name => [key(name), name]));
const aliases = new Map([
  ['국립공주대','공주대학교'], ['국립강원대','강원대학교'], ['한예종','한국예술종합학교'],
  ['인천 강화군 불은면 중앙로 602-14 안양대강화캠퍼스','안양대학교'],
]);
export function managementUniversityName(value) {
  return aliases.get(String(value ?? '').trim()) || aliases.get(key(value)) || approved.get(key(value)) || null;
}
export function managementRows(rows, archived = []) {
  const ids = new Set(archived.map(String));
  return rows.filter(row => !ids.has(String(row.id)));
}

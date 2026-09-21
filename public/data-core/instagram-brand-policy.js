// Shared by the Worker and the browser. Campus identities/names are never rewritten.
export const BRAND_VERSION = '20260921-v1';
export const LOGOS = {
  anihi: { label: 'ANiHi', src: '/data-core/assets/brand/anihi-20260921.png', tagline: 'WEBTOON & ANIMATION' },
  hi5: { label: 'Hi5', src: '/data-core/assets/brand/hi5-20260921.png', tagline: 'DESIGN & DRAWING' },
  combined: { label: 'Hi5·ANiHi', src: '/data-core/assets/brand/combined-20260921.png', tagline: '' },
};
const CAMPUS_LABELS = {
  '부천 디자인 입시본원': '부천 입시본원', '부천 애니 입시본원': '부천 입시본원',
  '부천 범박 캠퍼스': '범박 캠퍼스', '부천 원종 캠퍼스': '원종 캠퍼스',
  '부천 중동 캠퍼스': '중동 캠퍼스', '부천 옥길 캠퍼스': '옥길 캠퍼스',
  '서울 광진 입시본원': '광진 입시본원', '울산 송정 입시본원': '송정 입시본원',
};
export function getInstagramCampusLogoLabel(name) { return CAMPUS_LABELS[name] || name || ''; }
export const TEMPLATES = {
  artwork: { label: '학생 작품', logo: 'anihi' },
  animation: { label: '만화·웹툰·애니·게임', logo: 'anihi' },
  design: { label: '디자인·드로잉', logo: 'hi5' },
  academy: { label: '학원·모집·종합 안내', logo: 'combined' },
};
export const MATERIALS = {
  'student-artwork': '학생 작품 원본', 'real-photo': '실제 수업·학원·행사 사진',
  'brand-asset': '로고·브랜드 자산', 'fact-document': '합격·수상·공문 등 사실 자료',
  'ai-support': 'AI 보조 이미지',
};
export const HUMAN_CHECKS = ['artwork', 'logo', 'design', 'ai', 'privacy', 'readability', 'facts'];
/** @param {unknown} input */
export function normalizeDesign(input = {}) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const text = (key, max) => String(input[key] || '').trim().slice(0, max);
  const templateId = Object.hasOwn(TEMPLATES, input.templateId) ? input.templateId : 'artwork';
  return {
    schemaVersion: 1, templateId,
    logoType: Object.hasOwn(LOGOS, input.logoType) ? input.logoType : TEMPLATES[templateId].logo,
    materialKind: Object.hasOwn(MATERIALS, input.materialKind) ? input.materialKind : 'student-artwork',
    usePermission: ['allowed', 'review', 'denied'].includes(input.usePermission) ? input.usePermission : 'review',
    externalAiConsent: input.externalAiConsent === true,
    headline: text('headline', 160), contact: text('contact', 160),
    // Contact is explicitly supplied and human-verified; no invented campus phone numbers.
    factsVerified: input.factsVerified === true,
  };
}
export function designChecks(design, campusLabel) {
  const checks = [];
  const add = (code, status, message) => checks.push({ code, status, message });
  add('campus', campusLabel ? 'pass' : 'needs_changes', campusLabel ? `로고 캠퍼스: ${campusLabel}` : '캠퍼스를 선택하세요.');
  add('permission', design.usePermission === 'allowed' ? 'pass' : 'needs_changes', design.usePermission === 'allowed' ? '담당자가 홍보 사용 가능으로 확인' : '홍보 사용 권한 확인이 필요합니다.');
  add('logo-topic', design.logoType === TEMPLATES[design.templateId].logo ? 'pass' : 'human_required', '로고 타입과 주제 일치 여부');
  add('contact', design.contact ? 'human_required' : 'needs_changes', design.contact ? '문의 문구·전화번호를 실제 정보와 대조하세요.' : '검증된 전화 문의 또는 DM 안내를 입력하세요.');
  add('facts', design.factsVerified ? 'human_required' : 'needs_changes', '캡션과 이미지의 숫자·날짜·성과·캠퍼스 정보를 직접 대조하세요.');
  if (/전국\s*1위|100\s*%\s*합격|합격\s*보장/.test(design.headline + design.contact)) add('claims', 'needs_changes', '근거 없는 순위·합격 보장 표현을 제거하세요.');
  return checks;
}

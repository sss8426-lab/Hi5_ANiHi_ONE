import {normalizeTags} from './content-preset-catalog.js';

// 캠퍼스 고정 키워드 (blog and Instagram): region + academy keywords every post of a campus carries,
// per brand. The first region is the campus's own; the others are nearby areas it also serves.
// Stored edits (고정키워드 수정) replace a brand's default list; the regions themselves stay fixed.
export const CAMPUS_REGIONS = {
  'campus-design-admission': ['부천', '부평', '계양', '삼산동', '산곡동'],
  'campus-anihi-admission': ['부천', '부평', '계양', '삼산동', '산곡동'],
  'campus-wonjong': ['원종', '부천'],
  'campus-beombak': ['범박', '부천'],
  'campus-jungdong': ['중동', '부천'],
  'campus-okgil': ['옥길', '부천'],
  'campus-gwangjin': ['광진'],
  'campus-paju': ['파주'],
  'campus-ansan': ['안산'],
  'campus-ulsan': ['울산', '송정'],
};
export const KEYWORD_BRANDS = {
  hi5: {label: 'Hi5', core: '미술학원', primary: ['미술학원', '입시미술학원'],
    fixed: ['입시미술학원', '기초디자인', '기초소양', '미대입시', '예고입시', '예중예고'],
    recommended: ['입시미술', '디자인입시', '미술입시', '발상과표현', '소묘']},
  anihi: {label: 'ANiHi', core: '만화학원', primary: ['만화학원', '웹툰학원', '애니학원'],
    fixed: ['웹툰학원', '만화학원', '애니학원', '만화입시'],
    recommended: ['애니입시', '웹툰입시', '애니메이션입시', '만화애니과']},
};
export const MAX_CAMPUS_KEYWORDS = 25;
export const MAX_POST_TAGS = 30;
export const AI_CONTENT_TAGS = 5;

export const campusRegions = (campusId) => CAMPUS_REGIONS[campusId] || [];
// 대표 지역 gets every primary keyword (부천만화학원·부천웹툰학원·부천애니학원); the other regions get the core one.
export function defaultCampusKeywords(campusId, brand) {
  const spec = KEYWORD_BRANDS[brand], regions = campusRegions(campusId);
  if (!spec) return [];
  const [home, ...nearby] = regions;
  return normalizeTags(home ? spec.primary.map(word => home + word) : [], nearby.map(region => region + spec.core), spec.fixed, spec.recommended);
}
export function cleanCampusKeywords(value) {
  const tags = normalizeTags(value);
  if (!tags.length) throw Error('고정 키워드를 하나 이상 입력하세요.');
  if (tags.length > MAX_CAMPUS_KEYWORDS) throw Error(`고정 키워드는 ${MAX_CAMPUS_KEYWORDS}개까지 저장할 수 있습니다.`);
  if (tags.some(tag => tag.length > 40 || /[<>{}]/.test(tag))) throw Error('키워드는 각각 40자 이내로, 기호 없이 입력하세요.');
  return tags;
}
// 고정 키워드 → 직접 입력한 해시태그 → AI가 고른 내용 태그 (max 5). Duplicates collapse to their first place;
// only AI tags are dropped when the post would go over 30 tags.
export function postHashtags(keywords, userTags, aiTags = []) {
  const fixed = normalizeTags(keywords, userTags);
  const ai = normalizeTags(aiTags).filter(tag => !fixed.includes(tag)).slice(0, Math.max(0, Math.min(AI_CONTENT_TAGS, MAX_POST_TAGS - fixed.length)));
  return [...fixed, ...ai];
}
export const hashtagText = tags => normalizeTags(tags).map(tag => '#' + tag).join(' ');

// Title keywords are the region + core keyword tags (부천만화학원, 부평만화학원 …) in their saved order.
export function titleKeywords(tags, brand) {
  const core = KEYWORD_BRANDS[brand]?.core;
  if (!core) return [];
  return normalizeTags(tags).filter(tag => tag.endsWith(core) && tag.length > core.length && !tag.slice(0, -core.length).includes('입시'));
}
const PREFIX = /^\[([^\]\n]*)_(Hi5|ANiHi)\]\s*/;
export const stripTitlePrefix = title => String(title || '').replace(PREFIX, '');
// [대표 키워드,다음 지역 키워드_브랜드] — the second keyword moves one step along the list with each post,
// continuing after the one the most recent prefixed title used.
export function titlePrefix(tags, brand, recentTitles = []) {
  const words = titleKeywords(tags, brand), label = KEYWORD_BRANDS[brand]?.label;
  if (!words.length || !label) return '';
  const [first, ...rest] = words;
  let second = rest[0];
  for (const title of recentTitles) {
    const used = String(title || '').match(PREFIX)?.[1]?.split(',').map(v => v.trim());
    if (!used || used[0] !== first) continue;
    const at = rest.indexOf(used[1]);
    if (at >= 0) second = rest[(at + 1) % rest.length];
    break;
  }
  return `[${[first, second].filter(Boolean).join(',')}_${label}]`;
}
export function withTitlePrefix(title, prefix) {
  const plain = stripTitlePrefix(title).trim();
  return prefix && plain ? prefix + plain : plain;
}
// Only the words used in the text itself (no region-stuck forms): regions plus the region-free keywords.
export function seoGuide(campusId, tags) {
  const regions = campusRegions(campusId), list = normalizeTags(tags);
  return {regions, keywords: list.filter(tag => !regions.some(region => tag.startsWith(region))).slice(0, 10)};
}

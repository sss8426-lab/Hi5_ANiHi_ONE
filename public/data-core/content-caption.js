import {normalizeTags} from './content-preset-catalog.js';

export function assertResolvedText(...values) {
  if(values.some(value=>/\{\{[^}]*\}\}|\b(?:undefined|null)\b/.test(String(value||''))))throw Error('확인되지 않은 치환값이 남아 있습니다. 문구를 확인해주세요.');
}
// The app — never the AI — decides where every fixed part of a post goes. One order for blog, the
// Instagram caption, saved data, reopening, copy and export:
//   1 인사말 · 2 메인글 · 3 체험수업 · 4 홈페이지 · 5 인스타 · 6 상담전화 · 7 주소 · 8 고정 마지막 문구 · 9 고정 해시태그
// Empty parts are left out; the others keep their relative order.
export const CONTACT_FIELDS=[['trialLink','체험수업'],['homeLink','홈페이지'],['instaLink','인스타그램'],['phone','상담전화'],['address','주소']];
export function contactLines(contact={}) {
  return CONTACT_FIELDS.map(([key,label])=>{const value=String(contact?.[key]||'').trim();return value?`${label}: ${value}`:'';}).filter(Boolean).join('\n');
}
export function hashtagLine(fixedTags) {
  const tags=normalizeTags(fixedTags);
  if(tags.length>30)throw Error('현재 콘텐츠 저장 계약은 태그 30개까지입니다. 직접 정리해주세요.');
  if(tags.some(tag=>tag.length>80))throw Error('태그는 각각 80자까지 저장할 수 있습니다.');
  return tags.map(tag=>'#'+tag).join(' ');
}
// Everything after the main text: links → 상담전화 → 주소 → 마지막 문구 → 해시태그 (always last).
export function managedTail({contact='',closing='',hashtags=''}={}) {
  const lines=typeof contact==='string'?contact:contactLines(contact);
  assertResolvedText(lines,closing,hashtags);
  return [String(lines||'').trim(),String(closing||'').trim(),hashtagLine(hashtags)].filter(Boolean).join('\n\n');
}
export function managedHead(greeting='') {
  assertResolvedText(greeting);
  return String(greeting||'').trim();
}
// `body` is only the main text. A copy of the greeting at its very start, or of the closing at its very
// end, is dropped so re-running never stacks them; matching sentences inside the body are kept.
export function assemblePost({greeting='',body='',contact='',closing='',hashtags=''}={}) {
  const head=managedHead(greeting),tail=managedTail({contact,closing,hashtags});
  let text=String(body||'').trim();
  if(head&&(text===head||text.startsWith(head+'\n')))text=text.slice(head.length).trimStart();
  const fixed=String(closing||'').trim();
  if(fixed&&(text===fixed||text.endsWith('\n'+fixed)))text=text.slice(0,text.length-fixed.length).trimEnd();
  return [head,text,tail].filter(Boolean).join('\n\n');
}
// Swaps only the app-managed start/end of a caption the user may have edited in between.
export function replaceManaged(text,{previousHead=null,previousTail=null,head='',tail=''}) {
  let body=String(text||'');
  if(previousTail&&(body===previousTail||body.endsWith('\n\n'+previousTail)))body=body.slice(0,-previousTail.length).trimEnd();
  else if(previousTail)throw Error('마지막 문구 경계가 변경됐습니다. 결과의 문구와 태그를 직접 수정해주세요. 본문은 유지됩니다.');
  if(previousHead&&(body===previousHead||body.startsWith(previousHead+'\n\n')))body=body.slice(previousHead.length).trimStart();
  else if(previousHead)throw Error('인사말 경계가 변경됐습니다. 결과의 인사말을 직접 수정해주세요. 본문은 유지됩니다.');
  // Without a known boundary, never append a second copy of what is already there.
  if(tail&&(body===tail||body.endsWith('\n\n'+tail)))body=body.slice(0,-tail.length).trimEnd();
  if(head&&(body===head||body.startsWith(head+'\n\n')))body=body.slice(head.length).trimStart();
  return [head,body,tail].filter(Boolean).join('\n\n');
}
// Older argument lists (body, footer, fixedTags, generatedTags, contact[, greeting]). AI-suggested tags
// (the 4th argument) are no longer added: the hashtag line is only the user's fixed tags.
export function captionTail(footer, fixedTags, ...rest) {
  return managedTail({contact:rest[1]||'',closing:footer,hashtags:fixedTags});
}
export function assembleCaption(body, footer, fixedTags, ...rest) {
  return assemblePost({greeting:rest[2]||'',body,contact:rest[1]||'',closing:footer,hashtags:fixedTags});
}
export function replaceManagedTail(text, previousTail, nextTail) {
  return replaceManaged(text,{previousTail,tail:nextTail});
}

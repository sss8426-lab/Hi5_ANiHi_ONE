import {normalizeTags} from './content-preset-catalog.js';

export function assertResolvedText(...values) {
  if(values.some(value=>/\{\{[^}]*\}\}|\b(?:undefined|null)\b/.test(String(value||''))))throw Error('확인되지 않은 치환값이 남아 있습니다. 문구를 확인해주세요.');
}
export function captionTail(footer, fixedTags, generatedTags=[], contact='') {
  assertResolvedText(footer,fixedTags,contact);
  const tags=normalizeTags(fixedTags,generatedTags);
  if(tags.length>30)throw Error('현재 콘텐츠 저장 계약은 태그 30개까지입니다. 직접 정리해주세요.');
  if(tags.some(tag=>tag.length>80))throw Error('태그는 각각 80자까지 저장할 수 있습니다.');
  return [String(footer||''),String(contact||''),tags.map(tag=>'#'+tag).join(' ')].filter(Boolean).join('\n\n');
}
export function assembleCaption(body, footer, fixedTags, generatedTags = [], contact='') {
  const fixed=String(footer||'').trim();let text=String(body||'').trim();
  // Only an exact trailing block is managed; never remove a matching sentence inside the body.
  if(fixed&&(text===fixed||text.endsWith('\n'+fixed)))text=text.slice(0,text.length-fixed.length).trimEnd();
  return [text,captionTail(footer,fixedTags,generatedTags,contact)].filter(Boolean).join('\n\n');
}
export function replaceManagedTail(text, previousTail, nextTail) {
  let body=String(text||'');
  if(previousTail&&(body===previousTail||body.endsWith('\n\n'+previousTail)))body=body.slice(0,-previousTail.length).trimEnd();
  else if(previousTail)throw Error('마지막 문구 경계가 변경됐습니다. 결과의 문구와 태그를 직접 수정해주세요. 본문은 유지됩니다.');
  if(nextTail&&(body===nextTail||body.endsWith('\n\n'+nextTail)))return body;
  return [body,nextTail].filter(Boolean).join('\n\n');
}

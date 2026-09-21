export function assembleCaption(body, footer, fixedTags, generatedTags = []) {
  const fixed = String(footer || '');
  let text = String(body || '').trim();
  // The footer is deterministic user text, never rewritten by the provider.
  if (fixed.trim()) {
    text = text.split(fixed.trim()).join('').trim();
    if (fixed.trim() !== '궁금한 점은 DM으로 문의해주세요.') text = text.replace(/궁금한 점은 DM으로 문의해주세요\.?/g, '').trim();
  }
  const tags = [...new Set([fixedTags, ...generatedTags].flatMap(value => String(value || '').split(/[\s,#]+/)).filter(Boolean))].slice(0, 30);
  return [text, fixed, tags.map(tag => '#' + tag).join(' ')].filter(Boolean).join('\n\n');
}

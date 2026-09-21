import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('public/data-core/content.js', 'utf8');
const carousel = fs.readFileSync('public/data-core/instagram-carousel.js', 'utf8');

test('블로그와 인스타 사진 선택은 10장까지이며 기존 선택을 덮어쓰지 않는다', () => {
  assert.match(content, /const BLOG_PHOTO_LIMIT = 10;/u);
  assert.doesNotMatch(content, /\bPHOTO_LIMIT\b(?!_)/u, 'the old shared PHOTO_LIMIT constant must not remain referenced anywhere');

  // Both pickers share the ten-photo bound; generation has its own server validation.
  assert.match(content, /state\.selectedFileIds\.length >= BLOG_PHOTO_LIMIT/u);
  assert.match(content, /사진은 최대 \$\{BLOG_PHOTO_LIMIT\}장까지 선택할 수 있습니다\./u);

  assert.doesNotMatch(content, /state\.selectedFileIds = \[id\]/u);
  assert.match(content, /state\.selectedFileIds\.push\(id\)/u);
});

test('블로그 사진은 브라우저에서 자동 최적화된 뒤 multipart로 전송되고, 인스타 요청은 기존 JSON 방식 그대로 유지된다', () => {
  // The optimize pipeline: sequential, closes each bitmap, adaptive ladder, hard cap enforced.
  assert.match(content, /async function optimizeImageForAi\(file\)/u);
  assert.match(content, /createImageBitmap\(sourceBlob\)/u);
  assert.match(content, /bitmap\.close\(\);/u);
  assert.match(content, /AI_OPTIMIZE_HARD_CAP_BYTES/u);
  assert.match(content, /async function prepareBlogPhotos\(files, signal\)/u);
  // One photo decoded/optimized at a time, not Promise.all — protects low-memory tablets.
  assert.doesNotMatch(content, /Promise\.all\([^)]*optimizeImageForAi/u);

  // Instagram's carousel uses JSON per item; blog keeps optimized multipart analysis.
  assert.match(carousel, /post\('generate',\{sourceApp:'instagram'/u);
  assert.match(content, /const photos = await prepareBlogPhotos\(photoFiles, signal\);/u);
  assert.match(content, /form\.set\(`photo:\$\{id\}`, blob, `\$\{id\}\.jpg`\);/u);
  assert.match(content, /await api\('\/api\/data-core\/content\/generate', \{ method: 'POST', signal, body: form \}\);/u);

  // Image edit still uses JSON, with explicit source kind and consent.
  assert.match(carousel, /if\(itemDesign\.externalAiConsent\)/u);
  assert.match(carousel, /post\('image-edit',\{sourceApp:'instagram',campusId,sourceFileId:ids\[i\],direction,material:itemDesign/u);
});

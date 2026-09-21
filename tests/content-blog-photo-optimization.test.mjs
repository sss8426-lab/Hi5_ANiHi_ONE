import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('public/data-core/content.js', 'utf8');

test('블로그 사진 선택은 10장까지, 인스타 대표사진 1장 흐름은 그대로 유지된다', () => {
  assert.match(content, /const BLOG_PHOTO_LIMIT = 10;/u);
  assert.doesNotMatch(content, /\bPHOTO_LIMIT\b(?!_)/u, 'the old shared PHOTO_LIMIT constant must not remain referenced anywhere');

  // The blog-only client-side gate uses the new limit and a clear, specific message.
  assert.match(content, /state\.selectedFileIds\.length >= BLOG_PHOTO_LIMIT/u);
  assert.match(content, /블로그 AI 분석은 최대 \$\{BLOG_PHOTO_LIMIT\}장까지 선택할 수 있습니다\./u);

  // Instagram keeps replacing the selection with exactly one photo, completely bypassing the limit
  // check — this must still be the very branch checked before the blog limit is ever consulted.
  assert.match(content,
    /else if \(state\.sourceApp === 'instagram'\) state\.selectedFileIds = \[id\];\s*\n\s*else if \(state\.selectedFileIds\.length >= BLOG_PHOTO_LIMIT\)/u);
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

  // runAi() branches: instagram keeps the original JSON `post()` helper for both its calls;
  // blog builds its own FormData with an `input` field plus one `photo:<id>` field per photo.
  assert.match(content, /if \(instagram\) \{\s*\n\s*result = await post\('generate', \{ selectedFileIds: ids, notes: direction, material \}\);/u);
  assert.match(content, /const photos = await prepareBlogPhotos\(photoFiles, signal\);/u);
  assert.match(content, /form\.set\(`photo:\$\{id\}`, blob, `\$\{id\}\.jpg`\);/u);
  assert.match(content, /await api\('\/api\/data-core\/content\/generate', \{ method: 'POST', signal, body: form \}\);/u);

  // Image edit still uses JSON, with explicit source kind and consent.
  assert.match(content, /const result = await post\('image-edit', \{ sourceFileId: ids\[0\], direction, material \}\);/u);
});

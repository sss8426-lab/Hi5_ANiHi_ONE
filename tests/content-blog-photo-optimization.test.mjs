import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('public/data-core/content.js', 'utf8');
const carousel = fs.readFileSync('public/data-core/instagram-carousel.js', 'utf8');
const optimizeModule = fs.readFileSync('public/data-core/image-ai-optimize.js', 'utf8');

test('블로그와 인스타 사진 선택은 장수 제한이 없고(서버 보호용 100장) 기존 선택을 덮어쓰지 않는다', () => {
  assert.match(content, /const PHOTO_SAFETY_LIMIT = 100;/u);
  assert.doesNotMatch(content, /BLOG_PHOTO_LIMIT|\/ 10`/u, 'no leftover 10-photo limit or "n / 10" counter');
  assert.match(content, /state\.selectedFileIds\.length >= PHOTO_SAFETY_LIMIT/u);
  assert.match(carousel, /state\.selectedFileIds\.length>100\)return;/u);
  // The AI still sees a bounded number of images: first 10 for the Instagram caption and blog analysis.
  assert.match(carousel, /\[ids\.slice\(0,5\),ids\.slice\(5,10\)\]/u);

  assert.doesNotMatch(content, /state\.selectedFileIds = \[id\]/u);
  assert.match(content, /state\.selectedFileIds\.push\(id\)/u);
});

test('사진은 브라우저에서 자동 최적화된 뒤 multipart로 전송된다 (블로그 분석, 인스타 이미지 편집 모두 공유 모듈 사용)', () => {
  // The optimize pipeline lives in one shared module now — blog and Instagram both import it
  // instead of each keeping their own copy. Sequential, closes each bitmap, adaptive ladder, hard
  // cap enforced.
  assert.match(optimizeModule, /export async function optimizeImageForAi\(file\)/u);
  assert.match(optimizeModule, /createImageBitmap\(sourceBlob\)/u);
  assert.match(optimizeModule, /bitmap\.close\(\);/u);
  assert.match(optimizeModule, /AI_OPTIMIZE_HARD_CAP_BYTES/u);
  assert.match(content, /import \{optimizeImageForAi\} from '\.\/image-ai-optimize\.js/u);
  assert.match(carousel, /import \{optimizeImageForAi\} from '\.\/image-ai-optimize\.js/u);
  assert.doesNotMatch(content, /async function optimizeImageForAi/u, 'must not keep a second, drifting copy in content.js');
  assert.match(content, /async function prepareBlogPhotos\(files, signal\)/u);
  // One photo decoded/optimized at a time, not Promise.all — protects low-memory tablets.
  assert.doesNotMatch(content, /Promise\.all\([^)]*optimizeImageForAi/u);

  // Blog's multi-photo analysis: optimized copies sent as multipart alongside the JSON input.
  assert.match(content, /const photos = await prepareBlogPhotos\(photoFiles, signal\);/u);
  assert.match(content, /form\.set\(`photo:\$\{id\}`, blob, `\$\{id\}\.jpg`\);/u);
  assert.match(content, /await api\('\/api\/data-core\/content\/generate', \{ method: 'POST', signal, body: form \}\);/u);

  // Instagram's single-photo AI edit now also sends a browser-optimized working copy as multipart
  // (same reasoning as blog: the R2 original is never read/resized server-side for this call), with
  // the same externalAiConsent gate and a cache so an already-edited photo is never re-optimized or
  // re-sent on retry.
  assert.match(carousel, /if\(itemDesign\.externalAiConsent\)\{/u);
  // Decoding for the AI copy runs under the same one-at-a-time lock as composition (low-memory tablets).
  assert.match(carousel, /const optimized=await decodeLock\(\(\)=>\{[^}]*return optimizeImageForAi\(photoFile\);\}\);/u);
  assert.match(carousel, /postWithPhoto\('image-edit',\{sourceApp:'instagram',campusId,sourceFileId:id,direction,material:itemDesign/u);
  assert.match(carousel, /form\.set\('photo:'\+photoId,blob,photoId\+'\.jpg'\);/u);
  assert.doesNotMatch(carousel, /post\('image-edit'/u, 'the plain JSON call must be fully replaced, not left dangling alongside postWithPhoto');
});

test('인스타 다중 이미지: AI 요청은 한 번에 하나, 실패분만 재시도하며 이전 결과·초안을 재사용한다', () => {
  // withAiRequest allows one in-flight AI job per user; the pipeline must never race it.
  assert.match(carousel, /const IG_CONCURRENCY=2;/u);
  assert.equal((carousel.match(/postWithPhoto\('image-edit'/gu) || []).length, 1, 'exactly one AI call site');
  assert.match(carousel, /backgroundId=await aiLock\(async\(\)=>\{/u, 'the AI call runs inside the per-batch AI lock');
  assert.match(carousel, /const composing=decodeLock\(/u, 'composition shares the one-at-a-time decode lock');
  // A retry hands back what the failed attempt already paid for, instead of re-billing or re-drafting.
  assert.match(carousel, /prior=failures\.find\(f=>f\.id===id\)/u);
  assert.match(carousel, /if\(!backgrounds\.has\(key\)&&prior\?\.backgroundId\)backgrounds\.set\(key,prior\.backgroundId\);/u);
  assert.match(carousel, /const drafting=reuse\?Promise\.resolve\(reuse\)/u);
  // 이어서 하기: every draft records its batch, and resumable lookups never trip api()'s 401/403 wipe.
  assert.match(carousel, /instagramBatch:\{\.\.\.batchInfo,slot:ids\.indexOf\(id\)/u);
  assert.match(carousel, /const view=await quiet\('\/api\/data-core\/library\/files\?'/u, 'resume re-reads photo details from the picker listing (folder protection included)');
  assert.doesNotMatch(carousel.slice(carousel.indexOf('async function findResumable'), carousel.indexOf("$('igResumeDismiss')")), /\bapi\(/u);
});

test('인스타 홍보글도 최적화 사본을 보내며, 요청 본문은 홍보글 누적 텍스트가 아니라 요청 객체다', () => {
  // Regression: the form once serialized the caption accumulator (`body`, '') instead of the request.
  assert.match(carousel, /const form=new FormData\(\);form\.set\('input',JSON\.stringify\(payload\)\);\s*for\(const id of ids\)\{const blob=await optimizeImageForAi/u);
  assert.match(carousel, /if\(textOnly\)generated=\(await captionFetch\('generate',\{method:'POST',headers:\{'content-type':'application\/json'\},body:JSON\.stringify\(payload\),signal:abort\.signal\}\)\)\.generated;/u, 'text-only captions stay JSON-only, never carrying image bytes');
});

test('SVG 로고는 브라우저에서 PNG로 바꾼 뒤에만 올라간다', () => {
  assert.match(carousel, /accept="image\/png,image\/jpeg,image\/webp,image\/svg\+xml,\.svg"/u);
  assert.match(carousel, /if\(isSvg\)\{file=await rasterizeSvgLogo\(file\);/u);
  assert.match(carousel, /return new File\(\[blob\],file\.name\.replace\(\/\\\.svg\$\/i,''\)\+'\.png',\{type:'image\/png'\}\);/u);
});

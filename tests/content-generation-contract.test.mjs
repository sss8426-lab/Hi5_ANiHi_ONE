import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const generationSource = await readFile(
  new URL('../worker/data-core-content-generation.ts', import.meta.url),
  'utf8',
);
const routerSource = await readFile(new URL('../worker/router.ts', import.meta.url), 'utf8');

test('content generation endpoint is explicit and provider absence is never faked as success', () => {
  assert.match(routerSource, /\/api\/data-core\/content\/generate/);
  assert.match(routerSource, /generation\.available \? 200 : 503/);
  assert.match(generationSource, /if \(!provider\) \{[\s\S]*available: false,[\s\S]*code: "provider_not_configured"/);
  assert.match(generationSource, /AI 생성 연결 준비 중입니다/);
});

test('generation request preserves authorization and DATA CORE file reuse boundaries', () => {
  assert.match(generationSource, /requireWriteAccess\(context\)/);
  assert.match(generationSource, /requireCampusAccess\(context, campusId\)/);
  assert.match(generationSource, /FROM file_objects/);
  assert.match(generationSource, /canReadFileRow\(context, row\)/);
  assert.match(generationSource, /다른 캠퍼스의 파일은 같은 생성 요청에 사용할 수 없습니다/);
  assert.doesNotMatch(generationSource, /\.put\(/);
  assert.doesNotMatch(generationSource, /r2_key/);
});

test('generation contract accepts only blog/instagram and keeps the Instagram 2160x2700 4:5 brand rule', () => {
  assert.match(generationSource, /new Set\(\["blog", "instagram"\]\)/);
  assert.match(generationSource, /sourceApp은 blog 또는 instagram이어야 합니다/);
  assert.match(generationSource, /width: 2160/);
  assert.match(generationSource, /height: 2700/);
  assert.match(generationSource, /aspectRatio: "4:5"/);
});

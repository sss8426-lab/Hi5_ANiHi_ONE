import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('public/data-core/content.js', 'utf8');
const html = fs.readFileSync('public/data-core/content.html', 'utf8');

test('글 방향 선택(균형형 기본)과 바로 글 만들기 버튼은 블로그에서만 보이고, 인스타에서는 숨는다', () => {
  assert.match(html, /<select id="strategyMode"><option value="balanced" selected>균형형<\/option>/u);
  assert.match(html, /id="quickGenerateAi"/u);
  assert.match(content, /\$\('strategyModeField'\)\.hidden = instagram;/u);
  assert.match(content, /\$\('quickGenerateAi'\)\.hidden = instagram;/u);
});

test('runAi는 quick 파라미터로 바로 글 만들기와 단계별(제목 선택) 흐름을 분기하고, 인스타 경로는 그대로 유지한다', () => {
  assert.match(content, /async function runAi\(captionOnly = false, quick = false\) \{/u);
  assert.match(content, /\$\('quickGenerateAi'\)\.onclick = \(\) => runAi\(false, true\);/u);
  // Instagram remains JSON-based, with additive material/consent policy.
  assert.match(content, /if \(instagram\) \{\s*\n\s*result = await post\('generate', \{ selectedFileIds: ids, notes: direction, material \}\);/u);
  // Blog sends strategyMode/recentTitles alongside the existing fields; multipart shape otherwise unchanged.
  assert.match(content, /strategyMode: \$\('strategyMode'\)\.value, recentTitles, photoInstructions:blogWorkflow\?\.instructions\(\),requestId: crypto\.randomUUID\(\)/u);
  assert.match(content, /const recentTitles = await recentBlogTitles\(\);/u);
  assert.match(content, /if \(quick\) \{\s*\n\s*applyBlogTitleAndBody\(state\.blogSelectedTitleKind\);/u);
  assert.match(content, /renderTitlePicker\(\);/u);
});

test('제목 선택은 기존 수동 본문을 보존하고 새 생성 결과에서만 가벼운 retitle 경로를 사용한다', () => {
  assert.match(content, /async function retitleTo\(kind\) \{/u);
  assert.match(content, /if\(blogWorkflow&&!state.pendingBlogGeneration&&\$\('draftContent'\).value.trim\(\)\)/u);
  assert.match(content, /if \(kind === state\.blogFittedKind\) \{ applyBlogTitleAndBody\(kind\);blogWorkflow\?\.assemble\(false\);return; \}/u);
  assert.match(content, /mode: 'retitle', campusId: \$\('draftCampus'\)\.value \|\| null, strategy: state\.blogStrategy,/u);
  assert.match(content, /priorLead: state\.currentLead, priorBody: state\.currentBody,/u);
  // retitle never touches selected photos or FormData — it is a plain JSON call.
  assert.doesNotMatch(/async function retitleTo[\s\S]*?\n\}/u.exec(content)?.[0] || '', /FormData|photo:/u);
});

test('다른 제목 만들기는 recentTitles를 다시 조회해 /refine(titles)를 호출하고, 추천 후보로 즉시 본문을 맞춘다', () => {
  assert.match(content, /mode: 'titles', campusId: \$\('draftCampus'\)\.value \|\| null, strategy: state\.blogStrategy,/u);
  assert.match(content, /state\.blogFittedKind = null;\s*\n\s*renderTitlePicker\(\);\s*\n\s*await retitleTo\(state\.blogSelectedTitleKind\);/u);
});

test('발행 전 검수는 공통 블록 검사로 연결하며 제목 존재나 글자 수를 의미 통과로 오인하지 않는다', () => {
  assert.match(content, /function renderPublishChecklist\(\)/u);
  assert.match(content, /blogWorkflow\?\.review\(\)/u);
  assert.doesNotMatch(content,/tagCount >= 8 && tagCount <= 15/u);
  assert.match(content, /async function copyPublishPackage\(\)/u);
  assert.match(content,/return blogWorkflow\?\.downloadPackage\(\)/u);
  assert.doesNotMatch(content,/이미지 순서:/u);
  assert.match(html, /네이버 발행용 복사/u);
  assert.match(html, /⚠ 합격·수상 수치는 직접 확인해주세요\./u);
});

test('다음 콘텐츠 아이디어 클릭은 명령창을 채우고, 초안 저장/불러오기는 strategy·titles·nextTopics를 additive metadata로 오간다', () => {
  assert.match(content, /function renderNextTopics\(\)/u);
  assert.match(content, /const next=state.blogNextTopics\[Number\(button.dataset.nextTopic\)\]/u);
  assert.match(content, /resetDraftForm\(\);\$\('aiCommand'\).value = next/u);
  assert.match(content, /if \(state\.blogStrategy\) metadata\.strategy = state\.blogStrategy;/u);
  assert.match(content, /if \(state\.blogTitles\) metadata\.titles = state\.blogTitles;/u);
  assert.match(content, /if \(state\.blogNextTopics\.length\) metadata\.nextTopics = state\.blogNextTopics;/u);
  // Reopening a draft saved before this feature must not throw — every read is optional-chained/defaulted.
  assert.match(content, /state\.blogStrategy = metadata\.strategy \|\| null;/u);
  assert.match(content, /state\.blogTitles = metadata\.titles \|\| null;/u);
});

test('busy 상태는 새 버튼들(바로 글 만들기, 다른 제목 만들기)도 함께 비활성화한다', () => {
  assert.match(content, /'generateAi','quickGenerateAi','regenerateAi','regenerateTitles'/u);
});

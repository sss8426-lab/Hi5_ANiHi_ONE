import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { libraryHarness, users, A } from './support/library-harness.mjs';
import { compareCandidates, factPreservation, publishStatus, applyStyleEdit } from '../worker/blog-editorial.ts';

// 블로그 작성 기준 취합본·문체 편집 단계 (2026-10-16). 가상 원고만 씁니다(실제 학원 사실 아님).
const png = () => encode({ width: 64, height: 80, channels: 4, depth: 8, data: new Uint8Array(64 * 80 * 4).fill(180) });
const textResponse = (value) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

const SEO = { mode: 'seo', title: '웹툰 입문 준비: 기초 연습·장비·수업 선택 기준',
  lead: '웹툰을 처음 배운다면 장비보다 장면을 나누는 연습과 꾸준한 기초 드로잉부터 점검하는 편이 좋습니다.',
  body: '## 준비 항목 한눈에 보기\n입문 단계에서는 칸을 나누어 장면을 설명하는 연습과 인체 기초 드로잉이 함께 필요합니다.\n## 장비 선택 기준\n태블릿은 디지털 작업을 시작할 때 고르면 되고 처음부터 비싼 장비가 꼭 필요한 것은 아닙니다.\n## 수업을 고를 때 볼 것\n수업에서 장면 설계와 피드백 과정을 실제로 다루는지 확인해 보세요.' };
const TITLE_ONLY = { ...SEO, mode: 'aeo', title: '웹툰을 처음 배우려면 태블릿부터 사야 하나요?' };
const AEO = { mode: 'aeo', title: '웹툰을 처음 배우려면 태블릿부터 사야 하나요?',
  lead: '아니요, 처음 몇 주는 종이에 장면을 나누어 그려 보는 것만으로도 충분히 시작할 수 있습니다.',
  body: '## Q. 태블릿은 언제 필요해지나요?\n선화와 채색을 디지털로 옮기기 시작할 때 필요해지며 그전에는 연필과 종이로 연습해도 됩니다.\n## Q. 그동안 무엇을 연습하나요?\n한 장면을 세 칸으로 나누어 인물의 동작과 표정이 이어지게 그려 보는 연습이 기본입니다.\n## Q. 예외가 있나요?\n이미 디지털 작업에 익숙하다면 처음부터 태블릿으로 시작해도 무리가 없습니다.' };
const GEO = { mode: 'geo', title: '웹툰 입문에서 장비보다 먼저 점검할 학습 요소',
  lead: '입문 단계의 판단 기준은 장비 유무보다 장면을 나누어 설명하는 능력이 있는지입니다.',
  body: '## 판단 기준과 대상\n이 글은 웹툰을 처음 배우는 중고등학생을 대상으로 장면 설계 능력을 먼저 보는 이유를 정리합니다.\n## 확인된 수업 자료\n수업에서는 같은 줄거리를 세 칸과 다섯 칸으로 나누어 그려 보고 차이를 비교합니다.\n## 해석과 한계\n장면 설계가 먼저라는 판단은 교사의 해석이며 학생마다 순서가 달라질 수 있습니다.' };

test('차별화: 제목만 바꾼 유사 본문은 지적하고, 공통 사실을 공유하거나 AEO·GEO가 둘 다 답을 먼저 써도 실패가 아니다', () => {
  const same = compareCandidates(TITLE_ONLY, SEO);
  assert.ok(same.issues.some((i) => i.includes('본문 문장') && i.includes('SEO')), JSON.stringify(same));
  assert.ok(same.issues.some((i) => i.includes('도입부')));
  const questioned = { ...SEO, mode: 'aeo', title: '다른 제목', lead: '다른 도입부입니다 완전히 다른 문장으로 시작합니다.', body: SEO.body.replace('준비 항목 한눈에 보기', '준비 항목은 무엇인가요?').replace('장비 선택 기준', '장비는 어떻게 고르나요?').replace('수업을 고를 때 볼 것', '수업은 어떻게 고르나요?') };
  assert.ok(compareCandidates(questioned, SEO).issues.length >= 1, '질문형으로만 바꾸고 문장이 같으면 지적');
  assert.deepEqual(compareCandidates(AEO, SEO).issues, [], '같은 주제·같은 사실이라도 편집 목적이 다르면 통과');
  assert.deepEqual(compareCandidates(GEO, AEO).issues, [], 'AEO·GEO가 모두 답변 우선이어도 통과');
  const sharedFacts = { ...AEO, body: AEO.body + '\n2027학년도 모집요강 기준 실기 비중은 60%입니다.' }, other = { ...GEO, body: GEO.body + '\n실기 비중이 60%라는 점(2027학년도 모집요강)을 함께 봐야 합니다.' };
  assert.deepEqual(compareCandidates(sharedFacts, other).issues, [], '같은 수치(60%)를 공유해도 문장이 다르면 통과');
});

test('사실 보존: 문체 편집이 숫자·인용·실적·후기를 만들거나 바꾸면 편집 전 원고를 쓴다', () => {
  const original = { lead: '2026년 가을 수업에서 학생들은 세 칸 연습을 했습니다.', body: '## 수업 과정\n선생님이 구도를 먼저 보고 피드백했습니다.' };
  const fabricated = { lead: '2026년 가을 수업에서 학생들은 세 칸 연습을 했고 90%가 실력이 늘었습니다.', body: '## 수업 과정\n“정말 좋아졌어요”라는 후기가 많았고 합격으로 이어졌습니다.', changes: [], factChecks: [], operatorQuestions: [] };
  const check = factPreservation(`${original.lead}\n${original.body}`, `${fabricated.lead}\n${fabricated.body}`);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('90')) && check.problems.some((p) => p.includes('인용문')) && check.problems.some((p) => /합격|후기/.test(p)), JSON.stringify(check));
  const kept = applyStyleEdit(original, fabricated);
  assert.equal(kept.editorial.status, 'kept_original');
  assert.equal(kept.lead, original.lead); assert.equal(kept.body, original.body);
  const tidy = applyStyleEdit(original, { lead: '2026년 가을 수업에서는 세 칸 연습을 했습니다.', body: original.body, changes: [{ before: '학생들은', after: '', reason: '불필요한 주어 반복' }], factChecks: [], operatorQuestions: ['세 칸 연습에서 학생이 가장 많이 고친 부분은 무엇이었나요?'] });
  assert.equal(tidy.editorial.status, 'applied');
  assert.equal(tidy.editorial.changes.length, 1);
  assert.equal(applyStyleEdit(original, { lead: original.lead, body: original.body + '\n지금 바로 무료 체험!', changes: [], factChecks: [], operatorQuestions: [] }, /무료\s?체험/).editorial.status, 'kept_original', '금지 표현이 생기면 원고 유지');
});

test('발행 판정: 생성 성공과 분리 — 미확인 사실·출처가 있으면 발행 보류, 문구 문제는 수정 필요, 나머지도 사람 확인 대기(자동 발행 가능 없음)', () => {
  assert.equal(publishStatus({ missingInfo: ['추가 근거 필요: 실기 비중 출처'] }).status, 'hold');
  assert.equal(publishStatus({ factChecks: ['수업 기간 8주'] }).label, '발행 보류');
  assert.equal(publishStatus({ warnings: ['제목이 너무 깁니다.'] }).status, 'fix');
  const clean = publishStatus({});
  assert.equal(clean.status, 'review');
  assert.notEqual(clean.label, '발행 가능');
});

async function photoFile(h) {
  const folder = await h.folder('category:' + users.staff.campus + ':class-photo', '__synthetic_editorial_' + crypto.randomUUID(), users.staff);
  const uploaded = await h.upload(folder.body.folder.id, users.staff, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC.png' });
  return uploaded.body.file;
}
const generated = (c, extra = {}) => ({
  strategy: { primaryTopic: '웹툰 입문', searchIntent: '웹툰 입문 준비', nextQuestion: '태블릿은 언제 필요할까', readerProblem: '무엇부터 시작할지 모름' },
  modePlan: { readerQuestion: '태블릿부터 사야 하나', introRole: '직접 답', flow: ['직접 답', '조건', '방법', '후속 질문'], keyUnit: '질문별 답', outcome: '구매 판단' },
  titles: { search: c.title, homefeed: c.title, balanced: c.title, list: c.title, curious: c.title }, selectedTitleKind: 'balanced',
  lead: c.lead, body: c.body, hashtags: ['웹툰입문'], cta: '궁금한 점은 상담으로 확인해 보세요.', nextTopics: ['장면 나누기 연습'], photoCaptions: [], missingInfo: [], ...extra,
});
const generateForm = (file, extra) => {
  const form = new FormData();
  form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [file.id], notes: '웹툰 입문 수업 사진', strategyMode: 'balanced', requestId: crypto.randomUUID(), ...extra }));
  form.set(`photo:${file.id}`, new Blob([png()], { type: 'image/png' }), `${file.id}.png`);
  return form;
};

test('생성: 다른 방식 후보를 함께 보내면 차별화 지시가 들어가고, 제목만 바뀐 결과는 한 번 다시 쓰며 남은 문제는 숨기지 않는다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const file = await photoFile(h);
    // 1) 편집 목적이 다른 후보: AEO 생성 시 SEO 후보를 비교 대상으로 보냄 → 차별화 지시, 다른 결과는 그대로 통과
    let calls = [];
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls.push(JSON.parse(options.body)); return textResponse(generated(AEO));
    };
    const ok = await h.request('POST', '/api/data-core/content/generate', users.staff, generateForm(file, { writingMode: 'aeo', compareWith: [SEO, { mode: 'aeo', title: '자기 자신은 빠짐' }] }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(calls.length, 1);
    assert.match(calls[0].instructions, /같은 입력으로 이미 만든 다른 작성 방식 후보입니다[\s\S]*SEO 후보 — 제목: 웹툰 입문 준비/);
    assert.doesNotMatch(calls[0].instructions, /자기 자신은 빠짐/, '같은 방식 후보는 비교 대상이 아님');
    assert.match(calls[0].instructions, /AEO 작성 방식\(질문에 직접 답변\)/);
    assert.ok(calls[0].text.format.schema.required.includes('modePlan'));
    assert.equal(ok.body.generated.differentiation, undefined);
    assert.equal(ok.body.generated.modePlan.keyUnit, '질문별 답');
    assert.equal(ok.body.generated.publish.status, 'review', '생성 성공 ≠ 발행 가능');
    // 2) 제목만 바꾼 유사 본문 → 정확히 한 번 재작성, 그래도 같으면 경고로 남김(숨기지 않음) → 수정 필요
    calls = [];
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls.push(JSON.parse(options.body)); return textResponse(generated(TITLE_ONLY));
    };
    const similar = await h.request('POST', '/api/data-core/content/generate', users.staff, generateForm(file, { writingMode: 'aeo', compareWith: [SEO] }));
    assert.equal(similar.status, 200, JSON.stringify(similar.body));
    assert.equal(calls.length, 2, '차별화 부족은 한 번만 다시 쓴다');
    assert.match(calls[1].instructions, /이전 결과에 다음 문제가 있었습니다[\s\S]*SEO 후보와 같습니다/);
    assert.ok(similar.body.generated.differentiation.some((i) => i.includes('본문 문장')));
    assert.ok(similar.body.generated.warnings.some((i) => i.includes('SEO 후보')));
    assert.equal(similar.body.generated.publish.status, 'fix');
    // 3) 근거가 부족한 GEO: 지시문에 '추가 근거 필요', 결과 missingInfo → 발행 보류(생성은 성공)
    calls = [];
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls.push(JSON.parse(options.body)); return textResponse(generated(GEO, { missingInfo: ['추가 근거 필요: 장면 설계 비교 수업 기록'] }));
    };
    const geo = await h.request('POST', '/api/data-core/content/generate', users.staff, generateForm(file, { writingMode: 'geo' }));
    assert.equal(geo.status, 200);
    assert.match(calls[0].instructions, /근거가 없으면 그 주장을 빼고 missingInfo에 "추가 근거 필요"/);
    assert.match(calls[0].instructions, /전문가 인용문도 만들지/);
    assert.equal(geo.body.generated.publish.status, 'hold');
    assert.ok(geo.body.generated.publish.reasons[0].includes('추가 근거 필요'));
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('문체 편집 단계(API): 기계적 표현은 다듬고, 허위 후기·실적·인용문을 넣으면 편집 전 원고를 돌려준다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const input = { campusId: A, writingMode: 'aeo', title: AEO.title, lead: AEO.lead, body: AEO.body, facts: '웹툰 입문 수업 사진', missingInfo: [], warnings: [] };
    let sent = null;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      sent = JSON.parse(options.body);
      return textResponse({ lead: AEO.lead, body: AEO.body.replace('이미 디지털 작업에 익숙하다면', '디지털 작업에 익숙하면'), changes: [{ before: '이미 디지털 작업에 익숙하다면', after: '디지털 작업에 익숙하면', reason: '군더더기 줄임' }], factChecks: [], operatorQuestions: ['입문 학생이 세 칸 연습에서 가장 자주 막히는 부분은 무엇인가요?'] });
    };
    const applied = await h.request('POST', '/api/data-core/content/blog/style-edit', users.staff, { ...input, requestId: crypto.randomUUID() });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.editorial.status, 'applied');
    assert.match(applied.body.body, /디지털 작업에 익숙하면/);
    assert.equal(applied.body.editorial.operatorQuestions.length, 1);
    assert.match(sent.instructions, /AI 탐지 점수를 낮추는 것이 아니라/);
    assert.match(sent.instructions, /실제로 없었던 경험·학생 대화·후기 만들기/);
    assert.match(sent.instructions, /일부러 오타·비문·억지 구어체를 넣지 않습니다/);
    assert.equal(sent.input[0].content.length, 1, '텍스트만 보낸다(사진 없음)');
    assert.equal(applied.body.publish.status, 'review');

    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      return textResponse({ lead: AEO.lead, body: AEO.body + '\n“여기서 배우고 3개월 만에 합격했어요”라는 후기가 많습니다.', changes: [], factChecks: ['3개월 만에 합격'], operatorQuestions: [] });
    };
    const kept = await h.request('POST', '/api/data-core/content/blog/style-edit', users.staff, { ...input, requestId: crypto.randomUUID() });
    assert.equal(kept.status, 200);
    assert.equal(kept.body.editorial.status, 'kept_original');
    assert.equal(kept.body.body, AEO.body, '사실이 바뀐 편집은 버린다');
    assert.equal(kept.body.publish.status, 'hold', '사실 확인 필요 항목이 있으면 발행 보류');

    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      return textResponse({ unexpected: true });
    };
    const failed = await h.request('POST', '/api/data-core/content/blog/style-edit', users.staff, { ...input, requestId: crypto.randomUUID() });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.editorial.status, 'failed');
    assert.equal(failed.body.lead, AEO.lead, '편집에 실패해도 원고를 잃지 않는다');
    assert.equal((await h.request('POST', '/api/data-core/content/blog/style-edit', users.outsider, { ...input, requestId: crypto.randomUUID() })).status, 403);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

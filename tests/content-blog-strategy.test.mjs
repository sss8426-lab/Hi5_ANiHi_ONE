import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { libraryHarness, users, A } from './support/library-harness.mjs';

const png = () => encode({ width: 64, height: 80, channels: 4, depth: 8, data: new Uint8Array(64 * 80 * 4).fill(180) });
const textResponse = (value) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

async function fixture(h, user = users.staff) {
  const folder = await h.folder('category:' + user.campus + ':class-photo', '__synthetic_strategy_' + crypto.randomUUID(), user);
  assert.equal(folder.status, 201);
  const uploaded = await h.upload(folder.body.folder.id, user, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC_STRATEGY.png' });
  assert.equal(uploaded.status, 201);
  return uploaded.body.file;
}

// A well-formed synthetic blog result for the given strategyMode. Chosen so it never trips the
// server's own quality heuristic (blogQualityIssues): primaryTopic is non-empty, the picked title
// is short and shares a word with lead, no runaway word repetition, no brand-name overload.
function blogResult(kind) {
  const titles = { search: '부천 웹툰학원 고1 칸만화 수업', homefeed: '그림을 많이 그려도 장면이 밋밋한 이유', balanced: '부천 웹툰학원 수업, 그림보다 먼저 장면을 설계하는 이유' };
  return {
    strategy: { primaryTopic: '칸만화 장면연출', searchIntent: '웹툰 입시 준비 방법', nextQuestion: '인체를 먼저 해야 할까요', readerProblem: '그림은 많이 그리지만 상황 전달력이 부족함' },
    titles, selectedTitleKind: kind,
    lead: `${titles[kind]}에 대해 설명합니다. 장면을 먼저 설계하는 수업 방식을 소개합니다.`,
    body: '수업에서는 장면 구성을 먼저 연습한 뒤 세부 표현으로 넘어갑니다.',
    hashtags: ['웹툰입시', '칸만화', '부천웹툰학원', '장면연출', '인체', '실기', '고1미술', '입시미술'],
    cta: '어떤 준비부터 시작해야 할지 고민된다면 상담해드립니다.',
    nextTopics: ['인체보다 장면 연출을 먼저 연습해야 하는 경우', '칸만화에서 시선이 중요한 이유', '실기시험 첫 10분에 해야 하는 것'],
  };
}

function multipartInput(files, extra = {}) {
  const form = new FormData();
  form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: files.map((f) => f.id), notes: '고1 칸만화 수업 사진입니다', requestId: crypto.randomUUID(), ...extra }));
  for (const file of files) form.set(`photo:${file.id}`, new Blob([png()], { type: 'image/png' }), `${file.id}.png`);
  return form;
}

test('TYPE A/B/C: 검색형·홈피드형·균형형 strategyMode가 OpenAI instructions에 반영되고, 응답의 titles/selectedTitleKind/nextTopics가 그대로 전달된다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    for (const kind of ['search', 'homefeed', 'balanced']) {
      const file = await fixture(h);
      let capturedInstructions = '';
      globalThis.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
        const body = JSON.parse(options.body);
        capturedInstructions = body.instructions;
        return textResponse(blogResult(kind));
      };
      const result = await h.request('POST', '/api/data-core/content/generate', users.staff, multipartInput([file], { strategyMode: kind }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.match(capturedInstructions, new RegExp(`selectedTitleKind는 "${kind}"`));
      const generated = result.body.generated;
      assert.deepEqual(Object.keys(generated.titles).sort(), ['balanced', 'homefeed', 'search']);
      assert.equal(generated.selectedTitleKind, kind);
      assert.equal(generated.title, generated.titles[kind]);
      assert.equal(generated.lead, blogResult(kind).lead);
      assert.equal(generated.strategyMode, kind);
      assert.equal(generated.nextTopics.length, 3);
      assert.equal(generated.warnings, undefined, JSON.stringify(generated));
    }
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('기본값은 균형형이며, 지정하지 않으면 서버가 balanced로 정규화한다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const file = await fixture(h);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    let capturedInstructions = '';
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      capturedInstructions = JSON.parse(options.body).instructions;
      return textResponse(blogResult('balanced'));
    };
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, multipartInput([file]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(capturedInstructions, /selectedTitleKind는 "balanced"/);
    assert.equal(result.body.generated.strategyMode, 'balanced');
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('TYPE D: 긴 사용자 명령도 그대로 전송되고 정상 생성된다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const file = await fixture(h);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const longNote = '고1 칸만화 수업 사진입니다. '.repeat(150).slice(0, 3990);
    let sentText = '';
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      sentText = JSON.parse(options.body).input[0].content[0].text;
      return textResponse(blogResult('balanced'));
    };
    const form = multipartInput([file]);
    form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [file.id], notes: longNote, requestId: crypto.randomUUID() }));
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, form);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(sentText, longNote.trim());
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('TYPE E: 사진 없이 블로그 생성은 기존과 동일하게 명확히 거부되고, 제목/본문 재작성(refine)은 사진 없이도 동작한다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      return textResponse({ titles: { search: '검색형 제목', homefeed: '홈피드형 제목', balanced: '균형형 제목' } });
    };
    const empty = new FormData();
    empty.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [], notes: '사진 없이 작성', requestId: crypto.randomUUID() }));
    const generateResult = await h.request('POST', '/api/data-core/content/generate', users.staff, empty);
    assert.equal(generateResult.status, 400, JSON.stringify(generateResult.body));
    assert.equal(calls, 0);

    const refineResult = await h.request('POST', '/api/data-core/content/refine', users.staff, {
      mode: 'titles', campusId: A, strategy: blogResult('balanced').strategy, notes: '사진 없이 제목만', requestId: crypto.randomUUID(),
    });
    assert.equal(refineResult.status, 200, JSON.stringify(refineResult.body));
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(refineResult.body.refined.titles).sort(), ['balanced', 'homefeed', 'search']);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('TYPE G: 이 기능 이전에 저장된 초안(strategy/titles 필드 없음)도 그대로 열리고 다시 저장된다', async () => {
  const h = await libraryHarness();
  try {
    const legacy = await h.request('POST', '/api/data-core/content', users.staff, {
      sourceApp: 'blog', campusId: A, title: '레거시 초안', content: '이전 버전에서 저장된 본문입니다.',
      tags: ['레거시'], metadata: { footer: '레거시 문의' },
    });
    assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
    assert.equal(legacy.body.draft.metadata.strategy, undefined);
    const reopened = await h.request('GET', '/api/data-core/content/' + legacy.body.draft.id, users.staff);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.draft.title, '레거시 초안');
    const resaved = await h.request('PATCH', '/api/data-core/content/' + legacy.body.draft.id, users.staff, { title: '레거시 초안 수정' });
    assert.equal(resaved.status, 200, JSON.stringify(resaved.body));
    assert.equal(resaved.body.draft.title, '레거시 초안 수정');
  } finally { await h.mf.dispose(); }
});

test('TYPE H: 최근 제목을 recentTitles로 보내면 중복 회피 지시문이 OpenAI instructions에 포함된다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const file = await fixture(h);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    let capturedInstructions = '';
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      capturedInstructions = JSON.parse(options.body).instructions;
      return textResponse(blogResult('balanced'));
    };
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, multipartInput([file], { recentTitles: ['부천 웹툰학원 칸만화 수업'] }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(capturedInstructions, /부천 웹툰학원 칸만화 수업/);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('/refine mode=retitle: 사진 재전송 없이 새 제목에 맞춰 lead/body만 다시 쓰고, mode=titles는 제목 후보만 다시 만든다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const strategy = blogResult('balanced').strategy;
    let sawImage = false;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      const body = JSON.parse(options.body);
      sawImage = sawImage || body.input[0].content.some((item) => item.type === 'input_image');
      if (body.instructions.includes('제목 후보 3개(titles)만')) return textResponse({ titles: { search: '새 검색형', homefeed: '새 홈피드형', balanced: '새 균형형' } });
      return textResponse({ lead: '새 제목에 맞춘 새 도입부입니다.', body: '새 제목에 맞춰 최소한으로 고친 본문입니다.' });
    };
    const titlesResult = await h.request('POST', '/api/data-core/content/refine', users.staff, {
      mode: 'titles', campusId: A, strategy, notes: '', requestId: crypto.randomUUID(),
    });
    assert.equal(titlesResult.status, 200, JSON.stringify(titlesResult.body));
    assert.equal(titlesResult.body.refined.mode, 'titles');
    assert.equal(titlesResult.body.refined.titles.balanced, '새 균형형');

    const retitleResult = await h.request('POST', '/api/data-core/content/refine', users.staff, {
      mode: 'retitle', campusId: A, strategy, selectedTitle: '새 균형형', priorLead: '기존 도입부', priorBody: '기존 본문',
      notes: '', requestId: crypto.randomUUID(),
    });
    assert.equal(retitleResult.status, 200, JSON.stringify(retitleResult.body));
    assert.equal(retitleResult.body.refined.mode, 'retitle');
    assert.equal(retitleResult.body.refined.lead, '새 제목에 맞춘 새 도입부입니다.');
    assert.equal(sawImage, false);

    // Cross-campus and unauthenticated requests are rejected before any provider traffic.
    assert.equal((await h.request('POST', '/api/data-core/content/refine', users.foreign, { mode: 'titles', campusId: A, strategy, requestId: crypto.randomUUID() })).status, 403);
    assert.equal((await h.request('POST', '/api/data-core/content/refine', null, { mode: 'titles', campusId: A, strategy, requestId: crypto.randomUUID() })).status, 401);
    assert.equal((await h.request('POST', '/api/data-core/content/refine', users.staff, { mode: 'unknown', campusId: A, strategy, requestId: crypto.randomUUID() })).status, 400);
    delete h.env.OPENAI_API_KEY;
    const unavailable = await h.request('POST', '/api/data-core/content/refine', users.staff, { mode: 'titles', campusId: A, strategy, requestId: crypto.randomUUID() });
    assert.equal(unavailable.status, 503); assert.equal(unavailable.body.available, false);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('홈피드 품질검사: 문제가 있는 첫 결과는 한 번만 자동 재작성을 시도하고, 무한 재시도하지 않는다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const file = await fixture(h);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const bad = { ...blogResult('balanced'), strategy: { ...blogResult('balanced').strategy, primaryTopic: '' }, titles: { search: 's', homefeed: 'h', balanced: '이 글은 제목이 전혀 관련 없는 아주 길고 산만한 제목입니다 실제로 예순 글자가 넘도록 계속 이어지는 제목을 일부러 만들었습니다' }, lead: '전혀 다른 이야기입니다.' };
    const good = blogResult('balanced');
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      return textResponse(calls === 1 ? bad : good);
    };
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, multipartInput([file]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(calls, 2, '지적된 문제가 2개 이상이면 정확히 한 번만 재시도해야 한다');
    assert.equal(result.body.generated.title, good.titles.balanced);
    assert.equal(result.body.generated.warnings, undefined);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('홈피드 품질검사: 재시도 결과마저 파싱할 수 없으면 첫 결과를 warnings와 함께 그대로 반환한다(요청 자체는 실패하지 않음)', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const file = await fixture(h);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const bad = { ...blogResult('balanced'), strategy: { ...blogResult('balanced').strategy, primaryTopic: '' }, titles: { search: 's', homefeed: 'h', balanced: '이 글은 제목이 전혀 관련 없는 아주 길고 산만한 제목입니다 실제로 예순 글자가 넘도록 계속 이어지는 제목을 일부러 만들었습니다' }, lead: '전혀 다른 이야기입니다.' };
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      return textResponse(calls === 1 ? bad : { title: 'invalid shape' });
    };
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, multipartInput([file]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(calls, 2);
    assert.equal(result.body.generated.title, bad.titles.balanced);
    assert.ok(Array.isArray(result.body.generated.warnings) && result.body.generated.warnings.length > 0);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

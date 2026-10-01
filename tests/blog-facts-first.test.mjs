import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { encode } from 'fast-png';
import { libraryHarness, users, A } from './support/library-harness.mjs';

const png = () => encode({ width: 64, height: 80, channels: 4, depth: 8, data: new Uint8Array(64 * 80 * 4).fill(180) });
const textResponse = (value) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const titles = { search: '청강대 실기대전 최우수상 소식', homefeed: '최우수상을 만든 건 장면 설계였어요', balanced: '청강대 실기대전, 최우수상까지의 과정', list: '수상작 포인트 3가지', curious: '최우수상의 비결은 따로 있었습니다' };
const reply = (lead, body, missingInfo = []) => ({ strategy: { primaryTopic: '수상', searchIntent: '실기대전', nextQuestion: '준비', readerProblem: '준비' }, titles, selectedTitleKind: 'balanced',
  lead, body, hashtags: ['실기대전', '수상', '웹툰', '만화', '청강대'], cta: '상담', nextTopics: ['a', 'b', 'c'], photoCaptions: [], missingInfo });

test('수상 글에 사실이 없어 AI가 "자료가 없다"는 말을 본문에 쓰면 한 번 다시 쓰고, 부족한 정보는 따로 돌려준다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const folder = await h.folder('category:' + A + ':class-photo', '__synthetic_facts', users.staff);
    const file = (await h.upload(folder.body.folder.id, users.staff, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC.png' })).body.file;
    const calls = [];
    const answers = [
      reply('청강대 실기대전, 최우수상까지의 과정을 정리합니다.', '현재 제공된 자료에는 대회명과 수상 내역을 확인할 수 있는 정보가 없어, 구체적인 결과를 사실처럼 정리하기는 어렵습니다.'),
      reply('청강대 실기대전, 최우수상까지의 과정을 정리합니다.', '학생들은 장면을 먼저 나누는 연습으로 작품을 시작했어요.', ['수상 인원']),
    ];
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls.push(JSON.parse(options.body)); return textResponse(answers[Math.min(calls.length - 1, 1)]);
    };
    const form = new FormData();
    form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [file.id], notes: '청강대 수상 글', keywordBrand: 'anihi', templateId: 'award', requestId: randomUUID(),
      photoInstructions: { brief: { topic: '수상', facts: '2026 청강대 콘텐츠 실기대전 · 만화 문해력 2P 최우수상 · 2026년 5월' }, commonDescription: '', photos: [{ fileId: file.id, kind: 'student', description: '', facts: '', exclude: '', externalAiConsent: false }] } }));
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, form);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(calls.length, 2, 'one corrective retry, even with photo instructions');
    assert.match(calls[0].instructions, /32\) 입력에 필요한 사실.*missingInfo에 짧게 적고/);
    assert.match(calls[0].instructions, /핵심 키워드 하나를 골라 제목·상단 답변·본문·하단 요약을 합쳐 3~5번/);
    assert.match(calls[1].instructions, /본문에 자료가 부족하다는 설명이 들어갔습니다/);
    assert.ok(calls[0].text.format.schema.required.includes('missingInfo'));
    assert.equal(result.body.generated.body, '학생들은 장면을 먼저 나누는 연습으로 작품을 시작했어요.');
    assert.deepEqual(result.body.generated.missingInfo, ['수상 인원']);
    assert.equal(result.body.generated.warnings, undefined);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('지침이 금지한 표현(무료 체험·전원 합격 등)은 입력에 없으면 한 번 다시 쓰고, 사용자가 직접 적은 경우는 그대로 둔다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const folder = await h.folder('category:' + A + ':class-photo', '__synthetic_guide', users.staff);
    const file = (await h.upload(folder.body.folder.id, users.staff, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC.png' })).body.file;
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      return textResponse(calls === 1 || calls === 3 ? reply('청강대 실기대전, 최우수상까지의 과정을 정리합니다.', '지금 무료 체험을 신청하세요. 장면 설계 연습을 했습니다.') : reply('청강대 실기대전, 최우수상까지의 과정을 정리합니다.', '장면 설계 연습을 했습니다.'));
    };
    const generate = (notes) => {
      const form = new FormData();
      form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [file.id], notes, templateId: 'class', requestId: randomUUID() }));
      form.set(`photo:${file.id}`, new Blob([png()], { type: 'image/png' }), 'a.png');
      return h.request('POST', '/api/data-core/content/generate', users.staff, form);
    };
    const first = await generate('수업 소개 글');
    assert.equal(calls, 2, 'one rewrite');
    assert.equal(first.body.generated.body, '장면 설계 연습을 했습니다.');
    const typed = await generate('수업 소개 글, 이번 달 무료 체험 수업 안내 포함');
    assert.equal(calls, 3, 'the writer asked for it, so no rewrite');
    assert.match(typed.body.generated.body, /무료 체험/);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('블로그 글 만들기는 추천 제목으로 바로 완성본을 보여 주고, 다른 제목은 위의 칩으로 바꾼다', () => {
  const content = fs.readFileSync('public/data-core/content.js', 'utf8');
  assert.match(content, /\$\('generateAi'\)\.onclick = \(\) => runAi\(false, state\.sourceApp === 'blog'\);/);
});

test('흔한 오해 바로잡기는 입시·진로 정보 글에만 들어간다', () => {
  const source = fs.readFileSync('worker/blog-structures.ts', 'utf8');
  const career = source.split('\n').find(line => line.startsWith('  career:'));
  assert.match(career, /많이들 오해하는 점 바로잡기/);
  assert.equal(source.split('\n').filter(line => /오해/.test(line)).length, 1);
});

test('수상·합격·행사·입시정보 글은 사실 칸이 메인 화면에 나오고, 비어 있으면 AI를 부르지 않는다', () => {
  const blog = fs.readFileSync('public/data-core/blog-workflow.js', 'utf8'), content = fs.readFileSync('public/data-core/content.js', 'utf8');
  for (const type of ['award', 'admission', 'event', 'career']) assert.match(blog, new RegExp(`${type}:\\{label:`));
  assert.match(blog, /document\.querySelector\('\.brief-grid'\)\.after\(factsField\)/);
  assert.match(blog, /missingFacts\(\)\{/);
  const guard = content.indexOf("const missingFacts = instagram ? '' : blogWorkflow?.missingFacts();"), call = content.indexOf("api('/api/data-core/content/generate'");
  assert.ok(guard > 0 && guard < call, 'checked before the AI call');
  assert.match(content, /더 적으면 좋은 정보: \$\{generated\.missingInfo\.join\(', '\)\}/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { encode } from 'fast-png';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';
import { assembleBlocks } from '../public/data-core/blog-post-model.js';
import { BLOG_TEMPLATES } from '../public/data-core/blog-post-model.js';

const png = () => encode({ width: 64, height: 80, channels: 4, depth: 8, data: new Uint8Array(64 * 80 * 4).fill(180) });
const textResponse = (value) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const titles = { search: '부천 입시미술 합격 준비 과정', homefeed: '실기 준비를 늦게 시작해도 괜찮을까요', balanced: '합격 준비, 실기는 이렇게 했습니다', list: '합격 준비 3가지 정리', curious: '합격을 바꾼 건 따로 있었습니다' };
const result = { strategy: { primaryTopic: '합격 준비', searchIntent: '실기 준비', nextQuestion: '언제 시작할까', readerProblem: '준비 시기' }, titles, selectedTitleKind: 'balanced',
  lead: '합격 준비, 실기는 이렇게 했습니다. 준비를 시작할 때의 상황부터 정리합니다.', body: '실기 준비는 기초 소묘부터 시작했습니다.', hashtags: ['입시미술', '실기', '합격', '준비', '소묘'], cta: '상담 안내', nextTopics: ['a', 'b', 'c'] };

test('글 종류마다 정해진 글 구조가 AI 지시에 들어가고, 같은 캠퍼스·같은 종류의 조회수 높은 글만 참고로 보낸다', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const save = async (user, campusId, title, lead, templateId, views) => {
      const blocks = assembleBlocks({ body: `${lead}\n\n## ${title} 소제목\n\n본문 문단입니다.`, lead, photos: [] });
      const post = { schemaVersion: 1, revision: 0, title, privacyConfirmed: true, photos: [], blocks, brief: { exclude: '' }, strategyMode: 'balanced', template: { templateId },
        publication: views == null ? {} : { url: '', date: '2026-09-20', views, homefeedViews: null, asOf: '2026-09-21', source: '네이버 통계' } };
      const r = await h.request('POST', '/api/data-core/content/blog/save', user, { requestId: randomUUID(), campusId, publishStatus: 'draft', post });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    await save(users.staff, A, '합격 글 중간', '중간 조회 도입부입니다.', 'admission', 300);
    await save(users.staff, A, '합격 글 최고', '가장 많이 읽힌 도입부입니다.', 'admission', 900);
    await save(users.staff, A, '합격 글 셋째', '셋째 도입부입니다.', 'admission', 120);
    await save(users.staff, A, '합격 글 넷째', '넷째 도입부입니다.', 'admission', 50);
    await save(users.staff, A, '조회수 없는 합격 글', '아직 측정 안 한 도입부입니다.', 'admission', null);
    await save(users.staff, A, '수업 소개 글', '수업 소개 도입부입니다.', 'class', 5000);
    await save(users.foreign, B, '다른 캠퍼스 합격 비밀', '다른 캠퍼스 도입부입니다.', 'admission', 9999);

    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const folder = await h.folder('category:' + A + ':class-photo', '__synthetic_structure', users.staff);
    const file = (await h.upload(folder.body.folder.id, users.staff, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC.png' })).body.file;
    let sent;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      sent = JSON.parse(options.body); return textResponse(result);
    };
    const generate = (templateId) => {
      const form = new FormData();
      form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [file.id], notes: '합격 소식 글', templateId, requestId: randomUUID() }));
      form.set(`photo:${file.id}`, new Blob([png()], { type: 'image/png' }), `${file.id}.png`);
      return h.request('POST', '/api/data-core/content/generate', users.staff, form);
    };

    const admission = await generate('admission');
    assert.equal(admission.status, 200, JSON.stringify(admission.body));
    assert.match(sent.instructions, /이 글의 종류는 "합격 소식"입니다\. 본문은 다음 흐름을 따르세요: 1\. 결과 한 줄/);
    assert.match(sent.instructions, /합격을 보장하는 표현은 쓰지 않습니다/);
    assert.match(sent.instructions, /referencePosts가 있으면 같은 캠퍼스에서 반응이 좋았던/);
    const input = JSON.stringify(sent.input);
    const refs = JSON.parse(input.match(/\{\\"referencePosts\\":.*?\]\}/)[0].replace(/\\"/g, '"')).referencePosts;
    assert.deepEqual(refs.map(r => [r.title, r.views]), [['합격 글 최고', 900], ['합격 글 중간', 300], ['합격 글 셋째', 120]], 'best 3 of the same campus and kind');
    assert.equal(refs[0].lead, '가장 많이 읽힌 도입부입니다.');
    assert.deepEqual(refs[0].headings, ['합격 글 최고 소제목']);
    assert.doesNotMatch(input, /다른 캠퍼스|조회수 없는|수업 소개 도입부/);
    assert.deepEqual(admission.body.generated.referenceTitles, ['합격 글 최고', '합격 글 중간', '합격 글 셋째']);

    // A kind without measured posts gets its structure but no references; an unknown kind falls back to 수업 소개.
    const space = await generate('space');
    assert.match(sent.instructions, /"학원 공간"/);
    assert.doesNotMatch(sent.instructions, /referencePosts가 있으면/);
    assert.doesNotMatch(JSON.stringify(sent.input), /referencePosts/);
    assert.deepEqual(space.body.generated.referenceTitles, []);
    await generate('<script>');
    assert.match(sent.instructions, /"수업 소개"/);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('the server structures cover every 글 종류 the screen offers, with the same names', () => {
  const source = fs.readFileSync('worker/blog-structures.ts', 'utf8');
  const labels = Object.fromEntries([...source.matchAll(/^  (\w+): \{ label: '([^']+)'/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(labels, BLOG_TEMPLATES);
});

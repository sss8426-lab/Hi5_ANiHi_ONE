import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { encode } from 'fast-png';
import { libraryHarness, users, A } from './support/library-harness.mjs';
import { assembleBlocks } from '../public/data-core/blog-post-model.js';

const ids = () => { let n = 0; return () => 'b' + (++n); };

test('many photos are spread between paragraphs instead of piling up at the end', () => {
  const photos = Array.from({ length: 12 }, (_, i) => ({ fileId: 'p' + (i + 1), use: true, description: '' }));
  const blocks = assembleBlocks({ body: '도입.\n\n첫 문단.\n\n## 소제목\n\n둘째 문단.\n\n셋째 문단.\n\n넷째 문단.', photos, tags: ['태그'] }, ids());
  const seq = blocks.map(b => b.type === 'image' ? 'I' : b.type === 'heading' ? 'H' : b.type === 'divider' ? '-' : b.type === 'hashtags' ? '#' : 'T').join('');
  assert.equal(blocks.filter(b => b.type === 'image').map(b => b.fileId).join(), photos.map(p => p.fileId).join(), 'photo order kept');
  assert.ok(!/I{4}/.test(seq), `no long run of photos: ${seq}`);
  assert.equal(seq, 'TIIIT-HIIITIIITIIIT#', 'like the academy posts: divider before a section title, and each part reads title → photos → text');
  // Fewer photos than paragraphs: spread out, not packed at the top.
  const few = assembleBlocks({ body: '도입.\n\n1.\n\n2.\n\n3.\n\n4.', photos: photos.slice(0, 2) }, ids()).map(b => b.type === 'image' ? 'I' : 'T').join('');
  assert.equal(few, 'TITTITT');
});

test('a photo caption is the user description first, otherwise the AI caption, otherwise none', () => {
  const photos = [{ fileId: 'a', use: true, description: '직접 쓴 설명', aiCaption: 'AI 설명' }, { fileId: 'b', use: true, description: '', aiCaption: 'AI가 쓴 한 줄' }, { fileId: 'c', use: true, description: '' }];
  const blocks = assembleBlocks({ body: '도입.\n\n문단 하나.\n\n문단 둘.\n\n문단 셋.', photos }, ids());
  assert.deepEqual(blocks.filter(b => b.type === 'caption').map(b => b.text), ['직접 쓴 설명', 'AI가 쓴 한 줄']);
});

const png = () => encode({ width: 64, height: 80, channels: 4, depth: 8, data: new Uint8Array(64 * 80 * 4).fill(180) });
const textResponse = (value) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('saved hashtags become body keywords with the brand name, many photos ask for more paragraphs, captions come back filtered', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const folder = await h.folder('category:' + A + ':class-photo', '__synthetic_photos', users.staff);
    const files = [];
    for (let i = 0; i < 6; i++) files.push((await h.upload(folder.body.folder.id, users.staff, { bytes: png(), mime: 'image/png', name: `SYNTHETIC_${i}.png` })).body.file);
    let sent, reply;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      sent = JSON.parse(options.body); return textResponse(reply);
    };
    const titles = { search: '부천 웹툰학원 수상 소식', homefeed: '수상 뒤에 학생이 돌아본 것', balanced: '부천 웹툰학원 수상, 다음 작품을 향해', list: '수상작 3가지 포인트', curious: '수상보다 중요한 건 따로 있었습니다' };
    reply = { strategy: { primaryTopic: '수상', searchIntent: '공모전', nextQuestion: '다음 작품', readerProblem: '준비' }, titles, selectedTitleKind: 'balanced',
      lead: '부천 웹툰학원 수상, 다음 작품을 향해 준비합니다. 이번 수상의 의미를 정리했습니다.', body: '첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.', hashtags: ['공모전', '수상', '웹툰', '작품', '도전'], cta: '상담', nextTopics: ['a', 'b', 'c'],
      photoCaptions: [{ fileId: files[0].id, caption: '바다 생물을 그린 수채 작품' }, { fileId: files[1].id, caption: '' }, { fileId: 'not-selected', caption: '선택하지 않은 사진' }, { fileId: files[2].id, caption: 'x'.repeat(201) }] };
    const form = new FormData();
    form.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: files.map(f => f.id), notes: '수상작 사진입니다', keywordBrand: 'anihi',
      keywordTags: ['#만화입시', '애니입시', '웹툰학원', '부천웹툰학원', 7], templateId: 'award', requestId: randomUUID() }));
    for (const f of files) form.set(`photo:${f.id}`, new Blob([png()], { type: 'image/png' }), `${f.id}.png`);
    const result = await h.request('POST', '/api/data-core/content/generate', users.staff, form);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(sent.instructions, /검색 키워드 "[^"]*만화입시, 애니입시, 웹툰학원/, 'the saved tags are the search keywords (region-glued ones go through the region rule)');
    assert.doesNotMatch(sent.instructions, /본문 문단 3개 이상에 서로 다른 키워드/, 'no keyword weaving into every paragraph (guide: no keyword stuffing)');
    assert.match(sent.instructions, /핵심 키워드 하나를 골라 제목·상단 답변·본문·하단 요약을 합쳐 3~5번/);
    assert.match(sent.instructions, /18\) 사진이 6장입니다\. .*비슷한 사진끼리 묶어.*최소 2개/);
    // The academy's writing guide.
    assert.match(sent.instructions, /\[원고 지침\]/);
    assert.match(sent.instructions, /20\) 역할: .*학원 이름은 "애니하이"로 쓰고, 예전 이름\(애니스타\)은 쓰지 마세요\. 기본 발신자는 부천 애니하이입니다/);
    assert.match(sent.instructions, /23\) 문체: .*"~합니다", "~할 수 있습니다"를 중심에/);
    assert.match(sent.instructions, /24\) 문단: 한 문단은 2~4문장.*문장마다 줄을 끊지 마세요.*1,200~1,800자/);
    assert.match(sent.instructions, /25\) 상단\(lead\): 독자의 핵심 질문 1개와 그에 대한 직접적인 답 2~3문장/);
    assert.match(sent.instructions, /26\) 본문: 소제목\(## \)은 "Q\. …인가요\?"/);
    assert.match(sent.instructions, /29\) 하단\(마지막 문단\): .*"부천 만화학원"/);
    assert.match(sent.instructions, /30\) 금지 표현: "무료 체험", "상시 모집", "전원 합격", "마감 임박"/);
    assert.match(sent.instructions, /6\) 문단은 2~4문장 단위로 나누고, 문장마다 줄바꿈하지 마세요/);
    assert.doesNotMatch(sent.instructions, /15~25자|"~인데요", "~답니다"|학원 이름 문구 "#/, 'the earlier short-line style is replaced by the guide');
    assert.match(sent.instructions, /"Q\. …\?" 질문형 소제목으로 바꿔 쓰고/);
    assert.match(sent.instructions, /19\) photoCaptions에는/);
    assert.ok(sent.text.format.schema.required.includes('photoCaptions'));
    assert.deepEqual(result.body.generated.photoCaptions, [{ fileId: files[0].id, caption: '바다 생물을 그린 수채 작품' }], 'empty, oversized and unselected captions are dropped');

    // An older-shaped answer without photoCaptions still works.
    delete reply.photoCaptions;
    const again = new FormData();
    again.set('input', JSON.stringify({ sourceApp: 'blog', campusId: A, selectedFileIds: [files[0].id], notes: '사진', requestId: randomUUID() }));
    again.set(`photo:${files[0].id}`, new Blob([png()], { type: 'image/png' }), 'a.png');
    const older = await h.request('POST', '/api/data-core/content/generate', users.staff, again);
    assert.equal(older.status, 200, JSON.stringify(older.body));
    assert.deepEqual(older.body.generated.photoCaptions, []);
    assert.doesNotMatch(sent.instructions, /18\) 사진이/, 'one photo needs no paragraph rule');
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

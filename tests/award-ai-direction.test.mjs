import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { encode } from 'fast-png';
import { libraryHarness, users } from './support/library-harness.mjs';

// Synthetic folders and generated pixels only; no real student work or names.
const png = (shade = 180) => encode({ width: 48, height: 64, channels: 4, depth: 8, data: new Uint8Array(48 * 64 * 4).fill(shade) });
const base = '/api/data-core/awards';
const ai = base + '/ai-direction';
async function folder(h, title, extra = {}) {
  const r = await h.request('POST', base + '/folders', users.teacher, { title, collectionType: 'enrolled', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.record;
}
async function upload(h, parent, name, shade) {
  const form = new FormData(); form.set('file', new File([png(shade)], name, { type: 'image/png' }));
  form.set('recordId', parent.id); form.set('category', 'competition-material');
  const r = await h.request('POST', '/api/data-core/files', users.staff, form); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.file;
}
async function fixture(h) {
  const root = await folder(h, 'SYNTHETIC 가상예술대학교');
  const y25 = await folder(h, '2025', { parentFolderId: root.id }), y24 = await folder(h, '2024년', { parentFolderId: root.id });
  const comic = await folder(h, '만화창작', { parentFolderId: y25.id }), anim = await folder(h, '애니메이션', { parentFolderId: y24.id });
  const publicRoot = await folder(h, 'SYNTHETIC 가상예술대학교', { collectionType: 'public' });
  const files = {
    comic1: await upload(h, comic, 'SYNTHETIC_comic_1.png', 120), comic2: await upload(h, comic, 'SYNTHETIC_comic_2.png', 140),
    anim: await upload(h, anim, 'SYNTHETIC_anim.png', 160), untyped: await upload(h, y25, 'SYNTHETIC_untyped.png', 170),
    publicOne: await upload(h, await folder(h, '2026 웹툰', { parentFolderId: publicRoot.id, collectionType: 'public' }), 'SYNTHETIC_public.png', 190),
  };
  // Aliases of one university merge into its full name across collections.
  const alias = await folder(h, '계명대', { collectionType: 'admitted' }), full = await folder(h, '계명대학교 (대명캠퍼스)', { collectionType: 'university' });
  files.alias = await upload(h, alias, 'SYNTHETIC_alias.png', 100); files.full = await upload(h, full, 'SYNTHETIC_full.png', 110);
  return files;
}
const reply = value => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('universities merge collections and aliases; types come from folders below year; members only', async () => {
  const h = await libraryHarness();
  try {
    const files = await fixture(h);
    const list = await h.request('GET', ai + '/universities', users.foreign);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.universities, [{ name: '계명대학교 (대명캠퍼스)', count: 2 }, { name: 'SYNTHETIC 가상예술대학교', count: 5 }]);
    assert.equal(list.body.referenceLimit, 8);
    const works = await h.request('GET', ai + '/works?university=' + encodeURIComponent('SYNTHETIC 가상예술대학교'), users.teacher);
    assert.equal(works.status, 200);
    assert.deepEqual(works.body.types, [{ name: '2026 웹툰', count: 1 }, { name: '만화창작', count: 2 }, { name: '애니메이션', count: 1 }, { name: '구분 없음', count: 1 }]);
    const byId = Object.fromEntries(works.body.works.map(work => [work.id, work]));
    assert.deepEqual([byId[files.comic1.id].year, byId[files.comic1.id].type, byId[files.comic1.id].collection], ['2025', '만화창작', 'enrolled']);
    assert.deepEqual([byId[files.anim.id].year, byId[files.anim.id].type], ['2024', '애니메이션']);
    assert.deepEqual([byId[files.untyped.id].year, byId[files.untyped.id].type], ['2025', '구분 없음']);
    assert.deepEqual([byId[files.publicOne.id].year, byId[files.publicOne.id].collection], ['2026', 'public']);
    assert.equal(works.body.works[0].year, '2026');
    const merged = await h.request('GET', ai + '/works?university=' + encodeURIComponent('계명대학교 (대명캠퍼스)'), users.teacher);
    assert.deepEqual(merged.body.works.map(work => work.id).sort(), [files.alias.id, files.full.id].sort());
    // Deleted folders drop out of the lists.
    const deleted = await h.request('GET', base + '/folders?collectionType=admitted', users.teacher);
    await h.request('DELETE', base + '/folders/' + deleted.body.folders[0].id, users.admin);
    assert.equal((await h.request('GET', ai + '/universities', users.teacher)).body.universities[0].count, 1);
    for (const [user, status] of [[null, 401], [users.outsider, 403]]) {
      assert.equal((await h.request('GET', ai + '/universities', user)).status, status);
      assert.equal((await h.request('GET', ai + '/works?university=x', user)).status, status);
    }
    assert.equal((await h.request('GET', ai + '/works', users.teacher)).status, 400);
  } finally { await h.mf.dispose(); }
});

test('analyze sends the picture and checked works only, returns three marked directions, stores nothing', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const files = await fixture(h);
    const form = (ids, image = new File([png(60)], 'SYNTHETIC_student_name.png', { type: 'image/png' })) => {
      const body = new FormData(); body.set('image', image); body.set('fileIds', JSON.stringify(ids)); return body;
    };
    assert.equal((await h.request('POST', ai + '/analyze', users.teacher, form([files.comic1.id]))).status, 503);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body), content = body.input[0].content;
      assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, 'award_direction');
      assert.deepEqual(content.filter(item => item.type === 'input_image').map(item => item.detail), ['high', 'low', 'low']);
      assert.deepEqual(Buffer.from(content[1].image_url.split(',')[1], 'base64'), Buffer.from(png(60)));
      assert.ok(content.some(item => item.text === '참고작 1: 2025 · 만화창작 · 재원생 수상작'));
      for (const secret of [files.comic1.id, 'SYNTHETIC_comic_1', 'SYNTHETIC_student_name', 'synthetic-test-only', 'library-teacher']) assert.ok(!options.body.includes(secret), secret);
      return reply({ directions: [
        { title: '주인공을 화면 1/3 지점으로', detail: '수상작처럼 인물을 안쪽으로 옮기세요.', x: 0.1, y: 0.5, w: 0.3, h: 0.4 },
        { title: '대각선 시선 흐름', detail: '길을 대각선으로 두세요.', x: 0.9, y: -1, w: 5, h: 0.2 },
        { title: '오른쪽 아래 마무리', detail: '덜 그린 곳을 채우세요.', x: 0.6, y: 0.7, w: 0.3, h: 0.25 },
        { title: '네 번째는 버림', detail: '', x: 0, y: 0, w: 0.1, h: 0.1 },
      ] });
    };
    const before = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM file_objects').first(), objects = (await h.env.FILES.list()).objects.length;
    const result = await h.request('POST', ai + '/analyze', users.teacher, form([files.comic1.id, files.anim.id]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.directions.length, 3);
    assert.equal(result.body.directions[0].title, '주인공을 화면 1/3 지점으로');
    assert.deepEqual(result.body.directions[1].box, { x: 0.9, y: 0, w: 0.09999999999999998, h: 0.2 });
    assert.deepEqual(result.body.compared, [files.comic1.id, files.anim.id]);
    assert.equal(calls, 1);
    assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM file_objects').first()).n, before.n);
    assert.equal((await h.env.FILES.list()).objects.length, objects);
    assert.equal((await h.env.DB.prepare("SELECT COUNT(*) AS n FROM data_records WHERE record_type='content-ai-call' AND source_app='award-direction'").first()).n, 1);

    const nine = Array.from({ length: 9 }, (_, n) => 'id-' + n);
    for (const [body, status] of [[form(nine), 400], [form([]), 400], [form([files.comic1.id, files.comic1.id]), 400], [form(['missing']), 404],
      [form([files.comic1.id], new File(['text'], 'a.txt', { type: 'text/plain' })), 400]]) {
      assert.equal((await h.request('POST', ai + '/analyze', users.teacher, body)).status, status);
    }
    const libraryFolder = await h.folder('root', 'SYNTHETIC library'), libraryFile = await h.upload(libraryFolder.body.folder.id, users.admin, { bytes: png(), mime: 'image/png', name: 'SYNTHETIC.png' });
    assert.equal((await h.request('POST', ai + '/analyze', users.admin, form([libraryFile.body.file.id]))).status, 404);
    assert.equal((await h.request('POST', ai + '/analyze', users.teacher, form([files.comic1.id]), 'https://attacker.invalid')).status, 403);
    assert.equal((await h.request('POST', ai + '/analyze', users.outsider, form([files.comic1.id]))).status, 403);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

test('screen: upload → university → type chips → scrollable check list (max 8) → marked result', async () => {
  const [html, js, css] = await Promise.all(['index.html', 'award-ai-direction.js', 'award-workspace.css'].map(name => readFile(new URL('../public/data-core/' + name, import.meta.url), 'utf8')));
  const section = html.slice(html.indexOf('id="awardAiDirection"'), html.indexOf('</aside>', html.indexOf('id="awardAiDirection"')));
  for (const id of ['awardAiFile', 'awardAiUniversity', 'awardAiTypes', 'awardAiWorks', 'awardAiAll', 'awardAiNone', 'awardAiGo', 'awardAiMarks', 'awardAiDirections', 'awardAiRefs', 'awardAiAfterImage', 'awardAiAgain', 'awardAiSave', 'awardAiSaved']) assert.ok(section.includes(`id="${id}"`), id);
  assert.ok(html.indexOf('id="awardAiDirection"') > html.indexOf('id="awardFolderDetail"'));
  assert.ok(html.indexOf('award-ai-direction.js') > html.indexOf('award-image-cache.js'));
  for (const removed of ['점수', '보호자', '인쇄', '연습 과제']) assert.ok(!section.includes(removed), removed);
  assert.match(js, /분석하기 · 체크한 \$\{n\}장과 비교/);
  assert.match(js, /st\.picked\.size >= st\.limit/);
  assert.match(js, /'image\/jpeg', 0\.88/);
  assert.match(css, /\.award-ai-scroll \{ max-height:320px; overflow-y:auto;/);
  assert.match(css, /\.award-ai \.m1 \{ --mark:#ef4444; \} \.award-ai \.m2 \{ --mark:#f59e0b; \} \.award-ai \.m3 \{ --mark:#3b82f6; \}/);
});

test('수정 후 그림: the picture is redrawn with the directions; results save per campus, open, and delete with their pictures', async () => {
  const h = await libraryHarness(), originalFetch = globalThis.fetch;
  try {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
    const directions = [{ title: '명암 대비 키우기', detail: '인물은 밝게, 배경은 어둡게.', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }, { title: '선 정리', detail: '겹친 선을 정리하세요.', box: { x: 0, y: 0, w: 1, h: 1 } }];
    const reviseForm = (list = directions) => { const body = new FormData(); body.set('image', new File([png(60)], 'SYNTHETIC_student.png', { type: 'image/png' })); body.set('directions', JSON.stringify(list)); return body; };
    assert.equal((await h.request('POST', ai + '/revise', users.teacher, reviseForm())).status, 503);
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
      calls++;
      assert.equal(String(url), 'https://api.openai.com/v1/images/edits');
      const body = options.body;
      assert.equal(body.get('size'), '1024x1536'); assert.equal(body.get('output_format'), 'jpeg'); assert.equal(body.get('n'), '1');
      assert.match(body.get('prompt'), /1\. 명암 대비 키우기 — 인물은 밝게, 배경은 어둡게\.\n2\. 선 정리/);
      assert.ok(!body.get('prompt').includes('SYNTHETIC_student'));
      return Response.json({ data: [{ b64_json: jpeg.toString('base64') }] });
    };
    const revised = await h.raw('POST', ai + '/revise', users.teacher, reviseForm());
    assert.equal(revised.status, 200); assert.equal(revised.headers.get('content-type'), 'image/jpeg');
    const after = Buffer.from(await revised.arrayBuffer());
    assert.equal(after.subarray(0, 2).toString('hex'), 'ffd8');
    for (const list of [[], Array(4).fill(directions[0])]) assert.equal((await h.request('POST', ai + '/revise', users.teacher, reviseForm(list))).status, 400);
    assert.equal((await h.request('POST', ai + '/revise', users.teacher, reviseForm(), 'https://attacker.invalid')).status, 403);
    assert.equal(calls, 1);

    const saveForm = (withAfter = true) => {
      const body = new FormData();
      body.set('before', new File([png(60)], 'before.png', { type: 'image/png' }));
      if (withAfter) body.set('after', new File([after], 'after.jpg', { type: 'image/jpeg' }));
      body.set('result', JSON.stringify({ title: '가상 결과', university: 'SYNTHETIC 가상예술대학교', directions, compared: ['id-1'] }));
      return body;
    };
    const objects = (await h.env.FILES.list()).objects.length;
    const saved = await h.request('POST', ai + '/results', users.teacher, saveForm());
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.deepEqual([saved.body.result.title, saved.body.result.hasAfter, saved.body.result.directions.length, saved.body.result.canDelete], ['가상 결과', true, 2, true]);
    assert.equal((await h.env.FILES.list()).objects.length, objects + 2);
    const id = saved.body.result.id;
    assert.equal((await h.request('POST', ai + '/results', users.foreign, saveForm(false))).status, 201);
    const seen = async user => (await h.request('GET', ai + '/results', user)).body.results.map(item => item.title);
    assert.deepEqual(await seen(users.staff), ['가상 결과']);
    assert.equal((await seen(users.foreign)).length, 1);
    assert.equal((await seen(users.admin)).length, 2);
    const picture = await h.raw('GET', `${ai}/results/${id}/after`, users.staff);
    assert.equal(picture.status, 200); assert.deepEqual(Buffer.from(await picture.arrayBuffer()), after);
    assert.equal((await h.raw('GET', `${ai}/results/${id}/before`, users.foreign)).status, 404);
    assert.equal((await h.raw('GET', `${ai}/results/${id}/before`, users.outsider)).status, 403);
    const generic = await h.request('GET', '/api/data-core/records?recordType=award-ai-direction-result', users.admin);
    assert.equal(generic.body.records.length, 0);
    assert.equal((await h.request('DELETE', `${ai}/results/${id}`, users.staff)).status, 403);
    assert.equal((await h.request('DELETE', `${ai}/results/${id}`, users.teacher)).status, 200);
    assert.deepEqual(await seen(users.staff), []);
    assert.equal(await h.env.FILES.get(`award-ai-direction/${id}/before`), null);
    assert.equal(await h.env.FILES.get(`award-ai-direction/${id}/after`), null);
    assert.equal((await h.request('POST', ai + '/results', users.teacher, saveForm(), 'https://attacker.invalid')).status, 403);
  } finally { globalThis.fetch = originalFetch; await h.mf.dispose(); }
});

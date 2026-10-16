import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encode } from 'fast-png';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';
import { renderReport, analyze, compare, gradeBook, bandOf, regionFromAddress, segment, pickByAverage, model } from '../public/data-core/highschool-report.js';
import { makePdf } from '../public/data-core/highschool-export.js';

// 고교 진학 상담 (2026-10-16). 가상 학생만 씁니다.
const data = { ...JSON.parse(fs.readFileSync(new URL('../worker/highschool-schools.json', import.meta.url), 'utf8')),
  academies: [{ campusId: 'campus-anihi-admission', name: '부천 애니 입시본원', address: '경기도 부천시 원미구 상동로 109, 상동프라자 5층' }, { campusId: 'campus-ansan', name: '안산 입시본원', address: '경기도 안산시 단원구 고잔로 88' }] };
const g = (s, m, a) => ({ s, m, a });
const seg = (min, bus = '83') => ({ min, mode: 'transit', bus, transfers: 0, walk: 5 });
const student = (over = {}) => ({
  name: '가상학생', middleSchool: '가상중학교', grade: 3, address: '경기도 부천시 원미구 가상로 1', entryYear: 2027, campusId: 'campus-anihi-admission',
  wishes: ['상원고', '중원고', '부명고', '상일고', '부천정산고'],
  commute: { checkedAt: '2026.10.16', back: seg(25), schools: { 상원고: { home: seg(18) }, 중원고: { home: { min: 12, mode: 'walk' } }, 부명고: { home: seg(22) }, 상일고: { home: seg(30) }, 부천정산고: { home: seg(35) } } },
  grades: { '2-2': { 국어: g(82, 70.1, 'B'), 영어: g(64, 68.2, 'D'), 수학: g(55, 60.3, 'E'), 사회: g(88, 72.4, 'B') }, '3-1': { 국어: g(90, 72.3, 'A'), 영어: g(70, 67.9, 'C'), 수학: g(58, 59.4, 'E'), 역사: g(84, 70.1, 'B') } },
  ...over,
});

test('상담 자료: 예전 자료와 같은 9쪽, 저장 파일 이름 순서', () => {
  const out = renderReport(student(), data);
  assert.deepEqual(out.pages.map((p) => p.name), ['표지', '수능변화', '내신변화', '등급제개편', '상담표', '학교비교표', '지역평균표', '성적변화_추천학교', '통학시간_차이']);
  assert.ok(out.pages.every((p) => (p.html.match(/<section class="/g) || []).length === 1), '쪽마다 section 하나');
  for (const text of ['2027학년도 고등학교 진학', '가상중학교 3학년', '2028 대입 수능 변화', '2028 대입 내신 변화', '9등급제에서 5등급제로의 변환', '고교 진학 상담표', '<span>부천 애니 입시본원</span>',
    '부천 고등학교 고1·고2 국어·영어·수학 평균표', '전체 평균은 <b>69.3점', '중학교 성적 변화 정리', '통학 시간에 따른 공부·그림 시간 차이', '최종 추천 순위', '재원생 학교 평가'])
    assert.ok(out.html.includes(text), text);
  assert.equal(out.analysis.band, '상위권', '국어·영어·사탐 점수−평균 평균 +9.5');
  assert.equal(out.analysis.rows[0].s, '중원고', '하루 이동이 가장 짧은 학교가 통학 1위');
  assert.equal(out.recommendation.list.at(-1).s, '부천정산고', '특성화고는 맨 아래');
});

test('상담 자료: 통학 미확인 학교는 뒤로, 다른 지역 희망은 빼고, 이름은 글자로', () => {
  const s = student({ name: '<b>가상</b>', wishes: ['상원고', '삼산고', '범박고'], commute: { back: seg(20), schools: { 상원고: { home: seg(18) } } } });
  const A1 = analyze(s, data);
  assert.deepEqual(A1.out, ['삼산고'], '인천 학교는 부천 주소 학생 자료에서 빠진다');
  assert.deepEqual(A1.rows.map((x) => [x.s, x.rank]), [['상원고', 1], ['범박고', null]]);
  const html = renderReport(s, data).html;
  assert.ok(html.includes('&lt;b&gt;가상&lt;/b&gt;') && !html.includes('<b>가상</b>'));
  assert.ok(html.includes('범박고는 통학 시간을 아직 넣지 않아 순위에서 뒤에 두었습니다'));
});

test('성적대·지역·캠퍼스 학원 기준', () => {
  assert.deepEqual(bandOf(gradeBook(student())), { gap: 9.5, band: '상위권', trend: '비교 불가', d: null, sems: ['2-2', '3-1'] });
  assert.equal(bandOf(gradeBook(student({ grades: { '3-1': { 국어: { a: 'B' } } } }))), null, '성취도만 있으면 점수 성적대 없음');
  assert.equal(regionFromAddress('인천광역시 부평구 가상로 2'), '인천');
  assert.equal(segment({ min: 18, mode: 'transit', bus: '7호선,16' }).head, '7호선 등 / 18분', '지하철에는 버스를 붙이지 않는다');
  assert.equal(segment({ min: 17, mode: 'transit', bus: '5', transfers: 0, walk: 0 }).sub, '환승 0회', '도보 0분은 적지 않는다');
  assert.deepEqual(segment({ min: 4, mode: 'walk', alt: 9 }), { min: 4, head: '도보 4분', sub: '버스로는 9분' });
  assert.ok(analyze(student(), data).rows.every((x) => x.total != null), '부천 애니 입시본원(상동로 109)은 정리해 둔 학교→학원 시간을 쓴다');
  const ansan = analyze(student({ campusId: 'campus-ansan' }), data);
  assert.equal(ansan.sangdong, false);
  assert.ok(ansan.rows.every((x) => x.total == null), '다른 캠퍼스는 카카오로 찾은 학교→학원 시간이 있어야 한다');
  assert.ok(renderReport(student({ campusId: 'campus-ansan' }), data).html.includes('<span>안산 입시본원</span>'));
  const C = compare(analyze(student(), data), student());
  assert.equal(C.genList.length, 4);
});

test('PDF: 쪽마다 그림 한 장, 목차(xref) 위치가 맞는 A4 파일', () => {
  const jpeg = (n) => ({ bytes: new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]), width: 1588, height: 2246 });
  const pdf = makePdf([jpeg(1), jpeg(2), jpeg(3)]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 3);
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = text.slice(xref).split('\n').filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  assert.equal(offsets.length, 2 + 3 * 3);
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `객체 ${i + 1} 위치`));
});

test('API: 캠퍼스마다 자기 학원 학생만 (마스터는 전체), 삭제는 만든 사람·원장·마스터', async () => {
  const h = await libraryHarness();
  try {
    const created = await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student({ campusId: A }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.student.id;
    assert.equal(created.body.student.campusId, A);
    assert.equal((await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student({ campusId: B }) })).status, 400, '다른 캠퍼스로는 못 만든다');
    assert.equal((await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student({ campusId: '' }) })).status, 400, '캠퍼스를 골라야 한다');

    const mine = await h.request('GET', '/api/data-core/highschool', users.staff);
    assert.equal(mine.body.students.length, 1, '같은 캠퍼스 선생님은 본다');
    assert.deepEqual(mine.body.schools.academies.map((a) => a.campusId), [A], '고를 수 있는 캠퍼스도 자기 캠퍼스만');
    assert.equal(mine.body.schools.academies[0].address, '경기도 부천시 원미구 상동로 109, 상동프라자 5층 506호·507호');
    const other = await h.request('GET', '/api/data-core/highschool', users.foreign);
    assert.equal(other.status, 200);
    assert.equal(other.body.students.length, 0, '다른 캠퍼스 선생님은 못 본다');
    assert.equal((await h.request('PATCH', `/api/data-core/highschool/students/${id}`, users.foreign, { student: { ...created.body.student, campusId: B } })).status, 404);
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${id}`, users.foreign)).status, 404);
    const master = await h.request('GET', '/api/data-core/highschool', users.master);
    assert.equal(master.body.students.length, 1, '마스터는 전체');
    assert.equal(master.body.schools.academies.length, 10);
    assert.ok(master.body.schools.academies.every((a) => a.address && !/\.co\.kr|naver/.test(a.address)), '홈페이지 주소 없이 주소만');

    const edited = await h.request('PATCH', `/api/data-core/highschool/students/${id}`, users.staff, { student: { ...mine.body.students[0], wishes: ['상원고'] } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual(edited.body.student.wishes, ['상원고']);
    assert.equal((await h.request('PATCH', `/api/data-core/highschool/students/${id}`, users.teacher, { student: created.body.student })).status, 409, '먼저 고친 사람이 있으면 다시 불러오기');
    assert.equal((await h.request('GET', '/api/data-core/highschool', users.outsider)).status, 403);
    assert.equal((await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student({ campusId: A }) }, 'https://evil.example')).status, 403);
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${id}`, users.staff)).status, 403, '만든 사람이 아닌 선생님은 못 지움');
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${id}`, users.director)).status, 200, '원장은 지움');
    assert.equal((await h.request('PATCH', '/api/data-core/highschool/schools', users.master, { name: '상원고' })).status, 404, '학교 평가 고치기는 화면·API 모두 없음');
    assert.equal((await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { address: '부천', campusId: A, schools: ['상원고'] })).status, 503, '카카오 키가 없으면');
  } finally { await h.mf.dispose(); }
});

test('API: 카카오맵 대중교통 길찾기 (가짜 응답) — 캠퍼스 학원 주소 기준', async () => {
  const h = await libraryHarness();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (url.hostname !== 'dapi.kakao.com') return realFetch(input, init);
    seen.push([url.pathname, url.searchParams.get('query'), init?.headers?.authorization]);
    // 집 126.70 · 학원(상동로) 126.75 · 학교 126.72(약 1.8km) · 가까운고 126.7001(집 바로 옆)
    const q = url.searchParams.get('query') || '';
    if (url.pathname.startsWith('/v2/local/search/')) return Response.json({ documents: [{ x: q.includes('상동로') ? '126.75' : q.includes('가상로') ? '126.70' : q.includes('가까운') ? '126.7001' : '126.72', y: '37.5' }] });
    if (url.searchParams.get('end_x') === '126.7001') return Response.json({ status: 'NO_RESULTS' }); // 너무 가까워 대중교통 경로 없음
    return Response.json({ status: 'OK', routes: [{ properties: { totalTime: 1500, transfers: 1 }, steps: [
      { properties: { type: 'WALKING', time: 300 } }, { properties: { type: 'BUS', time: 900, vehicles: [{ name: '83' }] } }, { properties: { type: 'WALKING', time: 300 } }] }] });
  };
  try {
    h.env.KAKAO_REST_KEY = 'test-key';
    const body = (campusId, schools = ['상원고']) => ({ address: '경기도 부천시 원미구 가상로 1', campusId, schools });
    assert.equal((await h.request('POST', '/api/data-core/highschool/routes', users.teacher, body('campus-ansan'))).status, 400, '자기 캠퍼스가 아니면 못 찾는다');
    const r = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, body(A, ['상원고', '없는고', '가까운고']));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.schools.상원고.home, { min: 25, mode: 'transit', bus: '83', transfers: 1, walk: 10, auto: true });
    assert.deepEqual(r.body.schools.가까운고.home, { min: 1, mode: 'walk', alt: '', auto: true }, '너무 가까워 대중교통 경로가 없으면 걷는 시간으로');
    assert.equal(r.body.schools.상원고.academy, null, '상동 본원은 정리해 둔 학교→학원 시간을 쓴다');
    assert.ok(r.body.schools.없는고.academy, '목록에 없는 학교는 학교→학원도 찾는다');
    assert.ok(seen.some(([path, q]) => path === '/v2/local/search/address.json' && q === '경기도 부천시 원미구 상동로 109'), '학원 주소로 위치를 찾는다');
    assert.ok(seen.every(([, , auth]) => auth === 'KakaoAK test-key'));
    // 비교 학교 채우기: 희망 3곳 + 같은 지역(부천) 일반고 중 가까운 곳으로 모두 5곳. 여고·특성화고는 자동으로 넣지 않음
    assert.equal(r.body.extras.length, 2, JSON.stringify(r.body.extras));
    for (const name of r.body.extras) {
      const school = data.schools.find((s) => s.name === name);
      assert.ok(school && school.region === '부천' && !school.special && !school.girls, name);
      assert.ok(r.body.schools[name].home, `${name} 통학도 함께 찾는다`);
    }
    const five = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, body(A, ['상원고', '중원고', '부명고', '상일고', '심원고']));
    assert.deepEqual(five.body.extras, [], '희망이 5곳이면 채우지 않는다');
    // 4·5지망 '거리 최우선': 가까운 같은 지역 일반고를 골라 돌려주고, 비교 학교는 그만큼 덜 채운다
    const nearPick = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { ...body(A, ['상원고', '중원고', '부명고']), near: 2 });
    assert.equal(nearPick.body.near.length, 2, JSON.stringify(nearPick.body));
    assert.deepEqual(nearPick.body.extras, [], '희망 3 + 거리 최우선 2 = 5곳');
    assert.ok(nearPick.body.near.every((n) => !data.schools.find((x) => x.name === n).girls && nearPick.body.schools[n].home));
    const girlsAllowed = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { ...body(A, ['상원고']), near: 0, female: true });
    const boys = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { ...body(A, ['상원고']), near: 0 });
    assert.ok([...girlsAllowed.body.extras].length === 4 && [...boys.body.extras].every((n) => !data.schools.find((x) => x.name === n).girls));
    const ansan = await h.request('POST', '/api/data-core/highschool/routes', users.master, body('campus-ansan'));
    assert.ok(ansan.body.schools.상원고.academy, '다른 캠퍼스는 학교→학원도 카카오로 찾는다');
  } finally { globalThis.fetch = realFetch; await h.mf.dispose(); }
});

test('화면: 이름·학교·주소·캠퍼스·지망·성적표 사진만, 결과는 PDF·이미지 저장', () => {
  const index = fs.readFileSync('public/data-core/index.html', 'utf8');
  const a = index.indexOf('<span>대학합격 로드맵</span>'), b = index.indexOf('<span>고교 진학 상담</span>'), c = index.indexOf('<span>꿈을 향한 커리큘럼</span>');
  assert.ok(a > 0 && a < b && b < c, '대학합격 로드맵 바로 아래');
  const page = fs.readFileSync('public/data-core/highschool.html', 'utf8');
  const js = fs.readFileSync('public/data-core/highschool.js', 'utf8');
  assert.match(page, /highschool\.js\?v=20261016-hs6/);
  assert.deepEqual([...page.matchAll(/<input name="(\w+)"/g)].map((m) => m[1]), ['name', 'middleSchool', 'address']);
  assert.match(page, /id="hsCampus" role="radiogroup"/);
  assert.match(page, /id="hsPhoto"/);
  for (const gone of ['region', 'consultDate', 'campusLabel', 'hsCommute', 'memo', 'hsSemAdd', 'bandManual', 'hsSchoolsDialog', 'fixedOrder', 'hsExtras'])
    assert.ok(!page.includes(gone) && !js.includes(`'${gone}'`), `${gone} 없음`);
  assert.match(js, /data-act="pdf">PDF 저장/);
  assert.match(js, /data-act="images">이미지 저장/);
  const css = fs.readFileSync('public/data-core/highschool.css', 'utf8');
  assert.match(css, /@media \(max-width:1100px\)\{[^}]*\.hs-page \.app-shell\{display:block\}\s*\.hs-page \.sidebar\{display:none!important\}/, '태블릿에서 왼쪽 메뉴가 화면을 덮지 않게');
});

test('성적표 사진 읽기: 찍힌 칸 그대로("82/77.0", "B(168)")로 점수·평균·성취도를 나누고, 옆으로 찍힌 사진은 돌릴 각도를 알려 준다', async () => {
  const h = await libraryHarness();
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url ?? input);
    if (!url.startsWith('https://api.openai.com/')) return realFetch(input, init);
    sent = JSON.parse(init.body);
    const reading = { kind: 'report', rotation: '90', studentName: '', school: '가상중학교', uncertain: [], rows: [
      // AI가 원점수·평균을 섞어 "82.7"로 옮겨도 찍힌 칸 "82/77.0"이 이긴다
      { academicYear: '', schoolYear: '1학년', semester: '2학기', subject: '국어', printedName: '국어', scoreCell: '82/77.0', achievementCell: 'B(168)', rawScore: '82.7', average: '', achievement: '' },
      { academicYear: '', schoolYear: '1학년', semester: '2학기', subject: '수학', printedName: '수학', scoreCell: '45/64.4', achievementCell: 'E(168)', rawScore: '45', average: '64.4', achievement: 'E' },
      { academicYear: '2026', schoolYear: '3학년', semester: '1학기', subject: '영어', printedName: '영어', scoreCell: '89', achievementCell: '', rawScore: '89', average: '76.7', achievement: 'B' },
      { academicYear: '', schoolYear: '1학년', semester: '1학기', subject: '국어', printedName: '국어', scoreCell: '해당없음', achievementCell: 'P', rawScore: '', average: '', achievement: '' },
    ] };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reading) }] }] });
  };
  try {
    h.env.OPENAI_API_KEY = 'synthetic-test-only';
    const form = new FormData();
    form.set('image', new Blob([encode({ width: 40, height: 60, channels: 4, depth: 8, data: new Uint8Array(40 * 60 * 4).fill(200) })], { type: 'image/png' }), 'grade.png');
    form.set('gradeHint', '지금 중학교 3학년, 2026학년도');
    const r = await h.request('POST', '/api/data-core/highschool/grade-photo', users.teacher, form);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rotation, 90);
    assert.deepEqual(r.body.rows.map((x) => [x.grade, x.semester, x.subject, x.s, x.m, x.a]), [[1, 2, '국어', 82, 77, 'B'], [1, 2, '수학', 45, 64.4, 'E'], [3, 1, '영어', 89, 76.7, 'B']], '자유학기(P·해당없음)는 빠진다');
    assert.match(sent.instructions, /같은 행의 칸끼리만 짝지으세요/);
    assert.match(sent.instructions, /성적증명서·생활기록부 형식/);
    assert.ok(sent.text.format.schema.required.includes('rotation'));
  } finally { globalThis.fetch = realFetch; await h.mf.dispose(); }
});

test('4·5지망 자동으로 고르기: 내신평균 높은/낮은 학교는 같은 지역 일반고 중 고1·고2 국·영·수 평균으로, 여중이면 여고도 후보', () => {
  const M = model(data);
  const base = (n) => M.baseOf(n);
  const st = { address: '경기도 부천시 원미구 가상로 1', middleSchool: '가상중학교', wishes: ['상원고'] };
  const [high] = pickByAverage(data, st, 'high', ['상원고']), [low] = pickByAverage(data, st, 'low', ['상원고']);
  const pool = data.schools.filter((s) => s.region === '부천' && !s.special && !s.girls && s.name !== '상원고' && base(s.name) != null);
  assert.equal(base(high), Math.max(...pool.map((s) => base(s.name))));
  assert.equal(base(low), Math.min(...pool.map((s) => base(s.name))));
  assert.ok(!data.schools.find((s) => s.name === high).girls && !data.schools.find((s) => s.name === low).girls, '남녀를 모르면 여고 제외');
  const girl = pickByAverage(data, { ...st, middleSchool: '가상여중' }, 'high', [], 20);
  assert.ok(girl.some((n) => data.schools.find((s) => s.name === n).girls), '여중이면 여고도 후보');
  assert.deepEqual(pickByAverage(data, { address: '울산광역시 북구', wishes: [] }, 'high', []), [], '지역을 모르면 고르지 않음');
  const html = renderReport({ ...student(), wishes: ['상원고', '중원고', '부명고', high, ''], wishRules: ['', '', '', 'high', ''] }, data).html;
  assert.ok(html.includes(`→ ${high}(내신평균 높은 학교)`), '상담표에 고른 기준을 함께 적는다');
});

test('화면: 4·5지망에 자동으로 고르기, 성적표 칸에 끌어다 놓기', () => {
  const page = fs.readFileSync('public/data-core/highschool.html', 'utf8'), js = fs.readFileSync('public/data-core/highschool.js', 'utf8');
  assert.match(page, /id="hsPhotoBox"/);
  assert.ok(js.includes("photoBox.addEventListener('drop'"));
  assert.ok(js.includes("slot >= 3 ? `<optgroup label=\"자동으로 고르기\">"));
});

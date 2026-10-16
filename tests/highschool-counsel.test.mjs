import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users } from './support/library-harness.mjs';
import { renderReport, analyze, compare, gradeBook, bandOf, regionFromAddress, segment } from '../public/data-core/highschool-report.js';

// 고교 진학 상담 (2026-10-16). 가상 학생만 씁니다.
const data = JSON.parse(fs.readFileSync(new URL('../worker/highschool-schools.json', import.meta.url), 'utf8'));
const g = (s, m, a) => ({ s, m, a });
const seg = (min, bus = '83') => ({ min, mode: 'transit', bus, transfers: 0, walk: 5 });
const student = (over = {}) => ({
  name: '가상학생', middleSchool: '가상중학교', grade: 3, address: '경기도 부천시 원미구 가상로 1', entryYear: 2027,
  wishes: ['상원고', '중원고', '부명고', '상일고', '부천정산고'],
  commute: { checkedAt: '2026.10.16', back: seg(25), schools: { 상원고: { home: seg(18) }, 중원고: { home: { min: 12, mode: 'walk', alt: 15 } }, 부명고: { home: seg(22) }, 상일고: { home: seg(30) }, 부천정산고: { home: seg(35) } } },
  grades: { '2-2': { 국어: g(82, 70.1, 'B'), 영어: g(64, 68.2, 'D'), 수학: g(55, 60.3, 'E'), 사회: g(88, 72.4, 'B') }, '3-1': { 국어: g(90, 72.3, 'A'), 영어: g(70, 67.9, 'C'), 수학: g(58, 59.4, 'E'), 역사: g(84, 70.1, 'B') } },
  ...over,
});
const pages = (html) => (html.match(/<section class="/g) || []).length;

test('상담 자료: 표지·안내 3쪽·상담표·학교 비교·지역 평균·성적 변화·통학 차이 9쪽', () => {
  const out = renderReport(student(), data);
  assert.equal(pages(out.html), 9);
  for (const text of ['2027학년도 고등학교 진학', '가상중학교 3학년', '2028 대입 수능 변화', '2028 대입 내신 변화', '9등급제에서 5등급제로의 변환', '고교 진학 상담표', '상동 본원 · 입시기초반',
    '부천 고등학교 고1·고2 국어·영어·수학 평균표', '전체 평균은 <b>69.3점', '중학교 성적 변화 정리', '통학 시간에 따른 공부·그림 시간 차이', '최종 추천 순위', '재원생 학교 평가'])
    assert.ok(out.html.includes(text), text);
  assert.equal(out.analysis.band, '상위권', '국어·영어·사탐 점수−평균 평균 +9.5');
  assert.equal(out.analysis.rows[0].s, '중원고', '하루 이동이 가장 짧은 학교가 통학 1위');
  const list = out.recommendation.list.map((x) => x.s);
  assert.equal(list.at(-1), '부천정산고', '특성화고는 맨 아래');
  assert.equal(pages(renderReport(student(), data, { withGuide: false }).html), 6);
});

test('상담 자료: 통학 미확인 학교는 뒤로, 다른 지역 희망은 빼고, 이름은 그대로 글자로', () => {
  const s = student({ name: '<b>가상</b>', wishes: ['상원고', '삼산고', '범박고'], commute: { back: seg(20), schools: { 상원고: { home: seg(18) } } } });
  const A = analyze(s, data);
  assert.deepEqual(A.out, ['삼산고'], '인천 학교는 부천 주소 학생 자료에서 빠진다');
  assert.deepEqual(A.rows.map((x) => [x.s, x.rank]), [['상원고', 1], ['범박고', null]]);
  const html = renderReport(s, data).html;
  assert.ok(html.includes('&lt;b&gt;가상&lt;/b&gt;') && !html.includes('<b>가상</b>'));
  assert.ok(html.includes('범박고는 통학 시간을 아직 넣지 않아 순위에서 뒤에 두었습니다'));
  assert.ok(html.includes('희망 학교 중 삼산고는 다른 지역이라 뺐습니다'));
});

test('성적대·지역: 최근 두 학기 국어·영어·사탐, 성취도만 있으면 점수 성적대 없음, 주소로 지역', () => {
  assert.deepEqual(bandOf(gradeBook(student())), { gap: 9.5, band: '상위권', trend: '비교 불가', d: null, sems: ['2-2', '3-1'] });
  const letters = student({ grades: { '3-1': { 국어: { a: 'B' }, 영어: { a: 'D' } } }, bandManual: '하위권' });
  assert.equal(gradeBook(letters).letterOnly, true);
  assert.equal(bandOf(gradeBook(letters)), null);
  assert.equal(analyze(letters, data).band, '하위권', '상담 때 확인한 수준을 쓴다');
  assert.equal(regionFromAddress('인천광역시 부평구 가상로 2'), '인천');
  assert.equal(segment({ min: 18, mode: 'transit', bus: '7호선,16', transfers: 1, walk: 4 }).head, '7호선 등 / 18분', '지하철에는 버스를 붙이지 않는다');
  assert.equal(segment({ min: 17, mode: 'transit', bus: '5' }).head, '버스 5 / 17분');
  const withAcademies = { ...data, academies: [{ campusId: 'campus-anihi-admission', name: '부천 애니 입시본원', address: '경기도 부천시 원미구 상동로 109' }, { campusId: 'campus-ansan', name: '안산 입시본원', address: '경기도 안산시 단원구 고잔로 88' }] };
  assert.equal(analyze(student({ campusId: 'campus-anihi-admission' }), withAcademies).rows.every((x) => x.total != null), true, '상동 본원은 정리해 둔 학교→학원 시간을 쓴다');
  const ansan = analyze(student({ campusId: 'campus-ansan' }), withAcademies);
  assert.equal(ansan.sangdong, false);
  assert.ok(ansan.rows.every((x) => x.total == null), '다른 캠퍼스는 학교→학원 시간을 따로 넣어야 한다');
  assert.ok(renderReport(student({ campusId: 'campus-ansan' }), withAcademies).html.includes('안산 입시본원 · 입시기초반'));
  const fixed = student({ fixedOrder: true });
  const C = compare(analyze(fixed, data), fixed);
  assert.deepEqual(C.genList.map((x) => x.s), ['상원고', '중원고', '부명고', '상일고'], '상담에서 확정한 희망 순서');
});

test('API: 모든 캠퍼스 선생님이 보고 고치고, 삭제는 만든 사람·원장·마스터만', async () => {
  const h = await libraryHarness();
  try {
    const created = await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student() });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.student.id;
    assert.equal(created.body.student.wishes.length, 5);
    const listed = await h.request('GET', '/api/data-core/highschool', users.foreign);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.students.length, 1, '다른 캠퍼스 선생님도 본다');
    assert.ok(listed.body.schools.schools.some((s) => s.name === '상원고' && s.review));
    assert.equal(listed.body.kakao, false);
    const edited = await h.request('PATCH', `/api/data-core/highschool/students/${id}`, users.foreign, { student: { ...listed.body.students[0], memo: '다른 캠퍼스에서 고침' } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await h.request('PATCH', `/api/data-core/highschool/students/${id}`, users.teacher, { student: { ...created.body.student } })).status, 409, '먼저 고친 사람이 있으면 다시 불러오기');
    assert.equal((await h.request('GET', '/api/data-core/highschool', users.outsider)).status, 403);
    assert.equal((await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: student() }, 'https://evil.example')).status, 403);
    assert.equal((await h.request('POST', '/api/data-core/highschool/students', users.teacher, { student: { name: ' ' } })).status, 400);
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${id}`, users.foreign)).status, 403, '만든 사람이 아닌 선생님은 못 지움');
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${id}`, users.director)).status, 200, '원장은 지움');
    assert.equal((await h.request('GET', '/api/data-core/highschool', users.teacher)).body.students.length, 0);
    const own = await h.request('POST', '/api/data-core/highschool/students', users.staff, { student: student() });
    assert.equal((await h.request('DELETE', `/api/data-core/highschool/students/${own.body.student.id}`, users.staff)).status, 200, '만든 선생님은 지움');

    assert.equal((await h.request('PATCH', '/api/data-core/highschool/schools', users.teacher, { name: '상원고', review: '고침' })).status, 403);
    const school = await h.request('PATCH', '/api/data-core/highschool/schools', users.director, { name: '상원고', review: '원장이 고친 평가', academy: { min: 9, mode: 'walk' } });
    assert.equal(school.status, 200, JSON.stringify(school.body));
    const after = (await h.request('GET', '/api/data-core/highschool', users.teacher)).body.schools.schools.find((s) => s.name === '상원고');
    assert.equal(after.review, '원장이 고친 평가');
    assert.deepEqual(after.academy, { transit: null, walkMin: 9 });
    assert.equal((await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { address: '부천', schools: ['상원고'] })).status, 503, '카카오 키가 없으면 직접 입력');
    const acad = listed.body.schools.academies;
    assert.equal(acad.length, 10);
    assert.equal(acad.find((a) => a.campusId === 'campus-anihi-admission').address, '경기도 부천시 원미구 상동로 109, 상동프라자 5층 506호·507호');
    assert.ok(acad.every((a) => a.address && !/\.co\.kr|naver/.test(a.address)), '홈페이지 주소 없이 주소만');
    assert.equal(listed.body.myCampusId, 'campus-gwangjin');
    assert.equal((await h.request('PATCH', '/api/data-core/highschool/academies', users.teacher, { campusId: 'campus-paju', address: '고침' })).status, 403);
    const moved = await h.request('PATCH', '/api/data-core/highschool/academies', users.director, { campusId: 'campus-paju', address: '경기도 파주시 가상로 9' });
    assert.equal(moved.body.academies.find((a) => a.campusId === 'campus-paju').address, '경기도 파주시 가상로 9');
  } finally { await h.mf.dispose(); }
});

test('API: 카카오맵 대중교통 길찾기로 집→학교·학원→집 채우기 (가짜 응답)', async () => {
  const h = await libraryHarness();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (url.hostname !== 'dapi.kakao.com') return realFetch(input, init);
    seen.push([url.pathname, init?.headers?.authorization]);
    if (url.pathname.startsWith('/v2/local/search/')) return Response.json({ documents: [{ x: '126.7', y: '37.5' }] });
    return Response.json({ status: 'OK', routes: [{ properties: { totalTime: 1500, transfers: 1 }, steps: [
      { properties: { type: 'WALKING', time: 300 } }, { properties: { type: 'BUS', time: 900, vehicles: [{ name: '83' }] } }, { properties: { type: 'WALKING', time: 300 } }] }] });
  };
  try {
    h.env.KAKAO_REST_KEY = 'test-key';
    assert.equal((await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { address: '경기도 부천시 원미구 가상로 1', schools: ['상원고'] })).status, 400, '캠퍼스를 골라야 학원 기준이 생긴다');
    const other = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { address: '경기도 부천시 원미구 가상로 1', campusId: 'campus-ansan', schools: ['상원고'] });
    assert.ok(other.body.schools.상원고.academy, '상동 본원이 아닌 캠퍼스는 학교→학원도 카카오로 찾는다');
    const r = await h.request('POST', '/api/data-core/highschool/routes', users.teacher, { address: '경기도 부천시 원미구 가상로 1', campusId: 'campus-anihi-admission', schools: ['상원고', '없는고'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.schools.상원고.home, { min: 25, mode: 'transit', bus: '83', transfers: 1, walk: 10, auto: true });
    assert.equal(r.body.schools.상원고.academy, null, '학교→학원은 정리된 기본값을 쓴다');
    assert.ok(r.body.schools.없는고.academy, '목록에 없는 학교는 학교→학원도 찾는다');
    assert.deepEqual(r.body.back, r.body.schools.상원고.home);
    assert.match(r.body.checkedAt, /^\d{4}\.\d{2}\.\d{2}$/);
    assert.ok(seen.every(([, auth]) => auth === 'KakaoAK test-key'));
    assert.ok(seen.some(([path]) => path === '/v2/routing/publictraffic'));
  } finally { globalThis.fetch = realFetch; await h.mf.dispose(); }
});

test('메뉴와 화면: 대학합격 로드맵 바로 아래 고교 진학 상담', () => {
  const index = fs.readFileSync('public/data-core/index.html', 'utf8');
  const a = index.indexOf('<span>대학합격 로드맵</span>'), b = index.indexOf('<span>고교 진학 상담</span>'), c = index.indexOf('<span>꿈을 향한 커리큘럼</span>');
  assert.ok(a > 0 && a < b && b < c);
  assert.match(index, /href="\/data-core\/highschool"/);
  const page = fs.readFileSync('public/data-core/highschool.html', 'utf8');
  assert.match(page, /highschool\.js\?v=20261016-hs3/);
  const css = fs.readFileSync('public/data-core/highschool.css', 'utf8');
  assert.match(css, /@media \(max-width:1100px\)\{[^}]*\.hs-page \.app-shell\{display:block\}\s*\.hs-page \.sidebar\{display:none!important\}/, '태블릿에서 왼쪽 메뉴가 화면을 덮지 않게');
  assert.match(page, /aria-current="page"><span class="nav-icon">▣<\/span><span>고교 진학 상담/);
});

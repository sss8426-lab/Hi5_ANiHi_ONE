// 고교 진학 상담 자료 (A4 9쪽): 표지 · 2028 수능 변화 · 2028 내신 변화 · 5등급제 변환 · 고교 진학 상담표 ·
// 후보 학교 비교표 · 지역 평균표 · 중학교 성적 변화 정리 · 통학 시간 차이.
// 2026-10 입시기초반 상담 때 만든 자료(gen7·page2·report_all·time_page)와 같은 기준·문구를 쓴다. 화면과 테스트가 함께 쓰는
// 순수 함수라 DOM에 손대지 않고 HTML 문자열만 만든다.
export const LOGO = '/data-core/assets/anihi-academy-logo.png';
export const SEMS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2'];
export const SL = { '1-1': '1학년 1학기', '1-2': '1학년 2학기', '2-1': '2학년 1학기', '2-2': '2학년 2학기', '3-1': '3학년 1학기', '3-2': '3학년 2학기' };
const SEM_SHORT = { '1-1': '중1 1학기', '1-2': '중1 2학기', '2-1': '중2 1학기', '2-2': '중2 2학기', '3-1': '중3 1학기', '3-2': '중3 2학기' };
export const SUBJECTS = ['국어', '수학', '영어', '사회', '역사', '과학'];
export const ACHIEVEMENTS = ['A', 'B', 'C', 'D', 'E'];
export const BANDS = ['상위권', '중위권', '하위권'];
const GROUPS = ['국어', '영어', '수학', '사회', '과학'];
const LONG = 40, DAYS = 190, Y3 = DAYS * 3;
const LVT = { 상: '높은 편', 중: '보통', 하: '낮은 편' };
const COUNT = { 2: '두', 3: '세', 4: '네', 5: '다섯' };

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const r1 = (a) => (a.length ? Math.round((a.reduce((p, q) => p + q, 0) / a.length) * 10) / 10 : null);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const signed = (d) => `${d > 0 ? '+' : ''}${d}`;
const fmt = (v) => v.toLocaleString('ko-KR');
const hrs = (m) => Math.round(m / 60);

export function regionFromAddress(address) {
  const a = String(address || '');
  if (/인천/.test(a)) return '인천';
  if (/부천/.test(a)) return '부천';
  if (/서울/.test(a)) return '서울';
  return '';
}

// 통학 한 구간: {min, mode:'transit'|'walk', bus, transfers, walk, alt} → 표에 쓰는 굵은 글씨(head)와 작은 글씨(sub)
export function segment(v) {
  const min = num(v && v.min);
  if (min == null) return null;
  if (v.mode === 'walk') return { min, head: `도보 ${min}분`, sub: num(v.alt) != null ? `버스로는 ${num(v.alt)}분` : '' };
  const bus = String(v.bus || '').split(',').map((s) => s.trim()).filter(Boolean);
  // 지하철(카카오 자동 조회의 '7호선' 등)은 '버스'를 붙이지 않는다
  const first = bus[0] && (/(호선|선|철)$/.test(bus[0]) ? bus[0] : `버스 ${bus[0]}`);
  const head = bus.length ? `${first}${bus.length > 1 ? ' 등' : ''} / ${min}분` : `대중교통 ${min}분`;
  const parts = [];
  if (num(v.transfers) != null) parts.push(`환승 ${num(v.transfers)}회`);
  if (num(v.walk)) parts.push(`도보 ${num(v.walk)}분 포함`);
  return { min, head, sub: parts.join(' · ') };
}

// 학교 → 학원(상동 본원) 기본값: 대중교통이 걷기보다 빠르면 대중교통, 아니면 도보(gen7과 같은 규칙)
export function academyDefault(school) {
  const a = school && school.academy;
  if (!a) return null;
  const t = a.transit, w = a.walkMin;
  if (t && (w == null || t.min <= w)) return { min: t.min, mode: 'transit', bus: (t.buses || []).join(','), transfers: t.transfers, walk: t.walk };
  if (w != null) return { min: w, mode: 'walk', alt: t ? t.min : '' };
  return null;
}

// 고른 캠퍼스 학원 주소. 정리해 둔 학교→학원 시간은 상동 본원(상동로 109) 기준이라 그 캠퍼스일 때만 기본값으로 쓴다.
export function academyOf(student, data) {
  return (data.academies || []).find((a) => a.campusId === student.campusId) || null;
}
export function usesSangdongTimes(student, data) {
  if (!student.campusId) return true; // 캠퍼스를 고르기 전에 만든 상담(상동 본원)
  return /상동로\s*109/.test(academyOf(student, data)?.address || '');
}

export function model(data) {
  const schools = new Map((data.schools || []).map((s) => [s.name, s]));
  const semesters = data.semesters || [];
  const dn = (s) => (schools.get(s) && schools.get(s).display) || s;
  const cell = (name, key, grade, grp) => {
    const c = schools.get(name)?.sem?.[key]?.[grade]?.[grp];
    return c ? { m: c[0], a: c[1], n: c[2] } : null;
  };
  const hasData = (name) => Boolean(semesters.length && schools.get(name)?.sem?.[semesters[0].key]);
  const gradeOf = (name, gr) => {
    const c = ['국어', '영어', '수학'].map((k) => r1(semesters.map((s) => cell(name, s.key, gr, k)).filter(Boolean).map((q) => q.m)));
    return { c, m: c.every((q) => q != null) ? r1(c) : null };
  };
  const baseOf = (name) => r1([gradeOf(name, 1).m, gradeOf(name, 2).m].filter((q) => q != null));
  const special = (name) => Boolean(schools.get(name)?.special);
  const regionOf = (name) => schools.get(name)?.region || '';
  const regAvg = {};
  for (const r of new Set((data.schools || []).map((s) => s.region))) {
    const v = (data.schools || []).filter((s) => s.region === r && !s.special).map((s) => baseOf(s.name)).filter((q) => q != null);
    if (v.length) regAvg[r] = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  }
  const lvOf = (base, r) => (base >= regAvg[r] + 2 ? '상' : base <= regAvg[r] - 2 ? '하' : '중');
  return { data, schools, semesters, dn, cell, hasData, gradeOf, baseOf, special, regionOf, regAvg, lvOf };
}

// ── 학생 성적 ──
export function gradeBook(student) {
  const by = {};
  for (const sem of SEMS) {
    const o = student.grades?.[sem];
    if (!o) continue;
    for (const [sub, v] of Object.entries(o)) {
      const s = num(v && v.s), m = num(v && v.m), a = ACHIEVEMENTS.includes(v && v.a) ? v.a : '';
      if (s == null && !a) continue;
      (by[sem] ??= {})[sub] = { s, m, a };
    }
  }
  const sems = SEMS.filter((s) => by[s]);
  const letterOnly = sems.length > 0 && sems.every((q) => Object.values(by[q]).every((x) => x.s == null));
  return { by, sems, letterOnly };
}
function priGap(by, sem) {
  const o = by[sem]; if (!o) return null;
  const g = (k) => (o[k] && o[k].s != null && o[k].m != null ? o[k].s - o[k].m : null);
  return { 국어: g('국어'), 영어: g('영어'), 사탐: r1(['사회', '역사'].map(g).filter((v) => v != null)) };
}
// 성적대: 최근 두 학기 국어·영어·사탐의 '점수 - 학교 평균' 평균. +3 이상 상위권, -10 이상 중위권, 그 아래 하위권
export function bandOf(book) {
  const sems = book.sems;
  const recent = sems.slice(-2), early = sems.slice(-4, -2);
  const vals = (list) => list.map((s) => priGap(book.by, s)).filter(Boolean).flatMap((p) => Object.values(p)).filter((x) => x != null);
  const v = vals(recent);
  if (!v.length) return null;
  const gap = r1(v), e = vals(early);
  const d = e.length ? Math.round((gap - r1(e)) * 10) / 10 : null;
  return { gap, band: gap >= 3 ? '상위권' : gap >= -10 ? '중위권' : '하위권', trend: d == null ? '비교 불가' : d >= 5 ? '상승' : d <= -5 ? '하락' : '유지', d, sems: recent };
}
const semList = (list) => list.map((s) => SEM_SHORT[s]).join('·');

// ── 상담 계산: 후보 학교, 통학 순위, 학교 비교, 최종 추천 ──
export function analyze(student, data) {
  const M = model(data);
  const wishes = (student.wishes || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 5);
  const extras = (student.extras || []).map((s) => String(s || '').trim()).filter((s) => s && !wishes.includes(s));
  const region = student.region || regionFromAddress(student.address) || (wishes[0] ? M.regionOf(wishes[0]) : '');
  const inRegion = (s) => M.special(s) || !region || !M.regionOf(s) || M.regionOf(s) === region;
  const out = wishes.filter((s) => !inRegion(s));
  const back = segment(student.commute?.back);
  const sangdong = usesSangdongTimes(student, data);
  const names = [...new Set([...wishes, ...extras])].filter(inRegion).slice(0, 8);
  let rows = names.map((s) => {
    const c = student.commute?.schools?.[s] || {};
    const a = segment(c.home);
    const b = segment(c.academy) || (sangdong ? segment(academyDefault(M.schools.get(s))) : null);
    const total = a && b && back ? a.min + b.min + back.min : null;
    return { s, a, b, wish: wishes.indexOf(s) + 1, total };
  });
  const known = (x) => x.total != null;
  rows.sort((x, y) => (known(x) && known(y) ? x.total - y.total : known(x) ? -1 : known(y) ? 1 : (x.wish || 9) - (y.wish || 9)));
  let k = 0;
  for (const x of rows) x.rank = known(x) ? ++k : null;
  const book = gradeBook(student);
  const latest = book.sems[book.sems.length - 1];
  const cur = latest ? book.by[latest] : null;
  const ks = cur ? ['국어', '수학', '영어', '사회', '과학'].filter((q) => cur[q] && cur[q].s != null && cur[q].m != null) : [];
  const p = ks.length ? { gap: ks.reduce((a, q) => a + (cur[q].s - cur[q].m), 0) / ks.length } : null;
  const bd = bandOf(book);
  const bandManual = BANDS.includes(student.bandManual) ? student.bandManual : '';
  const band = bandManual || (bd && bd.band) || (!p ? null : p.gap >= 3 ? '상위권' : p.gap >= -10 ? '중위권' : '하위권');
  return { M, wishes, extras, region, out, back, rows, book, latest, cur, p, bd, band, bandManual, sangdong };
}

// 2쪽 학교 비교의 계산(page2.js와 같은 규칙). 순서가 필요한 다른 쪽에서도 쓴다.
export function compare(A, student) {
  const { M, rows, band } = A;
  const fixed = Boolean(student.fixedOrder);
  const big = (x) => (x.total == null ? Infinity : x.total);
  const gen = rows.filter((x) => !M.special(x.s));
  const withData = gen.filter((x) => M.hasData(x.s)).sort((x, y) => (x.wish || 9) - (y.wish || 9) || (x.rank || 99) - (y.rank || 99)).slice(0, 5).sort((x, y) => big(x) - big(y));
  for (const x of withData) { x.g1 = M.gradeOf(x.s, 1); x.g2 = M.gradeOf(x.s, 2); x.base = M.baseOf(x.s); }
  const ranked = withData.filter((x) => x.base != null && M.regAvg[M.regionOf(x.s)] != null).sort((a, b) => b.base - a.base);
  for (const x of ranked) { x.reg = M.regionOf(x.s); x.avg = M.regAvg[x.reg]; x.diff = Math.round((x.base - x.avg) * 10) / 10; x.lv = M.lvOf(x.base, x.reg); }
  const grp = ['상', '중', '하'].map((l) => ranked.filter((x) => x.lv === l)).filter((g) => g.length);
  const allLv = grp.length === 1 ? LVT[grp[0][0].lv] : '';
  const lvOrder = { 상위권: ['비슷', '상', '중', '하'], 중위권: ['비슷', '중', '하', '상'], 하위권: ['비슷', '하', '중', '상'] };
  const key = (b, x) => (b === '중위권' && !ranked.some((y) => y.lv === '중') ? 0 : lvOrder[b].indexOf(x.lv));
  const cRank = new Map(ranked.slice().sort((x, y) => big(x) - big(y)).map((x, i) => [x.s, i + 1]));
  const bKeys = band ? [...new Set(ranked.map((x) => key(band, x)))].sort((a, b) => a - b) : [];
  const bRank = new Map(band ? ranked.map((x) => [x.s, bKeys.indexOf(key(band, x)) + 1]) : []);
  const tie = (x) => band && ranked.filter((y) => bRank.get(y.s) === bRank.get(x.s)).length > 1;
  const fin = ranked.slice().sort((x, y) => ((bRank.get(x.s) || 0) + cRank.get(x.s)) - ((bRank.get(y.s) || 0) + cRank.get(y.s)) || (x.wish || 9) - (y.wish || 9));
  const spRows = rows.filter((x) => M.special(x.s));
  const spW = spRows.filter((x) => x.wish);
  const genList = fixed ? rows.filter((x) => x.wish && !M.special(x.s)).sort((a, b) => a.wish - b.wish) : ranked.length >= 2 ? fin : ranked;
  const knownGen = genList.filter((x) => x.total != null);
  const best = knownGen.length ? Math.min(...knownGen.map((x) => x.total)) : 0;
  for (const x of spW) { x.more = x.total != null && knownGen.length ? x.total - best : 0; x.long = knownGen.length > 0 && x.total != null && x.more >= LONG; }
  const extraGen = spW.some((x) => x.long) ? rows.filter((x) => !M.special(x.s) && !genList.includes(x)).sort((a, b) => big(a) - big(b)) : [];
  const tail = [...spW.filter((x) => !x.long), ...extraGen, ...spW.filter((x) => x.long).sort((a, b) => big(a) - big(b))];
  const spOther = spRows.filter((x) => !x.wish);
  return { fixed, gen, withData, ranked, grp, allLv, key, cRank, bRank, tie, fin, spRows, spW, spOther, genList, tail, best };
}

// 최종 추천 결과(8쪽·9쪽이 쓰는 목록)
export function recommendation(A, C) {
  const { M, rows } = A;
  const info = (x) => { const r = C.ranked.find((q) => q.s === x.s); return { s: M.dn(x.s), total: x.total, wish: x.wish || 0, special: M.special(x.s), lv: r ? LVT[r.lv] : null, diff: r ? r.diff : null, reg: r ? r.reg : null, long: Boolean(x.long), more: x.more || 0, a: x.a ? x.a.min : null, b: x.b ? x.b.min : null }; };
  return {
    band: A.band, fixed: C.fixed, allSame: C.grp.length === 1,
    list: [...C.genList, ...C.tail].map(info),
    sp: C.spOther.map((x) => ({ s: M.dn(x.s), wish: 0, total: x.total })),
    wishes: rows.filter((x) => x.wish).sort((a, b) => a.wish - b.wish).map(info),
  };
}

// ── 쪽별 HTML ──
const FOOT = '<div class="ft"><b class="fl">ANiHi</b><span>부천입시본원 · WEBTOON &amp; ANIMATION</span></div>';
const logoImg = (cls = 'logo') => `<img class="${cls}" src="${LOGO}" alt="ANiHi 만화학원">`;
const minText = (v) => (v == null ? '통학 미확인' : `하루 이동 ${v}분`);

export function coverPage(student) {
  const school = `${student.middleSchool || ''}${student.middleSchool ? ' ' : ''}${student.grade || 3}학년`;
  const year = num(student.entryYear) || new Date().getFullYear() + 1;
  return `<section class="ip cv"><div class="top">${logoImg('logo2')}
<div class="tt"><p>${year}학년도 고등학교 진학</p><h1>고교 진학 상담 자료</h1></div>
<div class="who"><div><b>이름</b>${esc(student.name)}</div><div><b>학교</b>${esc(school)}</div></div>
<div class="toc"><h3>목차</h3>1. 2028 대입 수능 변화<br>2. 2028 대입 내신 변화<br>3. 2028 고교 내신 등급제 개편<br>4. 고교 진학 상담표<br>5. 후보 학교 비교표</div></div>
${FOOT}</section>`;
}

export const INFO_PAGES = `<section class="ip"><div class="in"><h1>2028 대학입시제도 개편</h1><h2>2028 대입 수능 변화</h2>
<ul class="bl"><li>국어, 수학, 사회·과학탐구, 직업탐구 영역은 <span class="r">선택과목제 폐지</span></li><li><span class="r">심화수학(미적분Ⅱ, 기하)</span>은 수능에 미포함</li><li>공통과목 중심의 ‘<span class="r">통합형</span>’ 체제 도입</li><li class="ns">&nbsp;&nbsp;* <span class="r">통합형 수능</span> : 모든 학생이 국어, 수학, 사회·과학탐구에서 같은 내용과 기준으로 시험을 보는 체제</li></ul>
<table class="t1"><tr><th colspan="2">영역</th><th class="cur">현행<br>(~2027학년도 수능)</th><th class="new">개편안<br>(2028학년도 수능~)</th></tr>
<tr><td class="k" colspan="2">국어</td><td><b>공통 + <span class="r">2과목 중 택1</span></b>· 공통 : 독서, 문학<br>· 선택 : 화법과 작문, 언어와 매체</td><td class="m"><b class="r">공통</b>화법과 언어, 독서와 작문, 문학</td></tr>
<tr><td class="k" colspan="2">수학</td><td><b>공통 + <span class="r">3과목 중 택1</span></b>· 공통 : 수학Ⅰ, 수학Ⅱ<br>· 선택 : 확률과 통계, 미적분, 기하</td><td class="m"><b class="r">공통</b>대수, 미적분Ⅰ, 확률과 통계</td></tr>
<tr><td class="k" colspan="2">영어 <small class="abs">(절대평가)</small></td><td><b class="r">공통</b>영어Ⅰ, 영어Ⅱ</td><td class="m"><b class="r">공통</b>영어Ⅰ, 영어Ⅱ</td></tr>
<tr><td class="k" colspan="2">한국사 <small class="abs">(절대평가)</small></td><td><b class="r">공통</b>한국사</td><td class="m"><b class="r">공통</b>한국사</td></tr>
<tr><td class="k kt" rowspan="2">탐구</td><td class="k2">사회<br>과학</td><td><b><span class="r">17과목</span> 중 최대 택2</b>· 사회 : 9과목(한국지리, 세계지리, 세계사, 동아시아사, 경제, 정치와 법, 사회·문화, 생활과 윤리, 윤리와 사상)<br>· 과학 : 8과목(물리학Ⅰ, 화학Ⅰ, 생명과학Ⅰ, 지구과학Ⅰ, 물리학Ⅱ, 화학Ⅱ, 생명과학Ⅱ, 지구과학Ⅱ)</td><td class="m"><b>사회 : <span class="r">공통</span></b>통합사회<br><b class="gap">과학 : <span class="r">공통</span></b>통합과학</td></tr>
<tr class="dash"><td class="k2">직업</td><td><b>1과목 : <span class="r">5과목</span> 중 택1<br>2과목 : 공통 + [1과목]</b>· 공통 : 성공적인 직업생활<br>· 선택 : 농업기초기술, 공업일반, 상업경제, 수산·해운산업기초, 인간발달</td><td class="m"><b>직업 : <span class="r">공통</span></b>성공적인 직업생활</td></tr>
<tr><td class="k" colspan="2">제2외국어<br>/한문 <small class="abs">(절대평가)</small></td><td><b><span class="r">9과목</span> 중 최대 택1</b>독일어Ⅰ, 프랑스어Ⅰ, 스페인어Ⅰ, 중국어Ⅰ, 일본어Ⅰ, 러시아어Ⅰ, 아랍어Ⅰ, 베트남어Ⅰ, 한문Ⅰ</td><td class="m"><b><span class="r">9과목</span> 중 최대 택1</b>독일어, 프랑스어, 스페인어, 중국어, 일본어, 러시아어, 아랍어, 베트남어, 한문</td></tr></table>
<p class="note2">출처: 교육부 「미래 사회를 대비하는 2028 대학입시제도 개편 확정안」(2023.12.27)</p></div>${FOOT}</section>
<section class="ip"><div class="in"><h1>2028 대학입시제도 개편</h1><h2>2028 대입 내신 변화</h2>
<ul class="bl"><li>기존 내신 9등급제는 <span class="r">5등급제로 개편</span></li><li>(기존) 공통·일반선택 9등급 상대평가, 진로선택 3단계 절대평가 → <span class="r">절대평가(A~E)와 상대평가(1~5등급) 함께 기재</span></li><li>체육·예술·과학탐구실험·교양, 사회·과학 융합선택 과목은 석차등급 미기재</li><li>사고력·문제해결력을 평가할 수 있는 <span class="r">논·서술형 평가 확대</span></li><li><span class="r">사회·과학 융합선택 과목</span>은 절대평가만 실시</li></ul>
<table class="t2"><tr><th class="e" rowspan="2"></th><th colspan="2">절대평가</th><th>상대평가</th><th colspan="3">통계정보</th></tr>
<tr><th>원점수</th><th>성취도</th><th>석차등급</th><th>성취도별<br>분포비율</th><th>과목평균</th><th>수강자수</th></tr>
<tr><td class="k">보통교과</td><td><span class="o"></span></td><td>A·B·C<br>·D·E</td><td>5등급</td><td><span class="o"></span></td><td><span class="o"></span></td><td><span class="o"></span></td></tr>
<tr><td class="k">사회·과학<br>융합선택</td><td><span class="o ro"></span></td><td class="r">A·B·C<br>·D·E</td><td>-</td><td><span class="o ro"></span></td><td><span class="o ro"></span></td><td><span class="o ro"></span></td></tr>
<tr><td class="k">체육·예술<br>/과학탐구실험</td><td>-</td><td>A·B·C</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
<tr><td class="k">교양</td><td>-</td><td>P</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
<tr><td class="k">전문교과</td><td><span class="o"></span></td><td>A·B·C<br>·D·E</td><td>5등급</td><td><span class="o"></span></td><td><span class="o"></span></td><td><span class="o"></span></td></tr></table>
<p class="r lead">*1등급(10%) - 2등급(24%, 누적34%) - 3등급(32%, 누적66%) - 4등급(24%, 누적90%) - 5등급(10%, 누적100%)</p>
<p class="p14">- 과목 평가결과는 절대평가(A~E)와 상대평가(1~5등급)를 함께 기재</p><p class="p115">※ 체육·예술·교양 교과(군), 과학탐구실험 과목은 절대평가 성취도만 기재 (교양은 이수 여부 P)</p>
<p class="p14 mb6">- 국가교육위원회 의결 내용을 존중하여, 사회·과학 교과의 융합 선택과목은 상대평가 석차등급 미기재</p>
<p class="r lead2">● 논·서술형 평가 강화</p><p class="p14">- 지식암기 위주 평가(5지선다형)는 가급적 지양, 사고력·문제해결력을 평가할 수 있는 논·서술형 평가 확대</p>
<p class="note2">출처: 교육부 2028 대학입시제도 개편 확정안(2023.12.27) · 경기도교육청 2026학년도 고등학교 학업성적관리 시행지침</p></div>${FOOT}</section>
<section class="ip"><div class="in"><h1>2028 고교내신등급제 개편</h1><h2>9등급제에서 5등급제로의 변환</h2>
<div class="box5"><div>1등급<i>&#8595;&#xFE0E;</i><b>1등급</b></div><div>2~3등급<i>&#8595;&#xFE0E;</i><b>2등급</b></div><div>4~5등급<i>&#8595;&#xFE0E;</i><b>3등급</b></div><div>6~7등급<i>&#8595;&#xFE0E;</i><b>4등급</b></div><div>8~9등급<i>&#8595;&#xFE0E;</i><b>5등급</b></div></div>
<table class="t3"><tr><th class="old">기존 9등급제</th><th>상위 누적 비율</th><th class="new">2028 5등급제</th><th>비고</th></tr>
<tr><td>1등급</td><td>상위 4%</td><td class="n">1등급</td><td>최상위권</td></tr><tr><td>2등급</td><td>상위 11%</td><td class="n">2등급</td><td>상위권</td></tr><tr><td>3등급</td><td>상위 23%</td><td class="n">2등급</td><td>상위권</td></tr><tr><td>4등급</td><td>상위 40%</td><td class="n">3등급</td><td>중상위권</td></tr><tr><td>5등급</td><td>상위 60%</td><td class="n">3등급</td><td>중위권</td></tr><tr><td>6등급</td><td>상위 77%</td><td class="n">4등급</td><td>중하위권</td></tr><tr><td>7등급</td><td>상위 89%</td><td class="n">4등급</td><td>중하위권</td></tr><tr><td>8등급</td><td>상위 96%</td><td class="n">5등급</td><td>하위권</td></tr><tr><td>9등급</td><td>하위 4%</td><td class="n">5등급</td><td>하위권</td></tr></table>
<div class="t3pair"><table class="t3 w14"><tr><th class="new" colspan="3">2028학년도 고교 내신 5등급제 비율</th></tr><tr><th class="new">5등급제</th><th>석차 등급 비율</th><th>누적 비율</th></tr>
<tr><td class="n">1등급</td><td>상위 10%</td><td>10%</td></tr><tr><td class="n">2등급</td><td>다음 24%</td><td>34%</td></tr><tr><td class="n">3등급</td><td>다음 32%</td><td>66%</td></tr><tr><td class="n">4등급</td><td>다음 24%</td><td>90%</td></tr><tr><td class="n">5등급</td><td>하위 10%</td><td>100%</td></tr></table>
<table class="t3 w10"><tr><th class="new" colspan="2">내신 변환표</th></tr><tr><th class="old">기존 9등급제</th><th class="new">5등급제</th></tr>
<tr><td>1등급</td><td class="n">1등급</td></tr><tr><td>2~3등급</td><td class="n">2등급</td></tr><tr><td>4~5등급</td><td class="n">3등급</td></tr><tr><td>6~7등급</td><td class="n">4등급</td></tr><tr><td>8~9등급</td><td class="n">5등급</td></tr></table></div></div>${FOOT}</section>`;

const routeDate = (student, data) => student.commute?.checkedAt || data.routeDate || '';

// 4. 고교 진학 상담표
export function counselPage(student, A, data) {
  const { M, rows, back, out, book, latest, cur, wishes } = A;
  const academy = data.academyName || '상동 본원';
  const head = `${logoImg()}
<div class="tt"><h1>고교 진학 상담표</h1><span>${esc(academyOf(student, data)?.name || academy)}</span></div>
<div class="meta"><div><i>학생</i><b>${esc(student.name)}</b></div><div><i>학교</i>${esc(`${String(student.middleSchool || '').replace(/중학교$/, '중')} ${student.grade || 3}학년`.trim())}</div><div class="ad"><i>주소</i>${esc(student.address || '')}</div></div>
<p class="info">기존 희망순서: ${wishes.length ? wishes.map((s) => esc(M.dn(s))).join(' → ') : '미기재'}</p>`;
  if (!rows.length) return `<section class="page">${head}<p class="box">희망 학교가 아직 없어 통학·성적 비교를 하지 못했습니다. 희망 학교(1~5지망)를 넣으면 바로 작성합니다.</p></section>`;
  const cellHtml = (c) => (c ? `<b>${esc(c.head)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}` : '<span class="na">미확인</span>');
  const unknown = rows.filter((x) => x.total == null).map((x) => M.dn(x.s));
  const dense = rows.length > 5;
  const commute = `<table class="t route${dense ? ' dense' : ''}"><tr><th class="c1">학교</th><th>집 → 학교</th><th>학교 → 학원</th></tr>
${rows.map((x) => `<tr><td class="c1"><b>${esc(M.dn(x.s))}</b><small>${x.rank ? `통학 ${x.rank}위` : '통학 미확인'}${x.wish ? ` · 희망 ${x.wish}지망` : ''}</small></td><td>${cellHtml(x.a)}</td><td>${cellHtml(x.b)}</td></tr>`).join('')}</table>
<div class="box"><b>학원 → 집: ${back ? esc(back.head) : '미확인'}</b>${back && back.sub ? ` · ${esc(back.sub)}` : ''}</div>
<p class="note">통학 순위는 집→학교, 학교→학원, 학원→집을 모두 더한 시간 기준입니다. 카카오맵 조회(${esc(routeDate(student, data))}), 버스 기다리는 시간은 빠져 있을 수 있습니다.${unknown.length ? ` ${unknown.map(esc).join('·')}는 통학 시간을 아직 넣지 않아 순위에서 뒤에 두었습니다.` : ''}${out.length ? ` 희망 학교 중 ${out.map((s) => esc(M.dn(s))).join('·')}는 다른 지역이라 뺐습니다.` : ''}${student.commuteNote ? ` ${esc(student.commuteNote)}` : ''}</p>`;
  const year = num(student.entryYear);
  const latestLabel = latest ? `${year && latest[0] === '3' ? `${year - 1} ` : year && latest[0] === '2' ? `${year - 2} ` : ''}${SEM_SHORT[latest]}` : '';
  let gradeHtml;
  const seqLabel = `(${book.sems.map((s) => SEM_SHORT[s]).join(' → ')})`;
  if (cur && !book.letterOnly) {
    const trend = (k) => book.sems.map((q) => (book.by[q][k] && book.by[q][k].s != null ? `${book.by[q][k].s}${book.by[q][k].a ? `(${book.by[q][k].a})` : ''}` : '-')).join('→');
    gradeHtml = `<table class="t gr"><tr><th class="c1">구분</th>${SUBJECTS.map((s) => `<th>${s}</th>`).join('')}</tr>
<tr><td class="c1">점수 (성취도)</td>${SUBJECTS.map((s) => (cur[s] && cur[s].s != null ? `<td><b>${cur[s].s}${cur[s].a ? `(${cur[s].a})` : ''}</b></td>` : '<td class="na">-</td>')).join('')}</tr>
<tr><td class="c1">학교 평균</td>${SUBJECTS.map((s) => (cur[s] && cur[s].m != null ? `<td>${cur[s].m}</td>` : '<td class="na">-</td>')).join('')}</tr></table>
<div class="box ach"><b>괄호 안 A~E는 '성취도'입니다.</b> 시험과 수행평가를 합한 점수가 학교 기준에 얼마나 도달했는지 5단계로 나타냅니다. 보통 90점 이상 A(매우 잘함), 80점대 B(잘함), 70점대 C(보통), 60점대 D(노력 필요), 60점 미만 E(많은 노력 필요)입니다. 반 친구들과 비교한 순위(등급)가 아니며, 고등학교 1~5등급과도 다릅니다.</div>
${book.sems.length > 1 ? `<p class="note">수학 변화: ${trend('수학')} &nbsp;·&nbsp; 영어 변화: ${trend('영어')} ${seqLabel}</p>` : ''}`;
  } else if (cur) {
    const seqOf = (k) => book.sems.map((q) => (book.by[q][k] ? book.by[q][k].a : '-')).join('→');
    gradeHtml = `<table class="t gr"><tr><th class="c1">구분</th>${SUBJECTS.map((s) => `<th>${s}</th>`).join('')}</tr>
<tr><td class="c1">성취도</td>${SUBJECTS.map((s) => (cur[s] ? `<td><b>${cur[s].a}</b></td>` : '<td class="na">-</td>')).join('')}</tr></table>
<div class="box ach"><b>A~E는 '성취도'입니다.</b> 받은 성적 자료에 점수와 학교 평균이 없어 성취도만 적었습니다. 반 친구들과 비교한 순위(등급)가 아니며, 고등학교 1~5등급과도 다릅니다.</div>
${book.sems.length > 1 ? `<p class="note">국어 변화: ${seqOf('국어')} &nbsp;·&nbsp; 영어 변화: ${seqOf('영어')} &nbsp;·&nbsp; 수학 변화: ${seqOf('수학')} ${seqLabel}</p>` : ''}`;
  } else gradeHtml = `<p class="box">받은 성적표 자료가 없어 성적 비교를 하지 못했습니다.${A.bandManual ? ` 상담 때 확인한 성적 수준(${A.bandManual})을 2쪽 학교 비교에 적용했습니다.` : ''}</p>`;
  const reviewed = rows.filter((x) => M.schools.get(x.s)?.review);
  const favHtml = `<table class="t fav rv">${reviewed.map((x) => `<tr><td class="c1"><b>${esc(M.dn(x.s))}</b></td><td>${esc(M.schools.get(x.s).review)}</td></tr>`).join('')}</table>
<p class="note">입시기초반 재원생이 직접 다녀 보거나 들은 의견을 정리한 것입니다(개인 의견, 공식 자료 아님). 의견이 있는 학교만 적었습니다.</p>`;
  return `<section class="page${dense ? ' dense-page' : ''}">${head}
<h2>통학 시간 비교 <span>짧은 순서 · 대중교통·도보 중 빠른 경로</span></h2>${commute}
<h2>최신 학생 성적 <span>${esc(latestLabel)}</span></h2>${gradeHtml}
${reviewed.length ? `<h2>재원생 학교 평가</h2>${favHtml}` : ''}
<footer><span>출처: 학생 성적표·학생상담목록, 카카오맵(${esc(routeDate(student, data))}), 입시기초반 재원생 학교 조사</span><span>ANiHi 만화학원</span></footer>
</section>`;
}

const avgHead = '<tr><th rowspan="2">학교</th><th colspan="4">고1</th><th colspan="4">고2</th><th rowspan="2">고1·고2<br>평균</th><th rowspan="2">지역 평균<br>대비</th></tr><tr><th>국</th><th>영</th><th>수</th><th>평균</th><th>국</th><th>영</th><th>수</th><th>평균</th></tr>';
const avgCells = (g1, g2, base, last) => `${g1.c.map((c) => `<td>${c ?? '-'}</td>`).join('')}<td><b>${g1.m ?? '-'}</b></td>${g2.c.map((c) => `<td>${c ?? '-'}</td>`).join('')}<td><b>${g2.m ?? '-'}</b></td><td class="bs"><b>${base}</b></td><td>${last}</td>`;

// 5. 후보 학교 비교표
export function comparePage(student, A, C, data) {
  const { M, rows, band, bd } = A;
  const { ranked, grp, allLv, key, cRank, bRank, tie, fin, spW, spOther, genList, tail, gen, withData } = C;
  const tm = (x) => (x.total == null ? '통학 미확인' : `하루 이동 ${x.total}분`);
  const orderFor = (b) => {
    const big = (x) => (x.total == null ? Infinity : x.total);
    const a = ranked.slice().sort((x, y) => key(b, x) - key(b, y) || big(x) - big(y));
    const parts = []; for (const x of a) { const l = parts[parts.length - 1]; if (l && key(b, l[0]) === key(b, x)) l.push(x); else parts.push([x]); }
    if (parts.length === 1) return grp.length > 1 ? `평균이 보통인 학교가 없어 통학이 짧은 순: ${a.map((x) => esc(M.dn(x.s))).join(' · ')}` : `${COUNT[a.length] || a.length} 학교 모두 평균 '${allLv}'이라 통학이 짧은 순: ${a.map((x) => esc(M.dn(x.s))).join(' · ')}`;
    return parts.map((p, i) => `${i + 1}순위 ${p.map((x) => esc(M.dn(x.s))).join(' · ')}${p.length > 1 ? ' (같은 단계, 통학 짧은 순)' : ''}`).join(' &gt; ');
  };
  const why = {
    상위권: '평균이 높은 편인 학교부터 보고, 같은 단계면 통학이 짧은 학교를 앞에 둡니다.',
    중위권: '평균이 보통인 학교부터 보고, 같은 단계면 통학·그림 연습 시간을 우선합니다.',
    하위권: '평균이 낮은 편인 학교부터 봅니다. 참고 의견이며 기초 보완이 먼저입니다.',
  };
  const tailLi = tail.map((x) => (M.special(x.s) ? `<li><b>${esc(M.dn(x.s))}</b> — 특성화고 · 희망 ${x.wish}지망 · ${tm(x)}${x.long ? ` (일반고 최단보다 +${x.more}분, 통학 부담 큼)` : ''}</li>` : `<li><b>${esc(M.dn(x.s))}</b> — 일반고 후보 · ${tm(x)}${x.wish ? ` · 희망 ${x.wish}지망` : ''}</li>`)).join('');
  const spNote = spW.length ? ` 특성화고(${spW.map((x) => `${esc(M.dn(x.s))} ${x.wish}지망`).join('·')})는 맨 아래에 두었고${spW.some((x) => x.long) ? `, 통학이 일반고보다 ${LONG}분 이상 더 걸려 다른 후보 일반고보다도 아래에 두었습니다` : '습니다'}(학과·실기 전형은 따로 준비).` : '';
  const spOtherNote = spOther.length ? ` 특성화고(${spOther.map((x) => esc(M.dn(x.s))).join('·')})는 학과·전형(실기 등)으로 따로 준비합니다.` : '';
  const bandBasis = A.bandManual ? (A.book.sems.length ? `성적대는 상담 때 확인한 성적 수준(${A.bandManual})을 적용했습니다.` : `성적대는 상담 때 확인한 성적 수준(${A.bandManual})을 적용했습니다(성적표 미제출).`) : `성적대는 ${bd ? semList(bd.sems) : '최근 학기'} 국어·영어·사탐(미대 입시 중요 과목) 점수를 학교 평균과 비교해 나눴습니다(참고 의견).`;
  let finalHtml = '';
  if (C.fixed) {
    const li = genList.map((x) => { const r = ranked.find((q) => q.s === x.s); return `<li><b>${esc(M.dn(x.s))}</b> — ${x.wish}지망 · 일반고 · ${tm(x)}${r ? ` · 평균 ${LVT[r.lv]}(${r.reg} 평균 대비 ${signed(r.diff)})` : ''}</li>`; }).join('') + tailLi;
    const tnote = genList.length === 2 && genList[0].total != null && genList[1].total != null && genList[0].total > genList[1].total ? `, ${esc(M.dn(genList[1].s))}가 ${genList[0].total - genList[1].total}분 더 가까움` : '';
    finalHtml = `<div class="final"><p class="fh">■ 최종 추천 순위 <span>일반고는 상담 순서 · 특성화고는 맨 아래</span></p><ol>${li}</ol>
<p class="why">일반고는 상담에서 정한 순서(${genList.map((x) => esc(M.dn(x.s))).join(' → ')}${tnote})를 따랐습니다.${spNote}</p></div>`;
  } else if (ranked.length >= 2) {
    const multi = band && grp.length > 1;
    finalHtml = `<div class="final"><p class="fh">■ 최종 추천 순위 <span>${grp.length === 1 ? '평균 같은 단계 · 통학 시간 순' : '성적대 순서 + 통학 시간'}</span></p>
<ol>${fin.map((x) => `<li><b>${esc(M.dn(x.s))}</b> — ${multi ? `${band} 순서 ${bRank.get(x.s)}위${tie(x) ? '(공동)' : ''} + ` : ''}통학 ${cRank.get(x.s)}위(${tm(x)})${multi ? ` = ${bRank.get(x.s) + cRank.get(x.s)}점` : ''}${x.wish ? ` · 희망 ${x.wish}지망` : ''}${x.lv && grp.length > 1 ? ` · 평균 ${LVT[x.lv]}` : ''}</li>`).join('')}${tailLi}</ol>
<p class="why">${band && grp.length === 1 ? `${COUNT[ranked.length] || ranked.length} 학교 모두 지역 평균 기준 '${allLv}'이라 통학 시간이 짧은 순으로 정했습니다.` : band ? `성적대 순서와 통학 순위를 같은 비중으로 더해 작은 순으로 정했고, 같으면 희망 지망을 앞에 두었습니다. ${bandBasis}` : '성적표가 없어 통학 순위로만 정했습니다. 성적표를 받으면 다시 정합니다.'}${spNote}${spOtherNote}</p></div>`;
  }
  const detail = ranked.length > 3 ? fin.slice(0, 3) : ranked;
  const tbl = detail.map((x) => {
    const lines = [];
    for (const gr of [1, 2, 3]) A.M.semesters.forEach((sem, si) => {
      lines.push(`<tr>${gr === 1 && si === 0 ? `<td rowspan="${3 * A.M.semesters.length}" class="nm"><b>${esc(M.dn(x.s))}</b>${x.wish ? `<small>희망 ${x.wish}지망</small>` : ''}<small>${x.rank ? `통학 ${x.rank}위` : '통학 미확인'}</small></td><td rowspan="${3 * A.M.semesters.length}" class="lv">${LVT[x.lv]}<small>${x.reg} 평균 대비 ${signed(x.diff)}</small></td>` : ''}${si === 0 ? `<td rowspan="${A.M.semesters.length}">${gr}</td>` : ''}<td class="sm">${sem.short}</td>${GROUPS.map((k) => { const c = M.cell(x.s, sem.key, gr, k); return c ? `<td>${c.m}${c.n > 1 ? '*' : ''}</td><td class="a">${c.a ?? '-'}</td>` : '<td class="na">-</td><td class="na">-</td>'; }).join('')}</tr>`);
    });
    return lines.join('');
  }).join('');
  const nodata = gen.filter((x) => !M.hasData(x.s)).map((x) => M.dn(x.s));
  const others = gen.filter((x) => M.hasData(x.s) && !withData.includes(x)).map((x) => M.dn(x.s));
  const sp = rows.filter((x) => M.special(x.s)).map((x) => M.dn(x.s));
  const semNote = A.M.semesters.map((s) => `${s.short} = ${s.long}`).join(', ');
  return `<section class="page p2">${logoImg()}
<p class="who">&lt;${esc(student.name)}&gt;</p>
<p class="cap">*고1·고2 국·영·수 평균을 ${ranked.length ? ranked[0].reg : ''} 일반고 전체 평균(${ranked.length ? ranked[0].avg : ''}점)과 비교했습니다. 2점 안쪽이면 '보통'입니다.<br>*평균만으로 내신 받기 쉬움·어려움을 단정할 수 없습니다(2026학년도부터 표준편차 미공시).</p>
${ranked.length ? `<table class="t avg">${avgHead}${ranked.map((x) => `<tr><td><b>${esc(M.dn(x.s))}</b></td>${avgCells(x.g1, x.g2, x.base, `${LVT[x.lv]} (${signed(x.diff)})`)}</tr>`).join('')}</table>` : ''}
${ranked.length ? `<table class="t cmp2"><tr><th rowspan="2">학교명</th><th rowspan="2">고1·고2<br>평균</th><th rowspan="2">학년</th><th rowspan="2">학기</th>${GROUPS.map((k) => `<th colspan="2">${k}</th>`).join('')}</tr>
<tr>${GROUPS.map(() => '<th class="sm">평균</th><th class="sm">A%</th>').join('')}</tr>${tbl}</table>` : '<p class="box">비교할 일반고 공시 자료가 없습니다.</p>'}
<p class="note">${semNote} · * 표시는 같은 교과 과목이 여러 개라 평균을 낸 값${nodata.length ? ` · ${nodata.map(esc).join('·')}는 공시 성적 미수집` : ''}${others.length ? ` · ${others.map(esc).join('·')}는 1쪽 통학표 참고` : ''}${ranked.length > 3 ? ` · 자세한 표는 추천 상위 3곳만` : ''}${sp.length ? ` · 특성화고(${sp.map(esc).join('·')})는 학과·전형으로 따로 검토` : ''}</p>
<h3>&lt;설명&gt;</h3>
<ol class="ex"><li><b>평균</b>: 그 과목을 들은 학생 전체의 평균 점수입니다.</li><li><b>A 비율</b>: 성취도 A를 받은 학생 비율입니다. 학교마다 A 기준이 달라 그대로 비교하지 않습니다.</li><li><b>A는 절대평가</b>: 기준 점수를 넘으면 모두 A입니다. A가 많아도 1등급(상위 10%)과는 다릅니다.</li><li><b>등급은 상대평가</b>: 상위 10% 1등급, 34% 2등급, 66% 3등급, 90% 4등급, 나머지 5등급입니다.</li></ol>
${ranked.length >= 2 && grp.length === 1 ? `<div class="band"><p class="bh">□ 성적대별 순서</p><p>□ ${orderFor('상위권')}</p><p class="why">이유: 후보 학교가 지역 평균 기준으로 같은 단계라, 성적대(상위·중위·하위권)와 관계없이 순서가 같습니다. 통학이 짧은 학교를 앞에 둡니다.</p></div>` : ''}${ranked.length >= 2 && grp.length > 1 ? BANDS.map((b) => `<div class="band${b === band ? ' me' : ''}"><p class="bh">□ 성적 ${b}${b === '상위권' ? ' (중학교 성적 상~중상)' : ''}</p><p>□ ${orderFor(b)}</p><p class="why">이유: ${why[b]}</p></div>`).join('') : ''}
${finalHtml}
<footer><span>출처: ${esc(data.disclosure || '학교알리미 학업성취사항')}, 카카오맵 통학 조회</span><span>ANiHi 만화학원</span></footer></section>`;
}

// 6. 지역 평균표
export function regionPage(student, A, data) {
  const { M, rows } = A;
  const region = A.region && M.regAvg[A.region] != null ? A.region : rows.map((x) => M.regionOf(x.s)).find((r) => M.regAvg[r] != null);
  if (!region) return '';
  const mine = rows.map((x) => x.s);
  const all = (data.schools || []).filter((q) => q.region === region).map((q) => ({ s: q.name, g1: M.gradeOf(q.name, 1), g2: M.gradeOf(q.name, 2), base: M.baseOf(q.name) })).filter((o) => o.base != null);
  const gen = all.filter((o) => !M.special(o.s)).sort((a, b) => b.base - a.base);
  const sp = all.filter((o) => M.special(o.s));
  const avg = M.regAvg[region];
  const row = (o, lab) => { const d = Math.round((o.base - avg) * 10) / 10; const m = mine.includes(o.s); return `<tr class="${m ? 'mine' : ''}"><td class="sc">${m ? '● ' : ''}<b>${esc(M.dn(o.s))}</b></td>${avgCells(o.g1, o.g2, o.base, lab ?? signed(d))}</tr>`; };
  const body = ['상', '중', '하'].map((l) => { const g = gen.filter((o) => M.lvOf(o.base, region) === l); return g.length ? `<tr class="grp"><td colspan="12">${LVT[l]} ${l === '상' ? '(평균보다 2점 이상 높음)' : l === '하' ? '(평균보다 2점 이상 낮음)' : '(평균 ±2점 안쪽)'} · ${g.length}개교</td></tr>${g.map((o) => row(o)).join('')}` : ''; }).join('');
  const spBody = sp.length ? `<tr class="grp"><td colspan="12">특성화고 · 일반고와 비교하지 않음(학과·전형 별도)</td></tr>${sp.map((o) => row(o, '비교 제외')).join('')}` : '';
  const semNote = M.semesters.map((s) => s.long).join('와 ');
  return `<section class="page p2 rp">${logoImg()}
<p class="who">&lt;${esc(student.name)}&gt;</p>
<h2 class="rt">${region} 고등학교 고1·고2 국어·영어·수학 평균표</h2>
<p class="cap">*${region} 일반고 ${gen.length}개교 고1·고2 국·영·수 평균의 전체 평균은 <b>${avg}점</b>입니다.<br>*평균 차이가 2점 안쪽이면 '보통'으로 묶었고, 같은 단계 안에서는 점수 순으로만 적었습니다(등수 아님).</p>
<table class="t rtab">${avgHead}${body}${spBody}</table>
<p class="note">● 표시는 이 상담에서 검토한 후보 학교입니다. · 각 학년 점수 = ${semNote}의 평균 · 고2는 선택과목이 여러 개라 과목 평균을 냄</p>
<h3>&lt;읽는 법&gt;</h3>
<ol class="ex"><li>평균은 그 학교 고1·고2 학생 전체의 과목 평균 점수입니다. 학생 수준과 시험 난이도가 함께 섞인 값입니다.</li><li>평균이 높다고 내신 받기가 어렵거나, 낮다고 쉽다고 단정할 수 없습니다(2026학년도부터 표준편차 미공시).</li><li>지역마다 평균 수준이 달라 ${region} 학교끼리만 비교했습니다.</li></ol>
<footer><span>출처: ${esc(data.disclosure || '학교알리미 학업성취사항')}</span><span>ANiHi 만화학원</span></footer></section>`;
}

// 7. 중학교 성적 변화 정리 + 추천 학교
const RK = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const ADV = {
  국어: { good: '가장 중요한 과목에서 좋은 성적을 내고 있습니다. 꾸준한 독서와 문학 작품 읽기로 고등학교 국어까지 이어 갑니다.', mid: '교과서 지문을 두 번 이상 읽고, 모르는 어휘를 정리하는 습관을 들입니다. 매일 짧은 글 한 편 읽기를 권합니다.', bad: '입시 1순위 과목입니다. 교과서 지문 반복 읽기, 어휘 정리, 매일 짧은 글 읽기로 기본 독해력부터 채웁니다.' },
  영어: { good: '지금 실력을 유지하면서 고1 공통영어에 맞춰 긴 지문 독해를 꾸준히 합니다.', mid: '하루 단어 20개와 짧은 지문 한 개 읽기를 습관으로 만들고, 서술형 쓰기도 연습합니다.', bad: '하루 단어 20개, 중학 핵심 문법(시제·to부정사·관계대명사 등) 복습, 짧은 지문 한 개 읽기를 습관으로 만듭니다.' },
  '사탐(사회·역사)': { good: '고1 통합사회로 이어지는 과목입니다. 지금처럼 수업 내용 정리와 수행평가를 챙깁니다.', mid: '교과서 단원별 핵심 개념을 한 장으로 정리하고, 수행평가를 빠짐없이 챙깁니다.', bad: '교과서 단원별 개념 정리 노트를 만들고, 수행평가부터 빠짐없이 챙겨 점수를 받습니다.' },
  수학: { good: '현재 수준을 유지하면서 고1 공통수학을 차근차근 준비합니다.', mid: '중3 이차방정식·이차함수 개념과 기본 문제를 다시 풀고, 틀린 문제는 오답 노트로 한 번 더 풉니다.', bad: '순서는 뒤지만 고1 내신에는 수학 등급도 들어갑니다. 중3 이차방정식·이차함수 개념과 기본 문제만은 다시 다집니다.' },
};
export function gradeReportPage(student, A, rec) {
  const { book, bd } = A;
  const data = book.by, sems = book.sems, LO = book.letterOnly;
  const SUBS = ['국어', '영어', '사회', '역사', '수학', '과학'].filter((k) => sems.some((s) => data[s][k]));
  const seq = (k) => sems.map((s) => data[s][k]).filter(Boolean);
  const flow = (k) => {
    if (LO) { const v = seq(k).map((x) => RK[x.a]).filter(Boolean); if (v.length < 2) return ['keep', '한 학기 자료']; const d = v[v.length - 1] - v[0], rng = Math.max(...v) - Math.min(...v); return d >= 1 ? ['up', '올라감'] : d <= -1 ? ['down', '내려감'] : rng >= 2 ? ['wave', '오르내림'] : ['keep', '같은 단계 유지']; }
    const vs = seq(k).filter((x) => x.s != null), v = vs.map((x) => x.s);
    if (v.length < 2) return ['keep', '한 학기 자료'];
    const d = v[v.length - 1] - v[0], rng = Math.max(...v) - Math.min(...v);
    const ups = v.slice(1).every((x, i) => x >= v[i] - 2), downs = v.slice(1).every((x, i) => x <= v[i] + 2);
    if (d >= 8) return ['up', ups ? '꾸준히 상승' : '상승'];
    if (d <= -8) return ['down', downs ? '계속 하락' : '하락'];
    if (rng >= 15) return ['wave', '오르내림'];
    const last = vs[vs.length - 1];
    return ['keep', last.m != null && last.s - last.m >= 5 ? '평균보다 높게 유지' : last.m != null && last.s - last.m <= -5 ? '평균보다 낮게 유지' : '비슷하게 유지'];
  };
  const cell = (v, prev) => {
    if (!v) return '<td class="na">-</td>';
    if (LO || v.s == null) { const ar = prev && RK[v.a] && RK[prev.a] ? (RK[v.a] > RK[prev.a] ? '<i class="u">▲</i>' : RK[v.a] < RK[prev.a] ? '<i class="d">▼</i>' : '<i class="s">-</i>') : ''; return `<td>${v.a ? `<b class="g g${v.a}">${v.a}</b>` : '-'}${ar}</td>`; }
    const ar = prev && prev.s != null ? (v.s > prev.s + 2 ? '<i class="u">▲</i>' : v.s < prev.s - 2 ? '<i class="d">▼</i>' : '<i class="s">-</i>') : '';
    return `<td>${v.a ? `<b class="g g${v.a}">${v.a}</b> ` : ''}<b class="sc">${v.s}</b>${ar} ${v.m != null ? `<small>(평균 ${v.m})</small>` : ''}</td>`;
  };
  const rows = SUBS.map((k) => { const f = flow(k); return `<tr><th>${k}</th>${sems.map((s, i) => cell(data[s][k], sems.slice(0, i).reverse().map((q) => data[q][k]).find(Boolean))).join('')}<td class="fl ${f[0]}">${f[1]}</td></tr>`; }).join('');
  const PRI = [['국어', ['국어']], ['영어', ['영어']], ['사탐(사회·역사)', ['사회', '역사']], ['수학', ['수학']]];
  const pri = PRI.map(([lab, ks], i) => {
    const last = sems.slice().reverse().map((s) => ks.map((k) => data[s][k]).filter(Boolean)).find((a) => a.length);
    if (!last) return { i, lab, none: true };
    const ach = [...new Set(last.map((x) => x.a).filter(Boolean))].join('·');
    if (LO) {
      const rs = sems.map((q) => { const v = ks.map((k) => data[q][k]).filter(Boolean).map((x) => RK[x.a]).filter(Boolean); return v.length ? r1(v) : null; }).filter((v) => v != null);
      const h = Math.min(2, Math.floor(rs.length / 2));
      const dd = rs.length >= 2 ? r1(rs.slice(-h)) - r1(rs.slice(0, h)) : null;
      const fl = dd == null ? ['keep', '한 학기 자료'] : dd >= 1 ? ['up', '앞 학기보다 오름'] : dd <= -1 ? ['down', '앞 학기보다 내려감'] : ['keep', '앞 학기와 비슷'];
      const lr = r1(last.map((x) => RK[x.a]).filter(Boolean)) || 3;
      const st = lr >= 4 ? (fl[0] === 'down' ? 'mid' : 'good') : lr <= 2 ? 'bad' : fl[0] === 'down' ? 'bad' : 'mid';
      return { i, lab, sc: null, m: null, ach, fl, st };
    }
    const scored = last.filter((x) => x.s != null);
    const sc = scored.length ? r1(scored.map((x) => x.s)) : null;
    const m = scored.length && scored.every((x) => x.m != null) ? r1(scored.map((x) => x.m)) : null;
    const gs = sems.map((q) => { const v = ks.map((k) => data[q][k]).filter((x) => x && x.s != null && x.m != null).map((x) => x.s - x.m); return v.length ? r1(v) : null; }).filter((v) => v != null);
    const gap = sc != null && m != null ? Math.round((sc - m) * 10) / 10 : 0;
    const h = Math.min(2, Math.floor(gs.length / 2));
    const dd = gs.length >= 2 ? r1(gs.slice(-h)) - r1(gs.slice(0, h)) : null;
    const fl = dd == null ? ['keep', '한 학기 자료'] : dd >= 8 ? ['up', '평균 대비 오름'] : dd <= -8 ? ['down', '평균 대비 내려감'] : ['keep', '평균 대비 비슷'];
    const st = gap >= 5 ? (fl[0] === 'down' ? 'mid' : 'good') : gap <= -5 ? 'bad' : fl[0] === 'down' ? 'bad' : 'mid';
    return { i, lab, sc, m, ach, fl, st };
  });
  const urgent = pri.find((p) => p.st === 'bad' && p.i < 3) || pri.find((p) => p.st === 'bad');
  const STT = { good: '강점', mid: '유지·보완', bad: '보완 필요' };
  const priHtml = `<div class="pri"><p class="ph">미대 입시에서 중요한 과목 순서 <span>ANiHi 입시 지도 기준 · ${LO ? '최근 학기 성취도, 흐름은 성취도 단계 기준' : '최근 학기 점수, 흐름은 학교 평균과의 차이 기준'}</span></p><div class="pg">${pri.map((p) => (p.none ? `<div><em>${p.i + 1}</em><b>${p.lab}</b><span>자료 없음</span></div>` : `<div class="${p === urgent ? 'bad' : p.st}"><em>${p.i + 1}</em><b>${p.lab}</b><span>${p.sc != null ? `${p.sc}점 ` : '성취도 '}${p.ach}${p.m != null ? ` (평균 ${p.m})` : ''}</span><span>${p.fl[1]}</span><strong>${p === urgent ? '가장 먼저 보완' : STT[p.st]}</strong></div>`)).join('')}</div></div>`;
  const COL = { 국어: '#c0392b', 영어: '#2e8b57', 사탐: '#8e6c00', 수학: '#1f5fae' }, DASH = { 국어: '', 영어: '2 3', 사탐: '10 3 2 3', 수학: '6 3' };
  const sv = (o) => (o ? (LO ? RK[o.a] ?? null : o.s) : null);
  const series = { 국어: sems.map((s) => sv(data[s].국어)), 영어: sems.map((s) => sv(data[s].영어)), 사탐: sems.map((s) => { const v = ['사회', '역사'].map((k) => sv(data[s][k])).filter((x) => x != null); return v.length ? r1(v) : null; }), 수학: sems.map((s) => sv(data[s].수학)) };
  let svg = '';
  const allV = Object.values(series).flat().filter((v) => v != null);
  if (sems.length >= 2 && allV.length) {
    const lo = LO ? 1 : Math.max(0, Math.floor((Math.min(...allV) - 5) / 10) * 10), hi = LO ? 5 : 100, stepV = LO ? 1 : 10, lab = (v) => (LO ? 'EDCBA'[v - 1] : v);
    const W = 640, H = 200, L = 40, R = 110, T = 14, B = 26;
    const x = (i) => L + (i * (W - L - R)) / (sems.length - 1), y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
    svg = `<svg class="graph" viewBox="0 0 ${W} ${H}">`;
    for (let v = lo; v <= hi; v += stepV) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e3e3"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#888">${lab(v)}</text>`;
    sems.forEach((s, i) => (svg += `<text x="${x(i)}" y="${H - 7}" text-anchor="middle" font-size="11" fill="#444">${SL[s]}</text>`));
    const ends = [];
    for (const k of Object.keys(series)) {
      const pts = series[k].map((v, i) => (v == null ? null : [x(i), y(v), v])).filter(Boolean);
      if (!pts.length) continue;
      svg += `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${COL[k]}" stroke-width="2.4" stroke-dasharray="${DASH[k]}"/>`;
      pts.forEach((p) => (svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.3" fill="${COL[k]}"/><text x="${p[0]}" y="${p[1] + (k === '수학' ? 14 : -6)}" text-anchor="middle" font-size="9.5" fill="${COL[k]}">${LO ? '' : p[2]}</text>`));
      ends.push([k, pts[pts.length - 1][1]]);
    }
    ends.sort((a, b) => a[1] - b[1]); let prevY = -99;
    const lys = ends.map(([, yy]) => (prevY = Math.max(yy + 4, prevY + 13)));
    for (let i = lys.length - 1, lim = H - B - 4; i >= 0; i--) { lys[i] = Math.min(lys[i], lim); lim = lys[i] - 13; }
    ends.forEach(([k], i) => (svg += `<text x="${W - R + 12}" y="${lys[i]}" font-size="12" font-weight="bold" fill="${COL[k]}">${k}</text>`));
    svg += '</svg>';
  }
  const order = pri.filter((p) => !p.none).sort((a, b) => (a === urgent ? -1 : b === urgent ? 1 : a.i - b.i));
  const NUM = ['①', '②', '③', '④'];
  const advHtml = order.map((p, j) => `<p><b class="t">${NUM[j]} ${p.lab} — ${p === urgent ? '가장 먼저' : STT[p.st]} (입시 ${p.i + 1}순위)</b> ${ADV[p.lab][p === urgent ? 'bad' : p.st]}</p>`).join('');
  const band = A.band;
  let recHtml = '';
  if (rec && rec.list.length) {
    const basis = A.bandManual
      ? (sems.length ? `상담 때 확인한 성적 수준(${A.bandManual})을 적용했습니다.${LO ? ` 최근 두 학기 국어 ${sems.slice(-2).map((q) => data[q]?.국어?.a || '-').join('→')}, 영어 ${sems.slice(-2).map((q) => data[q]?.영어?.a || '-').join('→')}.` : ''}` : `성적표가 없어 상담 때 확인한 성적 수준(${A.bandManual})을 적용했습니다.`)
      : bd ? `${semList(bd.sems)} 국어·영어·사탐 점수가 학교 평균보다 평균 ${signed(bd.gap)}점 → <b>${bd.band}</b>${bd.trend === '비교 불가' ? '' : `, 앞 두 학기보다 ${bd.trend === '상승' ? `오름(+${bd.d})` : bd.trend === '하락' ? `내려감(${bd.d})` : '비슷함'}`}` : '성적표가 없어 통학 시간으로만 순서를 정했습니다.';
    const how = rec.fixed ? '일반고는 상담 순서 · 특성화고는 맨 아래' : rec.allSame ? '후보 학교 평균이 같은 단계라 통학 시간이 짧은 순' : band ? `${band} 기준 학교 순서 + 통학 시간` : '통학 시간이 짧은 순';
    const li = rec.list.map((x) => `<li><b>${esc(x.s)}</b> — ${x.special ? '특성화고(학과·실기 전형) · ' : ''}${minText(x.total)}${x.long ? ` (일반고 최단보다 +${x.more}분, 통학 부담 큼)` : ''}${x.lv ? ` · 학교 평균 ${x.lv}` : ''}${x.wish ? ` · 희망 ${x.wish}지망` : ''}</li>`).join('');
    const sp = rec.sp.filter((x) => !rec.list.some((y) => y.s === x.s));
    recHtml = `<div class="rec"><p class="rh">■ 추천 학교 <span>${how}</span></p><p class="basis">성적대: ${basis}</p><ol>${li}</ol>${rec.list.some((x) => x.special) ? `<p class="basis">특성화고는 지망과 관계없이 맨 아래에 두고, 통학이 일반고보다 ${LONG}분 이상 더 걸리면 다른 후보 일반고보다도 아래에 두었습니다.</p>` : ''}${sp.length ? `<p class="basis">특성화고 ${sp.map((x) => esc(x.s)).join('·')}는 학과·실기 전형으로 따로 준비합니다.</p>` : ''}</div>`;
  }
  const noData = !sems.length;
  const school = String(student.middleSchool || '').trim();
  const sub = noData ? '받은 자료에 성적표가 없습니다' : `${school ? `${esc(/학교$/.test(school) ? school : `${school}학교`)} · ` : ''}${SL[sems[0]]} ~ ${SL[sems[sems.length - 1]]} ${LO ? ' 성적(성취도)' : ' 성적표'} 기준`;
  return `<section class="page gp">${logoImg('logo13')}<p class="who">&lt;${esc(student.name)}&gt;</p>
<h1>중학교 성적 변화 정리</h1><p class="sub">${sub}</p>
${noData ? `<p class="box">받은 자료에 성적표가 없어 학기별 성적 변화를 정리하지 못했습니다. 성적표(또는 성적증명서)를 받으면 같은 양식으로 바로 만듭니다.${A.bandManual ? ` 추천 학교는 상담 때 확인한 성적 수준(${A.bandManual})을 적용했습니다.` : ''}</p>` : `${priHtml}
<h2>학기별 성적 (주요 과목) <span>${LO ? '점수 없이 성취도만 있는 자료 · ▲▼는 직전 학기보다 성취도가 오르거나 내림' : '성취도 · 점수 · (학교 과목 평균) · ▲▼는 직전 학기보다 2점 넘게 오르거나 내림'}</span></h2>
<table><thead><tr><th>과목</th>${sems.map((s) => `<th>${SL[s]}</th>`).join('')}<th>흐름</th></tr></thead><tbody>${rows}</tbody></table>
${sems.length < 2 ? '<p class="note">받은 자료가 한 학기뿐이라 변화는 비교하지 못했습니다.</p>' : ''}
${svg ? `<h2>중요 과목 ${LO ? '성취도' : '점수'} 그래프 <span>사탐은 사회·역사 평균</span></h2>${svg}` : ''}`}
<div class="sp25"></div>${recHtml || '<p class="note">추천 학교 자료가 없습니다.</p>'}
${noData ? '' : `<h2>앞으로 이렇게 해 보면 좋습니다</h2><div class="plan">${advHtml}</div>`}
<p class="note">* 중학교 성취도(A~E)는 절대평가라 고등학교 등급으로 바로 바꿀 수 없습니다. 학교 평균 단계·통학 시간은 2쪽 학교 비교표와 같은 기준입니다. 학습 방향을 위한 참고 자료입니다.</p>
<footer><span>출처: 학교 성적표·성적증명서, 학교알리미, 카카오맵</span><span>ANiHi 만화학원</span></footer>
</section>`;
}

// 8. 통학 시간 차이
export function timePage(student, rec) {
  const known = (x) => x.total != null && x.a != null && x.b != null;
  const byRec = rec.wishes.filter(known).length < 2;
  const W = (byRec ? rec.list.filter(known).slice(0, 3).map((x, i) => ({ ...x, wish: i + 1 })) : rec.wishes.filter(known));
  const WL = byRec ? '추천 ' : '', WS = byRec ? '순위' : '지망';
  const lab = (x) => `${WL}${x.wish}${WS}`;
  const missing = rec.wishes.filter((x) => !known(x)).map((x) => x.s);
  let body;
  if (W.length < 2) body = '<p class="box">통학 시간이 들어간 학교가 2곳 이상 있어야 비교할 수 있습니다.</p>';
  else {
    const min = Math.min(...W.map((x) => x.total));
    const base = W.find((x) => x.total === min);
    const R = W.map((x) => ({ ...x, home: x.total - x.a - x.b, d: x.total - min }));
    const t1 = `<table><thead><tr><th rowspan="2">${byRec ? '순위' : '지망'}</th><th rowspan="2">학교</th><th colspan="4">하루 이동 시간(분)</th><th colspan="2">통학 총량</th></tr>
<tr><th>집→학교</th><th>학교→학원</th><th>학원→집</th><th>합계</th><th>1년</th><th>3년</th></tr></thead><tbody>
${R.map((x) => `<tr class="${x.d === 0 ? 'best' : ''}"><td>${lab(x)}</td><td class="nm"><b>${esc(x.s)}</b>${x.special ? '<small>특성화고</small>' : ''}</td><td>${x.a}</td><td>${x.b}</td><td>${x.home}</td><td><b>${x.total}분</b></td><td>${fmt(hrs(x.total * DAYS))}시간</td><td>${fmt(hrs(x.total * Y3))}시간</td></tr>`).join('')}</tbody></table>`;
    const t2 = `<table class="t2"><thead><tr><th rowspan="2">${byRec ? '순위' : '지망'}</th><th rowspan="2">학교</th><th colspan="3">${esc(base.s)}보다 길에서 더 쓰는 시간<small>= 공부·그림에 쓸 수 있는 시간</small></th><th colspan="3">그 시간이면 그릴 수 있는 양<small>5분 크로키 · 2시간 소묘</small></th></tr>
<tr><th>하루</th><th>1년</th><th>3년</th><th>하루</th><th>1년</th><th>3년</th></tr></thead><tbody>
${R.map((x) => (x.d === 0 ? `<tr class="best"><td>${lab(x)}</td><td class="nm"><b>${esc(x.s)}</b></td><td colspan="6" class="bm">통학이 가장 짧은 기준 학교</td></tr>` : `<tr><td>${lab(x)}</td><td class="nm"><b>${esc(x.s)}</b></td><td class="dd">+${x.d}분</td><td class="dd">+${fmt(hrs(x.d * DAYS))}시간</td><td class="dd">+${fmt(hrs(x.d * Y3))}시간</td><td>${x.d >= 5 ? `크로키 ${Math.floor(x.d / 5)}장` : '-'}</td><td>크로키 ${fmt(Math.floor((x.d * DAYS) / 5))}장<small>소묘 ${fmt(Math.floor((x.d * DAYS) / 120))}장</small></td><td>크로키 ${fmt(Math.floor((x.d * Y3) / 5))}장<small>소묘 ${fmt(Math.floor((x.d * Y3) / 120))}장</small></td></tr>`)).join('')}</tbody></table>`;
    const mx = Math.max(...R.map((x) => x.total));
    const bars = R.map((x) => `<div class="bar"><span class="bl">${lab(x)} ${esc(x.s)}</span><span class="bw"><i style="width:${(x.total / mx) * 100}%" class="${x.d === 0 ? 'b0' : x.d >= 40 ? 'b2' : 'b1'}"></i></span><span class="bv">3년 ${fmt(hrs(x.total * Y3))}시간${x.d ? ` (+${fmt(hrs(x.d * Y3))})` : ''}</span></div>`).join('');
    const far = R.filter((x) => x.d > 0).sort((a, b) => b.d - a.d)[0];
    const sum = far ? `${esc(far.s)}(${lab(far)})에 다니면 ${esc(base.s)}보다 하루 ${far.d}분, 3년 동안 약 <b>${fmt(hrs(far.d * Y3))}시간</b>을 더 길에서 보냅니다. 이 시간이면 5분 크로키 약 <b>${fmt(Math.floor((far.d * Y3) / 5))}장</b>, 2시간 소묘 약 <b>${fmt(Math.floor((far.d * Y3) / 120))}장</b>을 더 그릴 수 있습니다. 하루 2시간씩 공부한다고 하면 약 <b>${fmt(Math.round((far.d * Y3) / 120))}일치</b> 공부 시간입니다.` : '';
    body = `<h2>${byRec ? '추천 순위별' : '지망별'} 하루 이동 시간과 통학 총량</h2>${t1}
<h2>3년 통학 시간 비교</h2><div class="bars">${bars}</div>
<h2>통학 시간 차이 = 공부·그림 시간 차이</h2>${t2}
${sum ? `<div class="sum"><p class="sh">■ 한눈에 보기</p><p>${sum}</p></div>` : ''}`;
  }
  return `<section class="page tp${W.length > 5 ? ' many' : ''}">${logoImg('logo13')}<p class="who">&lt;${esc(student.name)}&gt;</p>
<h1>통학 시간에 따른 공부·그림 시간 차이</h1><p class="sub">${byRec ? '희망 지망 통학 시간이 2곳 미만이라 추천 순위 기준' : `희망 ${W.map((x) => x.wish).join('·')}지망 기준`} · 하루 이동 = 집→학교 + 학교→학원 + 학원→집</p>
${body}
<p class="note">* 1년 = 수업일수 190일, 3년 = 570일 기준이며 학교 수업 날마다 학원에 간다고 가정했습니다. 카카오맵 대중교통 조회 시간으로, 버스 기다리는 시간은 빠져 있어 실제로는 더 걸릴 수 있습니다.${missing.length && !byRec ? ` ${missing.map(esc).join('·')}는 통학 시간이 없어 뺐습니다.` : ''}<br>* 5분 크로키는 하루 차이 시간을 5분으로 나눈 장수, 소묘는 한 장 2시간 기준입니다.</p>
<footer><span>출처: 카카오맵 대중교통 조회</span><span>ANiHi 만화학원</span></footer>
</section>`;
}

// 9쪽 전체. pages의 name은 이미지로 저장할 때 파일 이름(01_표지.png …)이 된다.
export function renderReport(student, data, { withGuide = true } = {}) {
  const A = analyze(student, data);
  const C = compare(A, student);
  const rec = recommendation(A, C);
  const pages = [{ name: '표지', html: coverPage(student) }];
  if (withGuide) {
    const guide = INFO_PAGES.split(/\n(?=<section)/);
    ['수능변화', '내신변화', '등급제개편'].forEach((name, i) => pages.push({ name, html: guide[i] }));
  }
  pages.push({ name: '상담표', html: counselPage(student, A, data) });
  if (A.rows.length) pages.push({ name: '학교비교표', html: comparePage(student, A, C, data) });
  const region = regionPage(student, A, data);
  if (region) pages.push({ name: '지역평균표', html: region });
  pages.push({ name: '성적변화_추천학교', html: gradeReportPage(student, A, rec) });
  if (A.rows.length) pages.push({ name: '통학시간_차이', html: timePage(student, rec) });
  return { html: pages.map((p) => p.html).join('\n'), pages, analysis: A, comparison: C, recommendation: rec };
}

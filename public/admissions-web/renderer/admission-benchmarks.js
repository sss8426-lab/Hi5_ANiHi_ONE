import { RULES, PROGRAMS, calculateVerified } from './verified-grade-engine.js';

// A display-only grouping threshold, NOT an admission probability or a cutoff.
export const NEAR_TOLERANCE = 0.3;
export const COMPARISON_NOTE = '평균 근처 ±0.3등급은 임의의 표시 구간이며 합격 가능성이나 합격선을 뜻하지 않습니다.';
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').trim() : '';
const fail = reason => ({ ok: false, reason });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const yearNumber = value => (typeof value === 'number' || (typeof value === 'string' && /^\d{4}$/.test(value.trim()))) ? Number(value) : NaN;
// Remove floating-point noise without rounding a genuine 0.3001 margin into near.
const cleanMargin = value => Math.round(value * 1e10) / 1e10;

// Official KCCE 2027 guide pp36–37,45–46; 2026 guide pp37–38.
// Both guides specify the same formula; buckets describe historical means, not admission likelihood.
const KUMA_RULE = Object.freeze({ year: 2027, season: '수시', scale: 9, version: '20261014.1', university: '한국영상대학교', campus: '세종', source: 'https://ipsi.kcce.or.kr/file/plan_pds/2027/2026_73109000_1781650616394.pdf', priorSource: 'https://ipsi.kcce.or.kr/file/plan_pds/2026/2025_73109000_1750489227348.pdf' });
const KUMA_MAJORS = ['영상디자인학과', '애니메이션전공', '게임콘텐츠전공', 'VFX콘텐츠전공', '웹툰웹소설자율전공', '만화웹툰전공', '웹소설전공', '웹툰PD전공', '웹툰일러스트전공'];
export const KUMA_COMPARISON_NOTE = '2026·2027 공식 모집요강의 동일 산식을 대조한 조건부 비교입니다. 과거 최종등록자 평균 참고이며 합격 가능성·합격확률이 아닙니다. 소수점 처리 규정은 미확인으로 중간 반올림하지 않습니다.';
const KUMA_STATUS = 'conditional_same_basis_verified_across_guides';
const KUMA_TERMS = ['1:1', '1:2', '2:1', '2:2', '3:1'];
const missing = value => value === null || value === undefined || (typeof value === 'string' && !value.trim());
const numeric = value => !missing(value) && (typeof value === 'number' || (typeof value === 'string' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) ? Number(value) : NaN;

function kumaIdentityValidation(u, benchmark) {
  if (u.name !== '한국영상대학교' || (u.university !== undefined && u.university !== '한국영상대학교') || u.campus !== '세종') return fail('한국영상대학교 공식 대학명·세종 캠퍼스가 일치해야 합니다.');
  if (!KUMA_MAJORS.includes(benchmark.major) || u.major !== benchmark.major) return fail('영상대 공식 결과의 정확한 모집단위가 일치해야 합니다.');
  if (!['수시1', '수시2'].includes(benchmark.phase) || !['학생부', '면접', '실기'].includes(benchmark.type) || u.admission !== benchmark.phase + ' · ' + benchmark.type) return fail('영상대 수시 차수·전형 유형이 공식 결과와 일치해야 합니다.');
  if (yearNumber(u.year) !== 2027 || u.season !== '수시') return fail('영상대는 2027학년도 수시만 조건부 비교합니다.');
  if (benchmark.directRecommendationEligible !== true || !Number.isFinite(numeric(u.gradeRatio)) || numeric(u.gradeRatio) <= 0 || numeric(u.gradeRatio) > 100) return fail('2027학년도 학생부 반영 여부와 공식 전형 비율 확인이 필요합니다. 실기 100% 전형은 내신 비교에서 제외합니다.');
  if (benchmark.comparisonStatus !== KUMA_STATUS || benchmark.metric !== 'mean' || benchmark.population !== 'final-registrants' || benchmark.resultYear !== 2026) return fail('영상대는 동일산식 대조가 확인된 2026 최종등록자 평균만 조건부 참고 비교합니다.');
  if (typeof benchmark.sourceUrl !== 'string') return fail('영상대 공식 KCCE 출처가 필요합니다.');
  try { if (new URL(benchmark.sourceUrl).hostname !== 'ipsi.kcce.or.kr') return fail('영상대 공식 KCCE 출처가 필요합니다.'); } catch { return fail('영상대 공식 KCCE 출처가 필요합니다.'); }
  return { ok: true };
}

function calculateKuma(rows, profile) {
  const profileCheck = profileValidation(profile);
  if (!profileCheck.ok) return { ...profileCheck, selected: [], excluded: [] };
  const semesters = KUMA_TERMS.map(term => ({ term, rows: [], credits: 0, weightedGrades: 0 }));
  const excluded = [], seen = new Set();
  for (const [index, row] of rows.entries()) {
    const name = normalize(row.subjectName);
    const year = typeof row.schoolYear === 'string' ? row.schoolYear.trim().replace(/학년$/, '') : row.schoolYear;
    const semester = typeof row.semester === 'string' ? row.semester.trim().replace(/학기$/, '') : row.semester;
    const y = numeric(year), s = numeric(semester);
    if (!name || ![1, 2, 3].includes(y) || ![1, 2].includes(s)) return { ...fail((index + 1) + '행: 과목명·학년·학기를 확인해 주세요.'), selected: [], excluded };
    const term = y + ':' + s, key = term + ':' + name;
    if (seen.has(key)) return { ...fail((index + 1) + '행: 같은 학기의 과목이 중복되었습니다.'), selected: [], excluded };
    seen.add(key);
    const gradePresent = !missing(row.grade), rawPresent = !missing(row.rawScore);
    const rank = numeric(row.grade), raw = numeric(row.rawScore);
    if ((gradePresent && (!Number.isInteger(rank) || rank < 1 || rank > 9)) || (rawPresent && (!Number.isFinite(raw) || raw < 0 || raw > 100))) return { ...fail((index + 1) + '행: 입력된 석차등급·원점수가 올바르지 않습니다.'), selected: [], excluded };
    if (!KUMA_TERMS.includes(term)) { excluded.push({ ...row, reason: '반영 학기 밖 (3학년 2학기)' }); continue; }
    if (!gradePresent && !rawPresent) { excluded.push({ ...row, reason: '석차등급과 원점수가 없는 교과목' }); continue; }
    const achievementType = ['CAREER', 'SPECIALIZED', '성취', '성취평가제', '진로선택', '전문교과'].includes(typeof row.subjectType === 'string' ? row.subjectType.trim() : '');
    if (!gradePresent && !achievementType) return { ...fail((index + 1) + '행: 원점수 환산 대상인 성취·진로·전문 교과 유형을 확인해 주세요.'), selected: [], excluded };
    const credits = numeric(row.credits);
    if (!Number.isFinite(credits) || credits <= 0) return { ...fail((index + 1) + '행: 반영 과목의 양수 이수단위가 필요합니다.'), selected: [], excluded };
    const convertedGrade = gradePresent ? rank : raw >= 90 ? 1 : raw >= 80 ? 2 : raw >= 70 ? 3 : raw >= 60 ? 4 : raw >= 50 ? 5 : raw >= 40 ? 6 : raw >= 30 ? 7 : raw >= 20 ? 8 : 9;
    const target = semesters.find(item => item.term === term);
    target.rows.push({ ...row, convertedGrade, originalIndex: index, fromRawScore: !gradePresent });
    target.credits += credits; target.weightedGrades += convertedGrade * credits;
    if (!Number.isFinite(target.credits) || !Number.isFinite(target.weightedGrades)) return { ...fail('이수단위 합계를 확인해 주세요.'), selected: [], excluded };
  }
  for (const semester of semesters) { semester.convertedGrade = semester.credits ? semester.weightedGrades / semester.credits : 9; semester.padded = !semester.credits; }
  const best = [...semesters].sort((a, b) => a.convertedGrade - b.convertedGrade || KUMA_TERMS.indexOf(a.term) - KUMA_TERMS.indexOf(b.term)).slice(0, 2);
  const selected = best.flatMap(semester => semester.rows.length ? semester.rows : [{ subjectName: '성적 없는 학기', term: semester.term, convertedGrade: 9, padded: true }]);
  for (const semester of semesters.filter(item => !best.includes(item))) excluded.push(...semester.rows.map(row => ({ ...row, reason: '우수 2학기 밖' })));
  // No source-supported rounding rule: never round intermediate or final model grades.
  const convertedGrade = (best[0].convertedGrade + best[1].convertedGrade) / 2;
  return { ok: true, convertedGrade, selected, excluded, semesters, selectedTerms: best.map(item => item.term), paddedCount: best.filter(item => item.padded).length, confidence: 'conditional', comparisonStatus: KUMA_STATUS, historicalReference: true, note: KUMA_COMPARISON_NOTE, sourceUrl: KUMA_RULE.source, priorSourceUrl: KUMA_RULE.priorSource };
}

function profileValidation(profile) {
  if (!isRecord(profile)) return fail('지원 학년도·모집 시기·등급제·학력·성적 입력 완료 여부를 명시해 주세요.');
  const year = yearNumber(profile.year);
  if (!Number.isInteger(year) || !normalize(profile.season)) return fail('지원 학년도와 모집 시기를 명시해 주세요.');
  if (profile.scale !== 9 && profile.scale !== '9') return fail('9등급제만 검증되어 있습니다. 5등급제는 별도 환산식이 필요합니다.');
  if (!['expected', 'graduate'].includes(profile.schoolStatus)) return fail('졸업예정·졸업 여부를 확인해 주세요. 기타 학력은 자동 비교 대상이 아닙니다.');
  if (profile.complete !== true) return fail('대상 학기의 과목별 성적 입력 완료를 확인해 주세요.');
  if (![...Object.values(RULES), KUMA_RULE].some(rule => rule.year === year && rule.season === profile.season && rule.scale === Number(profile.scale))) return fail('해당 학년도·모집 시기의 검증된 환산식이 없습니다.');
  return { ok: true };
}

function officialUrl(value, rule) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const officialHost = new URL(rule.source).hostname.replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (url.hostname !== officialHost && !url.hostname.endsWith('.' + officialHost)) return null;
    return url.href;
  } catch { return null; }
}

function identityValidation(u, program, rule) {
  // Exact metadata matches only. A campus encoded in this known catalog name is explicit,
  // but a university name alone must never silently choose a Joongbu campus.
  const names = program.rule === 'joongbu'
    ? [rule.university, '중부대', '중부대_고양', '중부대학교_고양']
    : [rule.university, '서원대'];
  const suppliedNames = [u.name, u.university].filter(value => value !== undefined);
  if (!suppliedNames.length || suppliedNames.some(value => !names.some(name => normalize(name) === normalize(value)))) return fail('대학명이 검증된 전형과 일치하지 않습니다.');
  const encodedCampus = suppliedNames.some(value => ['중부대_고양', '중부대학교_고양'].includes(normalize(value)));
  const campuses = program.rule === 'joongbu' ? [rule.campus, '고양', '고양캠퍼스'] : [rule.campus, '청주캠퍼스'];
  if ((u.campus !== undefined && !campuses.some(campus => normalize(campus) === normalize(u.campus))) || (u.campus === undefined && !encodedCampus)) return fail('캠퍼스가 누락되었거나 검증된 전형과 다릅니다.');
  if (normalize(u.major) !== normalize(program.major)) return fail('모집학과가 검증된 전형과 일치하지 않습니다.');
  if (normalize(u.admission) !== normalize(program.admission)) return fail('전형명이 검증된 전형과 일치하지 않습니다.');
  if (u.year !== undefined && yearNumber(u.year) !== rule.year) return fail('대학 행의 지원 학년도가 환산식과 다릅니다.');
  if (u.season !== undefined && u.season !== rule.season) return fail('대학 행의 모집 시기가 환산식과 다릅니다.');
  return { ok: true };
}

/** Validate provenance and same-basis comparability without calculating a transcript.
 * Returns {ok:false, reason} or {ok:true, benchmark, program, rule, sourceUrl}.
 */
export function benchmarkValidation(u, profile) {
  const profileCheck = profileValidation(profile);
  if (!profileCheck.ok) return profileCheck;
  if (!isRecord(u) || !isRecord(u.admissionBenchmark)) return fail('검증된 공식 입시결과가 없습니다.');
  const benchmark = u.admissionBenchmark;
  if (benchmark.directRecommendationEligible === false) return fail(benchmark.comparisonStatus === 'different_basis' || /smu|상명/i.test(benchmark.programId || '') ? '공식 입시결과와 현재 환산 기준이 달라 직접 비교할 수 없습니다.' : '2027 학생부 반영 비율 또는 산출 기준이 미검증이거나 실기 100% 전형이므로 내신 직접 비교에서 제외합니다.');
  const isKuma = benchmark.programId === 'kuma-best-two-2027';
  const program = isKuma ? { id: benchmark.programId, rule: 'kuma', major: benchmark.major, admission: benchmark.phase + ' · ' + benchmark.type } : PROGRAMS.find(item => item.id === benchmark.programId);
  const rule = isKuma ? KUMA_RULE : program && RULES[program.rule];
  if (!program || !rule) return fail('검증된 대학별 전형·환산식이 아닙니다.');
  if (rule.year !== yearNumber(profile.year) || rule.season !== profile.season) return fail('지원 학년도·모집 시기와 환산식이 다릅니다.');
  const identityCheck = isKuma ? kumaIdentityValidation(u, benchmark) : identityValidation(u, program, rule);
  if (!identityCheck.ok) return identityCheck;
  if (benchmark.verificationStatus !== 'verified') return fail('공식 출처 검증이 완료되지 않았습니다.');
  if (!['mean', 'minimum', 'p70'].includes(benchmark.metric)) return fail('평균·최저·70% 지표를 명시해 주세요.');
  if (!['final-registrants', 'initial-admits'].includes(benchmark.population)) return fail('최종등록자·최초합격자 집단을 명시해 주세요.');
  if (typeof benchmark.value !== 'number' || !Number.isFinite(benchmark.value) || benchmark.value <= 0 || benchmark.value > rule.scale) return fail('공식 입시결과 등급 값이 비어 있거나 유효하지 않습니다.');
  if (benchmark.scale !== rule.scale || benchmark.scale !== Number(profile.scale)) return fail('입시결과와 학생의 등급제가 다릅니다.');
  if (!Number.isInteger(benchmark.resultYear) || benchmark.resultYear < 1900 || benchmark.resultYear >= yearNumber(profile.year)) return fail('입시결과 학년도는 지원 학년도보다 이전이어야 합니다.');
  if (benchmark.season !== profile.season || benchmark.season !== rule.season) return fail('입시결과 모집 시기가 다릅니다.');
  if (benchmark.basisId !== program.rule + ':' + rule.year + ':' + rule.version) return fail('입시결과와 현재 환산식의 산출 기준이 다릅니다.');
  const sourceUrl = officialUrl(benchmark.sourceUrl, rule);
  if (!sourceUrl) return fail('대학 공식 HTTPS 출처 URL을 확인해 주세요.');
  if (!(typeof benchmark.sourcePage === 'string' && benchmark.sourcePage.trim()) && !(Number.isInteger(benchmark.sourcePage) && benchmark.sourcePage > 0)) return fail('공식 출처의 페이지를 명시해 주세요.');
  if (typeof benchmark.verifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(benchmark.verifiedAt) || !Number.isFinite(Date.parse(benchmark.verifiedAt)) || new Date(benchmark.verifiedAt).toISOString().slice(0, 10) !== benchmark.verifiedAt) return fail('출처 검증일을 올바르게 명시해 주세요.');
  return { ok: true, benchmark, program, rule, sourceUrl, isKuma };
}

/** Pure, fail-closed comparison. No legacy cutGpa, skill defaults, or probability. */
export function compareAdmissions(student, universities, { excludedIds = [] } = {}) {
  const result = { above: [], near: [], below: [], reference: [], pending: [] };
  const profile = student?.admissionsProfile;
  const profileCheck = profileValidation(profile);
  if (!profileCheck.ok) result.profileReason = profileCheck.reason;
  const excluded = new Set((Array.isArray(excludedIds) || excludedIds instanceof Set ? [...excludedIds] : []).filter(id => id !== null && id !== undefined).map(String));
  for (const u of Array.isArray(universities) ? universities : []) {
    if (u?.id !== undefined && excluded.has(String(u.id))) continue;
    const check = benchmarkValidation(u, profile);
    if (!check.ok) { result.pending.push({ u, reason: check.reason }); continue; }
    const rows = student?.detailedTranscript;
    if (!Array.isArray(rows) || (!rows.length && !check.isKuma) || rows.some(row => !isRecord(row))) { result.pending.push({ u, reason: '과목별 성적이 없거나 형식이 올바르지 않습니다.' }); continue; }
    const calculation = check.isKuma ? calculateKuma(rows, profile) : calculateVerified(check.program.id, rows, profile);
    if (!calculation.ok || !Number.isFinite(calculation.convertedGrade) || calculation.convertedGrade < 1 || calculation.convertedGrade > check.rule.scale) { result.pending.push({ u, reason: calculation.reason || '검증된 환산 성적을 산출할 수 없습니다.' }); continue; }
    const convertedGrade = calculation.convertedGrade;
    const margin = check.isKuma ? check.benchmark.value - convertedGrade : cleanMargin(check.benchmark.value - convertedGrade);
    const bucket = check.benchmark.metric !== 'mean' ? 'reference' : Math.abs(margin) <= NEAR_TOLERANCE + 1e-12 ? 'near' : margin > 0 ? 'above' : 'below';
    const label = check.isKuma ? '전년도 평균 대비 성적 ' + { above: '높음', near: '근접', below: '낮음' }[bucket] : bucket === 'reference' ? (check.benchmark.metric === 'minimum' ? '최저 등급 참고' : '70% 지표 참고') : { above: '평균보다 높음', near: '평균 근처', below: '평균보다 낮음' }[bucket];
    result[bucket].push({ u, benchmark: check.benchmark, convertedGrade, margin, label, sourceUrl: check.sourceUrl, calculation, ...(check.isKuma ? { confidence: calculation.confidence, note: calculation.note } : {}) });
  }
  for (const bucket of ['above', 'near', 'below', 'reference']) result[bucket].sort((a, b) => b.margin - a.margin);
  return result;
}

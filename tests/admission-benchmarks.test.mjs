import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, PROGRAMS } from '../public/admissions-web/renderer/verified-grade-engine.js';
import { benchmarkValidation, compareAdmissions, NEAR_TOLERANCE, COMPARISON_NOTE } from '../public/admissions-web/renderer/admission-benchmarks.js';

const profile = () => ({ year: 2027, season: '수시', scale: 9, schoolStatus: 'expected', complete: true });
const transcript = () => Array.from({ length: 10 }, (_, i) => ({ schoolYear: '1학년', semester: '1학기', subjectGroup: 'KOREAN', subjectType: 'COMMON', subjectName: '과목' + i, grade: 3 }));
const student = () => ({ admissionsProfile: profile(), detailedTranscript: transcript() });
function university(id = 'row-1', programId = 'jb-comic-practical', patch = {}) {
  const program = PROGRAMS.find(p => p.id === programId), rule = RULES[program.rule];
  return { id, name: rule.university, campus: rule.campus, major: program.major, admission: program.admission, year: rule.year,
    admissionBenchmark: { metric: 'mean', value: 3.5, resultYear: 2026, population: 'final-registrants', scale: 9, season: '수시', sourceUrl: rule.source, sourcePage: '70~71', verifiedAt: '2026-09-29', verificationStatus: 'verified', basisId: program.rule + ':' + rule.year + ':' + rule.version, programId, ...patch } };
}
const counted = result => ['above','near','below','reference'].reduce((n, key) => n + result[key].length, 0);
const pending = (u, s = student()) => {
  const result = compareAdmissions(s, [u]);
  assert.equal(counted(result), 0);
  assert.equal(result.pending.length, 1);
  assert.equal(typeof result.pending[0].reason, 'string');
  assert.ok(result.pending[0].reason.length);
  return result;
};

test('explicit mean buckets compare converted grades, never arbitrary raw GPA or skills', () => {
  const s = { ...student(), gpa: 9, skill: 0 };
  const rows = [university('above', undefined, { value: 3.5 }), university('near', undefined, { value: 3.2 }), university('below', undefined, { value: 2.5 })];
  const result = compareAdmissions(s, rows);
  assert.equal(result.above[0].u.id, 'above'); assert.equal(result.near[0].u.id, 'near'); assert.equal(result.below[0].u.id, 'below');
  assert.equal(result.above[0].convertedGrade, 3); assert.equal(result.above[0].margin, .5);
  assert.equal(result.above[0].label, '평균보다 높음'); assert.equal(result.below[0].label, '평균보다 낮음');
  assert.equal(result.above[0].calculation.ok, true); assert.equal(result.above[0].benchmark, rows[0].admissionBenchmark);
  assert.equal(result.above[0].sourceUrl, RULES.joongbu.source);
  assert.ok(!('probability' in result.above[0])); assert.ok(!('p' in result.above[0])); assert.equal(result.pending.length, 0);
});

test('±0.3 inclusive is an arbitrary display-only bucket, with stable rounded margins', () => {
  assert.equal(NEAR_TOLERANCE, .3); assert.match(COMPARISON_NOTE, /임의/); assert.match(COMPARISON_NOTE, /합격 가능성/);
  for (const value of [2.7, 3, 3.3]) assert.equal(compareAdmissions(student(), [university('x', undefined, { value })]).near.length, 1);
  assert.equal(compareAdmissions(student(), [university('x', undefined, { value: 3.31 })]).above.length, 1);
  assert.equal(compareAdmissions(student(), [university('x', undefined, { value: 2.69 })]).below.length, 1);
  const exact = compareAdmissions(student(), [university('x', undefined, { value: 3.3001 })]);
  assert.equal(exact.above.length, 1); assert.equal(exact.above[0].margin, .3001);
});

for (const metric of ['minimum', 'p70']) test(metric + ' is reference only, never a mean substitute', () => {
  const result = compareAdmissions(student(), [university('ref', undefined, { metric, value: 9 })]);
  assert.equal(result.reference.length, 1); assert.equal(result.above.length + result.near.length + result.below.length, 0);
  assert.equal(result.reference[0].benchmark.metric, metric); assert.match(result.reference[0].label, /참고/);
});

test('both explicitly named populations accepted, unknown population rejected', () => {
  for (const population of ['final-registrants', 'initial-admits']) assert.equal(benchmarkValidation(university('x', undefined, { population }), profile()).ok, true);
  for (const population of ['', null, 'applicants', 'registrants']) pending(university('x', undefined, { population }));
});

for (const value of [null, undefined, '', '3.5', 0, -1, 10, NaN, Infinity]) test('invalid benchmark value fails closed: ' + String(value), () => pending(university('x', undefined, { value })));
for (const field of ['metric','value','resultYear','population','scale','season','sourceUrl','sourcePage','verifiedAt','verificationStatus','basisId','programId']) test('required benchmark field: ' + field, () => {
  const u = university(); delete u.admissionBenchmark[field]; pending(u);
});

test('legacy cutGpa, acceptedStats, engine cutoff and default skills never supply a missing result', () => {
  const u = university(); delete u.admissionBenchmark;
  Object.assign(u, { cutGpa: 3.4, acceptedStats: { average: 3.5 }, sampleSkill: 95 });
  pending(u);
});

test('explicit profile is mandatory; no defaults from transcript or stored GPA', () => {
  const s = student(); delete s.admissionsProfile;
  const result = pending(university(), s); assert.ok(result.profileReason);
  for (const admissionsProfile of [null, {}, { ...profile(), complete: false }, { ...profile(), scale: 5 }, { ...profile(), year: 2028 }, { ...profile(), season: '정시' }, { ...profile(), schoolStatus: 'other' }]) assert.ok(pending(university(), { ...student(), admissionsProfile }).profileReason);
  for (const field of Object.keys(profile())) { const p = profile(); delete p[field]; pending(university(), { ...student(), admissionsProfile: p }); }
});

test('changed result year, scale, season, basis or status prevents comparison', () => {
  for (const patch of [{ resultYear: 2027 }, { resultYear: 2028 }, { resultYear: null }, { resultYear: '2026' }, { scale: 5 }, { scale: '9' }, { season: '정시' }, { basisId: 'joongbu:2026:old' }, { verificationStatus: 'pending' }, { programId: 'unknown' }]) pending(university('x', undefined, patch));
});

test('valid URL must be official HTTPS with no credentials or lookalike domain', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/plain,hello', 'https://user:secret@www.joongbu.ac.kr/report', 'https://www.joongbu.ac.kr.evil.test/report', 'https://fakejoongbu.ac.kr/report', 'https://www.seowon.ac.kr/report', 'http://www.joongbu.ac.kr/report', '/report', 'https://www.joongbu.ac.kr:8080/report', ' https://www.joongbu.ac.kr/report', 'https://www.joongbu.ac.kr/\nreport', 'https://www.joongbu.ac.kr\\@evil.test/report']) pending(university('x', undefined, { sourceUrl }));
  assert.equal(benchmarkValidation(university('x', undefined, { sourceUrl: 'https://ipsi.joongbu.ac.kr/results.pdf' }), profile()).ok, true);
});

test('source metadata is nonblank and verification date is real', () => {
  for (const patch of [{ sourcePage: null }, { sourcePage: ' ' }, { sourcePage: 0 }, { verifiedAt: '' }, { verifiedAt: 'yesterday' }, { verifiedAt: '2026-02-30' }]) pending(university('x', undefined, patch));
});

test('cannot attach a valid benchmark to wrong university, campus, major, admission or year', () => {
  for (const patch of [{ name: '다른대학교' }, { university: '다른대학교' }, { campus: '충청국제캠퍼스' }, { campus: '' }, { major: '사진영상학전공' }, { admission: '학생부우수자전형' }, { year: 2028 }, { season: '정시' }]) pending({ ...university(), ...patch });
  for (const field of ['name','campus','major','admission']) { const u = university(); delete u[field]; pending(u); }
  pending(university('x', 'jb-comic-practical', { programId: 'jb-photo-practical' }));
  pending(university('x', 'jb-photo-practical', { programId: 'jb-photo-record' }));
});

test('normalization uses exact metadata; explicit encoded campus is not inferred from plain name', () => {
  const u = { ...university(), name: ' 중부대학교 ', major: '만화 애니메이션학전공' };
  assert.equal(benchmarkValidation(u, profile()).ok, true);
  const encoded = { ...university(), name: '중부대_고양' }; delete encoded.campus;
  assert.equal(benchmarkValidation(encoded, profile()).ok, true);
  pending({ ...encoded, campus: '금산' }); pending({ ...encoded, name: '중부대' });
});

test('all eight bounded catalog programs validate, using each own official source', () => {
  for (const p of PROGRAMS) {
    const u = university(p.id, p.id);
    assert.equal(benchmarkValidation(u, profile()).ok, true, p.id);
    assert.equal(counted(compareAdmissions(student(), [u])), 1, p.id);
  }
});

test('failed calculation, missing and malformed transcript cannot recommend', () => {
  for (const detailedTranscript of [null, [], [null], ['bad'], [{ ...transcript()[0], grade: '' }], [{ ...transcript()[0], subjectType: 'UNKNOWN' }]]) pending(university(), { ...student(), detailedTranscript });
});

test('excluded IDs are hidden from every bucket, including pending, with number/string matching', () => {
  const rows = [university(1), university(2, undefined, { value: 0 }), university(3, undefined, { metric: 'minimum' }), university(4)];
  const result = compareAdmissions(student(), rows, { excludedIds: ['1', 2, '3'] });
  assert.deepEqual(result.above.map(item => item.u.id), [4]); assert.equal(result.pending.length, 0); assert.equal(result.reference.length, 0);
  assert.equal(compareAdmissions(null, rows, { excludedIds: new Set([1, 2, 3, 4]) }).pending.length, 0);
});

test('pure deterministic comparison does not mutate inputs or catalogs', () => {
  const s = student(), rows = [university('a'), university('b', undefined, { value: 5 })];
  const before = structuredClone({ s, rows, RULES, PROGRAMS });
  const a = compareAdmissions(s, rows), b = compareAdmissions(s, rows);
  assert.deepEqual(a, b); assert.deepEqual({ s, rows, RULES, PROGRAMS }, before);
  assert.deepEqual(a.above.map(item => item.u.id), ['b','a']);
});

test('empty and malformed university collections do not crash or invent comparisons', () => {
  assert.equal(counted(compareAdmissions(student(), undefined)), 0);
  assert.equal(counted(compareAdmissions(student(), {})), 0);
  assert.equal(compareAdmissions(student(), [null, {}, 'bad']).pending.length, 3);
});

// KUMA official 2026/2027 guide comparison: conditional historical best two semesters.
const kuma = (patch = {}, rowPatch = {}) => {
  const admissionBenchmark = { programId: 'kuma-best-two-2027', basisId: 'kuma:2027:20261014.1', metric: 'mean', value: 4.5, resultYear: 2026, population: 'final-registrants', scale: 9, season: '수시', sourceUrl: 'https://ipsi.kcce.or.kr/file/plan_pds/2027/2026_73109000_1781650616394.pdf', sourcePage: 45, verifiedAt: '2026-10-14', verificationStatus: 'verified', phase: '수시1', type: '실기', major: '애니메이션전공', directRecommendationEligible: true, comparisonStatus: 'conditional_same_basis_verified_across_guides', ...patch };
  return { id: 'kuma', name: '한국영상대학교', campus: '세종', year: 2027, season: '수시', major: admissionBenchmark.major, admission: admissionBenchmark.phase + ' · ' + admissionBenchmark.type, gradeRatio: 40, admissionBenchmark, ...rowPatch };
};
const kumaRow = (patch = {}) => ({ schoolYear: 1, semester: 1, subjectName: '미술', subjectGroup: 'ART', subjectType: 'COMMON', grade: 3, credits: 2, ...patch });
function kumaResult(rows, u = kuma(), p = profile()) { return compareAdmissions({ detailedTranscript: rows, admissionsProfile: p }, [u]); }
const kumaItem = result => [...result.above, ...result.near, ...result.below, ...result.reference][0];
function kumaCalculation(rows, u = kuma(), p = profile()) {
  const result = kumaResult(rows, u, p);
  assert.equal(result.pending.length, 0, result.pending[0]?.reason);
  assert.equal(counted(result), 1);
  assert.equal(result.reference.length, 0);
  return kumaItem(result).calculation;
}

test('KUMA mean display buckets have conditional confidence and no admission probability', () => {
  const result = kumaResult([kumaRow(), kumaRow({ schoolYear: 2, grade: 5 })]);
  const item = kumaItem(result); assert.equal(item.convertedGrade, 4); assert.equal(item.margin, .5);
  assert.equal(item.calculation.confidence, 'conditional');
  assert.equal(item.calculation.comparisonStatus, 'conditional_same_basis_verified_across_guides');
  assert.match(item.label, /전년도 평균 대비 성적/); assert.match(item.calculation.note, /합격확률이 아닙니다/);
  assert.ok(!('probability' in item)); assert.equal(item.calculation.selectedTerms.length, 2);
});

test('KUMA weighted semesters, equal 50% semesters, and no intermediate rounding', () => {
  const rows = [kumaRow({ grade: 1, credits: 1 }), kumaRow({ subjectName: '국어', grade: 2, credits: 2 }), kumaRow({ schoolYear: 2, grade: 4, credits: 30 })];
  const calc = kumaCalculation(rows);
  assert.equal(calc.semesters[0].convertedGrade, 5 / 3);
  assert.equal(calc.convertedGrade, (5 / 3 + 4) / 2);
  assert.notEqual(calc.convertedGrade, Math.round(calc.convertedGrade * 100) / 100);
  const item = kumaItem(kumaResult(rows)); assert.equal(item.margin, 4.5 - calc.convertedGrade);
});

test('KUMA missing semester is grade9 only with explicit five-term completion acknowledgement', () => {
  const calc = kumaCalculation([kumaRow({ grade: 1 })]);
  assert.equal(calc.convertedGrade, 5); assert.equal(calc.semesters.length, 5); assert.equal(calc.paddedCount, 1);
  assert.equal(calc.semesters.filter(s => s.padded).length, 4);
  assert.ok(kumaResult([kumaRow()], kuma(), { ...profile(), complete: false }).profileReason);
});

test('KUMA art/PE counted, only absent rank AND raw excluded regardless of subject group', () => {
  const calc = kumaCalculation([kumaRow({ grade: 2 }), kumaRow({ subjectName: '체육', grade: 4 }), kumaRow({ subjectName: '무등급', grade: '', rawScore: '', credits: null })]);
  assert.equal(calc.convertedGrade, 6); assert.equal(calc.selected.filter(r => !r.padded).length, 2);
  assert.equal(calc.excluded.length, 1); assert.match(calc.excluded[0].reason, /석차등급과 원점수가 없는/);
});

for (const [rawScore, grade] of [[100,1],[90,1],[89.9,2],[80,2],[70,3],[60,4],[50,5],[40,6],[30,7],[20,8],[19.9,9],[0,9]]) test('KUMA official raw score band ' + rawScore, () => {
  const calc = kumaCalculation([kumaRow({ grade: '', subjectType: 'CAREER', rawScore })]);
  assert.equal(calc.selected.find(r => !r.padded)?.convertedGrade, grade);
  assert.equal(calc.convertedGrade, (grade + 9) / 2);
});

test('KUMA accepts explicit achievement/specialized raw grades, not achievement letters alone', () => {
  for (const subjectType of ['CAREER','SPECIALIZED','성취','성취평가제','진로선택','전문교과']) assert.equal(kumaCalculation([kumaRow({ subjectType, grade: '', rawScore: 90 })]).convertedGrade, 5);
  const calc = kumaCalculation([kumaRow({ grade: '', rawScore: null, subjectType: 'CAREER', achievement: 'A' })]);
  assert.equal(calc.convertedGrade, 9); assert.equal(calc.excluded.length, 1);
  assert.equal(kumaResult([kumaRow({ grade: '', rawScore: 90, subjectType: 'COMMON' })]).pending.length, 1);
});

test('KUMA rejects invalid supplied grade/raw instead of silently excluding or falling back', () => {
  for (const patch of [{ grade: 0 },{ grade: 10 },{ grade: 2.5 },{ grade: 'bad' },{ grade: false },{ rawScore: -1 },{ rawScore: 101 },{ rawScore: NaN },{ rawScore: 'bad' },{ rawScore: false },{ grade: 'bad', rawScore: 90 }]) assert.equal(kumaResult([kumaRow(patch)]).pending.length, 1, JSON.stringify(patch));
});

test('KUMA requires positive included credits, never invents one unit', () => {
  for (const credits of [null, undefined, '', ' ', 0, -1, NaN, Infinity, false, 'abc']) assert.equal(kumaResult([kumaRow({ credits })]).pending.length, 1, String(credits));
  assert.equal(kumaCalculation([kumaRow({ grade: '2', credits: '3' })]).convertedGrade, 5.5);
});

test('KUMA validates names and terms and rejects same-term duplicates', () => {
  for (const patch of [{ subjectName: '' },{ subjectName: null },{ schoolYear: '' },{ schoolYear: 4 },{ semester: 3 },{ semester: false }]) assert.equal(kumaResult([kumaRow(patch)]).pending.length, 1);
  assert.equal(kumaResult([kumaRow(), kumaRow({ subjectName: ' 미 술 ' })]).pending.length, 1);
  assert.equal(kumaCalculation([kumaRow(), kumaRow({ semester: 2 })]).convertedGrade, 3);
});

test('KUMA fixed five semesters for both graduates and expected; 3-2 never selected', () => {
  const rows = [kumaRow({ grade: 4 }), kumaRow({ schoolYear: 3, semester: 1, grade: 2 }), kumaRow({ schoolYear: 3, semester: 2, grade: 1 })];
  for (const schoolStatus of ['expected','graduate']) {
    const calc = kumaCalculation(rows, kuma(), { ...profile(), schoolStatus });
    assert.equal(calc.convertedGrade, 3); assert.deepEqual(calc.selectedTerms, ['3:1','1:1']); assert.match(calc.excluded[0].reason, /반영 학기 밖/);
  }
});

test('KUMA strict provenance blocks legacy school/admission strings, wrong campus/major/season/year', () => {
  for (const patch of [{ name: '한국영상대' },{ campus: '' },{ campus: '공주' },{ major: '애니메이션학과' },{ admission: '실기' },{ admission: '수시1·실기' },{ year: 2028 },{ season: '정시' }]) assert.equal(kumaResult([kumaRow()], kuma({}, patch)).pending.length, 1);
  for (const patch of [{ major: '임의학과' },{ phase: '수시3' },{ type: '종합' },{ basisId: 'kuma:2026:old' },{ comparisonStatus: 'assumed' },{ population: 'initial-admits' },{ metric: 'minimum' },{ resultYear: 2025 }]) assert.equal(kumaResult([kumaRow()], kuma(patch)).pending.length, 1);
  for (const phase of ['수시1','수시2']) for (const type of ['학생부','면접','실기']) assert.equal(counted(kumaResult([kumaRow()], kuma({ phase, type }))), 1);
});

test('KUMA strict eligibility, zero grade cohort and SMU mismatches have informative reasons before program lookup', () => {
  for (const directRecommendationEligible of [false, null, undefined, 'true']) assert.equal(kumaResult([kumaRow()], kuma({ directRecommendationEligible })).pending.length, 1);
  for (const gradeRatio of [0, null, undefined, '', -1, NaN, 101]) assert.equal(kumaResult([kumaRow()], kuma({}, { gradeRatio })).pending.length, 1);
  const arts = kumaResult([kumaRow()], kuma({ major: '만화웹툰전공', directRecommendationEligible: false }, { gradeRatio: 0 })); assert.match(arts.pending[0].reason, /실기 100%/);
  const smu = compareAdmissions(student(), [{ id: 'smu', admissionBenchmark: { programId: 'smu-old', directRecommendationEligible: false, comparisonStatus: 'different_basis' } }]); assert.match(smu.pending[0].reason, /환산 기준이 달라/);
});

test('KUMA URL and metadata guards remain strict and profile never assumed', () => {
  for (const sourceUrl of ['javascript:alert(1)','https://user:pw@ipsi.kcce.or.kr/file.pdf','http://ipsi.kcce.or.kr/file.pdf','https://ipsi.kcce.or.kr.evil.test/file.pdf','https://sub.ipsi.kcce.or.kr/file.pdf']) assert.equal(kumaResult([kumaRow()], kuma({ sourceUrl })).pending.length, 1);
  for (const patch of [{ scale: 5 },{ year: 2028 },{ complete: false },{ schoolStatus: 'other' }]) assert.equal(kumaResult([kumaRow()], kuma(), { ...profile(), ...patch }).pending.length, 1);
  assert.equal(compareAdmissions({ detailedTranscript: [kumaRow()] }, [kuma()]).pending.length, 1);
});

test('KUMA inputs are immutable and excluded IDs hide references and pending rows', () => {
  const s = { detailedTranscript: [kumaRow()], admissionsProfile: profile() }, rows = [kuma()];
  const before = structuredClone({ s, rows }); compareAdmissions(s, rows); assert.deepEqual({ s, rows }, before);
  assert.equal(counted(compareAdmissions(s, rows, { excludedIds: ['kuma'] })), 0);
  assert.equal(compareAdmissions(s, [kuma({ directRecommendationEligible: false })], { excludedIds: ['kuma'] }).pending.length, 0);
});

test('KUMA mean margin display buckets are not probability and respect exact tolerance', () => {
  const rows = [kumaRow({ grade: 3 }), kumaRow({ schoolYear: 2, grade: 3 })];
  for (const [value, bucket, label] of [[3.5,'above','높음'],[3.3,'near','근접'],[2.7,'near','근접'],[2.5,'below','낮음']]) {
    const result = kumaResult(rows, kuma({ value })); assert.equal(result[bucket].length, 1); assert.equal(result[bucket][0].label, '전년도 평균 대비 성적 ' + label);
    assert.equal(result[bucket][0].confidence, 'conditional'); assert.match(result[bucket][0].note, /과거 최종등록자 평균 참고/);
  }
});

test('KUMA explicit complete empty transcript pads all five terms, but absent transcript never does', () => {
  const calc = kumaCalculation([]); assert.equal(calc.convertedGrade, 9); assert.equal(calc.paddedCount, 2); assert.ok(calc.semesters.every(term => term.padded));
  assert.equal(kumaResult(undefined).pending.length, 1);
  assert.equal(kumaResult([], kuma(), { ...profile(), complete: false }).pending.length, 1);
});

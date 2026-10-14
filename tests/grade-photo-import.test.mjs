import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';

// The browser module is a classic script that sets window.GradePhotoImport; run it in a bare context.
const source = readFileSync(new URL('../public/admissions-web/renderer/grade-photo-import.js', import.meta.url), 'utf8');
const context = { window: {}, document: {}, setTimeout, console };
vm.runInNewContext(source, context);
const api = context.window.GradePhotoImport._test;
const plain = v => JSON.parse(JSON.stringify(v)); // objects made inside the vm have another realm's prototypes
const { expectedGrade, nameKey, subjectKey } = api;
const validate = (...a) => plain(api.validate(...a)), mergeInto = (...a) => plain(api.mergeInto(...a)), fillTermGrades = (...a) => plain(api.fillTermGrades(...a));

const reading = (rows, extra = {}) => ({ kind: 'report', studentName: '', school: '가상고', gradeScale: '5등급', uncertain: [], rows, ...extra });
const row = o => ({ schoolYear: '1학년', semester: '1학기', subjectGroup: 'KOREAN', subjectName: '공통국어1', subjectType: 'COMMON', credits: '4', grade: '', rawScore: '', averageScore: '', standardDeviation: '', achievement: '', rank: '', studentCount: '', notes: '', uncertainFields: [], ...o });

test('석차/수강자수 → 석차등급 uses rounded cumulative headcount (5등급제·9등급제)', () => {
  assert.equal(expectedGrade(16, 156, 5), 1);
  assert.equal(expectedGrade(53, 156, 5), 2);
  assert.equal(expectedGrade(61, 156, 5), 3);
  assert.equal(expectedGrade(145, 161, 5), 4); // 161×0.9 = 144.9 → 145명까지 4등급
  assert.equal(expectedGrade(198, 277, 9), 6);
  assert.equal(expectedGrade(252, 277, 9), 8);
  assert.equal(expectedGrade('', 277, 9), null);
  assert.equal(expectedGrade(300, 277, 9), null);
});

test('folder and subject names are matched loosely', () => {
  assert.equal(nameKey('김은유(검정고시)'), nameKey('김은유'));
  assert.equal(nameKey('김혜진-'), '김혜진');
  assert.equal(subjectKey('영어 Ⅰ'), subjectKey('영어I'));
  assert.equal(subjectKey('사회·문화'), subjectKey('사회문화'));
});

test('validate flags doubtful cells and grades that disagree with 석차', () => {
  const issues = validate(row({ grade: '2', rank: '61', studentCount: '156', uncertainFields: ['rawScore'], rawScore: '7?' }), 5);
  assert.deepEqual(issues.map(i => [i.kind, i.field]), [['warn', 'rawScore'], ['error', 'grade']]);
  assert.equal(validate(row({ grade: '3', rank: '61', studentCount: '156' }), 5).length, 0);
  assert.equal(validate(row({ grade: '7' }), 5)[0].kind, 'error');
});

test('merge adds new subjects, fills empty cells, never overwrites an entered value', () => {
  const student = { id: 7, entryYear: 2025, detailedTranscript: [{ id: 'dt1', ...row({ grade: '3', rawScore: '76', averageScore: '' }) }] };
  const out = mergeInto(student, [{ reportId: 'r1', reading: reading([
    row({ grade: '2', rawScore: '76', averageScore: '72.6' }),
    row({ subjectGroup: 'MATH', subjectName: '공통수학1', grade: '3', rank: '61', studentCount: '156' }),
  ]) }]);
  const korean = out.rows.find(r => r.subjectName === '공통국어1');
  assert.equal(korean.grade, '3');            // kept
  assert.equal(korean.averageScore, '72.6');  // filled
  assert.equal(out.added.length, 1);
  assert.deepEqual(out.review.map(r => [r.kind, r.field, r.value, r.incoming]), [['diff', 'grade', '3', '2']]);
});

test('the same doubt read from two photos is listed once', () => {
  const student = { id: 7, entryYear: 2025, detailedTranscript: [] };
  const photo = reading([row({ grade: '2', uncertainFields: ['grade'] })]);
  const out = mergeInto(student, [{ reportId: 'a', reading: photo }, { reportId: 'b', reading: photo }]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.review.length, 1);
});

test('간편 성적 fills only empty semesters, credit-weighted, 한국사 counted as 사회', () => {
  const rows = [
    row({ subjectGroup: 'KOREAN', grade: '2', credits: '4' }),
    row({ subjectGroup: 'SOCIAL', subjectName: '통합사회1', grade: '1', credits: '4' }),
    row({ subjectGroup: 'KOREAN_HISTORY', subjectName: '한국사1', grade: '4', credits: '2' }),
    row({ semester: '2학기', subjectGroup: 'KOREAN', subjectName: '공통국어2', grade: '5' }),
  ];
  const student = { termGrades: { grade1: { semester2: { korean: 1, english: '', math: '', social: '', science: '' } } }, gpa: '' };
  const out = fillTermGrades(student, rows);
  assert.deepEqual(out.filled, ['1-1']);
  assert.equal(out.termGrades.grade1.semester1.social, 2);
  assert.equal(out.termGrades.grade1.semester2.korean, 1);
  assert.equal(out.gpa, 2.86); // (2×4 + 1×4 + 4×2 + 5×4) ÷ 14
  assert.equal(fillTermGrades({ gpa: 3.1 }, rows).gpa, null);
});

test('server keeps only known codes and drops rows from non-report photos', async () => {
  const bundle = await build({ stdin: { contents: "export { cleanReading } from './worker/admission-grade-photos.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { cleanReading } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const out = cleanReading({ kind: 'report', studentName: ' 강 수연 ', gradeScale: '5등급', uncertain: ['기울어짐'], rows: [
    { schoolYear: '1학년', semester: '1학기', subjectGroup: 'NOPE', subjectName: '공통국어1', subjectType: 'COMMON', grade: '3', uncertainFields: ['grade', 'evil'] },
    { subjectName: '' },
  ] });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].subjectGroup, 'ETC');
  assert.deepEqual(out.rows[0].uncertainFields, ['grade']);
  assert.equal(cleanReading({ kind: 'artwork', rows: [{ subjectName: 'x' }] }).rows.length, 0);
});

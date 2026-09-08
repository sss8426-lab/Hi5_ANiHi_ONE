import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { searchCareers, matchServerGoal, programView, filterPrograms, admissionTrend, percent, safeUrl } from '../public/data-core/roadmap-model.js';

const context = { window: {} };
const source = fs.readFileSync('public/data-core/roadmap-content.js', 'utf8');
vm.runInNewContext(source, context);
const content = JSON.parse(JSON.stringify(context.window.HI5_ROADMAP_CONTENT));
const verified = (override = {}) => ({ id: 'synthetic-program', name: '합성 디자인학과', metadata: {
  universityName: '합성 테스트대학', major: '합성 디자인학과', year: '2027', gradeRatio: 30, skillRatio: 70,
  officialSourceUrl: 'https://admissions.example.edu/2027.pdf', verificationStatus: 'approved', verifiedAt: '2026-09-03',
  region: '테스트지역', schoolType: '4년제', admission: '수시', practicalType: '포트폴리오', ...override,
} });

test('35 source careers map to existing summary tracks without publishing private monthly plans', () => {
  assert.equal(content.careers.length, 35);
  assert.equal(content.tracks.length, 22);
  assert.equal(new Set(content.careers.map((c) => c.id)).size, 35);
  for (const career of content.careers) {
    assert.ok(content.tracks.some((t) => t.id === career.trackId));
    assert.ok(career.majors.length && career.foundation.length && career.specialization.length);
    assert.ok(career.outcome && career.art >= 0 && career.art < 12);
    assert.equal(career.verificationStatus, 'reference-only');
  }
  assert.equal(content.internalSummary.monthlyPlanCount, 792);
  assert.equal(content.internalSummary.monthlyPlansPublished, false);
  assert.doesNotMatch(source, /주차별 세부수업|월간 루브릭|진급조건|평가루브릭|C0001/);
});

test('career search supports aliases and majors inside the selected family', () => {
  assert.equal(searchCareers(content.careers, 'UI·UX 디자이너', 'design')[0].id, 'D022');
  assert.equal(searchCareers(content.careers, '캐릭터원화가', 'story')[0].id, 'D010');
  assert.equal(searchCareers(content.careers, '패션', 'story').length, 0);
  assert.equal(searchCareers(content.careers, '없는합성직업').length, 0);
  assert.equal(searchCareers(content.careers, '', 'story').length, 16);
  assert.equal(searchCareers(content.careers, '', 'design').length, 19);
});

test('exact identity prevents a broad substring from binding to an unrelated career graph', () => {
  const career = content.careers.find((c) => c.id === 'D010');
  assert.equal(matchServerGoal(career, [{ name: '디자이너', id: 'wrong' }]), undefined);
  assert.equal(matchServerGoal(career, [{ name: '게임 캐릭터 디자이너', id: 'expected' }]).id, 'expected');
});

test('unreviewed, missing-year, missing-date, or unsafe-source ratios are not presented', () => {
  for (const override of [{ verificationStatus: 'draft' }, { year: '' }, { verifiedAt: '' }, { verifiedAt: 'invalid' }, { verifiedAt: '2026-02-30' },
    { officialSourceUrl: 'javascript:alert(1)' }, { officialSourceUrl: '' }]) {
    const row = programView(verified(override));
    assert.equal(row.verified, false);
    assert.equal(row.grade, null);
    assert.equal(row.skill, null);
    assert.equal(admissionTrend([row]), null);
  }
});

test('valid zero is preserved while impossible or missing ratio pairs never enter averages', () => {
  assert.equal(programView(verified({ gradeRatio: 0, skillRatio: 100 })).grade, 0);
  for (const [gradeRatio, skillRatio] of [[80, 80], [-1, 50], ['', 50], [null, 50], [true, 50], [50, Infinity], [[20], 50]]) {
    const row = programView(verified({ gradeRatio, skillRatio }));
    assert.equal(row.grade, null);
    assert.equal(row.skill, null);
  }
  assert.equal(percent('0'), 0);
  assert.equal(safeUrl('data:text/html,test'), '');
});

test('filters combine region, school type, term and verified emphasis without treating unknowns as zero', () => {
  const rows = [programView(verified()), programView(verified({ region: '다른지역', gradeRatio: 80, skillRatio: 20 })), programView(verified({ verificationStatus: 'pending' }))];
  assert.equal(filterPrograms(rows, { region: '테스트지역', schoolType: '4년제', admission: '수시', focus: 'practical' }).length, 1);
  assert.equal(filterPrograms(rows, { admission: '정시' }).length, 0);
  assert.equal(filterPrograms(rows, { focus: 'portfolio' }).length, 2);
  assert.equal(filterPrograms(rows, { focus: 'academic' }).length, 1);
});

test('sample trend only averages verified latest-year unique university program methods', () => {
  const current = programView(verified());
  const other = programView(verified({ universityName: '다른 합성대학', gradeRatio: 50, skillRatio: 40 }));
  const older = programView(verified({ year: '2025', gradeRatio: 100, skillRatio: 0 }));
  assert.deepEqual(admissionTrend([current, current, other, older]), { count: 2, year: '2027', grade: 40, skill: 55 });
  assert.equal(admissionTrend([]), null);
});

test('program presentation is an allowlist and never carries unrelated personal metadata', () => {
  const row = programView(verified({ studentName: 'SYNTHETIC_PRIVATE', guardianPhone: 'SYNTHETIC_PHONE', requiredScores: { privateNote: 'SYNTHETIC_NOTE' } }));
  assert.doesNotMatch(JSON.stringify(row), /SYNTHETIC_|studentName|guardianPhone|requiredScores/);
});

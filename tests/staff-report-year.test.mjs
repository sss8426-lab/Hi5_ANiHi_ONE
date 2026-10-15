import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

// 월간 업무보고 연간 합계 (2026-10-15). Synthetic reports only.
const report = (h, user, campusId, month, joins, leaves, awards = []) => h.request('POST', '/api/data-core/staff-reports', user,
  { month, campusId, done: [{ category: '수업', text: '진행' }], joins, leaves, awards });

test('연간 합계: 1월~12월 신입·퇴원·수상, 달마다 합계, 신입·수상 1위 선생님 (캠퍼스로 골라 보기)', async () => {
  const h = await libraryHarness();
  try {
    assert.equal((await report(h, users.teacher, A, '2026-01', { 고1: 2, 중3: 1 }, { 고3: 1 }, [{ contest: '대회', prize: '대상', count: 2 }, { contest: '대회2', prize: '입선', count: 0 }])).status, 200);
    assert.equal((await report(h, users.staff, A, '2026-02', { 초: 5 }, {})).status, 200);
    assert.equal((await report(h, users.foreign, B, '2026-09', { 중1: 1 }, { 중2: 2 }, [{ contest: '대회3', prize: '금상', count: 1 }])).status, 200);
    assert.equal((await report(h, users.teacher, A, '2025-12', { 고1: 9 }, {})).status, 200, '작년 보고는 빠진다');

    const year = await h.request('GET', '/api/data-core/staff-reports/year?year=2026', users.foreign);
    assert.equal(year.status, 200, JSON.stringify(year.body));
    assert.deepEqual(year.body.totals, { joins: 9, leaves: 3, awards: 4 }, '수상 인원이 비어 있으면 1건으로 센다');
    assert.equal(year.body.months.length, 12); assert.equal(year.body.reports, 3);
    assert.deepEqual(year.body.months[0], { month: '2026-01', reports: 1, joins: 3, leaves: 1, awards: 3 });
    assert.deepEqual(year.body.months[8], { month: '2026-09', reports: 1, joins: 1, leaves: 2, awards: 1 });
    assert.deepEqual(year.body.topJoins.map(p => p.count), [5]); assert.ok(year.body.topJoins[0].campusName);
    assert.deepEqual(year.body.topAwards.map(p => p.count), [3]);

    const onlyB = await h.request('GET', `/api/data-core/staff-reports/year?year=2026&campusId=${B}`, users.teacher);
    assert.deepEqual(onlyB.body.totals, { joins: 1, leaves: 2, awards: 1 });
    assert.equal((await h.request('GET', '/api/data-core/staff-reports/year?year=26', users.teacher)).status, 400);
    assert.equal((await h.request('GET', '/api/data-core/staff-reports/year?year=2026', users.outsider)).status, 403);
  } finally { await h.mf.dispose(); }
});

test('화면: 월 합계 위에 연간 합계 카드', () => {
  const html = fs.readFileSync('public/data-core/reports.html', 'utf8'), js = fs.readFileSync('public/data-core/reports.js', 'utf8');
  assert.ok(html.indexOf('id="reportYear"') > 0 && html.indexOf('id="reportYear"') < html.indexOf('id="reportTotals"'));
  assert.match(html, /reports\.js\?v=20261015-year/);
  assert.match(js, /신입', '🏅'/); assert.match(js, /수상·입상', '🏆'/); assert.match(js, /월별 보기/);
});

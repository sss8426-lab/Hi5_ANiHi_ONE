import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { multiSlotFixture } from './helpers/attendance-multi-slot-fixture.mjs';
import { analyzeWorkbook, openTemplate, generateWorkbook, weekdaySlotPolicy, targetCalendarColumns } from '../public/data-core/work/attendance-auto.js';
import { all, attr, indexSheet, cellRef, range, calendarMonth, textOf, styleEngine, mostCommon } from '../public/data-core/work/attendance-template.js';

const env = { DOMParser, XMLSerializer };
const read = (opts) => {
  const source = multiSlotFixture(opts), t = openTemplate(source.bytes, env);
  const year = opts.year ?? 2026, month = opts.month ?? 9;
  const a = analyzeWorkbook(t, `출석부${String(year).slice(-2)}.${String(month).padStart(2, '0')}_.xlsx`);
  return { t, a };
};

test('TYPE A(병합 헤더): 토 3칸/일 2칸을 인식하고, 10월로 생성하면 요일 기준으로 물리 열이 재배치된다', () => {
  const { t, a } = read({ year: 2026, month: 9, weekendMode: 'merged', saturdaySlots: 3, sundaySlots: 2 });
  const s = a.sheets[0];
  assert.equal(s.headerMode, 'merged');
  // Source recognition: every Saturday/Sunday in the source month got the configured slot count.
  const sourceCalendar = calendarMonth(2026, 9);
  const bySourceDay = new Map(); for (const d of s.dateColumns) bySourceDay.set(d.day, (bySourceDay.get(d.day) || 0) + 1);
  for (let day = 1; day <= 28; day++) {
    const wd = sourceCalendar[day - 1].weekdayIndex;
    assert.equal(bySourceDay.get(day), wd === 6 ? 3 : wd === 0 ? 2 : 1, `source day ${day} (weekday ${wd}) slot count`);
  }

  const g = generateWorkbook(t, a, { year: 2026, month: 10 });
  const r = g.results[0], grid = indexSheet(r.sheet);
  const policy = weekdaySlotPolicy(s.dateColumns, sourceCalendar);
  assert.deepEqual(policy, { 0: 2, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 3 });
  const expected = targetCalendarColumns(2026, 10, policy);
  assert.equal(r.mapping.dateColumns.length, expected.length);

  // 2026-10-03 is a Saturday, 10-04 a Sunday, 10-05 a Monday: the physical column layout must
  // follow the *target* month's calendar, not the day-numbers the source happened to use.
  const targetCalendar = calendarMonth(2026, 10);
  assert.equal(targetCalendar[2].weekday, '토'); assert.equal(targetCalendar[3].weekday, '일'); assert.equal(targetCalendar[4].weekday, '월');
  const saturdayCols = r.mapping.dateColumns.filter(d => d.day === 3);
  const sundayCols = r.mapping.dateColumns.filter(d => d.day === 4);
  const mondayCols = r.mapping.dateColumns.filter(d => d.day === 5);
  assert.equal(saturdayCols.length, 3); assert.equal(sundayCols.length, 2); assert.equal(mondayCols.length, 1);

  // Merged header style is preserved: the multi-slot groups are real mergeCells in the output,
  // and only the anchor column carries the date/weekday text.
  const merges = all(r.sheet, 'mergeCell').map(n => range(attr(n, 'ref')));
  const satMerge = merges.find(m => m.r === r.mapping.dateRow && m.c === saturdayCols[0].c && m.end.c === saturdayCols.at(-1).c);
  assert.ok(satMerge, 'Saturday date-row merge exists at the new column position');
  assert.equal(textOf(grid.cells.get(cellRef(saturdayCols[0].c, r.mapping.dateRow)), t.strings), '3');
  assert.equal(textOf(grid.cells.get(cellRef(saturdayCols[1].c, r.mapping.dateRow)), t.strings), '');
  assert.equal(textOf(grid.cells.get(cellRef(saturdayCols[0].c, r.mapping.weekdayRow)), t.strings), '토');
  assert.equal(textOf(grid.cells.get(cellRef(mondayCols[0].c, r.mapping.dateRow)), t.strings), '5');

  // Re-opening the generated workbook must still recognize it (round-trip), and the print area
  // grew to the new, wider calendar.
  const reopened = analyzeWorkbook(openTemplate(g.bytes, env), '출석부26.10_.xlsx');
  assert.equal(reopened.month, 10); assert.equal(reopened.sheets[0].headerMode, 'merged');
});

test('TYPE B(반복 헤더): 토 3칸/일 1칸 구조가 다음 달에도 반복 스타일로 유지된다', () => {
  const { t, a } = read({ year: 2026, month: 9, weekendMode: 'repeated', saturdaySlots: 3, sundaySlots: 1 });
  assert.equal(a.sheets[0].headerMode, 'repeated');
  const g = generateWorkbook(t, a, { year: 2026, month: 10 });
  const r = g.results[0], grid = indexSheet(r.sheet);
  const saturdayCols = r.mapping.dateColumns.filter(d => d.day === 3);
  assert.equal(saturdayCols.length, 3);
  // Repeated style: every column in the group carries its own literal value, no merge created.
  for (const col of saturdayCols) assert.equal(textOf(grid.cells.get(cellRef(col.c, r.mapping.dateRow)), t.strings), '3');
  const merges = all(r.sheet, 'mergeCell').map(n => range(attr(n, 'ref')));
  assert.equal(merges.some(m => m.r === r.mapping.dateRow && m.c === saturdayCols[0].c), false);
});

test('TYPE C(휴원 예외): 토요일 하나만 1칸이어도 요일 정책은 다수결로 3칸을 유지하고, 다음 달 모든 토요일에 적용된다', () => {
  // 2026-09-19 is a Saturday within days 1-28; force it down to a single column.
  const { t, a } = read({ year: 2026, month: 9, weekendMode: 'repeated', saturdaySlots: 3, holidayDay: 19 });
  const s = a.sheets[0], calendar = calendarMonth(2026, 9);
  assert.equal(calendar[18].weekday, '토');
  const policy = weekdaySlotPolicy(s.dateColumns, calendar);
  assert.equal(policy[6], 3, '3 of 4 Saturdays still vote for 3 slots; the one holiday exception does not win');

  const g = generateWorkbook(t, a, { year: 2026, month: 10 });
  const r = g.results[0];
  const targetCalendar = calendarMonth(2026, 10);
  for (const d of targetCalendar) if (d.active && d.weekdayIndex === 6) {
    const cols = r.mapping.dateColumns.filter(c => c.day === d.day);
    assert.equal(cols.length, 3, `target day ${d.day} (a Saturday) must use the regular 3-slot policy, not the source's one-off exception`);
  }
});

test('학생별 토요일 slot(0/1/2)과 일요일 slot이 재배치 후에도 그대로 보존된다', () => {
  const { t, a } = read({ year: 2026, month: 9, weekendMode: 'merged', saturdaySlots: 3, sundaySlots: 2, students: 10 });
  const g = generateWorkbook(t, a, { year: 2026, month: 10 });
  const r = g.results[0], grid = indexSheet(r.sheet), calendar = calendarMonth(2026, 10);
  // The generator marks a student's lesson days by cell fill (highlight), not by writing a text
  // value — the regenerated month is blank and ready for the teacher to check off. So "which slot
  // is this student's lesson" must be read from which columns got the non-default (lesson) fill.
  const se = styleEngine(r.styles, r.template);
  const markedSlots = (row) => {
    const active = r.mapping.dateColumns.filter(d => calendar[d.day - 1].active);
    const fills = active.map(d => se.fillId(grid.cells.get(cellRef(d.c, row))));
    const plain = mostCommon(fills, 0);
    const marks = new Set();
    active.forEach((d, i) => { if (fills[i] !== plain) marks.add(`${calendar[d.day - 1].weekdayIndex}:${d.slot}`); });
    return marks;
  };
  // Students 1,2,3 (rows 5,6,7 = i=1,2,3) are the Saturday slot 0/1/2 students from the fixture plan.
  assert.deepEqual([...markedSlots(5)].every(k => k === '6:0'), true);
  assert.ok(markedSlots(5).size > 0);
  assert.deepEqual([...markedSlots(6)].every(k => k === '6:1'), true);
  assert.ok(markedSlots(6).size > 0);
  assert.deepEqual([...markedSlots(7)].every(k => k === '6:2'), true);
  assert.ok(markedSlots(7).size > 0);
  // Student 4 (row 8) is the Sunday slot 0 student.
  assert.deepEqual([...markedSlots(8)].every(k => k === '0:0'), true);
  assert.ok(markedSlots(8).size > 0);
});

test('컬럼 폭이 줄어드는 달(2026-08 → 2027-02)에서도 안전하게 축소되고 재인식된다', () => {
  // Days 1-28 of any month always contain each weekday exactly 4 times (4 complete weeks), so a
  // month's *own* physical width beyond that fixed baseline comes entirely from its trailing days
  // (29-31). August 2026 ends on Sat/Sun/Mon (2026-08-29/30/31), which under a Sat=3/Sun=2 policy
  // pushes its trailing days to the maximum possible width; February 2027 (28 days, no trailing
  // days at all) sits at the minimum possible width. That combination guarantees a real shrink.
  const { t, a } = read({ year: 2026, month: 8, weekendMode: 'merged', saturdaySlots: 3, sundaySlots: 2 });
  const s = a.sheets[0], sourceCalendar = calendarMonth(2026, 8);
  assert.equal(sourceCalendar[28].weekday, '토'); assert.equal(sourceCalendar[29].weekday, '일'); assert.equal(sourceCalendar[30].weekday, '월');
  const policy = weekdaySlotPolicy(s.dateColumns, sourceCalendar);
  const expected = targetCalendarColumns(2027, 2, policy);
  assert.ok(expected.length < s.dateColumns.length, 'a 28-day February with the same weekday policy must need fewer physical columns than the 31-day source ending on a Saturday/Sunday');

  const g = generateWorkbook(t, a, { year: 2027, month: 2 });
  const r = g.results[0];
  assert.equal(r.mapping.dateColumns.length, expected.length);
  assert.equal(r.mapping.area.end.c, s.area.end.c + (expected.length - s.dateColumns.length));

  // Round-trips and stays recognizable after shrinking.
  const reopened = analyzeWorkbook(openTemplate(g.bytes, env), '출석부27.02_.xlsx');
  assert.equal(reopened.month, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../public/data-core/vendor/fflate-0.8.3.js';
import { realWorldFixture } from './helpers/attendance-real-world-fixture.mjs';
import { analyzeWorkbook, openTemplate, generateWorkbook, nextMonth } from '../public/data-core/work/attendance-auto.js';

const env = { DOMParser, XMLSerializer };
const analyze = (opts) => analyzeWorkbook(openTemplate(realWorldFixture(opts), env), 'SYNTHETIC.xlsx');
// Replaces (or, if absent, inserts into its row) a single cell's content with a formula — the
// same raw-XML-surgery technique already used elsewhere in this suite to make one narrow, targeted
// structural change without rebuilding a whole fixture generator.
function withFormula(bytes, ref, formulaText) {
  const files = unzipSync(bytes), xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const cellPattern = new RegExp(`<c r="${ref}"[^>]*>.*?</c>|<c r="${ref}"[^>]*/>`);
  const replaced = cellPattern.test(xml)
    ? xml.replace(cellPattern, `<c r="${ref}" s="1"><f>${formulaText}</f></c>`)
    : xml.replace(new RegExp(`(<row r="${ref.match(/\d+$/)[0]}"[^>]*>)(.*?)(</row>)`), (_m, open, body, close) => `${open}${body}<c r="${ref}" s="1"><f>${formulaText}</f></c>${close}`);
  files['xl/worksheets/sheet1.xml'] = strToU8(replaced);
  return zipSync(files);
}

// Regression fixtures for structurally different real-world exports found only after testing
// against actual (never-committed) attendance files, distinct from the synthetic shapes already
// covered elsewhere. Each reproduces one specific cause, not a hardcoded copy of any real file.

test('a source month whose physical calendar stops exactly at its own last day (no day-31 placeholder) is still recognized', () => {
  // 2026-09 has 30 real days; this fixture never writes a 31st physical day column at all, unlike
  // templates that always reserve a spare day-31 slot.
  const a = analyze({ year: 2026, month: 9, days: 30 });
  assert.equal(a.year, 2026); assert.equal(a.month, 9);
  assert.equal(a.sheets[0].dateColumns.length, 30);
  assert.equal(a.sheets[0].dateColumns.at(-1).day, 30);
});

test("Excel's built-in text-contains/begins-with conditional formatting rules are recognized, not just literal cellIs rules", () => {
  for (const type of ['containsText', 'beginsWith', 'notContainsText', 'endsWith']) {
    const a = analyze({ cfRuleType: type, cfRuleText: '출석' });
    assert.equal(a.sheets.length, 1, `${type} rule must not block recognition`);
  }
});

test('a title using academic-year phrasing ("2026학년도 9월") is still recognized as year 2026, month 9', () => {
  const a = analyze({ titleText: '2026학년도 9월 출석부' });
  assert.equal(a.year, 2026); assert.equal(a.month, 9);
});

test('a stale <dimension>/Print_Area that under-reports the real used range never hides real students', () => {
  const a = analyze({ students: 3, areaShrink: 5 });
  assert.equal(a.sheets[0].studentBlocks.filter(b => b.name).length, 3);
});

// dateStart is 4 (column D) in realWorldFixture; September 2026 (30 days) -> October 2026 (31 days)
// always needs one extra physical column, so generating October always forces the reshape branch.
const FORMULA_MSG = /수식이 있는 양식을 지원하지 않습니다/;
test('a formula confined to the student-info columns (own cell and every reference before the calendar) no longer blocks a month that needs the calendar to reshape', () => {
  const bytes = withFormula(realWorldFixture({ year: 2026, month: 9 }), 'A4', 'ROW(A1)+2');
  const t = openTemplate(bytes, env), a = analyzeWorkbook(t, 'SYNTHETIC.xlsx');
  const weekdays = Object.fromEntries(a.sheets[0].studentBlocks.map(b => [b.id, '월수금']));
  const g = generateWorkbook(t, a, { ...nextMonth(2026, 9), weekdays });
  assert.equal(g.results[0].mapping.dateColumns.length, 31, 'reshape actually happened (30 -> 31 columns)');
  const fNode = [...g.results[0].sheet.getElementsByTagNameNS('*', 'f')].find(n => n.parentNode.getAttribute('r') === 'A4');
  assert.equal(fNode.textContent, 'ROW(A1)+2', 'formula text preserved verbatim');
});

test('a formula that references a calendar column still blocks a reshaping month, even though its own cell is pre-calendar', () => {
  const bytes = withFormula(realWorldFixture({ year: 2026, month: 9 }), 'A4', 'SUM(D4:D10)');
  const t = openTemplate(bytes, env), a = analyzeWorkbook(t, 'SYNTHETIC.xlsx');
  assert.throws(() => generateWorkbook(t, a, nextMonth(2026, 9)), FORMULA_MSG);
});

test('a formula whose own cell sits in the trailing (post-calendar) region still blocks a reshaping month, even if it references nothing risky', () => {
  const bytes = withFormula(realWorldFixture({ year: 2026, month: 9 }), 'AJ4', 'ROW(A1)');
  const t = openTemplate(bytes, env), a = analyzeWorkbook(t, 'SYNTHETIC.xlsx');
  assert.throws(() => generateWorkbook(t, a, nextMonth(2026, 9)), FORMULA_MSG);
});

test('a formula referencing another sheet still blocks a reshaping month, even from an otherwise-safe pre-calendar cell', () => {
  const bytes = withFormula(realWorldFixture({ year: 2026, month: 9 }), 'A4', 'Sheet2!A1');
  const t = openTemplate(bytes, env), a = analyzeWorkbook(t, 'SYNTHETIC.xlsx');
  assert.throws(() => generateWorkbook(t, a, nextMonth(2026, 9)), FORMULA_MSG);
});

test('a month that does not need the calendar to reshape still generates fine with a calendar-referencing formula (the guard only applies when columns actually move)', () => {
  // A single-slot source already at the full 31 physical columns (August 2026) always regenerates
  // at 31 columns for any target month too (calendarMonth() is always a fixed 31-day grid and the
  // policy is uniformly 1 slot/weekday here), so delta is guaranteed 0 and reshapeCalendar's guard
  // is never even reached — exactly the case this guard must stay out of.
  const bytes = withFormula(realWorldFixture({ year: 2026, month: 8 }), 'A4', 'SUM(D4:D10)');
  const t = openTemplate(bytes, env), a = analyzeWorkbook(t, 'SYNTHETIC.xlsx');
  const weekdays = Object.fromEntries(a.sheets[0].studentBlocks.map(b => [b.id, '월수금']));
  const g = generateWorkbook(t, a, { year: 2026, month: 10, weekdays });
  assert.equal(g.results[0].mapping.dateColumns.length, 31);
});

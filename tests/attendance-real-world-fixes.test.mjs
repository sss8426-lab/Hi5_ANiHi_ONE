import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { realWorldFixture } from './helpers/attendance-real-world-fixture.mjs';
import { analyzeWorkbook, openTemplate } from '../public/data-core/work/attendance-auto.js';

const env = { DOMParser, XMLSerializer };
const analyze = (opts) => analyzeWorkbook(openTemplate(realWorldFixture(opts), env), 'SYNTHETIC.xlsx');

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

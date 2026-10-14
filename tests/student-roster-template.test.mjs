import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from '../public/data-core/vendor/fflate-0.8.3.js';
import { openTemplate, all, attr, textOf } from '../public/data-core/work/attendance-template.js';

const TEMPLATE = 'public/admissions-web/renderer/templates/student-roster-template.xlsx';
const bytes = fs.readFileSync(TEMPLATE);
const window = {};
vm.runInNewContext(fs.readFileSync('public/admissions-web/renderer/student-grades.js', 'utf8'), { window });
const grades = window.AdmissionsStudentGrades;
const plain = v => JSON.parse(JSON.stringify(v));

// The same reading student-grades.js readXlsx() does in the browser, for one sheet.
function sheetRows(book, sheet) {
  const doc = book.read(sheet.path);
  return all(doc, 'row').map(row => {
    const cells = [];
    for (const cell of all(row, 'c')) {
      const ref = /^([A-Z]+)/.exec(attr(cell, 'r') || '');
      if (ref) cells[[...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1] = textOf(cell, book.strings);
    }
    return Array.from(cells, value => value ?? '');
  });
}
const book = openTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { DOMParser, XMLSerializer });

test('학생 명단 양식: the first sheet is the one uploads read, and it is empty', () => {
  assert.deepEqual(book.sheets.map(s => s.name), ['학생명단', '작성예시', '사용안내']);
  const first = book.sheets.find(s => !s.hidden);
  assert.equal(first.name, '학생명단');
  assert.deepEqual(plain(grades.mapRows(sheetRows(book, first))), []);
});

test('작성예시 rows map to every student field the upload knows', () => {
  const students = plain(grades.mapRows(sheetRows(book, book.sheets[1])));
  assert.equal(students.length, 5);
  assert.deepEqual(students[0], { name: '김예시', school: '예시고', gpa: 2.3, skillLevel: 'A0', track: '상황표현', targetUniversities: '한국대 만화애니', consultMemo: '주 2회 · 3월 입시 상담 예정' });
  assert.equal(students[2].gpa, undefined); // 비워 둔 내신은 넣지 않음
});

test('dropdowns match the lists on the student screen; the sheet is protected but input cells are open', () => {
  const app = fs.readFileSync('public/admissions-web/renderer/app.js', 'utf8');
  const list = name => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]+\\])`).exec(app)[1].replace(/'/g, '"'));
  const xml = strFromU8(unzipSync(new Uint8Array(bytes))['xl/worksheets/sheet1.xml']);
  const formulas = [...xml.matchAll(/<formula1>"([^"<]+)"<\/formula1>/g)].map(m => m[1].split(','));
  assert.deepEqual(formulas, [list('SKILL_LEVELS'), list('BASE_HOPE_TRACKS')]);
  assert.match(xml, /<sheetProtection[^>]*sheet="1"/);
  assert.match(xml, /sqref="D4:D203"/);
});

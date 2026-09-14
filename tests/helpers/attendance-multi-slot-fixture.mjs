import { columnName } from '../../public/data-core/work/attendance-template.js';
import { attendanceFixture } from './attendance-fixture.mjs';
import { unzipSync, zipSync, strToU8 } from '../../public/data-core/vendor/fflate-0.8.3.js';

// Builds a single-sheet synthetic attendance workbook whose weekend days occupy more than one
// physical column, in either the 'merged' (mergeCells, only the anchor column holds a value) or
// 'repeated' (every column repeats the same literal date/weekday value) header style — the two
// real-world structures this fix must recognize. `holidayDay` optionally forces one specific day
// down to a single column, simulating a 추석/휴원 exception the weekday policy must not follow.
export function multiSlotFixture({
  year = 2026, month = 9, weekendMode = 'merged', saturdaySlots = 3, sundaySlots = 2,
  holidayDay = null, students = 6, needsReview = false,
} = {}) {
  const files = unzipSync(attendanceFixture());
  const start = 4;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdayOf = day => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const slotsFor = day => {
    if (holidayDay && day === holidayDay) return 1;
    const wd = weekdayOf(day);
    if (wd === 6) return saturdaySlots;
    if (wd === 0) return sundaySlots;
    return 1;
  };
  const columns = [];
  let c = start;
  for (let day = 1; day <= 31; day++) {
    const n = day <= daysInMonth ? slotsFor(day) : 1;
    for (let slot = 0; slot < n; slot++) columns.push({ day, slot, c: c++ });
  }
  const last = c - 1;
  const cell = (col, row, value = '', style = 1) =>
    `<c r="${columnName(col)}${row}" s="${style}"${typeof value === 'number' ? '' : value !== '' ? ' t="inlineStr"' : ''}>${typeof value === 'number' ? `<v>${value}</v>` : value !== '' ? `<is><t>${value}</t></is>` : ''}</c>`;
  const byDay = new Map();
  for (const col of columns) { if (!byDay.has(col.day)) byDay.set(col.day, []); byDay.get(col.day).push(col); }
  const merges = [`A1:${columnName(last)}1`];
  const dateCells = [], weekdayCells = [];
  for (const [day, group] of byDay) {
    const active = day <= daysInMonth;
    const weekdayChar = active ? '일월화수목금토'[weekdayOf(day)] : '';
    if (weekendMode === 'merged' && group.length > 1) {
      dateCells.push(cell(group[0].c, 2, active ? day : ''));
      weekdayCells.push(cell(group[0].c, 3, weekdayChar));
      for (let i = 1; i < group.length; i++) { dateCells.push(cell(group[i].c, 2, '')); weekdayCells.push(cell(group[i].c, 3, '')); }
      merges.push(`${columnName(group[0].c)}2:${columnName(group.at(-1).c)}2`);
      merges.push(`${columnName(group[0].c)}3:${columnName(group.at(-1).c)}3`);
    } else {
      for (const col of group) { dateCells.push(cell(col.c, 2, active ? day : '')); weekdayCells.push(cell(col.c, 3, weekdayChar)); }
    }
  }
  const rows = [];
  rows.push(`<row r="1" ht="28" customHeight="1">${cell(1, 1, `${year}년 ${month}월 출석부`, 3)}</row>`);
  rows.push(`<row r="2" ht="15" customHeight="1">${dateCells.join('')}</row>`);
  rows.push(`<row r="3" ht="15" customHeight="1">${cell(2, 3, '이름')}${cell(3, 3, '학교,학년')}${weekdayCells.join('')}</row>`);
  // Rotates students across weekday classes and, for those on a multi-slot weekend, a specific
  // slot index — this is what exercises the per-student channel/slot inference after reshape.
  const plan = i => {
    if (needsReview) return { weekday: null, slot: 0 };
    const kind = i % 5;
    if (kind === 0) return { weekday: 1, extra: [3, 5], slot: 0 }; // 월수금
    if (kind === 1) return { weekday: 6, slot: 0 }; // 토 slot 0
    if (kind === 2) return { weekday: 6, slot: Math.min(1, saturdaySlots - 1) }; // 토 slot 1 (or 0 if only one slot)
    if (kind === 3) return { weekday: 6, slot: Math.min(2, saturdaySlots - 1) }; // 토 slot 2
    return { weekday: 0, slot: 0 }; // 일 slot 0
  };
  for (let i = 0; i < students; i++) {
    const row = 4 + i, p = plan(i);
    const marks = columns.map(col => {
      const valid = col.day <= daysInMonth, wd = weekdayOf(col.day);
      let marked = false;
      if (p.weekday !== null && valid) {
        if (wd === p.weekday && (p.weekday === 1 || p.weekday === 3 || p.weekday === 5 ? true : col.slot === p.slot)) marked = true;
        if (p.extra?.includes(wd)) marked = true;
      }
      return cell(col.c, row, marked ? 1 : '');
    }).join('');
    rows.push(`<row r="${row}" ht="15" customHeight="1">${cell(1, row, i + 1)}${cell(2, row, `SYNTHETIC_${i}`)}${cell(3, row, 'SYNTHETIC_GRADE')}${marks}</row>`);
  }
  const end = 3 + students;
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${columnName(last)}${end}"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="3.6"/><col min="2" max="3" width="10"/><col min="${start}" max="${last}" width="2.4"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.1968503937" right="0.1968503937" top="0.1968503937" bottom="0.1968503937" header="0" footer="0"/><pageSetup paperSize="9" orientation="landscape" scale="80" fitToWidth="1" fitToHeight="1"/></worksheet>`;
  files['xl/worksheets/sheet1.xml'] = strToU8(xml);
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="출석부" sheetId="1" r:id="rId1"/><sheet name="보존" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'출석부'!$A$1:$${columnName(last)}$${end}</definedName></definedNames></workbook>`);
  return { bytes: zipSync(files), start, last, end, columns, daysInMonth };
}

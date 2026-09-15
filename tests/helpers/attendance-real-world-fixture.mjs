import { columnName } from '../../public/data-core/work/attendance-template.js';
import { zipSync, strToU8 } from '../../public/data-core/vendor/fflate-0.8.3.js';

// Minimal, hand-built single-sheet workbook for regressions found only in structurally different
// real-world exports (never copies any real file's dates, names, or layout). One knob per bug:
// - `days`: how many physical day columns actually exist (a real 30-day September template can
//   have exactly 30, with no day-31 placeholder to borrow).
// - `titleText`: the literal title-row text carrying the period (e.g. an academic-year phrasing).
// - `cfRuleType`/`cfRuleText`: an Excel built-in conditional-formatting rule shape to include.
// - `areaShrink`: rows/columns to under-report in <dimension> and Print_Area versus the real data,
//   simulating a stale used-range that some export tools leave behind after edits.
export function realWorldFixture({
  year = 2026, month = 9, days = new Date(Date.UTC(year, month, 0)).getUTCDate(),
  titleText = `${year}년 ${month}월 출석부`, students = 3,
  cfRuleType = null, cfRuleText = null, areaShrink = 0,
} = {}) {
  const start = 4;
  const weekdayOf = day => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const cell = (col, row, value = '', style = 1) =>
    `<c r="${columnName(col)}${row}" s="${style}"${typeof value === 'number' ? '' : value !== '' ? ' t="inlineStr"' : ''}>${typeof value === 'number' ? `<v>${value}</v>` : value !== '' ? `<is><t>${value}</t></is>` : ''}</c>`;
  const last = start + days - 1;
  const dateCells = [], weekdayCells = [];
  for (let day = 1; day <= days; day++) {
    dateCells.push(cell(start + day - 1, 2, day));
    weekdayCells.push(cell(start + day - 1, 3, '일월화수목금토'[weekdayOf(day)]));
  }
  const rows = [];
  rows.push(`<row r="1" ht="28" customHeight="1">${cell(1, 1, titleText, 3)}</row>`);
  rows.push(`<row r="2" ht="15" customHeight="1">${dateCells.join('')}</row>`);
  rows.push(`<row r="3" ht="15" customHeight="1">${cell(2, 3, '이름')}${cell(3, 3, '학교,학년')}${weekdayCells.join('')}</row>`);
  for (let i = 0; i < students; i++) {
    const row = 4 + i;
    rows.push(`<row r="${row}" ht="15" customHeight="1">${cell(1, row, i + 1)}${cell(2, row, `SYNTHETIC_${i}`)}${cell(3, row, 'SYNTHETIC_GRADE')}</row>`);
  }
  const end = 3 + students;
  const declaredEnd = Math.max(1, end - areaShrink);
  const cfRule = !cfRuleType ? '' : cfRuleType === 'cellIs'
    ? `<conditionalFormatting sqref="${columnName(start)}4:${columnName(last)}${end}"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0"><formula>1</formula></cfRule></conditionalFormatting>`
    : `<conditionalFormatting sqref="${columnName(start)}4:${columnName(last)}${end}"><cfRule type="${cfRuleType}" priority="1" dxfId="0" operator="${cfRuleType}" text="${cfRuleText ?? '출석'}"><formula>NOT(ISERROR(SEARCH(&quot;${cfRuleText ?? '출석'}&quot;,${columnName(start)}4)))</formula></cfRule></conditionalFormatting>`;
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${columnName(last)}${declaredEnd}"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="3.6"/><col min="2" max="3" width="10"/><col min="${start}" max="${last}" width="2.4"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="1"><mergeCell ref="A1:${columnName(last)}1"/></mergeCells>${cfRule}<pageMargins left="0.1968503937" right="0.1968503937" top="0.1968503937" bottom="0.1968503937" header="0" footer="0"/><pageSetup paperSize="9" orientation="landscape" scale="80" fitToWidth="1" fitToHeight="1"/></worksheet>`;
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    // No Print_Area defined name: recognition must fall back to (and correct) <dimension>.
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="출석부" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': xml,
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf/></dxfs></styleSheet>',
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

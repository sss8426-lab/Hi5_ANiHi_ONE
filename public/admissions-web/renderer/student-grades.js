// 학생 관리 학년: a student keeps the year they were 고1 (entryYear), so 고1 → 고2 → 고3 follows the school year
// (which starts in March) without anyone editing it. Students without entryYear keep their stored 학년 until a
// teacher fills in the year. Also reads 학생 명단 uploads (.xlsx / .csv / .json) into student objects.
(() => {
  const GRADES = [1, 2, 3];
  function schoolYear(date = new Date()) { return date.getMonth() >= 2 ? date.getFullYear() : date.getFullYear() - 1; }
  function entryYearFor(grade, year) { return Number(year) - (Number(grade) - 1); }
  function gradeOf(student, date = new Date()) {
    const entry = Number(student?.entryYear);
    if (Number.isInteger(entry) && entry > 1990) {
      const grade = schoolYear(date) - entry + 1;
      return { grade: Math.max(1, Math.min(3, grade)), graduated: grade > 3, entryYear: entry, fromYear: true };
    }
    const stored = /고\s*([123])/.exec(String(student?.gradeLevel || ''));
    return stored ? { grade: Number(stored[1]), graduated: false, entryYear: null, fromYear: false } : { grade: null, graduated: false, entryYear: null, fromYear: false };
  }
  function gradeLabel(info) {
    if (!info.grade) return '학년 미지정';
    if (info.graduated) return `졸업 (${info.entryYear} 고1)`;
    return info.fromYear ? `${info.entryYear} 고1 입학` : '연도 입력 필요';
  }

  // Header names teachers commonly use, mapped to student fields.
  const HEADERS = [
    ['name', ['이름', '학생명', '성명', '학생']], ['gpa', ['내신', '평균등급', '내신등급', '등급']], ['skill', ['실기점수', '실기 점수']],
    ['skillLevel', ['실기능력', '실기 능력', '실기수준']], ['track', ['희망계열', '희망 계열', '전공계열', '전공 계열', '계열', '희망전공']],
    ['school', ['학교', '고등학교', '학교명']], ['targetUniversities', ['희망대학', '희망 대학', '목표대학']], ['consultMemo', ['메모', '상담메모', '비고']],
  ];
  const normal = text => String(text || '').replace(/\s+/g, '').toLowerCase();
  function mapRows(rows) {
    const headerIndex = rows.findIndex(row => row.some(cell => ['이름', '학생명', '성명'].includes(normal(cell))));
    if (headerIndex < 0) throw new Error('첫 줄(제목 줄)에 "이름" 또는 "학생명" 칸이 있어야 합니다.');
    const header = rows[headerIndex].map(normal);
    const columns = HEADERS.map(([field, names]) => [field, header.findIndex(cell => names.some(name => normal(name) === cell))]).filter(([, index]) => index >= 0);
    return rows.slice(headerIndex + 1).map(row => {
      const student = {};
      for (const [field, index] of columns) {
        const value = String(row[index] ?? '').trim();
        if (!value) continue;
        student[field] = ['gpa', 'skill'].includes(field) && Number.isFinite(Number(value)) ? Number(value) : value;
      }
      return student;
    }).filter(student => student.name);
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readXlsx(file) {
    const t = await import('/data-core/work/attendance-template.js?v=20260919-sparse-import');
    const book = t.openTemplate(await file.arrayBuffer());
    const sheet = book.sheets.find(s => !s.hidden) || book.sheets[0];
    const doc = book.read(sheet.path);
    return t.all(doc, 'row').map(row => {
      const cells = [];
      for (const cell of t.all(row, 'c')) {
        const ref = /^([A-Z]+)/.exec(t.attr(cell, 'r') || '');
        if (ref) cells[[...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1] = t.textOf(cell, book.strings);
      }
      return Array.from(cells, value => value ?? '');
    });
  }
  async function readStudentFile(file) {
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.json')) {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed?.students;
      if (!Array.isArray(list)) throw new Error('학생 목록이 들어 있는 JSON 파일이 아닙니다.');
      return list.filter(s => s && typeof s === 'object' && s.name).map(s => { const rest = { ...s }; for (const key of ['id', 'createdAt', 'updatedAt', '_revision']) delete rest[key]; return rest; });
    }
    if (name.endsWith('.csv')) return mapRows(parseCsv((await file.text()).replace(/^\uFEFF/, '')));
    if (name.endsWith('.xlsx')) return mapRows(await readXlsx(file));
    throw new Error('엑셀(.xlsx), CSV, JSON 파일을 올려주세요.');
  }
  window.AdmissionsStudentGrades = { GRADES, schoolYear, entryYearFor, gradeOf, gradeLabel, readStudentFile, mapRows, parseCsv };
})();

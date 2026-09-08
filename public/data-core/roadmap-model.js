export function normalize(value) {
  return String(value || '').toLowerCase().replace(/[·ㆍ/\s_-]+/g, '');
}
export function searchCareers(careers, query, family = '') {
  const needle = normalize(query);
  return careers.filter((career) => (!family || career.family === family) &&
    (!needle || [career.name, ...career.aliases, ...career.majors, career.summary].some((value) => normalize(value).includes(needle))));
}
export function matchServerGoal(career, goals) {
  const names = [career.name, ...career.aliases].map(normalize);
  return goals.find((goal) => names.includes(normalize(goal.name)));
}
export function careerStages(career) {
  return [
    ['미술 기초', career.foundation.join(' → ')],
    ['전공 기초', career.specialization.slice(0, 2).join(' → ')],
    ['전공 심화', career.advanced.join(' → ')],
    ['대학입시', career.preparation],
    ['대학 전공교육', `${career.majors.slice(0, 2).join('·')} 등 관련 전공에서 이론과 제작, 협업 경험을 넓혀요. 대학별 교육과정은 학과 홈페이지에서 확인해요.`],
    ['취업·창작·데뷔', `${career.outcome}을 나만의 포트폴리오로 발전시키고, 창작과 진로를 준비해요.`],
  ];
}
export function safeUrl(value) {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}
export function percent(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
export function programView(program) {
  const m = program.metadata || {};
  const yearText = String(m.year || '');
  const year = /^20\d{2}(학년도)?$/.test(yearText) ? yearText.replace('학년도', '') : '';
  const source = safeUrl(m.officialSourceUrl || m.sourceUrl || m.officialUrl);
  const status = String(m.verificationStatus || m.reviewStatus || '').toLowerCase();
  const verifiedAt = String(m.verifiedAt || m.reviewedAt || '');
  const reviewed = ['approved', 'verified', 'confirmed', '검수완료', '승인', '확정'].includes(status.replace(/\s/g, ''));
  // A source link alone is not evidence that admissions facts were reviewed.
  const date = new Date(verifiedAt);
  const validDate = /^\d{4}-\d{2}-\d{2}(T|$)/.test(verifiedAt) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === verifiedAt.slice(0, 10);
  const verified = Boolean(year && source && reviewed && validDate);
  const grade = verified ? percent(m.gradeRatio) : null;
  const skill = verified ? percent(m.skillRatio) : null;
  const validPair = grade !== null && skill !== null && grade + skill <= 100;
  return {
    id: String(program.id || ''), university: String(m.universityName || m.schoolName || '대학 확인 필요'),
    department: String(m.major || program.name || '학과 확인 필요'), region: String(m.region || m.area || m.location || ''),
    schoolType: String(m.schoolType || m.degreeType || ''), admission: String(m.admission || ''), practical: verified ? String(m.practicalType || '') : '',
    source, year, verified, verifiedAt: verified ? verifiedAt.slice(0, 10) : '', page: verified ? String(m.sourcePage || m.documentPage || '') : '',
    grade: validPair ? grade : null, skill: validPair ? skill : null,
    sourceUniversityId: String(m.sourceUniversityId || ''), campus: String(m.campus || ''),
    guidelineId: String(m.guidelineId || ''), admissionSeason: ['susi','jungsi'].includes(m.admissionSeason) ? m.admissionSeason : '',
  };
}
export function filterPrograms(programs, filters) {
  return programs.filter((p) => (!filters.region || p.region === filters.region) &&
    (!filters.schoolType || p.schoolType === filters.schoolType) &&
    (!filters.admission || p.admission.includes(filters.admission)) &&
    (!filters.focus || (filters.focus === 'verified' && p.verified) ||
      (filters.focus === 'practical' && p.skill !== null && p.grade !== null && p.skill > p.grade) ||
      (filters.focus === 'academic' && p.grade !== null && p.skill !== null && p.grade > p.skill) ||
      (filters.focus === 'portfolio' && p.verified && /포트폴리오/.test(p.practical))));
}
export function admissionTrend(programs) {
  const unique = new Map();
  for (const p of programs) {
    if (p.verified && p.year && p.grade !== null && p.skill !== null) unique.set([p.university, p.department, p.year, p.admission].join('|'), p);
  }
  const year = [...new Set([...unique.values()].map((p) => p.year))].sort().at(-1);
  const rows = [...unique.values()].filter((p) => p.year === year);
  if (!rows.length) return null;
  return { count: rows.length, year, grade: rows.reduce((sum, p) => sum + p.grade, 0) / rows.length,
    skill: rows.reduce((sum, p) => sum + p.skill, 0) / rows.length };
}

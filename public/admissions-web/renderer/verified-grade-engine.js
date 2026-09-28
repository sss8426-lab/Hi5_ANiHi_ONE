// Reviewed rules are versioned independently of editable/example admission rules.
export const CATALOG_VERSION = '2027-susi-20260929.1';
const joongbuSource = 'https://www.joongbu.ac.kr/boardDownload.es?bid=ATT&list_no=338272&seq=1';
const seowonSource = 'https://www.seowon.ac.kr/bbs/iphak/600/131310/download.do';
const common = { year: 2027, season: '수시', scale: 9, verifiedAt: '2026-09-29', version: CATALOG_VERSION };
export const RULES = {
  joongbu: { ...common, university: '중부대학교', campus: '고양창의캠퍼스', source: joongbuSource, pages: '50, 52, 70~71', calculator: 'https://addon.jinhakapply.com/nesin/1131/2027/Susi.html', summary: '3학년 1학기까지 국어·영어·수학·사회(한국사)·과학 상위 10과목. 진로 A=2, B=4, C=6. 단위 가중 없음.', groups: [{ subjects: ['KOREAN','MATH','ENGLISH','SOCIAL','SCIENCE','KOREAN_HISTORY'], count: 10 }], career: { A: 2, B: 4, C: 6 } },
  seowon: { ...common, university: '서원대학교', campus: '청주', source: seowonSource, pages: '5~6, 19~21, 32~34', calculator: 'https://addon.jinhakapply.com/Nesin/1088/2027/Susi.html', summary: '국어·수학 상위 4과목, 영어 2과목, 탐구(한국사) 2과목. 진로·전문 A=3, B=5, C=7, D=8, E=9. 단위 가중 없음.', groups: [{ subjects: ['KOREAN','MATH'], count: 4 }, { subjects: ['ENGLISH'], count: 2 }, { subjects: ['SOCIAL','SCIENCE','KOREAN_HISTORY'], count: 2 }], career: { A: 3, B: 5, C: 7, D: 8, E: 9 } },
};
export const PROGRAMS = [
  { id: 'jb-industrial-practical', rule: 'joongbu', major: '산업디자인학전공', admission: '실기우수자전형', track: '디자인', maxScore: 200, cutoff: 4.7 },
  { id: 'jb-comic-practical', rule: 'joongbu', major: '만화애니메이션학전공', admission: '실기우수자전형', track: '웹툰·애니', maxScore: 200, cutoff: 3.4 },
  { id: 'jb-photo-practical', rule: 'joongbu', major: '사진영상학전공', admission: '실기우수자전형', track: '영상', maxScore: 200, cutoff: 4.8 },
  { id: 'jb-photo-record', rule: 'joongbu', major: '사진영상학전공', admission: '학생부우수자전형', track: '영상', maxScore: 1000, cutoff: 3.4 },
  { id: 'sw-comic-art', rule: 'seowon', major: '웹툰콘텐츠학과', admission: '예체능전형', track: '웹툰·애니', maxScore: 200, cutoff: null },
  { id: 'sw-design-art', rule: 'seowon', major: '디자인학과(시각,산업)', admission: '예체능전형', track: '디자인', maxScore: 200, cutoff: null },
  { id: 'sw-design-general', rule: 'seowon', major: '디자인학과(시각,산업)', admission: '일반전형', track: '디자인', maxScore: 1000, cutoff: null },
  { id: 'sw-fashion-general', rule: 'seowon', major: '패션의류학과', admission: '일반전형', track: '디자인', maxScore: 1000, cutoff: null },
];
const aliases = { 국어: 'KOREAN', 수학: 'MATH', 영어: 'ENGLISH', 사회: 'SOCIAL', 과학: 'SCIENCE', 한국사: 'KOREAN_HISTORY', HISTORY: 'SOCIAL', ETHICS: 'SOCIAL' };
const subjectTypes = { 공통과목: 'COMMON', 일반선택: 'GENERAL', 진로선택: 'CAREER', 전문교과: 'SPECIALIZED' };
const termNumber = (value, suffix) => Number(String(value ?? '').trim().replace(suffix, ''));
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
const blocked = reason => ({ ok: false, reason, selected: [], excluded: [] });

export function joongbuPoints(grade, maxScore) {
  if (!Number.isFinite(grade) || grade < 1 || grade > 9) return null;
  if (maxScore === 200) {
    if (grade < 2) return 200;
    if (grade === 9) return 120;
    return 195 - Math.floor((grade - 2) * 2 + 1e-8) * 5;
  }
  if (maxScore !== 1000) return null;
  const bands = [[2,1000],[2.2,980],[2.4,960],[2.6,940],[2.8,920],[3,900],[3.2,880],[3.4,860],[3.6,840],[3.8,820],[4,800],[4.2,780],[4.4,760],[4.6,740],[4.8,720],[5,700],[5.2,680],[5.4,660],[5.6,640],[5.8,620],[6,600],[6.2,580],[6.4,560],[6.6,540],[6.8,520],[7,500],[8,480],[9,460],[10,440]];
  return bands.find(([upper]) => grade < upper)?.[1] ?? null;
}

export function calculateVerified(programId, rows, profile = {}) {
  const program = PROGRAMS.find(item => item.id === programId);
  if (!program) return blocked('검증된 전형이 아닙니다.');
  const rule = RULES[program.rule];
  if (Number(profile.year) !== rule.year || profile.season !== rule.season) return blocked('해당 학년도·모집 시기의 검증된 환산식이 없습니다.');
  if (Number(profile.scale) !== 9) return blocked('5등급제는 별도의 환산식 검증이 필요합니다.');
  if (!['expected', 'graduate'].includes(profile.schoolStatus)) return blocked('검정고시·해외고·기타 학력은 현재 자동 산출 대상이 아닙니다.');
  if (profile.complete !== true) return blocked('대상 학기 과목을 모두 입력했는지 확인해 주세요. 평균 내신만으로는 환산할 수 없습니다.');
  if (!Array.isArray(rows) || !rows.length) return blocked('과목별 성적이 없습니다.');
  const candidates = [], excluded = [], seen = new Set();
  for (const [index, row] of rows.entries()) {
    const name = String(row.subjectName ?? '').normalize('NFKC').trim();
    const year = termNumber(row.schoolYear, '학년'), semester = termNumber(row.semester, '학기');
    if (!name || ![1,2,3].includes(year) || ![1,2].includes(semester) || !row.subjectGroup || !row.subjectType) return blocked(`${index + 1}행: 학년·학기·교과·과목명·유형을 확인해 주세요.`);
    const key = `${year}:${semester}:${name.replace(/\s/g, '')}`;
    if (seen.has(key)) return blocked(`${index + 1}행: 같은 학기 과목이 중복되었습니다 (${name}).`);
    seen.add(key);
    const subject = aliases[row.subjectGroup] || row.subjectGroup;
    const type = subjectTypes[row.subjectType] || row.subjectType;
    let reason = '';
    if (year === 3 && semester === 2 && (program.rule === 'joongbu' || profile.schoolStatus === 'expected')) reason = '반영 학기 밖';
    else if (!rule.groups.some(group => group.subjects.includes(subject))) reason = '반영 교과 밖';
    else if (program.rule === 'joongbu' && year === 1 && name.replace(/\s/g, '') === '과학탐구실험') reason = '1학년 과학탐구실험 제외';
    else if (program.rule === 'joongbu' && type === 'SPECIALIZED') reason = '전문교과 제외';
    if (reason) { excluded.push({ ...row, reason }); continue; }
    if (!['COMMON','GENERAL','CAREER','SPECIALIZED'].includes(type)) return blocked(`${index + 1}행: ${name}의 과목 유형은 별도 확인이 필요합니다.`);
    const isAchievement = type === 'CAREER' || type === 'SPECIALIZED';
    const grade = isAchievement ? rule.career[String(row.achievement || '').trim().toUpperCase()] : Number(row.grade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 9) return blocked(`${index + 1}행: ${name}의 ${isAchievement ? '성취도' : '석차등급(1~9 정수)'}를 확인해 주세요.`);
    candidates.push({ ...row, subject, convertedGrade: grade, originalIndex: index, fromAchievement: isAchievement });
  }
  if (!candidates.length) return blocked('반영 가능한 과목 성적이 없습니다.');
  const selected = [];
  for (const group of rule.groups) {
    const sorted = candidates.filter(row => group.subjects.includes(row.subject)).sort((a,b) => a.convertedGrade - b.convertedGrade || a.originalIndex - b.originalIndex);
    selected.push(...sorted.slice(0, group.count));
    excluded.push(...sorted.slice(group.count).map(row => ({ ...row, reason: '상위 과목 수 초과' })));
    for (let i = sorted.length; i < group.count; i++) selected.push({ subjectName: '미이수 과목 보충', subject: group.subjects.join('/'), convertedGrade: 9, padded: true });
  }
  const convertedGrade = round2(selected.reduce((sum,row) => sum + row.convertedGrade, 0) / selected.length);
  // Seowon converts EACH subject to points, not the average grade to a band.
  const pointTenths = [0,100,98,96,94,92,90,88,85,20];
  const meanPoints = round2(selected.reduce((sum,row) => sum + pointTenths[row.convertedGrade], 0) / (selected.length * 10));
  const score = program.rule === 'joongbu' ? joongbuPoints(convertedGrade, program.maxScore) : round2(meanPoints * program.maxScore / 10);
  return { ok: true, program, rule, score, convertedGrade, selected, excluded, paddedCount: selected.filter(row => row.padded).length, benchmark: program.cutoff == null ? null : { year: 2026, label: '최종등록자 최저 교과등급 (2027 반영법 재산출)', grade: program.cutoff, margin: round2(program.cutoff - convertedGrade), source: rule.source, pages: '70~71' } };
}

export function calculateCandidates(rows, profile, track = '') {
  return PROGRAMS.filter(program => !track || program.track === track).map(program => ({ program, ...calculateVerified(program.id, rows, profile) })).sort((a,b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    if (!!a.benchmark !== !!b.benchmark) return a.benchmark ? -1 : 1;
    return (b.benchmark?.margin ?? 0) - (a.benchmark?.margin ?? 0) || a.program.id.localeCompare(b.program.id);
  });
}

export const normalizeName = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s·ㆍ/_-]+/g, '');
const text = (value, max = 240) => ['string', 'number'].includes(typeof value) ? String(value).trim().slice(0, max) : '';
const number = (value, max = Infinity) => {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const https = (value) => { try { const u = new URL(text(value, 2000)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

// These are subject-name associations, not a promise of eligibility or admission.
export const careerMajorKeywords = {
  D001:['웹툰','만화'], D002:['만화'], D003:['웹툰','만화','문화콘텐츠'], D004:['만화','스토리텔링','문예창작'],
  D005:['애니메이션'], D006:['애니메이션','3dcg','융합콘텐츠'], D007:['애니메이션','영상','콘텐츠기획'], D008:['애니메이션','영상디자인','만화'],
  D009:['게임'], D010:['게임','일러스트','애니메이션'], D011:['게임','공간디자인','애니메이션'], D012:['게임','시각디자인','uiux'],
  D013:['일러스트','시각디자인','만화'], D014:['캐릭터','애니메이션','시각디자인'], D015:['캐릭터','디지털콘텐츠','만화'], D016:['일러스트','시각디자인','문예창작'],
  D017:['시각디자인','커뮤니케이션디자인'], D018:['시각디자인','브랜드','커뮤니케이션디자인'], D019:['시각디자인','커뮤니케이션디자인','편집디자인'],
  D020:['시각디자인','산업디자인','패키지'], D021:['시각디자인','광고홍보','콘텐츠디자인'], D022:['시각디자인','디지털미디어디자인','ai디자인','uiux'],
  D023:['영상디자인','시각디자인','애니메이션'], D024:['영상디자인','영상애니메이션','미디어디자인'],
  D025:['산업디자인','공업디자인','제품디자인'], D026:['자동차','운송디자인','모빌리티','산업디자인'], D027:['공간디자인','실내건축','실내디자인','스페이스디자인'],
  D028:['전시디자인','공간디자인','vmd'], D029:['무대미술','공간디자인','공연영상미술'], D030:['의상','패션'], D031:['텍스타일','섬유','패션'],
  D032:['금속','주얼리','쥬얼리','보석'], D033:['도예','도자','세라믹','유리'], D034:['목조형','가구','리빙디자인','산업디자인'], D035:['ai디자인','융합콘텐츠','디자인이노베이션'],
};
export function matchesCareer(department, careerId) {
  return (careerMajorKeywords[careerId] || []).some((term) => normalizeName(department).includes(normalizeName(term)));
}

export function universityIdentity(name, campus = '') {
  let school = text(name).normalize('NFKC');
  const suffix = school.match(/(?:\(([^)]+)\)|[_\s]+([^\s]+캠퍼스)|_([^_]+))$/);
  const branch = normalizeName(campus || suffix?.[1] || suffix?.[2] || suffix?.[3] || '').replace(/캠퍼스$/, '');
  if (suffix) school = school.slice(0, suffix.index);
  school = normalizeName(school).replace(/대학교$/, '대').replace(/대학$/, '대');
  return { school, campus: branch };
}
export function indexUniversities(universities) {
  const index = new Map();
  for (const u of universities) {
    const key = universityIdentity(u.name || u.universityName,u.campus).school;
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push(u);
  }
  return index;
}
export const mappingReasonLabels = {
  matched:'정확히 일치', 'matched-label':'전형명 표기 일치',
  'university-missing':'대학 후보 없음', 'campus-mismatch':'캠퍼스 불일치',
  'department-mismatch':'학과 불일치', 'year-mismatch':'학년도 불일치',
  'admission-mismatch':'전형명 불일치', 'multiple-candidates':'동일 조건 후보 중복',
  'campus-ambiguous':'캠퍼스 구분 필요',
  'pending-sync':'연결 가능 · 새로고침 필요',
  'source-unavailable':'대학 원본 확인 불가',
};
const admissionLabel = (value) => normalizeName(value).replace(/전형$/, '');
export function explainUniversityMatch(row, universities) {
  const wanted = universityIdentity(row.universityName, row.campus);
  const candidates = universities instanceof Map ? (universities.get(wanted.school) || []) : universities.filter((u) => universityIdentity(u.name || u.universityName, u.campus).school === wanted.school);
  const exact = candidates.filter((u) => universityIdentity(u.name || u.universityName, u.campus).campus === wanted.campus);
  const campusVariants = new Set(candidates.map((u) => universityIdentity(u.name || u.universityName, u.campus).campus));
  // A university row is also a department/term. Do not pick an arbitrary ID among departments.
  const departments = exact.filter((u) => normalizeName(u.major || u.department) === normalizeName(row.department));
  const years = departments.filter((u) => !u.year || String(u.year) === String(row.academicYear));
  const program = years.filter((u) => !u.admission || normalizeName(u.admission) === normalizeName(row.admissionType));
  const ids = [...new Set(program.map((u) => String(u.id)).filter((id) => id && id !== 'undefined'))];
  const campusKnown = Boolean(wanted.campus || campusVariants.size <= 1);
  if (ids.length === 1 && campusKnown) return { universityId: ids[0], mappingStatus: 'matched', mappingReason:'matched' };
  // Only the terminal generic label differs. No fuzzy matching, missing year or campus inference.
  const labels = !program.length && campusKnown && /^20\d{2}$/.test(String(row.academicYear)) && admissionLabel(row.admissionType)
    ? departments.filter((u) => !u.hiddenDuplicate && String(u.year) === String(row.academicYear) &&
      admissionLabel(u.admission) === admissionLabel(row.admissionType) && ['string','number'].includes(typeof u.id) && String(u.id).trim()) : [];
  const labelIds = [...new Set(labels.map((u) => String(u.id)))];
  if (labelIds.length === 1) return {universityId:labelIds[0],mappingStatus:'matched',mappingReason:'matched-label'};
  const mappingReason = !candidates.length ? 'university-missing' : !exact.length ? 'campus-mismatch' : !departments.length ? 'department-mismatch'
    : !years.length ? 'year-mismatch' : labelIds.length>1 || ids.length>1 ? 'multiple-candidates' : !program.length ? 'admission-mismatch' : 'campus-ambiguous';
  return { universityId: null, mappingStatus: candidates.length ? 'review' : 'unmatched', mappingReason };
}
export function matchUniversity(row, universities) {
  const {universityId,mappingStatus}=explainUniversityMatch(row,universities);
  return {universityId,mappingStatus};
}

// Never forward legacy records, conversion rules, notes, student stats or arbitrary metadata.
export function projectUniversity(row) {
  const m = {
    sourceUniversityId: text(row.id), sourceApp: 'admissions', sourceName: '대학 데이터 관리',
    universityName: text(row.name || row.universityName), major: text(row.major || row.department),
    campus: text(row.campus), year: text(row.year), region: text(row.region), schoolType: text(row.collegeType || row.schoolType),
    admission: text(row.admission || row.admissionType), practicalType: text(row.practicalType),
    gradeRatio: number(row.gradeRatio,100), skillRatio: number(row.skillRatio,100), rateCurrent: number(row.rateCurrent),
    officialSourceUrl: https(row.officialSourceUrl || row.sourceUrl), verificationStatus: text(row.verificationStatus || row.reviewStatus),
    verifiedAt: text(row.verifiedAt || row.reviewedAt), sourceUpdatedAt: text(row.updatedAt), sourcePage: text(row.sourcePage),
  };
  return { id: `admissions:${m.sourceUniversityId}`, name: m.major, metadata: m };
}

// Only columns displayed on the anonymous public tables; member-only statistics are excluded.
export const publicColumns = {
  academicYear:'학년도', region:'지역', universityName:'대학', admissionType:'전형명', admissionCategory:'전형유형',
  department:'모집단위', quota:'모집인원', competitionRate:'전년도 경쟁률', selectionFormula:'전형요소 반영비율',
  practicalType:'실기과목', applicationPeriod:'원서접수기간', practicalExamDate:'실기(면접)시험일', resultDate:'합격자 발표',
  eligibility:'지원자격기준', csatMinimum:'최저학력기준', admissionGroup:'군', csatSubjects:'수능응시영역기준', csatMetric:'수능활용지표',
  koreanRatio:'국어비율', koreanSubject:'국어선택과목', englishMethod:'영어반영', mathRatio:'수학비율', mathSubject:'수학선택과목',
  historyMethod:'한국사반영', inquiryRatio:'탐구비율', inquirySubject:'탐구선택과목', inquiryCount:'탐구과목 수', bonus:'선택 및 가산',
};

export function parseSimpleRatios(formula) {
  const result = { gradeRatio:null, practicalRatio:null, csatRatio:null, documentRatio:null, interviewRatio:null };
  const s = text(formula, 1000);
  // Staged, point-based and conditional formulas remain verbatim facts, never guessed percentages.
  if (/단계|차|배수|점|이상|이하|중|또는|\//.test(s)) return result;
  const patterns = {gradeRatio:'학생부(?:교과)?|교과',practicalRatio:'실기',csatRatio:'수능',documentRatio:'서류',interviewRatio:'면접'};
  const fragments = s.split(/[+＋,\n]/).map((v) => v.trim()).filter(Boolean);
  if (!fragments.length) return result;
  for (const f of fragments) {
    let matched = false;
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = f.match(new RegExp(`^(?:${pattern})\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*%?$`));
      if (match && result[key] === null) { result[key] = number(match[1],100); matched = result[key] !== null; break; }
    }
    if (!matched) return { gradeRatio:null, practicalRatio:null, csatRatio:null, documentRatio:null, interviewRatio:null };
  }
  if (Object.values(result).reduce((sum,v) => sum + (v || 0),0) !== 100) return {gradeRatio:null,practicalRatio:null,csatRatio:null,documentRatio:null,interviewRatio:null};
  return result;
}

export function decodePublicGuidelines(raw, season, provenance) {
  if (!['susi','jungsi'].includes(season) || !Array.isArray(raw?.c) || !Array.isArray(raw?.p) || !Array.isArray(raw?.r) || !raw.r.length || raw.r.length > 10000) throw new Error('Invalid public source schema');
  for (const key of ['학년도','대학','모집단위','전형명']) if (!raw.c.includes(key)) throw new Error('Missing source columns');
  return raw.r.map((cells) => {
    if (!Array.isArray(cells)) throw new Error('Invalid public row');
    const row = { schemaVersion:1, admissionSeason:season, sourceApp:'admissions', sourcePriority:50, ...provenance };
    for (const [key,column] of Object.entries(publicColumns)) {
      const index = raw.c.indexOf(column);
      if (index < 0) { row[key] = null; continue; }
      const poolIndex = cells[index];
      if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= raw.p.length) throw new Error('Invalid source string pool');
      row[key] = text(raw.p[poolIndex], 1600) || null;
    }
    if (!/^20\d{2}$/.test(String(row.academicYear)) || !row.universityName || !row.department || !row.admissionType) throw new Error('Missing source identity');
    row.campus = universityIdentity(row.universityName).campus;
    row.quota = number(row.quota);
    row.competitionRate = number(String(row.competitionRate ?? '').replace(/\s*:\s*1$/, ''));
    return Object.assign(row, parseSimpleRatios(row.selectionFormula));
  });
}

export function guidelineIdentity(row) {
  const u = universityIdentity(row.universityName, row.campus);
  return JSON.stringify([row.academicYear,row.admissionSeason,u.school,u.campus,normalizeName(row.department),normalizeName(row.admissionType),normalizeName(row.admissionCategory),row.admissionGroup || '']);
}
export function preserveKnownValues(previous, next) {
  const merged = {...previous};
  for (const [key,value] of Object.entries(next)) if (value !== null && value !== undefined && value !== '') merged[key] = value;
  if (next.selectionFormula && next.selectionFormula !== previous.selectionFormula) Object.assign(merged,parseSimpleRatios(next.selectionFormula));
  if (next.mappingStatus && next.mappingStatus !== 'matched') merged.universityId = null;
  return merged;
}
export function projectGuideline(row) {
  const result = {};
  const numbers = ['quota','competitionRate','gradeRatio','practicalRatio','csatRatio','documentRatio','interviewRatio'];
  for (const key of [...new Set([...Object.keys(publicColumns),...numbers]),'campus','admissionSeason','sourceName','sourceUpdatedAt','fetchedAt','universityId','mappingStatus']) result[key] = numbers.includes(key) ? number(row[key],key.includes('Ratio')?100:Infinity) : text(row[key],1600) || null;
  result.sourceUrl = https(row.sourceUrl);
  return result;
}
export function selectGuidelines(rows, filters = {}) {
  const needles = String(filters.query || '').trim().split(/\s+/).map(normalizeName).filter(Boolean);
  const result = rows.filter((r) => (!filters.id || r.id === filters.id) && (!filters.season || r.admissionSeason === filters.season) &&
    (!filters.mappingStatus || r.mappingStatus === filters.mappingStatus) && (!filters.mappingReason || r.mappingReason === filters.mappingReason) &&
    (!filters.year || String(r.academicYear) === String(filters.year)) && (!filters.region || r.region === filters.region) &&
    (!filters.university || r.universityName === filters.university) && (!filters.group || r.admissionGroup === filters.group) &&
    (!filters.category || r.admissionCategory === filters.category) && (!filters.practical || r.practicalType === filters.practical) &&
    (!filters.major || matchesCareer(r.department,filters.major)) && (!filters.csatSubjects || r.csatSubjects === filters.csatSubjects) &&
    (!filters.minimum || (filters.minimum === 'none' ? /^(없음|미적용|해당없음)$/.test(r.csatMinimum || '') : Boolean(r.csatMinimum && !/^(없음|미적용|해당없음)$/.test(r.csatMinimum)))) &&
    ['gradeRatio','practicalRatio','csatRatio'].every((key) => filters[key] === undefined || filters[key] === '' || (r[key] !== null && r[key] >= Number(filters[key]))) &&
    needles.every((q) => normalizeName([r.universityName,r.department,r.region,r.admissionType,r.practicalType].join(' ')).includes(q)));
  return result.sort((a,b) => {
    const key = {practical:'practicalRatio',grade:'gradeRatio',competition:'competitionRate'}[filters.sort];
    if (key) return (b[key] ?? -1) - (a[key] ?? -1) || String(a.universityName).localeCompare(String(b.universityName),'ko');
    if (filters.sort === 'region') return String(a.region || '').localeCompare(String(b.region || ''),'ko');
    return String(a.universityName).localeCompare(String(b.universityName),'ko') || Number(b.academicYear)-Number(a.academicYear);
  });
}

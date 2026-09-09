// Verified against anonymous table META. Member-only JSON columns are excluded.
export const detailColumns = {
  admissionDivision:['전형구분'], admissionSubtype:['전형유형세부'],
  previousQuota:['전년도 모집인원'], previousApplicants:['전년도 지원인원'],
  practicalVenue:['실기(면접) 일정/고사장'], scheduleNotes:['기타'],
  documents:['서류제출(해당자)','서류제출기간(해당자)'],
  subjectCount:['반영영역 수'], secondLanguage:['제2외국어/한문'],
  admissionsContact:['대학주소 및 입학문의'], universityWebsite:['홈페이지'],
};
export function projectPublicDetails(value) {
  const result = {};
  for (const key of Object.keys(detailColumns)) {
    const v = value?.[key];
    if (['string','number'].includes(typeof v) && String(v).trim()) result[key] = String(v).trim().slice(0,1600);
  }
  return result;
}
export function enrichPublicDetails(previous, incoming) {
  if (Number(previous.sourcePriority || 0)>50 || /^(verified|manual-verified|official-university)$/.test(previous.verificationStatus || '')) return previous;
  const merged = {...projectPublicDetails(incoming),...projectPublicDetails(previous.publicDetails)};
  return Object.keys(merged).length ? {...previous,publicDetails:merged} : previous;
}
export const guidelineSections = [
  ['기본정보',[['academicYear','학년도'],['universityName','대학'],['campus','캠퍼스'],['region','지역'],['department','학과·모집단위'],['admissionDivision','전형구분'],['admissionCategory','전형유형'],['admissionSubtype','전형유형세부'],['admissionType','전형명'],['admissionGroup','모집군'],['quota','모집인원']]],
  ['전형방법',[['selectionFormula','전형요소 반영방법'],['gradeRatio','학생부 반영비율 (%)'],['practicalRatio','실기 반영비율 (%)'],['csatRatio','수능 반영비율 (%)'],['documentRatio','서류 반영비율 (%)'],['interviewRatio','면접 반영비율 (%)']]],
  ['학생부',[['gradeMethod','학생부 반영방법'],['gradeSubjects','반영과목'],['gradeYears','학년별 반영'],['attendance','출결·봉사']]],
  ['수능',[['csatSubjects','수능 응시영역'],['subjectCount','반영영역 수'],['csatMetric','수능 활용지표'],['koreanRatio','국어 비율'],['koreanSubject','국어 선택과목'],['englishMethod','영어 반영'],['mathRatio','수학 비율'],['mathSubject','수학 선택과목'],['historyMethod','한국사 반영'],['inquiryRatio','탐구 비율'],['inquirySubject','탐구 선택과목'],['inquiryCount','탐구 과목 수'],['secondLanguage','제2외국어·한문'],['bonus','선택과목·가산'],['csatMinimum','수능최저']]],
  ['실기',[['practicalType','실기과목·유형'],['practicalDuration','실기 시간'],['practicalPaper','실기 규격·용지'],['practicalVenue','실기·면접 일정/고사장']]],
  ['전년도 지원 현황',[['previousQuota','모집인원'],['previousApplicants','지원인원'],['competitionRate','경쟁률']]],
  ['일정',[['applicationPeriod','원서접수기간'],['practicalExamDate','실기·면접 시험일'],['resultDate','합격자 발표'],['documents','서류제출'],['registrationPeriod','등록 일정']]],
  ['지원자격',[['eligibility','지원자격기준']]],
  ['비고',[['scheduleNotes','기타 일정'],['admissionsContact','대학주소·입학문의'],['universityWebsite','대학 홈페이지']]],
];

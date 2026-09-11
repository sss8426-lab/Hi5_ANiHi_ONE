export const ratioPrograms = [
  ['A','학생부20 + 실기80'],
  ['B','학생부10 + 수능20 + 실기70'],
  ['C','수능40 + 실기60'],
  ['D','실기100'],
  ['E','수능100'],
  ['F','학생부20 + 실기60 + 면접20'],
  ['G','1단계 학생부100 / 2단계 1단계40 + 실기60'],
  ['H','확인 필요'],
  ['I','학생부25 + 실기75'],
  ['J','학생부35 + 실기65'],
].map(([id,selectionFormula])=>({id:`synthetic-ratio-${id}`,metadata:{
  universityName:`합성 대학 ${id}`,major:'웹툰콘텐츠학과',year:2028,
  region:['A','D','G','H'].includes(id)?'경기':'서울',schoolType:id==='C'?'전문대':'4년제',
  admission:id==='C'?'정시':'수시',admissionSeason:id==='C'?'jungsi':'susi',
  guidelineId:`synthetic-ratio-${id}`,selectionFormula,
  sourceUrl:'https://grinalda.net/univ-info-susi/',verificationStatus:'public-source-unverified',
  practicalType:'합성 실기',quota:0,competitionRate:0,
}}));

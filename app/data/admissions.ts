export type SupportLevel = "안정" | "적정" | "소신" | "도전";

export type CompetitionRates = Record<string, number>;

export type AdmissionProgram = {
  id: string;
  year: number;
  university: string;
  department: string;
  admissionType: string;
  category: string;
  capacity: number;
  gradeWeight: number;
  skillWeight: number;
  subjects: string[];
  gradeFormula: string;
  skillType: string;
  competitionRates: CompetitionRates;
  applicationPeriod: string;
  practicalExamDate: string;
  resultDate: string;
  avgAcceptedGrade: number;
  avgAcceptedSkill: number;
  previousYear?: {
    capacity: number;
    gradeWeight: number;
    skillWeight: number;
  };
};

export type AdmissionCase = {
  id: string;
  programId: string;
  year: number;
  gradeAverage: number;
  reflectedSubjects: string;
  skillScore: number;
  competitionRate: number;
  result: "합격" | "불합격";
  artworkTone: "blue" | "green" | "orange" | "red" | "violet";
  teacherNote: string;
};

export type StudentProfile = {
  name: string;
  school: string;
  gradeYear: string;
  category: string;
  desiredMajor: string;
  gradeAverage: number;
  koreanGrade: number;
  englishGrade: number;
  mathGrade: number;
  socialGrade: number;
  skillScore: number;
  desiredUniversity: string;
  memo: string;
};

export const initialStudent: StudentProfile = {
  name: "김하린",
  school: "서울예술고",
  gradeYear: "고3",
  category: "미술·웹툰",
  desiredMajor: "웹툰 / 게임일러스트",
  gradeAverage: 3.2,
  koreanGrade: 3,
  englishGrade: 2,
  mathGrade: 4,
  socialGrade: 3,
  skillScore: 82,
  desiredUniversity: "홍익대학교, 청강문화산업대학교",
  memo: "실기 완성도는 안정적이며 웹툰 스토리텔링 보완 필요",
};

export const admissionPrograms: AdmissionProgram[] = [
  {
    id: "hongik-design-2027",
    year: 2027,
    university: "홍익대학교",
    department: "디자인·미술계열",
    admissionType: "수시 실기우수자전형",
    category: "미술",
    capacity: 25,
    gradeWeight: 30,
    skillWeight: 70,
    subjects: ["국어", "영어", "탐구"],
    gradeFormula: "반영 과목 등급 평균을 100점 환산 후 반영",
    skillType: "기초디자인 / 사고의 전환",
    competitionRates: { "2024": 8.5, "2025": 11.2, "2026": 10.8 },
    applicationPeriod: "2026.09.09 - 2026.09.13",
    practicalExamDate: "2026.10.18",
    resultDate: "2026.12.14",
    avgAcceptedGrade: 3.1,
    avgAcceptedSkill: 88,
    previousYear: { capacity: 30, gradeWeight: 40, skillWeight: 60 },
  },
  {
    id: "sangmyung-animation-2027",
    year: 2027,
    university: "상명대학교",
    department: "애니메이션학과",
    admissionType: "수시 실기전형",
    category: "만화·애니메이션",
    capacity: 32,
    gradeWeight: 40,
    skillWeight: 60,
    subjects: ["국어", "영어", "사회"],
    gradeFormula: "상위 3개 교과 등급 평균",
    skillType: "상황표현 / 칸만화",
    competitionRates: { "2024": 9.1, "2025": 10.4, "2026": 12.1 },
    applicationPeriod: "2026.09.10 - 2026.09.14",
    practicalExamDate: "2026.10.25",
    resultDate: "2026.12.12",
    avgAcceptedGrade: 3.4,
    avgAcceptedSkill: 84,
    previousYear: { capacity: 32, gradeWeight: 40, skillWeight: 60 },
  },
  {
    id: "chungkang-webtoon-2027",
    year: 2027,
    university: "청강문화산업대학교",
    department: "웹툰만화콘텐츠",
    admissionType: "수시 실기중심전형",
    category: "웹툰",
    capacity: 44,
    gradeWeight: 20,
    skillWeight: 80,
    subjects: ["국어", "영어"],
    gradeFormula: "국어·영어 중 우수 과목 중심 반영",
    skillType: "웹툰 상황표현 / 캐릭터 콘셉트",
    competitionRates: { "2024": 12.4, "2025": 13.9, "2026": 15.3 },
    applicationPeriod: "2026.09.08 - 2026.09.12",
    practicalExamDate: "2026.10.11",
    resultDate: "2026.11.28",
    avgAcceptedGrade: 3.8,
    avgAcceptedSkill: 86,
    previousYear: { capacity: 40, gradeWeight: 20, skillWeight: 80 },
  },
  {
    id: "kaywon-illustration-2027",
    year: 2027,
    university: "계원예술대학교",
    department: "게임미디어과",
    admissionType: "수시 실기전형",
    category: "게임일러스트",
    capacity: 36,
    gradeWeight: 30,
    skillWeight: 70,
    subjects: ["국어", "영어", "탐구"],
    gradeFormula: "학생부 교과 등급 평균 반영",
    skillType: "게임 캐릭터 디자인",
    competitionRates: { "2024": 7.8, "2025": 8.2, "2026": 9.6 },
    applicationPeriod: "2026.09.11 - 2026.09.15",
    practicalExamDate: "2026.10.19",
    resultDate: "2026.12.10",
    avgAcceptedGrade: 4.0,
    avgAcceptedSkill: 80,
    previousYear: { capacity: 36, gradeWeight: 30, skillWeight: 70 },
  },
  {
    id: "sejong-cartoon-2027",
    year: 2027,
    university: "세종대학교",
    department: "만화애니메이션텍",
    admissionType: "수시 예체능우수자",
    category: "만화·애니메이션",
    capacity: 18,
    gradeWeight: 45,
    skillWeight: 55,
    subjects: ["국어", "영어", "수학", "탐구"],
    gradeFormula: "전 교과 중 반영 교과 석차 등급 환산",
    skillType: "스토리보드 / 상황묘사",
    competitionRates: { "2024": 14.5, "2025": 15.8, "2026": 16.2 },
    applicationPeriod: "2026.09.09 - 2026.09.13",
    practicalExamDate: "2026.10.26",
    resultDate: "2026.12.16",
    avgAcceptedGrade: 2.9,
    avgAcceptedSkill: 87,
    previousYear: { capacity: 20, gradeWeight: 40, skillWeight: 60 },
  },
  {
    id: "kongju-game-2027",
    year: 2027,
    university: "공주대학교",
    department: "게임디자인학과",
    admissionType: "수시 일반전형",
    category: "게임일러스트",
    capacity: 22,
    gradeWeight: 50,
    skillWeight: 50,
    subjects: ["국어", "영어", "탐구"],
    gradeFormula: "교과 성적 50%와 실기 50% 합산",
    skillType: "게임 배경 / 캐릭터 발상",
    competitionRates: { "2024": 6.1, "2025": 7.3, "2026": 7.9 },
    applicationPeriod: "2026.09.12 - 2026.09.16",
    practicalExamDate: "2026.10.22",
    resultDate: "2026.12.09",
    avgAcceptedGrade: 4.2,
    avgAcceptedSkill: 78,
    previousYear: { capacity: 24, gradeWeight: 50, skillWeight: 50 },
  },
];

export const admissionCases: AdmissionCase[] = [
  {
    id: "2026-HONGIK-001",
    programId: "hongik-design-2027",
    year: 2026,
    gradeAverage: 3.1,
    reflectedSubjects: "국어 3 / 영어 2 / 탐구 3",
    skillScore: 88,
    competitionRate: 9.8,
    result: "합격",
    artworkTone: "blue",
    teacherNote: "구도와 화면 장악력이 좋고 색 대비가 안정적임",
  },
  {
    id: "2026-HONGIK-019",
    programId: "hongik-design-2027",
    year: 2026,
    gradeAverage: 3.0,
    reflectedSubjects: "국어 3 / 영어 3 / 탐구 3",
    skillScore: 74,
    competitionRate: 11.2,
    result: "불합격",
    artworkTone: "orange",
    teacherNote: "아이디어는 좋으나 마감 완성도와 명암 정리가 부족함",
  },
  {
    id: "2026-SMU-006",
    programId: "sangmyung-animation-2027",
    year: 2026,
    gradeAverage: 3.5,
    reflectedSubjects: "국어 3 / 영어 3 / 사회 4",
    skillScore: 85,
    competitionRate: 12.1,
    result: "합격",
    artworkTone: "green",
    teacherNote: "캐릭터 동세와 감정 표현이 선명함",
  },
  {
    id: "2026-SMU-024",
    programId: "sangmyung-animation-2027",
    year: 2026,
    gradeAverage: 3.3,
    reflectedSubjects: "국어 3 / 영어 4 / 사회 3",
    skillScore: 72,
    competitionRate: 13.4,
    result: "불합격",
    artworkTone: "red",
    teacherNote: "스토리 연결은 보이나 컷 구성의 밀도가 낮음",
  },
  {
    id: "2026-CK-014",
    programId: "chungkang-webtoon-2027",
    year: 2026,
    gradeAverage: 3.7,
    reflectedSubjects: "국어 4 / 영어 3",
    skillScore: 89,
    competitionRate: 14.7,
    result: "합격",
    artworkTone: "violet",
    teacherNote: "웹툰형 연출과 컷 간 리듬이 우수함",
  },
  {
    id: "2026-CK-041",
    programId: "chungkang-webtoon-2027",
    year: 2026,
    gradeAverage: 3.6,
    reflectedSubjects: "국어 4 / 영어 3",
    skillScore: 76,
    competitionRate: 15.1,
    result: "불합격",
    artworkTone: "orange",
    teacherNote: "캐릭터 설정은 좋으나 시간 안배와 완성도 보완 필요",
  },
  {
    id: "2026-KAYWON-003",
    programId: "kaywon-illustration-2027",
    year: 2026,
    gradeAverage: 4.1,
    reflectedSubjects: "국어 4 / 영어 4 / 탐구 4",
    skillScore: 82,
    competitionRate: 8.9,
    result: "합격",
    artworkTone: "blue",
    teacherNote: "게임 캐릭터의 장비 설정과 컬러 기획이 명확함",
  },
  {
    id: "2026-KAYWON-022",
    programId: "kaywon-illustration-2027",
    year: 2026,
    gradeAverage: 3.9,
    reflectedSubjects: "국어 4 / 영어 3 / 탐구 4",
    skillScore: 70,
    competitionRate: 9.4,
    result: "불합격",
    artworkTone: "red",
    teacherNote: "형태력 보완과 주요 캐릭터 실루엣 정리가 필요함",
  },
  {
    id: "2026-SEJONG-011",
    programId: "sejong-cartoon-2027",
    year: 2026,
    gradeAverage: 2.8,
    reflectedSubjects: "국어 2 / 영어 3 / 수학 3 / 탐구 3",
    skillScore: 88,
    competitionRate: 16.2,
    result: "합격",
    artworkTone: "green",
    teacherNote: "상황 연출의 긴장감과 인물 표정 설계가 좋음",
  },
  {
    id: "2026-SEJONG-030",
    programId: "sejong-cartoon-2027",
    year: 2026,
    gradeAverage: 3.0,
    reflectedSubjects: "국어 3 / 영어 3 / 수학 3 / 탐구 3",
    skillScore: 75,
    competitionRate: 17.1,
    result: "불합격",
    artworkTone: "orange",
    teacherNote: "소재 해석은 좋지만 장면 전환이 단조로움",
  },
  {
    id: "2026-KONGJU-007",
    programId: "kongju-game-2027",
    year: 2026,
    gradeAverage: 4.3,
    reflectedSubjects: "국어 4 / 영어 4 / 탐구 5",
    skillScore: 80,
    competitionRate: 7.4,
    result: "합격",
    artworkTone: "violet",
    teacherNote: "게임 세계관과 배경 소품 설계가 일관됨",
  },
  {
    id: "2026-KONGJU-018",
    programId: "kongju-game-2027",
    year: 2026,
    gradeAverage: 4.1,
    reflectedSubjects: "국어 4 / 영어 4 / 탐구 4",
    skillScore: 68,
    competitionRate: 8.1,
    result: "불합격",
    artworkTone: "red",
    teacherNote: "주제 전달은 가능하나 원근과 빛 방향 보완 필요",
  },
];

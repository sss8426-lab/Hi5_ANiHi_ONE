import type {
  AdmissionCase,
  AdmissionProgram,
  StudentProfile,
  SupportLevel,
} from "../data/admissions";

export type Recommendation = {
  program: AdmissionProgram;
  probability: number;
  level: SupportLevel;
  gradeScore: number;
  skillScore: number;
  competitionPenalty: number;
};

export type StrategySummary = Record<SupportLevel, Recommendation[]>;

const levelOrder: SupportLevel[] = ["안정", "적정", "소신", "도전"];

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function latestCompetitionRate(program: AdmissionProgram) {
  const years = Object.keys(program.competitionRates).sort();
  return program.competitionRates[years[years.length - 1]] ?? 10;
}

function getSupportLevel(probability: number): SupportLevel {
  if (probability >= 68) return "안정";
  if (probability >= 50) return "적정";
  if (probability >= 35) return "소신";
  return "도전";
}

export function getRecommendations(
  student: StudentProfile,
  programs: AdmissionProgram[],
): Recommendation[] {
  return programs
    .map((program) => {
      // 내신은 숫자가 낮을수록 유리하므로 합격생 평균과의 차이를 반대로 계산한다.
      const gradeGap = program.avgAcceptedGrade - student.gradeAverage;
      const gradeScore = clamp(72 + gradeGap * 13);
      const skillGap = student.skillScore - program.avgAcceptedSkill;
      const skillScore = clamp(70 + skillGap * 2.3);
      const competitionPenalty = Math.min(18, latestCompetitionRate(program) * 0.65);
      const fitBonus =
        student.desiredMajor.includes(program.category) ||
        student.desiredUniversity.includes(program.university)
          ? 4
          : 0;

      const weightedScore =
        (gradeScore * program.gradeWeight + skillScore * program.skillWeight) /
        100;
      const probability = Math.round(
        clamp(weightedScore - competitionPenalty + fitBonus),
      );

      return {
        program,
        probability,
        level: getSupportLevel(probability),
        gradeScore: Math.round(gradeScore),
        skillScore: Math.round(skillScore),
        competitionPenalty: Math.round(competitionPenalty),
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

export function groupStrategy(
  recommendations: Recommendation[],
): StrategySummary {
  return levelOrder.reduce((summary, level) => {
    summary[level] = recommendations.filter((item) => item.level === level);
    return summary;
  }, {} as StrategySummary);
}

export function findCasesForProgram(
  programId: string,
  cases: AdmissionCase[],
) {
  return {
    accepted: cases.find(
      (item) => item.programId === programId && item.result === "합격",
    ),
    rejected: cases.find(
      (item) => item.programId === programId && item.result === "불합격",
    ),
  };
}

export function getChangedAdmissionFields(program: AdmissionProgram) {
  if (!program.previousYear) return [];

  const checks = [
    ["모집인원", program.previousYear.capacity, program.capacity, "명"],
    ["성적 반영비", program.previousYear.gradeWeight, program.gradeWeight, "%"],
    ["실기 반영비", program.previousYear.skillWeight, program.skillWeight, "%"],
  ] as const;

  return checks
    .filter(([, before, after]) => before !== after)
    .map(([label, before, after, unit]) => ({
      label,
      before: `${before}${unit}`,
      after: `${after}${unit}`,
    }));
}

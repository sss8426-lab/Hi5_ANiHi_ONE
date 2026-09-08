import { DataCoreAccessContext, DataCoreAccessError } from "./data-core-access";
import {
  KKUMEUM_ANALYTICS_MIN_COHORT_SIZE,
  computeKkumeumAnalyticsPreview,
  normalizeAnalyticsYearMonth,
  requireAnalyticsPreviewAccess,
  type KkumeumAnalyticsPreview,
} from "./kkumeum-analytics";

export const KKUMEUM_ANALYTICS_TREND_SCHEMA_VERSION = "kkumeum-growth-trend-v1";
export const KKUMEUM_ANALYTICS_TREND_MAX_MONTHS = 12;

export type KkumeumAnalyticsTrend = {
  schemaVersion: string;
  campusId: string;
  fromYearMonth: string;
  toYearMonth: string;
  minimumCohortSize: number;
  months: Array<{
    yearMonth: string;
    activeStudentCount: number;
    reportCompletionRate: number;
    artworkAveragePerActiveStudent: number;
    growthSkills: KkumeumAnalyticsPreview["growthSkills"];
  }>;
};

function monthOrdinal(yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  return year * 12 + month - 1;
}

function yearMonthFromOrdinal(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function normalizeAnalyticsTrendRange(
  fromValue: unknown,
  toValue: unknown,
): { fromYearMonth: string; toYearMonth: string; months: string[] } {
  const fromYearMonth = normalizeAnalyticsYearMonth(fromValue);
  const toYearMonth = normalizeAnalyticsYearMonth(toValue);
  const fromOrdinal = monthOrdinal(fromYearMonth);
  const toOrdinal = monthOrdinal(toYearMonth);
  if (fromOrdinal > toOrdinal) {
    throw new DataCoreAccessError(400, "fromYearMonth는 toYearMonth보다 늦을 수 없습니다.");
  }
  const monthCount = toOrdinal - fromOrdinal + 1;
  if (monthCount > KKUMEUM_ANALYTICS_TREND_MAX_MONTHS) {
    throw new DataCoreAccessError(400, `성장 흐름은 최대 ${KKUMEUM_ANALYTICS_TREND_MAX_MONTHS}개월까지 조회할 수 있습니다.`);
  }
  return {
    fromYearMonth,
    toYearMonth,
    months: Array.from({ length: monthCount }, (_, index) => yearMonthFromOrdinal(fromOrdinal + index)),
  };
}

export async function computeKkumeumAnalyticsTrend(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusIdValue: unknown,
  fromValue: unknown,
  toValue: unknown,
): Promise<KkumeumAnalyticsTrend> {
  const campusId = requireAnalyticsPreviewAccess(context, campusIdValue);
  const range = normalizeAnalyticsTrendRange(fromValue, toValue);
  const months: KkumeumAnalyticsTrend["months"] = [];

  for (const yearMonth of range.months) {
    const preview = await computeKkumeumAnalyticsPreview(familyDb, context, campusId, yearMonth);
    months.push({
      yearMonth,
      activeStudentCount: preview.activeStudentCount,
      reportCompletionRate: preview.reports.completionRate,
      artworkAveragePerActiveStudent: preview.artworks.averagePerActiveStudent,
      growthSkills: preview.growthSkills,
    });
  }

  return {
    schemaVersion: KKUMEUM_ANALYTICS_TREND_SCHEMA_VERSION,
    campusId,
    fromYearMonth: range.fromYearMonth,
    toYearMonth: range.toYearMonth,
    minimumCohortSize: KKUMEUM_ANALYTICS_MIN_COHORT_SIZE,
    months,
  };
}

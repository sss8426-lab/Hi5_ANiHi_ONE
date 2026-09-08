import taxonomy from "../docs/KKUMEUM_GROWTH_SKILL_TAXONOMY_V1.json";
import { DataCoreAccessError } from "./data-core-access";

export const KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION = taxonomy.schemaVersion;
export const KKUMEUM_GROWTH_SKILL_MAX_SELECTIONS = taxonomy.maxSelectionsPerReport;

export type KkumeumGrowthSkill = {
  code: string;
  labelKo: string;
  categoryCode: string;
  categoryLabelKo: string;
};

export const KKUMEUM_GROWTH_SKILL_REGISTRY: readonly KkumeumGrowthSkill[] = Object.freeze(
  taxonomy.categories.flatMap((category) =>
    category.skills.map((skill) => Object.freeze({
      code: skill.code,
      labelKo: skill.labelKo,
      categoryCode: category.code,
      categoryLabelKo: category.labelKo,
    })),
  ),
);

const KKUMEUM_GROWTH_SKILL_CODES = new Set(
  KKUMEUM_GROWTH_SKILL_REGISTRY.map((skill) => skill.code),
);

export function isKkumeumGrowthSkillCode(value: unknown): value is string {
  return typeof value === "string" && KKUMEUM_GROWTH_SKILL_CODES.has(value);
}

/**
 * Validates a report's structured growth-area selection.
 *
 * These codes represent observed/guided areas only. They are deliberately
 * unscored and must never be treated as a ranking signal.
 */
export function normalizeKkumeumGrowthSkillCodes(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DataCoreAccessError(400, "성장 영역은 표준 코드 목록으로 선택해야 합니다.");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new DataCoreAccessError(400, "성장 영역 코드 형식이 올바르지 않습니다.");
    }
    const code = raw.trim();
    if (!isKkumeumGrowthSkillCode(code)) {
      throw new DataCoreAccessError(400, "지원하지 않는 성장 영역 코드가 포함되어 있습니다.");
    }
    if (seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }

  if (normalized.length > KKUMEUM_GROWTH_SKILL_MAX_SELECTIONS) {
    throw new DataCoreAccessError(
      400,
      `성장 영역은 최대 ${KKUMEUM_GROWTH_SKILL_MAX_SELECTIONS}개까지 선택할 수 있습니다.`,
    );
  }
  return normalized;
}

export function kkumeumGrowthSkillCatalog() {
  return {
    taxonomyVersion: KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION,
    maxSelections: KKUMEUM_GROWTH_SKILL_MAX_SELECTIONS,
    categories: taxonomy.categories,
  };
}

import {
  DataCoreAccessContext,
  DataCoreAccessError,
} from "./data-core-access";
import {
  createDataRecord,
  deleteDataRecord,
  getDataRecord,
  listDataRecords,
  updateDataRecord,
} from "./data-core-records";
import { setDataRecordContent } from "./data-core-search";

const SOURCE_APP = "competition";
const COMPETITION_TYPE = "competition";
const RESULT_TYPE = "competition-result";

export type CompetitionInput = {
  campusId?: string | null;
  title?: string;
  summary?: string | null;
  content?: string | null;
  visibility?: "private" | "campus" | "organization" | "public";
  organizer?: string | null;
  hostSchool?: string | null;
  competitionKind?: "contest" | "practical-competition" | "award" | "other";
  applicationStart?: string | null;
  applicationEnd?: string | null;
  eventDate?: string | null;
  resultDate?: string | null;
  targetGrades?: string[];
  majors?: string[];
  practicalTypes?: string[];
  prize?: string | null;
  applicationMethod?: string | null;
  sourceUrl?: string | null;
  guideUrl?: string | null;
  year?: number | string | null;
  tags?: string[];
};

export type CompetitionResultInput = {
  campusId?: string | null;
  title?: string;
  summary?: string | null;
  participants?: number | null;
  winners?: number | null;
  gold?: number | null;
  silver?: number | null;
  bronze?: number | null;
  honorableMention?: number | null;
  otherAwards?: number | null;
  year?: number | string | null;
  practicalType?: string | null;
  grade?: string | null;
  tags?: string[];
};

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function stringList(value: unknown, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, 100)).filter(Boolean))).slice(0, maxItems);
}

function dateOrNull(value: unknown) {
  const normalized = text(value, 32);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new DataCoreAccessError(400, "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new DataCoreAccessError(400, "올바르지 않은 날짜입니다.");
  }
  return normalized;
}

function yearOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new DataCoreAccessError(400, "year는 올바른 연도여야 합니다.");
  }
  return year;
}

function nonNegativeInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new DataCoreAccessError(400, "인원/수상 수치는 0 이상의 정수여야 합니다.");
  }
  return number;
}

function normalizeKind(value: unknown) {
  const kind = text(value, 40);
  if (["contest", "practical-competition", "award", "other"].includes(kind)) return kind;
  return "contest";
}

function metadataFromCompetition(input: CompetitionInput) {
  return {
    schemaVersion: 1,
    organizer: text(input.organizer, 200) || null,
    hostSchool: text(input.hostSchool, 200) || null,
    competitionKind: normalizeKind(input.competitionKind),
    applicationStart: dateOrNull(input.applicationStart),
    applicationEnd: dateOrNull(input.applicationEnd),
    eventDate: dateOrNull(input.eventDate),
    resultDate: dateOrNull(input.resultDate),
    targetGrades: stringList(input.targetGrades),
    majors: stringList(input.majors),
    practicalTypes: stringList(input.practicalTypes),
    prize: text(input.prize, 1000) || null,
    applicationMethod: text(input.applicationMethod, 2000) || null,
    sourceUrl: text(input.sourceUrl, 2000) || null,
    guideUrl: text(input.guideUrl, 2000) || null,
    year: yearOrNull(input.year),
  };
}

function buildCompetitionTags(input: CompetitionInput) {
  return Array.from(
    new Set([
      "공모전·실기대회",
      ...stringList(input.tags),
      ...stringList(input.majors),
      ...stringList(input.practicalTypes),
      ...stringList(input.targetGrades),
      text(input.hostSchool, 100),
      text(input.organizer, 100),
      input.year ? String(input.year) : "",
    ].filter(Boolean)),
  ).slice(0, 30);
}

function currentCompetitionStatus(metadata: Record<string, unknown>) {
  const today = new Date().toISOString().slice(0, 10);
  const start = typeof metadata.applicationStart === "string" ? metadata.applicationStart : null;
  const end = typeof metadata.applicationEnd === "string" ? metadata.applicationEnd : null;
  const resultDate = typeof metadata.resultDate === "string" ? metadata.resultDate : null;
  if (resultDate && today >= resultDate) return "result-announced";
  if (end && today > end) return "closed";
  if (start && today < start) return "upcoming";
  if (start || end) return "open";
  return "unknown";
}

function decorateCompetition(record: Record<string, unknown>) {
  const metadata = (record.metadata && typeof record.metadata === "object")
    ? record.metadata as Record<string, unknown>
    : {};
  return {
    ...record,
    competitionStatus: currentCompetitionStatus(metadata),
  };
}

async function assertCompetition(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
) {
  const record = await getDataRecord(db, context, competitionId) as Record<string, unknown>;
  if (record.sourceApp !== SOURCE_APP || record.recordType !== COMPETITION_TYPE) {
    throw new DataCoreAccessError(404, "공모전/실기대회 정보를 찾을 수 없습니다.");
  }
  return record;
}

export async function listCompetitions(
  db: D1Database,
  context: DataCoreAccessContext,
  requestUrl: URL,
) {
  const url = new URL(requestUrl.toString());
  url.searchParams.set("sourceApp", SOURCE_APP);
  url.searchParams.set("recordType", COMPETITION_TYPE);
  const records = await listDataRecords(db, context, url) as Record<string, unknown>[];
  return records.map(decorateCompetition);
}

export async function createCompetition(
  db: D1Database,
  context: DataCoreAccessContext,
  input: CompetitionInput,
) {
  const title = text(input.title, 240);
  if (!title) throw new DataCoreAccessError(400, "공모전/실기대회명이 필요합니다.");

  const record = await createDataRecord(db, context, {
    campusId: input.campusId,
    recordType: COMPETITION_TYPE,
    sourceApp: SOURCE_APP,
    title,
    summary: text(input.summary, 10_000) || null,
    visibility: input.visibility || "organization",
    metadata: metadataFromCompetition(input),
    tags: buildCompetitionTags(input),
  }) as Record<string, unknown>;

  if (input.content) {
    await setDataRecordContent(db, context, String(record.id), input.content);
  }
  return decorateCompetition(record);
}

export async function getCompetition(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
) {
  return decorateCompetition(await assertCompetition(db, context, competitionId));
}

export async function updateCompetition(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
  input: CompetitionInput,
) {
  const existing = await assertCompetition(db, context, competitionId);
  const existingMetadata = (existing.metadata && typeof existing.metadata === "object")
    ? existing.metadata as Record<string, unknown>
    : {};

  const mergedMetadata = {
    ...existingMetadata,
    ...(input.organizer !== undefined ? { organizer: text(input.organizer, 200) || null } : {}),
    ...(input.hostSchool !== undefined ? { hostSchool: text(input.hostSchool, 200) || null } : {}),
    ...(input.competitionKind !== undefined ? { competitionKind: normalizeKind(input.competitionKind) } : {}),
    ...(input.applicationStart !== undefined ? { applicationStart: dateOrNull(input.applicationStart) } : {}),
    ...(input.applicationEnd !== undefined ? { applicationEnd: dateOrNull(input.applicationEnd) } : {}),
    ...(input.eventDate !== undefined ? { eventDate: dateOrNull(input.eventDate) } : {}),
    ...(input.resultDate !== undefined ? { resultDate: dateOrNull(input.resultDate) } : {}),
    ...(input.targetGrades !== undefined ? { targetGrades: stringList(input.targetGrades) } : {}),
    ...(input.majors !== undefined ? { majors: stringList(input.majors) } : {}),
    ...(input.practicalTypes !== undefined ? { practicalTypes: stringList(input.practicalTypes) } : {}),
    ...(input.prize !== undefined ? { prize: text(input.prize, 1000) || null } : {}),
    ...(input.applicationMethod !== undefined ? { applicationMethod: text(input.applicationMethod, 2000) || null } : {}),
    ...(input.sourceUrl !== undefined ? { sourceUrl: text(input.sourceUrl, 2000) || null } : {}),
    ...(input.guideUrl !== undefined ? { guideUrl: text(input.guideUrl, 2000) || null } : {}),
    ...(input.year !== undefined ? { year: yearOrNull(input.year) } : {}),
  };

  const updated = await updateDataRecord(db, context, competitionId, {
    campusId: input.campusId,
    recordType: COMPETITION_TYPE,
    sourceApp: SOURCE_APP,
    title: input.title,
    summary: input.summary,
    visibility: input.visibility,
    metadata: mergedMetadata,
    tags: input.tags || buildCompetitionTags({
      ...input,
      majors: (mergedMetadata.majors as string[]) || [],
      practicalTypes: (mergedMetadata.practicalTypes as string[]) || [],
      targetGrades: (mergedMetadata.targetGrades as string[]) || [],
      hostSchool: (mergedMetadata.hostSchool as string | null) || null,
      organizer: (mergedMetadata.organizer as string | null) || null,
      year: (mergedMetadata.year as number | null) || null,
    }),
  }) as Record<string, unknown>;

  if (input.content !== undefined) {
    await setDataRecordContent(db, context, competitionId, input.content || "");
  }
  return decorateCompetition(updated);
}

export async function deleteCompetition(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
) {
  await assertCompetition(db, context, competitionId);
  return deleteDataRecord(db, context, competitionId);
}

function competitionResultTags(competitionId: string, input: CompetitionResultInput) {
  return Array.from(new Set([
    "공모전결과",
    `competition:${competitionId}`,
    ...stringList(input.tags),
    text(input.practicalType, 100),
    text(input.grade, 100),
    input.year ? String(input.year) : "",
  ].filter(Boolean))).slice(0, 30);
}

export async function listCompetitionResults(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
  requestUrl: URL,
) {
  await assertCompetition(db, context, competitionId);
  const url = new URL(requestUrl.toString());
  url.searchParams.set("sourceApp", SOURCE_APP);
  url.searchParams.set("recordType", RESULT_TYPE);
  url.searchParams.set("tag", `competition:${competitionId}`);
  return listDataRecords(db, context, url);
}

export async function createCompetitionResult(
  db: D1Database,
  context: DataCoreAccessContext,
  competitionId: string,
  input: CompetitionResultInput,
) {
  const competition = await assertCompetition(db, context, competitionId);
  const participants = nonNegativeInteger(input.participants);
  const winners = nonNegativeInteger(input.winners);
  if (participants !== null && winners !== null && winners > participants) {
    throw new DataCoreAccessError(400, "수상 인원은 출품 인원보다 클 수 없습니다.");
  }

  const title = text(input.title, 240) || `${String(competition.title)} 결과`;
  const result = await createDataRecord(db, context, {
    campusId: input.campusId,
    recordType: RESULT_TYPE,
    sourceApp: SOURCE_APP,
    title,
    summary: text(input.summary, 10_000) || null,
    visibility: "campus",
    metadata: {
      schemaVersion: 1,
      competitionId,
      participants,
      winners,
      gold: nonNegativeInteger(input.gold),
      silver: nonNegativeInteger(input.silver),
      bronze: nonNegativeInteger(input.bronze),
      honorableMention: nonNegativeInteger(input.honorableMention),
      otherAwards: nonNegativeInteger(input.otherAwards),
      year: yearOrNull(input.year),
      practicalType: text(input.practicalType, 100) || null,
      grade: text(input.grade, 100) || null,
      winRate:
        participants && winners !== null
          ? Math.round((winners / participants) * 10000) / 100
          : null,
    },
    tags: competitionResultTags(competitionId, input),
  });
  return result;
}

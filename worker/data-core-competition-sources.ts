import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireWriteAccess,
} from "./data-core-access";
import {
  createCompetition,
  listCompetitions,
  updateCompetition,
  type CompetitionFieldSource,
  type CompetitionInput,
  type CompetitionSourceProvenance,
} from "./data-core-competitions";

export const COMPETITION_SOURCES = ["artmd", "mgood"] as const;
export type CompetitionSource = (typeof COMPETITION_SOURCES)[number];

type NormalizedCompetition = {
  title: string;
  competitionKind: "contest" | "practical-competition" | "award" | "other";
  organizer: string | null;
  hostSchool: string | null;
  applicationStart: string | null;
  applicationEnd: string | null;
  eventDate: string | null;
  resultDate: string | null;
  targetGrades: string[];
  majors: string[];
  practicalTypes: string[];
  sourceUrl: string;
  sourceName: string;
  source: CompetitionSource;
  externalSourceId: string | null;
  fetchedAt: string;
};

const SOURCE_CONFIG: Record<CompetitionSource, { name: string; url: string }> = {
  artmd: { name: "미대입시", url: "https://www.artmd.kr/contest/21001_contest_list.php" },
  mgood: { name: "엠굿", url: "https://mgood.co.kr/" },
};

function text(value: unknown, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(value: string) {
  return text(value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"));
}

function sourceFrom(value: string): CompetitionSource {
  if ((COMPETITION_SOURCES as readonly string[]).includes(value)) return value as CompetitionSource;
  throw new DataCoreAccessError(404, "지원하지 않는 외부 공모전 출처입니다.");
}

function absoluteUrl(value: string, base: string) {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function datesFrom(value: string) {
  const matches = value.match(/20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/g) || [];
  const dates = matches.map((item) => {
    const parts = item.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
    return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : null;
  }).filter((item): item is string => Boolean(item));
  return { applicationStart: dates[0] || null, applicationEnd: dates[1] || null };
}

function externalIdFrom(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("idx") || parsed.searchParams.get("no") || parsed.searchParams.get("id") || null;
  } catch {
    return null;
  }
}

/** Extract only concise facts and links; source HTML is deliberately never retained. */
export function normalizeCompetitionSourceHtml(sourceValue: string, html: string, fetchedAt = new Date().toISOString()) {
  const source = sourceFrom(sourceValue);
  const config = SOURCE_CONFIG[source];
  const anchors = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const seen = new Set<string>();
  const items: NormalizedCompetition[] = [];

  for (const match of anchors) {
    const sourceUrl = absoluteUrl(match[1], config.url);
    const title = stripHtml(match[2]);
    if (!sourceUrl || title.length < 4 || title.length > 240) continue;
    if (!/(contest|competition|공모전|대회|실기|미술|디자인|입시)/i.test(`${title} ${sourceUrl}`)) continue;
    const key = `${sourceUrl}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nearby = stripHtml(html.slice(Math.max(0, match.index! - 400), match.index! + match[0].length + 400));
    const dates = datesFrom(nearby);
    items.push({
      title,
      competitionKind: /실기/i.test(title) ? "practical-competition" : "contest",
      organizer: null,
      hostSchool: null,
      applicationStart: dates.applicationStart,
      applicationEnd: dates.applicationEnd,
      eventDate: null,
      resultDate: null,
      targetGrades: [],
      majors: [],
      practicalTypes: [],
      sourceUrl,
      sourceName: config.name,
      source,
      externalSourceId: externalIdFrom(sourceUrl),
      fetchedAt,
    });
    if (items.length >= 40) break;
  }
  return items;
}

async function fetchSource(source: CompetitionSource) {
  const config = SOURCE_CONFIG[source];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(config.url, {
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const items = normalizeCompetitionSourceHtml(source, html);
    if (!items.length) throw new Error("no usable source facts");
    return items;
  } catch {
    throw new DataCoreAccessError(502, `${config.name} 연결을 확인해 주세요. 기존 대회 데이터는 변경되지 않았습니다.`);
  } finally {
    clearTimeout(timer);
  }
}

function hasCompetitionPermission(context: DataCoreAccessContext) {
  requireWriteAccess(context);
  if (context.isSuperAdmin || context.memberships.some((membership) => membership.role === "CAMPUS_DIRECTOR" || membership.role === "STAFF")) return;
  throw new DataCoreAccessError(403, "외부 대회 소식 동기화 권한이 없습니다.");
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "동일 출처 요청만 허용됩니다.");
  }
}

function normalizedTitle(value: unknown) {
  return text(value, 240).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function metadataOf(record: Record<string, unknown>) {
  return record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
}

function sourceEntries(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.sources) ? metadata.sources as CompetitionSourceProvenance[] : [];
}

function matchExisting(item: NormalizedCompetition, records: Record<string, unknown>[]) {
  const bySourceId = records.filter((record) => sourceEntries(metadataOf(record)).some((entry) => (
    entry.source === item.source && entry.externalSourceId && entry.externalSourceId === item.externalSourceId
  )));
  if (bySourceId.length === 1) return { kind: "same" as const, record: bySourceId[0] };
  if (bySourceId.length > 1) return { kind: "ambiguous" as const };

  const title = normalizedTitle(item.title);
  const candidates = records.filter((record) => {
    const metadata = metadataOf(record);
    if (normalizedTitle(record.title) !== title) return false;
    const sameOrganizer = item.organizer && normalizedTitle(metadata.organizer) === normalizedTitle(item.organizer);
    const samePeriod = item.applicationStart && metadata.applicationStart === item.applicationStart
      && item.applicationEnd && metadata.applicationEnd === item.applicationEnd;
    const sameYear = item.applicationStart && String(metadata.year || "") === item.applicationStart.slice(0, 4);
    return Boolean(sameOrganizer || samePeriod || sameYear);
  });
  if (candidates.length === 1) return { kind: "matched" as const, record: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous" as const };
  return { kind: "new" as const };
}

function previewStatus(item: NormalizedCompetition, records: Record<string, unknown>[]) {
  return matchExisting(item, records).kind;
}

function provenance(item: NormalizedCompetition): CompetitionSourceProvenance {
  return {
    source: item.source,
    sourceUrl: item.sourceUrl,
    ...(item.externalSourceId ? { externalSourceId: item.externalSourceId } : {}),
    fetchedAt: item.fetchedAt,
  };
}

function mergeSources(existing: CompetitionSourceProvenance[], next: CompetitionSourceProvenance) {
  return [...existing.filter((entry) => !(entry.source === next.source && entry.externalSourceId === next.externalSourceId)), next].slice(-12);
}

function sourcePayload(item: NormalizedCompetition, existing?: Record<string, unknown>): CompetitionInput {
  const metadata = existing ? metadataOf(existing) : {};
  const next = provenance(item);
  const fieldSources = { ...(metadata.fieldSources as Record<string, CompetitionFieldSource> || {}) };
  const sourceCanReplace = (field: string) => !metadata[field] || fieldSources[field]?.source === item.source;
  const fields = ["organizer", "hostSchool", "applicationStart", "applicationEnd", "eventDate", "resultDate", "targetGrades", "majors", "practicalTypes", "sourceUrl"];
  fields.forEach((field) => {
    if (sourceCanReplace(field)) fieldSources[field] = { source: item.source, sourceUrl: item.sourceUrl, fetchedAt: item.fetchedAt };
  });
  return {
    title: existing ? String(existing.title) : item.title,
    visibility: "organization",
    competitionKind: item.competitionKind,
    organizer: sourceCanReplace("organizer") ? item.organizer : undefined,
    hostSchool: sourceCanReplace("hostSchool") ? item.hostSchool : undefined,
    applicationStart: sourceCanReplace("applicationStart") ? item.applicationStart : undefined,
    applicationEnd: sourceCanReplace("applicationEnd") ? item.applicationEnd : undefined,
    eventDate: sourceCanReplace("eventDate") ? item.eventDate : undefined,
    resultDate: sourceCanReplace("resultDate") ? item.resultDate : undefined,
    targetGrades: sourceCanReplace("targetGrades") ? item.targetGrades : undefined,
    majors: sourceCanReplace("majors") ? item.majors : undefined,
    practicalTypes: sourceCanReplace("practicalTypes") ? item.practicalTypes : undefined,
    sourceUrl: sourceCanReplace("sourceUrl") ? item.sourceUrl : undefined,
    year: item.applicationStart ? Number(item.applicationStart.slice(0, 4)) : undefined,
    sourceProvenance: mergeSources(sourceEntries(metadata), next),
    fieldSources,
  };
}

export async function previewCompetitionSource(db: D1Database, context: DataCoreAccessContext, sourceValue: string) {
  hasCompetitionPermission(context);
  const source = sourceFrom(sourceValue);
  const items = await fetchSource(source);
  const existing = await listCompetitions(db, context, new URL("https://data-core.invalid/api/data-core/competitions?limit=100")) as Record<string, unknown>[];
  return {
    source,
    sourceName: SOURCE_CONFIG[source].name,
    fetchedAt: new Date().toISOString(),
    items: items.map((item) => ({ ...item, importStatus: previewStatus(item, existing) })),
  };
}

export async function importCompetitionSource(request: Request, db: D1Database, context: DataCoreAccessContext, sourceValue: string) {
  sameOrigin(request);
  hasCompetitionPermission(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "외부 대회 소식 반영은 마스터 관리자만 할 수 있습니다.");
  const source = sourceFrom(sourceValue);
  const items = await fetchSource(source);
  const existing = await listCompetitions(db, context, new URL("https://data-core.invalid/api/data-core/competitions?limit=100")) as Record<string, unknown>[];
  const summary = { created: 0, updated: 0, unchanged: 0, ambiguous: 0 };

  for (const item of items) {
    const match = matchExisting(item, existing);
    if (match.kind === "ambiguous") { summary.ambiguous += 1; continue; }
    if (match.kind === "same") { summary.unchanged += 1; continue; }
    if (match.kind === "matched") {
      await updateCompetition(db, context, String(match.record.id), sourcePayload(item, match.record));
      summary.updated += 1;
      continue;
    }
    const created = await createCompetition(db, context, sourcePayload(item));
    existing.push(created as Record<string, unknown>);
    summary.created += 1;
  }
  return { source, fetchedAt: new Date().toISOString(), summary };
}

export function assertCompetitionSourceMutation(request: Request) {
  sameOrigin(request);
}

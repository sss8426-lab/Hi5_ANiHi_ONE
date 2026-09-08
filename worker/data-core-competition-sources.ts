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
type LiveSourceStatus = "open" | "upcoming" | "unknown";

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
  sourceStatus: LiveSourceStatus;
  sourceStatusLabel: string;
  externalSourceId: string | null;
  fetchedAt: string;
};

type CompetitionSourceConfig = {
  name: string;
  urls: readonly string[];
};

// `artmd` remains the internal legacy source key so existing provenance rows stay compatible.
// Its current public feed is Art & Design, while mgood aggregates both the main and other lists.
const SOURCE_CONFIG: Record<CompetitionSource, CompetitionSourceConfig> = {
  artmd: {
    name: "아트앤디자인",
    urls: ["https://artndesign.com/shop/list.php?ca_id=20"],
  },
  mgood: {
    name: "엠굿",
    urls: [
      "https://www.mgood.co.kr/contest/21001_contest_list.php",
      "https://www.mgood.co.kr/contest/21001_contest_list.php?state=other",
    ],
  },
};

const SOURCE_FIELDS = [
  "competitionKind",
  "organizer",
  "hostSchool",
  "applicationStart",
  "applicationEnd",
  "eventDate",
  "resultDate",
  "targetGrades",
  "majors",
  "practicalTypes",
  "sourceUrl",
] as const;

type SourceField = (typeof SOURCE_FIELDS)[number];

function text(value: unknown, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(value: string) {
  return text(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"'),
  );
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

function normalizedUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString();
  } catch {
    return text(value, 2000);
  }
}

function isoDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function datesFrom(value: string, fetchedAt: string) {
  const fullMatches = value.match(/20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/g) || [];
  const fullDates = fullMatches.map((item) => {
    const parts = item.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
    return parts ? isoDate(Number(parts[1]), Number(parts[2]), Number(parts[3])) : null;
  }).filter((item): item is string => Boolean(item));
  if (fullDates.length >= 2) {
    return { applicationStart: fullDates[0], applicationEnd: fullDates[1] };
  }

  const currentYear = new Date(fetchedAt).getUTCFullYear();
  const monthDays = Array.from(value.matchAll(/(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?:일)?/g))
    .map((match) => ({ month: Number(match[1]), day: Number(match[2]) }))
    .filter((entry) => entry.month >= 1 && entry.month <= 12 && entry.day >= 1 && entry.day <= 31);

  const dates = [...fullDates];
  for (const entry of monthDays) {
    const candidate = isoDate(currentYear, entry.month, entry.day);
    if (candidate && !dates.some((date) => date.slice(5) === candidate.slice(5))) dates.push(candidate);
    if (dates.length >= 2) break;
  }
  if (dates.length >= 2 && dates[1] < dates[0]) {
    const [year, month, day] = dates[1].split("-").map(Number);
    if (month <= 3 && Number(dates[0].slice(5, 7)) >= 10) {
      dates[1] = isoDate(year + 1, month, day) || dates[1];
    }
  }
  return { applicationStart: dates[0] || null, applicationEnd: dates[1] || null };
}

function sourceStatusFrom(value: string): { status: LiveSourceStatus; label: string } {
  const normalized = text(value, 500);
  if (/접수\s*중/i.test(normalized)) return { status: "open", label: "접수중" };
  if (/접수\s*(?:전|예정)/i.test(normalized) || /(^|\s)예정(\s|$)/.test(normalized)) {
    return { status: "upcoming", label: "예정" };
  }
  return { status: "unknown", label: "상태 확인 필요" };
}

function externalIdFrom(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("c_seq")
      || parsed.searchParams.get("idx")
      || parsed.searchParams.get("no")
      || parsed.searchParams.get("id")
      || parsed.searchParams.get("it_id")
      || null;
  } catch {
    return null;
  }
}

function tableCellsAround(html: string, index: number) {
  const start = html.lastIndexOf("<tr", index);
  const end = html.indexOf("</tr>", index);
  if (start < 0 || end < 0 || end - start > 8_000) return [];
  const row = html.slice(start, end + 5);
  return Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
}

/** Extract only concise facts and links; source HTML is deliberately never retained. */
export function normalizeCompetitionSourceHtml(
  sourceValue: string,
  html: string,
  fetchedAt = new Date().toISOString(),
  baseUrl?: string,
) {
  const source = sourceFrom(sourceValue);
  const config = SOURCE_CONFIG[source];
  const sourceBaseUrl = baseUrl || config.urls[0];
  const anchors = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const seen = new Set<string>();
  const items: NormalizedCompetition[] = [];

  for (const match of anchors) {
    const sourceUrl = absoluteUrl(match[1], sourceBaseUrl);
    const title = stripHtml(match[2]);
    if (!sourceUrl || title.length < 4 || title.length > 240) continue;
    if (!/(contest|competition|공모전|대회|실기|미술|디자인|입시)/i.test(`${title} ${sourceUrl}`)) continue;
    const key = `${sourceUrl}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cells = tableCellsAround(html, match.index || 0);
    const nearby = cells.length
      ? cells.join(" ")
      : stripHtml(html.slice(Math.max(0, (match.index || 0) - 500), (match.index || 0) + match[0].length + 500));
    const sourceStatus = sourceStatusFrom(nearby);
    const dates = datesFrom(nearby, fetchedAt);
    const kindText = source === "artmd" ? (cells[1] || title) : (cells[0] || title);
    const organizer = source === "artmd"
      ? (cells.length >= 5 ? text(cells[4], 200) || null : null)
      : (cells.length >= 3 ? text(cells[2], 200) || null : null);

    items.push({
      title,
      competitionKind: /실기/i.test(kindText) ? "practical-competition" : "contest",
      organizer,
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
      sourceStatus: sourceStatus.status,
      sourceStatusLabel: sourceStatus.label,
      externalSourceId: externalIdFrom(sourceUrl),
      fetchedAt,
    });
    if (items.length >= 80) break;
  }
  return items;
}

async function fetchSourcePage(source: CompetitionSource, sourceUrl: string, fetchedAt: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return normalizeCompetitionSourceHtml(source, html, fetchedAt, sourceUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(source: CompetitionSource) {
  const config = SOURCE_CONFIG[source];
  const fetchedAt = new Date().toISOString();
  const results = await Promise.allSettled(
    config.urls.map((sourceUrl) => fetchSourcePage(source, sourceUrl, fetchedAt)),
  );
  const seen = new Set<string>();
  const items: NormalizedCompetition[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const key = `${normalizedUrl(item.sourceUrl)}|${normalizedTitle(item.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  if (!items.length) {
    throw new DataCoreAccessError(502, `${config.name} 연결을 확인해 주세요. 기존 대회 데이터는 변경되지 않았습니다.`);
  }
  return items.slice(0, 120);
}

function hasCompetitionReadPermission(context: DataCoreAccessContext) {
  if (!context.authenticated) throw new DataCoreAccessError(401, "로그인 후 외부 대회 소식을 확인할 수 있습니다.");
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

function sourceValuePresent(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function comparableValue(value: unknown) {
  if (Array.isArray(value)) return [...value].map((entry) => text(entry, 200)).sort();
  return value ?? null;
}

function sourceValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));
}

function sourceCanReplace(metadata: Record<string, unknown>, fieldSources: Record<string, CompetitionFieldSource>, source: CompetitionSource, field: SourceField) {
  return !sourceValuePresent(metadata[field]) || fieldSources[field]?.source === source;
}

function sourceOwnedFactsChanged(item: NormalizedCompetition, record: Record<string, unknown>) {
  const metadata = metadataOf(record);
  const fieldSources = metadata.fieldSources && typeof metadata.fieldSources === "object"
    ? metadata.fieldSources as Record<string, CompetitionFieldSource>
    : {};
  return SOURCE_FIELDS.some((field) => {
    const incoming = item[field];
    if (!sourceValuePresent(incoming)) return false;
    if (!sourceCanReplace(metadata, fieldSources, item.source, field)) return false;
    return !sourceValuesEqual(metadata[field], incoming);
  });
}

function sameSourceIdentity(entry: CompetitionSourceProvenance, item: NormalizedCompetition) {
  if (entry.source !== item.source) return false;
  if (item.externalSourceId && entry.externalSourceId === item.externalSourceId) return true;
  return normalizedUrl(entry.sourceUrl) === normalizedUrl(item.sourceUrl);
}

function matchExisting(item: NormalizedCompetition, records: Record<string, unknown>[]) {
  const bySourceId = records.filter((record) => sourceEntries(metadataOf(record)).some((entry) => sameSourceIdentity(entry, item)));
  if (bySourceId.length === 1) {
    return sourceOwnedFactsChanged(item, bySourceId[0])
      ? { kind: "matched" as const, record: bySourceId[0] }
      : { kind: "same" as const, record: bySourceId[0] };
  }
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
  return [...existing.filter((entry) => !sameSourceIdentity(entry, {
    title: "",
    competitionKind: "other",
    organizer: null,
    hostSchool: null,
    applicationStart: null,
    applicationEnd: null,
    eventDate: null,
    resultDate: null,
    targetGrades: [],
    majors: [],
    practicalTypes: [],
    sourceUrl: next.sourceUrl,
    sourceName: "",
    source: next.source,
    sourceStatus: "unknown",
    sourceStatusLabel: "상태 확인 필요",
    externalSourceId: next.externalSourceId || null,
    fetchedAt: next.fetchedAt,
  })), next].slice(-12);
}

function sourcePayload(item: NormalizedCompetition, existing?: Record<string, unknown>): CompetitionInput {
  const metadata = existing ? metadataOf(existing) : {};
  const next = provenance(item);
  const fieldSources = { ...(metadata.fieldSources as Record<string, CompetitionFieldSource> || {}) };
  const mayReplace = (field: SourceField) => sourceCanReplace(metadata, fieldSources, item.source, field);
  const updateValue = <T>(field: SourceField, value: T): T | undefined => (
    !existing || (mayReplace(field) && sourceValuePresent(value)) ? value : undefined
  );

  SOURCE_FIELDS.forEach((field) => {
    const incoming = item[field];
    if ((!existing || sourceValuePresent(incoming)) && mayReplace(field)) {
      fieldSources[field] = { source: item.source, sourceUrl: item.sourceUrl, fetchedAt: item.fetchedAt };
    }
  });

  return {
    title: existing ? String(existing.title) : item.title,
    visibility: "organization",
    competitionKind: updateValue("competitionKind", item.competitionKind),
    organizer: updateValue("organizer", item.organizer),
    hostSchool: updateValue("hostSchool", item.hostSchool),
    applicationStart: updateValue("applicationStart", item.applicationStart),
    applicationEnd: updateValue("applicationEnd", item.applicationEnd),
    eventDate: updateValue("eventDate", item.eventDate),
    resultDate: updateValue("resultDate", item.resultDate),
    targetGrades: updateValue("targetGrades", item.targetGrades),
    majors: updateValue("majors", item.majors),
    practicalTypes: updateValue("practicalTypes", item.practicalTypes),
    sourceUrl: updateValue("sourceUrl", item.sourceUrl),
    year: !existing || (mayReplace("applicationStart") && sourceValuePresent(item.applicationStart))
      ? (item.applicationStart ? Number(item.applicationStart.slice(0, 4)) : undefined)
      : undefined,
    sourceProvenance: mergeSources(sourceEntries(metadata), next),
    fieldSources,
  };
}

export async function previewCompetitionSource(db: D1Database, context: DataCoreAccessContext, sourceValue: string) {
  hasCompetitionReadPermission(context);
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
      const updated = await updateCompetition(db, context, String(match.record.id), sourcePayload(item, match.record));
      const index = existing.findIndex((record) => String(record.id) === String(match.record.id));
      if (index >= 0) existing[index] = updated as Record<string, unknown>;
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

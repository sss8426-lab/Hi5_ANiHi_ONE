import { DEFAULT_ORGANIZATION_ID } from "./data-core";
import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { createCompetition } from "./data-core-competitions";
import { listDataRecords, updateDataRecord } from "./data-core-records";

export type CompetitionSourceProvider = "artmd" | "mgood";
export type CompetitionSourceSelection = CompetitionSourceProvider | "all";

export type CompetitionSourceItem = {
  provider: CompetitionSourceProvider;
  sourceUrl: string;
  sourceId: string;
  sourceFingerprint: string;
  title: string;
  competitionKind: "contest" | "practical-competition";
  organizer: string | null;
  hostSchool: string | null;
  applicationStart: string | null;
  applicationEnd: string | null;
  practicalTypes: string[];
  sourceStatus: string | null;
  year: number | null;
};

type ProviderResult = {
  provider: CompetitionSourceProvider;
  items: CompetitionSourceItem[];
  fetchedAt: string;
};

type SourceFetcher = typeof fetch;

const SOURCE_CONFIG: Record<CompetitionSourceProvider, { baseUrl: string; urls: string[] }> = {
  artmd: {
    baseUrl: "https://www.artmd.kr/",
    urls: [
      "https://www.artmd.kr/contest/21001_contest_list.php?category=&find=&ordering=&page=&sel=&state=main",
      "https://www.artmd.kr/contest/21001_contest_list.php?state=other",
    ],
  },
  mgood: {
    baseUrl: "https://www.mgood.co.kr/",
    urls: ["https://www.mgood.co.kr/contest/21001_contest_list.php"],
  },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 8_000;
const MAX_SOURCE_HTML = 2_000_000;
const cache = new Map<CompetitionSourceProvider, { expiresAt: number; result: ProviderResult }>();

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(html: string) {
  return cleanText(
    decodeEntities(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function normalizeDateParts(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const normalized = `${y}-${mm}-${dd}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) return null;
  return normalized;
}

function datesInText(value: string) {
  const dates: string[] = [];
  const pattern = /(20\d{2})\s*(?:[.\-/]|년)\s*(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})\s*(?:일)?/g;
  for (const match of value.matchAll(pattern)) {
    const normalized = normalizeDateParts(match[1], match[2], match[3]);
    if (normalized && !dates.includes(normalized)) dates.push(normalized);
  }
  return dates;
}

function safeSourceUrl(href: string, baseUrl: string) {
  try {
    const url = new URL(decodeEntities(href), baseUrl);
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== base.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function anchorFromCell(cellHtml: string, baseUrl: string) {
  const anchors = [...cellHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    const label = plainText(anchor[2]);
    const url = safeSourceUrl(anchor[1], baseUrl);
    if (label.length >= 3 && url) return { label, url };
  }
  return null;
}

function titleAndPracticalTypes(cellHtml: string, baseUrl: string) {
  const anchor = anchorFromCell(cellHtml, baseUrl);
  const full = plainText(cellHtml);
  const split = full.split(/\s+부문\s*[:：]?\s*/i);
  const title = cleanText(anchor?.label || split[0] || full, 240);
  const practicalText = split.length > 1 ? split.slice(1).join(" ") : "";
  const practicalTypes = practicalText
    ? Array.from(new Set(practicalText.split(/[,/|·ㆍ]/).map((item) => cleanText(item, 100)).filter((item) => item.length >= 2 && !/^20\d{2}/.test(item)))).slice(0, 20)
    : [];
  return { title, practicalTypes, sourceUrl: anchor?.url || null };
}

function sourceStatus(value: string) {
  const status = cleanText(value, 80);
  if (!status) return null;
  if (/접수\s*중|진행\s*중/i.test(status)) return "open";
  if (/예정|접수\s*전/i.test(status)) return "upcoming";
  if (/마감|종료|완료/i.test(status)) return "closed";
  if (/발표/i.test(status)) return "result-announced";
  return status;
}

function normalizeTitle(value: string) {
  return cleanText(value, 240)
    .toLowerCase()
    .replace(/[\[\](){}<>]/g, " ")
    .replace(/[·ㆍ:：,./\\|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalKey(title: string, year: number | null, organizer?: string | null) {
  return [normalizeTitle(title), year || "", normalizeTitle(organizer || "")].join("|");
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function parseCompetitionSourceHtml(
  provider: CompetitionSourceProvider,
  html: string,
  pageUrl: string,
): Promise<CompetitionSourceItem[]> {
  const config = SOURCE_CONFIG[provider];
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const output: CompetitionSourceItem[] = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1]);
    if (cells.length < 3) continue;
    const plainCells = cells.map(plainText);
    const kindIndex = plainCells.findIndex((value) => /실기\s*대회|공모전/.test(value));
    if (kindIndex < 0 || kindIndex + 1 >= cells.length) continue;
    const kindCell = plainCells[kindIndex];
    const titleCell = cells[kindIndex + 1];
    const parsedTitle = titleAndPracticalTypes(titleCell, config.baseUrl);
    if (!parsedTitle.title || parsedTitle.title.length < 3) continue;
    const organizer = cleanText(plainCells[kindIndex + 2] || "", 200) || null;
    const dateCell = plainCells[kindIndex + 3] || plainText(row[1]);
    const dates = datesInText(dateCell);
    const statusCell = plainCells[kindIndex + 4] || "";
    const sourceUrl = parsedTitle.sourceUrl || pageUrl;
    const explicitYear = dates[0] ? Number(dates[0].slice(0, 4)) : Number((parsedTitle.title.match(/\b(20\d{2})\b/) || [])[1] || 0) || null;
    const sourceId = sourceUrl !== pageUrl ? sourceUrl : canonicalKey(parsedTitle.title, explicitYear, organizer);
    output.push({
      provider,
      sourceUrl,
      sourceId,
      sourceFingerprint: await fingerprint(`${provider}|${sourceId}`),
      title: parsedTitle.title,
      competitionKind: /실기\s*대회/.test(kindCell) ? "practical-competition" : "contest",
      organizer,
      hostSchool: organizer && /대학|학교/.test(organizer) ? organizer : null,
      applicationStart: dates[0] || null,
      applicationEnd: dates[1] || dates[0] || null,
      practicalTypes: parsedTitle.practicalTypes,
      sourceStatus: sourceStatus(statusCell),
      year: explicitYear,
    });
  }

  const seen = new Set<string>();
  return output.filter((item) => {
    const key = `${item.provider}|${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSourcePage(fetcher: SourceFetcher, url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.5",
      },
    });
    if (!response.ok) throw new DataCoreAccessError(502, `외부 공모전 소스 응답 오류 (${response.status})`);
    const html = await response.text();
    if (!html || html.length > MAX_SOURCE_HTML) throw new DataCoreAccessError(502, "외부 공모전 소스 크기가 허용 범위를 벗어났습니다.");
    return html;
  } catch (error) {
    if (error instanceof DataCoreAccessError) throw error;
    if ((error as Error)?.name === "AbortError") throw new DataCoreAccessError(504, "외부 공모전 소스 응답 시간이 초과되었습니다.");
    throw new DataCoreAccessError(502, "외부 공모전 소스를 불러오지 못했습니다.");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProvider(provider: CompetitionSourceProvider, fetcher: SourceFetcher, force = false): Promise<ProviderResult> {
  const cached = cache.get(provider);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.result;
  const config = SOURCE_CONFIG[provider];
  const all: CompetitionSourceItem[] = [];
  for (const url of config.urls) {
    const html = await fetchSourcePage(fetcher, url);
    all.push(...await parseCompetitionSourceHtml(provider, html, url));
  }
  const bySource = new Map<string, CompetitionSourceItem>();
  for (const item of all) bySource.set(item.sourceId, item);
  const items = [...bySource.values()];
  if (!items.length) throw new DataCoreAccessError(502, `${provider} 공개 공모전 목록 형식을 읽을 수 없습니다.`);
  const result = { provider, items, fetchedAt: new Date().toISOString() };
  cache.set(provider, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

function normalizeSelection(value: unknown): CompetitionSourceSelection {
  const provider = cleanText(value || "all", 20).toLowerCase();
  if (provider === "artmd" || provider === "mgood" || provider === "all") return provider;
  throw new DataCoreAccessError(400, "공모전 소스 provider가 올바르지 않습니다.");
}

async function collectSources(selection: CompetitionSourceSelection, fetcher: SourceFetcher, force = false) {
  const providers: CompetitionSourceProvider[] = selection === "all" ? ["artmd", "mgood"] : [selection];
  const items: CompetitionSourceItem[] = [];
  const errors: Array<{ provider: CompetitionSourceProvider; code: string }> = [];
  const fetchedAt: Record<string, string> = {};
  for (const provider of providers) {
    try {
      const result = await fetchProvider(provider, fetcher, force);
      fetchedAt[provider] = result.fetchedAt;
      items.push(...result.items);
    } catch (error) {
      errors.push({
        provider,
        code: error instanceof DataCoreAccessError ? `source_${error.status}` : "source_error",
      });
    }
  }
  if (!items.length) throw new DataCoreAccessError(502, "공개 공모전 소스를 불러오지 못했습니다.");
  return { selection, items, errors, fetchedAt };
}

export async function previewCompetitionSources(
  context: DataCoreAccessContext,
  providerInput: unknown,
  fetcher: SourceFetcher = fetch,
) {
  requireAuthenticatedAccess(context);
  return collectSources(normalizeSelection(providerInput), fetcher, false);
}

function externalSources(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.externalSources)
    ? metadata.externalSources.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    : [];
}

function sourceSnapshot(item: CompetitionSourceItem) {
  return {
    provider: item.provider,
    sourceUrl: item.sourceUrl,
    sourceId: item.sourceId,
    fingerprint: item.sourceFingerprint,
    sourceStatus: item.sourceStatus,
  };
}

function mergeExternalSource(metadata: Record<string, unknown>, item: CompetitionSourceItem) {
  const current = externalSources(metadata);
  const next = sourceSnapshot(item);
  const filtered = current.filter((source) => source.fingerprint !== item.sourceFingerprint && source.provider !== item.provider);
  return [...filtered, next];
}

function metadataForNew(item: CompetitionSourceItem, metadata: Record<string, unknown>) {
  return {
    ...metadata,
    externalSources: [sourceSnapshot(item)],
    sourceCanonicalKey: canonicalKey(item.title, item.year, item.organizer),
  };
}

function mergeSourceFacts(existing: Record<string, unknown>, item: CompetitionSourceItem) {
  const next = { ...existing };
  const fill = (key: string, value: unknown) => {
    const current = next[key];
    const empty = current === null || current === undefined || current === "" || (Array.isArray(current) && current.length === 0);
    if (empty && value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length)) next[key] = value;
  };
  fill("organizer", item.organizer);
  fill("hostSchool", item.hostSchool);
  fill("competitionKind", item.competitionKind);
  fill("applicationStart", item.applicationStart);
  fill("applicationEnd", item.applicationEnd);
  fill("practicalTypes", item.practicalTypes);
  fill("sourceUrl", item.sourceUrl);
  fill("year", item.year);
  next.externalSources = mergeExternalSource(existing, item);
  next.sourceCanonicalKey = cleanText(existing.sourceCanonicalKey, 500) || canonicalKey(item.title, item.year, item.organizer);
  return next;
}

async function auditImport(
  db: D1Database,
  context: DataCoreAccessContext,
  selection: CompetitionSourceSelection,
  created: number,
  updated: number,
  unchanged: number,
  sourceErrors: number,
) {
  if (!context.user) return;
  await db.prepare(`INSERT INTO audit_logs (
    id, organization_id, campus_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at
  ) VALUES (?, ?, NULL, ?, 'competition.sources.import', 'competition_source', NULL, ?, ?)`).bind(
    crypto.randomUUID(),
    DEFAULT_ORGANIZATION_ID,
    context.user.internalUserId,
    JSON.stringify({ provider: selection, created, updated, unchanged, sourceErrors }),
    new Date().toISOString(),
  ).run();
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
  }
}

export async function importCompetitionSources(
  request: Request,
  db: D1Database,
  context: DataCoreAccessContext,
  providerInput: unknown,
  fetcher: SourceFetcher = fetch,
) {
  requireAuthenticatedAccess(context);
  assertSameOrigin(request);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "공모전 외부 소스 반영은 마스터 관리자만 할 수 있습니다.");
  const selection = normalizeSelection(providerInput);
  const collected = await collectSources(selection, fetcher, true);
  const url = new URL("https://data-core.internal/api/data-core/records");
  url.searchParams.set("recordType", "competition");
  url.searchParams.set("sourceApp", "competition");
  url.searchParams.set("limit", "100");
  const existing = await listDataRecords(db, context, url) as Record<string, unknown>[];
  const byFingerprint = new Map<string, Record<string, unknown>>();
  const byCanonical = new Map<string, Record<string, unknown>>();
  for (const record of existing) {
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    for (const source of externalSources(metadata)) {
      if (typeof source.fingerprint === "string" && source.fingerprint) byFingerprint.set(source.fingerprint, record);
    }
    const year = typeof metadata.year === "number" ? metadata.year : null;
    const organizer = typeof metadata.organizer === "string" ? metadata.organizer : null;
    const key = cleanText(metadata.sourceCanonicalKey, 500) || canonicalKey(String(record.title || ""), year, organizer);
    if (key) byCanonical.set(key, record);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const item of collected.items) {
    const key = canonicalKey(item.title, item.year, item.organizer);
    let record = byFingerprint.get(item.sourceFingerprint) || byCanonical.get(key);
    if (!record) {
      const createdRecord = await createCompetition(db, context, {
        campusId: null,
        title: item.title,
        visibility: "organization",
        organizer: item.organizer,
        hostSchool: item.hostSchool,
        competitionKind: item.competitionKind,
        applicationStart: item.applicationStart,
        applicationEnd: item.applicationEnd,
        practicalTypes: item.practicalTypes,
        sourceUrl: item.sourceUrl,
        year: item.year,
        tags: ["외부소스", item.provider],
      }) as Record<string, unknown>;
      const metadata = createdRecord.metadata && typeof createdRecord.metadata === "object" ? createdRecord.metadata as Record<string, unknown> : {};
      record = await updateDataRecord(db, context, String(createdRecord.id), { metadata: metadataForNew(item, metadata) }) as Record<string, unknown>;
      created += 1;
      byFingerprint.set(item.sourceFingerprint, record);
      byCanonical.set(key, record);
      continue;
    }

    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    const merged = mergeSourceFacts(metadata, item);
    if (JSON.stringify(merged) === JSON.stringify(metadata)) {
      unchanged += 1;
      continue;
    }
    record = await updateDataRecord(db, context, String(record.id), { metadata: merged }) as Record<string, unknown>;
    updated += 1;
    byFingerprint.set(item.sourceFingerprint, record);
    byCanonical.set(key, record);
  }

  await auditImport(db, context, selection, created, updated, unchanged, collected.errors.length);
  return {
    provider: selection,
    created,
    updated,
    unchanged,
    sourceErrors: collected.errors,
    imported: collected.items.length,
  };
}

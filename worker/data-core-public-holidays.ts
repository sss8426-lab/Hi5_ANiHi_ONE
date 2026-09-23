// 대한민국 공휴일 → CORE 업무 캘린더. Public holidays (including 대체공휴일 and announced 임시공휴일) are
// read from Google's public "대한민국의 휴일" calendar and kept as organization-wide `holiday` events, so
// the calendar, 출석부 and every other CORE feature see the same days off without anyone typing them in.
// Observances that are not days off (어버이날, 크리스마스 이브 …) are left out. The job is idempotent:
// it adds new holidays, renames changed ones and removes cancelled future ones; it never touches events
// people created themselves.
import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { DEFAULT_ORGANIZATION_ID, ensureDataCoreDatabase } from "./data-core";

export const PUBLIC_HOLIDAY_FEED = "https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics";
export const PUBLIC_HOLIDAY_SOURCE = "kr-public-holidays";
const RECORD_TYPE = "academy-calendar-event";
const SOURCE_APP = "academy-calendar";
const SUMMARY = "대한민국 공휴일 (자동 등록)";

export type PublicHoliday = { startDate: string; endDate: string; title: string };

const day = (compact: string) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const unescape = (value: string) => value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

/** Days off from an iCalendar feed: all-day VEVENTs whose description starts with "공휴일". */
export function parsePublicHolidays(ics: string): PublicHoliday[] {
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const byDate = new Map<string, PublicHoliday>();
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const field = (name: string) => new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
    const description = unescape(field("DESCRIPTION")).split("\n")[0].trim();
    if (description !== "공휴일") continue;
    const start = field("DTSTART"), end = field("DTEND");
    if (!/^\d{8}$/.test(start)) continue;
    const startDate = day(start);
    // DTEND of an all-day event is exclusive.
    const endDate = /^\d{8}$/.test(end) && day(end) > startDate ? shift(day(end), -1) : startDate;
    const title = unescape(field("SUMMARY")).slice(0, 240) || "공휴일";
    const existing = byDate.get(startDate);
    if (existing) {
      if (!existing.title.split(" · ").includes(title)) existing.title = `${existing.title} · ${title}`;
      if (endDate > existing.endDate) existing.endDate = endDate;
    } else byDate.set(startDate, { startDate, endDate, title });
  }
  return [...byDate.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

type SyncResult = { added: number; updated: number; removed: number; total: number; from: string };

/**
 * Brings the organization calendar in line with the feed from January 1st of this year (KST) onward.
 * Earlier holidays are kept as history. A feed that looks broken (nothing for this year) changes nothing.
 */
export async function syncPublicHolidays(
  db: D1Database,
  { fetchImpl = fetch, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<SyncResult> {
  await ensureDataCoreDatabase(db);
  const response = await fetchImpl(PUBLIC_HOLIDAY_FEED, { headers: { accept: "text/calendar" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`공휴일 정보를 불러오지 못했습니다. (${response.status})`);
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const from = `${kst.getUTCFullYear()}-01-01`;
  const holidays = parsePublicHolidays(await response.text()).filter(h => h.startDate >= from);
  const year = from.slice(0, 4);
  if (holidays.filter(h => h.startDate.startsWith(year)).length < 5) {
    throw new Error("공휴일 정보가 올바르지 않아 캘린더를 바꾸지 않았습니다.");
  }
  const json = "CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END";
  const existing = (await db.prepare(
    `SELECT id, title, metadata_json FROM data_records
      WHERE organization_id=? AND record_type=? AND source_app=? AND deleted_at IS NULL
        AND json_extract(${json}, '$.sourceApp')=? AND json_extract(${json}, '$.startDate')>=?`,
  ).bind(DEFAULT_ORGANIZATION_ID, RECORD_TYPE, SOURCE_APP, PUBLIC_HOLIDAY_SOURCE, from).all<{ id: string; title: string; metadata_json: string }>()).results || [];
  const current = new Map<string, { id: string; title: string; endDate: string }>();
  const duplicates: string[] = [];
  for (const row of existing) {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.metadata_json); } catch { /* malformed rows are replaced */ }
    const startDate = String(meta.startDate || "");
    if (current.has(startDate)) { duplicates.push(row.id); continue; }
    current.set(startDate, { id: row.id, title: row.title, endDate: String(meta.endDate || startDate) });
  }
  const stamp = now.toISOString(), statements: D1PreparedStatement[] = [];
  const metadata = (h: PublicHoliday) => JSON.stringify({
    schemaVersion: 1, startDate: h.startDate, ...(h.endDate !== h.startDate ? { endDate: h.endDate } : {}), allDay: true,
    eventType: "holiday", sourceApp: PUBLIC_HOLIDAY_SOURCE, sourceRecordId: `${PUBLIC_HOLIDAY_SOURCE}:${h.startDate}`,
  });
  let added = 0, updated = 0;
  for (const h of holidays) {
    const found = current.get(h.startDate);
    current.delete(h.startDate);
    if (!found) {
      added++;
      statements.push(db.prepare(
        `INSERT INTO data_records (id, organization_id, campus_id, created_by_user_id, record_type, source_app, title, summary,
           visibility, status, metadata_json, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 'organization', 'active', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), DEFAULT_ORGANIZATION_ID, RECORD_TYPE, SOURCE_APP, h.title, SUMMARY, metadata(h), stamp, stamp));
    } else if (found.title !== h.title || found.endDate !== h.endDate) {
      updated++;
      statements.push(db.prepare("UPDATE data_records SET title=?, metadata_json=?, updated_at=? WHERE id=?").bind(h.title, metadata(h), stamp, found.id));
    }
  }
  // Still in the calendar but no longer in the feed (e.g. a cancelled 임시공휴일).
  const removedIds = [...[...current.values()].map(r => r.id), ...duplicates];
  for (const id of removedIds) statements.push(db.prepare("UPDATE data_records SET deleted_at=?, updated_at=? WHERE id=?").bind(stamp, stamp, id));
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
  return { added, updated, removed: removedIds.length, total: holidays.length, from };
}

/** MASTER-only manual run (the daily cron does the same). */
export async function syncPublicHolidaysForAdmin(db: D1Database, context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "공휴일 동기화는 마스터 관리자만 실행할 수 있습니다.");
  try {
    return await syncPublicHolidays(db);
  } catch (error) {
    if (error instanceof DataCoreAccessError) throw error;
    throw new DataCoreAccessError(502, error instanceof Error ? error.message : "공휴일 정보를 불러오지 못했습니다.");
  }
}

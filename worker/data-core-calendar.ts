import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireCampusAccess,
  requireWriteAccess,
} from "./data-core-access";
import {
  createDataRecord,
  deleteDataRecord,
  getDataRecord,
  listDataRecords,
  updateDataRecord,
} from "./data-core-records";

const CALENDAR_RECORD_TYPE = "academy-calendar-event";
const CALENDAR_SOURCE_APP = "academy-calendar";
const EVENT_TYPES = new Set([
  "class",
  "admission",
  "competition",
  "marketing",
  "holiday",
  "meeting",
  "other",
]);

type CalendarRecord = Awaited<ReturnType<typeof getDataRecord>>;

type CalendarMetadata = {
  schemaVersion: 1;
  startDate: string;
  endDate?: string;
  allDay: true;
  eventType: string;
  sourceRecordId?: string;
  sourceApp?: string;
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseDate(value: unknown, field: string): string {
  const normalized = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new DataCoreAccessError(400, `${field}은 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new DataCoreAccessError(400, `${field} 날짜가 올바르지 않습니다.`);
  }
  return normalized;
}

function calendarMetadata(value: unknown, fallback: Partial<CalendarMetadata> = {}): CalendarMetadata {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const startDate = parseDate(input.startDate ?? fallback.startDate, "startDate");
  const endDate = cleanText(input.endDate ?? fallback.endDate, 10) || startDate;
  parseDate(endDate, "endDate");
  if (endDate < startDate) {
    throw new DataCoreAccessError(400, "endDate는 startDate보다 빠를 수 없습니다.");
  }
  const eventType = cleanText(input.eventType ?? fallback.eventType, 32) || "other";
  if (!EVENT_TYPES.has(eventType)) {
    throw new DataCoreAccessError(400, "지원하지 않는 일정 유형입니다.");
  }
  const sourceRecordId = cleanText(input.sourceRecordId ?? fallback.sourceRecordId, 120);
  const sourceApp = cleanText(input.sourceApp ?? fallback.sourceApp, 80);
  return {
    schemaVersion: 1,
    startDate,
    ...(endDate === startDate ? {} : { endDate }),
    allDay: true,
    eventType,
    ...(sourceRecordId ? { sourceRecordId } : {}),
    ...(sourceApp ? { sourceApp } : {}),
  };
}

function ensureCalendarRecord(record: CalendarRecord): CalendarRecord {
  if (record.recordType !== CALENDAR_RECORD_TYPE || record.sourceApp !== CALENDAR_SOURCE_APP) {
    throw new DataCoreAccessError(404, "일정을 찾을 수 없습니다.");
  }
  return record;
}

function calendarEvent(record: CalendarRecord) {
  return {
    ...record,
    metadata: calendarMetadata(record.metadata),
  };
}

function calendarScope(
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
  existingCampusId?: string | null,
  existingVisibility?: string,
) {
  const campusId = input.campusId === undefined
    ? existingCampusId ?? null
    : cleanText(input.campusId, 120) || null;
  const requestedVisibility = cleanText(input.visibility, 32)
    || existingVisibility
    || (campusId ? "campus" : "organization");

  if (!context.isSuperAdmin) {
    if (requestedVisibility === "organization") {
      throw new DataCoreAccessError(403, "조직 공통 일정은 마스터 관리자만 등록할 수 있습니다.");
    }
    if (!campusId) throw new DataCoreAccessError(400, "캠퍼스 일정에는 campusId가 필요합니다.");
    requireCampusAccess(context, campusId);
    return { campusId, visibility: "campus" as const };
  }

  if (requestedVisibility === "organization") {
    if (campusId) throw new DataCoreAccessError(400, "조직 공통 일정은 campusId를 비워야 합니다.");
    return { campusId: null, visibility: "organization" as const };
  }
  if (requestedVisibility !== "campus" || !campusId) {
    throw new DataCoreAccessError(400, "캠퍼스 일정은 campusId와 campus 범위가 필요합니다.");
  }
  requireCampusAccess(context, campusId);
  return { campusId, visibility: "campus" as const };
}

export async function listAcademyCalendar(
  db: D1Database,
  context: DataCoreAccessContext,
  url: URL,
) {
  const from = parseDate(url.searchParams.get("from"), "from");
  const to = parseDate(url.searchParams.get("to"), "to");
  if (to < from) throw new DataCoreAccessError(400, "to는 from보다 빠를 수 없습니다.");

  const campusId = cleanText(url.searchParams.get("campusId"), 120);
  if (campusId && !context.isSuperAdmin) requireCampusAccess(context, campusId);

  const recordsUrl = new URL(url);
  recordsUrl.searchParams.set("recordType", CALENDAR_RECORD_TYPE);
  recordsUrl.searchParams.set("sourceApp", CALENDAR_SOURCE_APP);
  recordsUrl.searchParams.set("limit", "100");
  const records = await listDataRecords(db, context, recordsUrl);
  return records
    .filter((record) => !campusId || record.campusId === campusId || record.visibility === "organization")
    .map((record) => calendarEvent(record))
    .filter((record) => {
      const metadata = record.metadata as CalendarMetadata;
      return metadata.startDate <= to && (metadata.endDate || metadata.startDate) >= from;
    })
    .sort((left, right) => {
      const a = left.metadata as CalendarMetadata;
      const b = right.metadata as CalendarMetadata;
      return a.startDate.localeCompare(b.startDate) || String(left.title).localeCompare(String(right.title), "ko");
    });
}

export async function createAcademyCalendarEvent(
  db: D1Database,
  context: DataCoreAccessContext,
  input: unknown,
) {
  requireWriteAccess(context);
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const scope = calendarScope(context, body);
  const record = await createDataRecord(db, context, {
    recordType: CALENDAR_RECORD_TYPE,
    sourceApp: CALENDAR_SOURCE_APP,
    campusId: scope.campusId,
    visibility: scope.visibility,
    title: cleanText(body.title, 240),
    summary: cleanText(body.summary, 10_000) || null,
    metadata: calendarMetadata(body),
  });
  return calendarEvent(record);
}

export async function updateAcademyCalendarEvent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
  input: unknown,
) {
  requireWriteAccess(context);
  const existing = ensureCalendarRecord(await getDataRecord(db, context, recordId));
  const body = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const scope = calendarScope(
    context,
    body,
    typeof existing.campusId === "string" ? existing.campusId : null,
    typeof existing.visibility === "string" ? existing.visibility : undefined,
  );
  const existingMetadata = calendarMetadata(existing.metadata);
  const metadataInput = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? { ...existingMetadata, ...(body.metadata as Record<string, unknown>) }
    : existingMetadata;
  const record = await updateDataRecord(db, context, recordId, {
    recordType: CALENDAR_RECORD_TYPE,
    sourceApp: CALENDAR_SOURCE_APP,
    campusId: scope.campusId,
    visibility: scope.visibility,
    title: body.title === undefined ? String(existing.title) : cleanText(body.title, 240),
    summary: body.summary === undefined
      ? (typeof existing.summary === "string" ? existing.summary : null)
      : cleanText(body.summary, 10_000) || null,
    metadata: calendarMetadata(metadataInput, existingMetadata),
  });
  return calendarEvent(record);
}

export async function deleteAcademyCalendarEvent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  requireWriteAccess(context);
  ensureCalendarRecord(await getDataRecord(db, context, recordId));
  return deleteDataRecord(db, context, recordId);
}

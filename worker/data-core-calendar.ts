import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireCampusAccess,
  requireWriteAccess,
  requireAuthenticatedAccess, isCampusAdmin, managesCampus,
} from "./data-core-access";
import {
  createDataRecord,
  deleteDataRecord,
  getDataRecord,
  rowToRecord, canReadRow, canMutateRecord,
  updateDataRecord,
} from "./data-core-records";
import { DEFAULT_ORGANIZATION_ID, ensureDataCoreDatabase } from './data-core';

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
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  location?: string;
  eventType: string;
  sourceRecordId?: string;
  sourceApp?: string;
  holidayOverride?: boolean;
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseDate(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
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
  const endDate = String(input.endDate ?? fallback.endDate ?? "").trim() || startDate;
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
  const allDay = input.allDay === undefined ? fallback.allDay : input.allDay;
  if (allDay !== undefined && typeof allDay !== 'boolean') throw new DataCoreAccessError(400, '종일 여부가 올바르지 않습니다.');
  const time = (value: unknown) => {
    const result = cleanText(value, 20);
    if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new DataCoreAccessError(400, '시간은 HH:mm 형식이어야 합니다.');
    return result;
  };
  const startTime = allDay === true ? '' : time(input.startTime ?? fallback.startTime);
  const endTime = allDay === true ? '' : time(input.endTime ?? fallback.endTime);
  if (endTime && !startTime) throw new DataCoreAccessError(400, '시작 시간을 입력하세요.');
  if (startTime && endTime && endDate === startDate && endTime < startTime) throw new DataCoreAccessError(400, '종료 시간은 시작 시간과 같거나 이후여야 합니다.');
  const location = cleanText(input.location ?? fallback.location, 300);
  // A campus teaching on a public holiday/closure: a class event marking that date as a normal lesson
  // day, so 출석부 keeps it as a regular column instead of 휴.
  const holidayOverride = (input.holidayOverride ?? fallback.holidayOverride) === true;
  if (holidayOverride && eventType !== "class") throw new DataCoreAccessError(400, "공휴일 수업 표시는 수업 일정에만 쓸 수 있습니다.");
  return {
    schemaVersion: 1,
    startDate,
    ...(endDate === startDate ? {} : { endDate }),
    ...(allDay === undefined ? {} : { allDay }),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(location ? { location } : {}),
    eventType,
    ...(sourceRecordId ? { sourceRecordId } : {}),
    ...(sourceApp ? { sourceApp } : {}),
    ...(holidayOverride ? { holidayOverride } : {}),
  };
}

// Home uses metadata; older clients (including FAMILY) send top-level dates.
function calendarInput(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.metadata;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? { ...body, ...nested as Record<string, unknown> }
    : body;
}

function ensureCalendarRecord(record: CalendarRecord): CalendarRecord {
  if (record.recordType !== CALENDAR_RECORD_TYPE || record.sourceApp !== CALENDAR_SOURCE_APP) {
    throw new DataCoreAccessError(404, "일정을 찾을 수 없습니다.");
  }
  return record;
}

function calendarEvent(record: CalendarRecord, context: DataCoreAccessContext) {
  const metadata = calendarMetadata(record.metadata);
  return {
    ...record,
    metadata,
    canManage: context.canWrite && !metadata.sourceRecordId && (context.isSuperAdmin || record.visibility !== 'organization') && canMutateRecord(context, {
      campus_id: record.campusId, created_by_user_id: record.createdByUserId, record_type: record.recordType,
    }),
  };
}

export async function getAcademyCalendarEvent(db: D1Database, context: DataCoreAccessContext, id: string) {
  return calendarEvent(ensureCalendarRecord(await getDataRecord(db, context, id)), context);
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

export async function listAcademyCalendar(db: D1Database, context: DataCoreAccessContext, url: URL) {
  requireAuthenticatedAccess(context);
  await ensureDataCoreDatabase(db);
  const from = parseDate(url.searchParams.get('from'), 'from');
  const to = parseDate(url.searchParams.get('to'), 'to');
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000) throw new DataCoreAccessError(400, '조회 기간은 63일 이내여야 합니다.');
  const campusId = cleanText(url.searchParams.get('campusId'), 120);
  if (campusId && !context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, '해당 캠퍼스의 일정을 볼 권한이 없습니다.');
  const scope = url.searchParams.get('scope') || 'all';
  if (!['all', 'organization', 'campus'].includes(scope)) throw new DataCoreAccessError(400, '일정 범위를 확인하세요.');
  const type = url.searchParams.get('eventType') || '';
  if (type && !EVENT_TYPES.has(type)) throw new DataCoreAccessError(400, '일정 유형을 확인하세요.');
  const q = cleanText(url.searchParams.get('q'), 120);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  // Guard malformed legacy JSON before extraction. Date filtering and authorization precede LIMIT.
  const json = "CASE WHEN json_valid(dr.metadata_json) THEN dr.metadata_json ELSE '{}' END";
  const start = `json_extract(${json}, '$.startDate')`;
  const end = `COALESCE(NULLIF(json_extract(${json}, '$.endDate'), ''), ${start})`;
  const conditions = ["dr.organization_id=?", "dr.record_type=?", "dr.source_app=?", "dr.deleted_at IS NULL",
    `length(${start})=10 AND date(${start}, '+0 days')=${start}`,
    `length(${end})=10 AND date(${end}, '+0 days')=${end}`,
    `${start}<=? AND ${end}>=? AND ${end}>=${start}`];
  const bindings: unknown[] = [DEFAULT_ORGANIZATION_ID, CALENDAR_RECORD_TYPE, CALENDAR_SOURCE_APP, to, from];
  const allowed = context.campusIds;
  const inCampuses = (ids: string[]) => ids.length ? `dr.campus_id IN (${ids.map(() => '?').join(',')})` : '0';
  if (!context.isSuperAdmin) {
    const managed = allowed.filter(id => managesCampus(context, id));
    if (isCampusAdmin(context)) {
      conditions.push(`(dr.campus_id IS NULL OR ${inCampuses(managed)})`); bindings.push(...managed);
    }
    conditions.push(`(${inCampuses(managed)} OR dr.visibility='public' OR (? AND (dr.visibility='organization' OR (dr.visibility='campus' AND ${inCampuses(allowed)}) OR (dr.visibility='private' AND dr.created_by_user_id=?))))`);
    bindings.push(...managed, context.memberships.length ? 1 : 0, ...allowed, context.user!.internalUserId);
  }
  if (scope === 'organization') conditions.push("dr.visibility='organization'");
  if (scope === 'campus') conditions.push("dr.visibility='campus'");
  if (campusId) { conditions.push("dr.campus_id=?"); bindings.push(campusId); }
  if (type) { conditions.push(`COALESCE(json_extract(${json}, '$.eventType'),'other')=?`); bindings.push(type); }
  if (q) { conditions.push("(instr(lower(dr.title),lower(?))>0 OR instr(lower(COALESCE(dr.summary,'')),lower(?))>0)"); bindings.push(q,q); }
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    let after;
    try { after = JSON.parse(atob(cursor)); } catch { throw new DataCoreAccessError(400, '잘못된 페이지입니다.'); }
    if (!Array.isArray(after) || after.length !== 2 || typeof after[1] !== 'string' || after[1].length > 160) throw new DataCoreAccessError(400, '잘못된 페이지입니다.');
    const date = parseDate(after[0], 'cursor');
    conditions.push(`(${start}>? OR (${start}=? AND dr.id>?))`); bindings.push(date,date,after[1]);
  }
  const result = await db.prepare(`SELECT dr.*, c.name AS campus_name, u.display_name AS created_by_name
    FROM data_records dr LEFT JOIN campuses c ON c.id=dr.campus_id LEFT JOIN users u ON u.id=dr.created_by_user_id
    WHERE ${conditions.join(' AND ')} ORDER BY ${start}, dr.id LIMIT ?`).bind(...bindings, Math.floor(limit)+1).all<Record<string, unknown>>();
  const rows = result.results || [], hasMore = rows.length > limit, page = rows.slice(0,limit);
  const events = page.flatMap(row => {
    if (!canReadRow(context,row)) return [];
    try { return [calendarEvent(rowToRecord(row),context)]; } catch (error) {
      if (error instanceof DataCoreAccessError && error.status === 400) return [];
      throw error;
    }
  });
  const last = page.at(-1);
  return { events, hasMore, nextCursor: hasMore && last ? btoa(JSON.stringify([JSON.parse(String(last.metadata_json)).startDate, last.id])) : null };
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
    metadata: calendarMetadata(calendarInput(body)),
  });
  return calendarEvent(record, context);
}

export async function updateAcademyCalendarEvent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
  input: unknown,
) {
  requireWriteAccess(context);
  const existing = ensureCalendarRecord(await getDataRecord(db, context, recordId));
  if (!calendarEvent(existing, context).canManage) throw new DataCoreAccessError(403, '이 일정을 수정할 권한이 없습니다.');
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
  const metadataInput = calendarInput(body);
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
  return calendarEvent(record, context);
}

export async function deleteAcademyCalendarEvent(
  db: D1Database,
  context: DataCoreAccessContext,
  recordId: string,
) {
  requireWriteAccess(context);
  const existing = ensureCalendarRecord(await getDataRecord(db, context, recordId));
  if (!calendarEvent(existing, context).canManage) throw new DataCoreAccessError(403, '이 일정을 삭제할 권한이 없습니다.');
  return deleteDataRecord(db, context, recordId);
}

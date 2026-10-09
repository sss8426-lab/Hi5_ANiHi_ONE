import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { requireKkumeumStudentAccess } from "./kkumeum-core";
import { getGuardianChild } from "./kkumeum-guardian-feed";
import { ensureKkumeumGuardianAuthSchema } from "./kkumeum-guardian-auth";
import { dispatchGuardianDirectPush, type KkumeumPushEnv } from "./kkumeum-push";
import { listKkumeumStudents } from "./kkumeum-staff";
import { attendanceScheduleForDay } from "./kkumeum-attendance-roster";
import { assertKkumeumPilotCampus } from "./kkumeum-pilot";

// 출석체크: staff mark 등원·하원·결석·지각·조퇴·보강 and the child's guardians get an alert at once.
export const ATTENDANCE_STATUSES = {
  arrive: "등원",
  leave: "하원",
  absent: "결석",
  late: "지각",
  early: "조퇴",
  makeup: "보강",
} as const;
type AttendanceStatus = keyof typeof ATTENDANCE_STATUSES;
const MAX_STUDENTS_PER_MARK = 60;

type EventRow = {
  id: string; campus_id: string; student_id: string; class_id: string | null; event_date: string;
  status: AttendanceStatus; message: string | null; occurred_at: string; created_by: string | null;
  created_at: string; canceled_at: string | null;
};

export async function ensureKkumeumAttendanceSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_attendance_events (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      class_id TEXT,
      event_date TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      occurred_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      canceled_at TEXT,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_attendance_campus_date_idx ON family_attendance_events(campus_id, event_date)"),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_attendance_student_date_idx ON family_attendance_events(student_id, event_date)"),
  ]);
}

// Academy days follow Korean time, whatever the worker's clock zone is.
export function kstDate(date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function kstTime(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(11, 16);
}
function validDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new DataCoreAccessError(400, "날짜를 확인해 주세요.");
  return date;
}
function validMonth(value: unknown): string {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DataCoreAccessError(400, "월을 확인해 주세요.");
  return month;
}
function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}
function eventResponse(row: EventRow) {
  return { id: row.id, studentId: row.student_id, date: row.event_date, status: row.status, label: ATTENDANCE_STATUSES[row.status] || row.status,
    time: kstTime(row.occurred_at), occurredAt: row.occurred_at, message: row.message || "" };
}

export function attendanceAlertText(studentName: string, status: AttendanceStatus, occurredAt: string, message = ""): string {
  const time = kstTime(occurredAt);
  const base = {
    arrive: `${studentName} 학생이 ${time}에 등원했습니다.`,
    leave: `${studentName} 학생이 ${time}에 하원했습니다.`,
    absent: `${studentName} 학생이 오늘 결석으로 확인되었습니다.`,
    late: `${studentName} 학생이 ${time}에 지각 등원했습니다.`,
    early: `${studentName} 학생이 ${time}에 조퇴했습니다.`,
    makeup: `${studentName} 학생이 ${time}에 보강 수업에 참여했습니다.`,
  }[status];
  return message ? `${base}\n${message}` : base;
}

export function attendanceCorrectionText(studentName: string, row: Pick<EventRow, "event_date" | "occurred_at" | "status">): string {
  return `출결 정정: ${studentName} 학생의 ${row.event_date} ${kstTime(row.occurred_at)} ${ATTENDANCE_STATUSES[row.status]} 기록을 취소했습니다. 해당 기록은 유효하지 않습니다. 현재 출결은 앱에서 확인해 주세요.`;
}

// Delivery is best effort after saving. Never expose the original free-text note in a correction.
async function notifyAttendance(familyDb: D1Database, env: KkumeumPushEnv, row: EventRow, canceled: boolean) {
  try {
    const student = await familyDb.prepare("SELECT name, display_name FROM family_students WHERE id = ? AND campus_id = ? AND status = 'active'")
      .bind(row.student_id, row.campus_id).first<{ name: string; display_name: string | null }>();
    if (!student) return { guardians: 0, push: { sent: 0, failed: 0, code: null } };
    const guardians = (await familyDb.prepare(`SELECT sg.guardian_id FROM student_guardians sg JOIN family_guardians g ON g.id = sg.guardian_id
      WHERE sg.student_id = ? AND g.status = 'active'`).bind(row.student_id).all<{ guardian_id: string }>()).results || [];
    const name = student.display_name || student.name;
    const push = await dispatchGuardianDirectPush(familyDb, env, guardians.map((g) => g.guardian_id), {
      kind: "attendance", attendanceAction: canceled ? "canceled" : "marked", eventId: row.id,
      title: canceled ? `꿈이음 · 출결 정정 (${ATTENDANCE_STATUSES[row.status]} 취소)` : `꿈이음 · ${ATTENDANCE_STATUSES[row.status]}`,
      body: canceled ? attendanceCorrectionText(name, row) : attendanceAlertText(name, row.status, row.occurred_at, row.message || ""),
      studentId: row.student_id, route: `/family/?openAttendance=${encodeURIComponent(row.student_id)}`,
    }, { studentId: row.student_id, campusId: row.campus_id, attendanceEventId: row.id, canceled });
    return { guardians: guardians.length, push };
  } catch {
    return { guardians: 0, push: { sent: 0, failed: 0, code: "push_delivery_unavailable" } };
  }
}

async function events(familyDb: D1Database, campusId: string, studentIds: string[], from: string, to: string): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let i = 0; i < studentIds.length; i += 80) {
    const ids = studentIds.slice(i, i + 80);
    const result = await familyDb.prepare(`SELECT * FROM family_attendance_events
      WHERE campus_id = ? AND event_date BETWEEN ? AND ? AND canceled_at IS NULL AND student_id IN (${ids.map(() => "?").join(",")})
      ORDER BY occurred_at`).bind(campusId, from, to, ...ids).all<EventRow>();
    rows.push(...(result.results || []));
  }
  return rows;
}

// Staff: the students this account may see (teachers: their classes) with that day's marks.
export async function listStaffAttendanceDay(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, dateValue: unknown, classId?: string) {
  await ensureKkumeumAttendanceSchema(familyDb);
  const date = dateValue ? validDate(dateValue) : kstDate();
  const students = await listKkumeumStudents(familyDb, context, campusId, { classId, status: "active" }) as Record<string, unknown>[];
  // The month's 출석부 (saved when it was made) decides who has class today and carries the phone numbers.
  const schedule = await attendanceScheduleForDay(familyDb, context, campusId, date, new Set(students.map((s) => String(s.id))));
  const ids = new Set(students.map((s) => String(s.id)));
  for (const group of schedule?.classes || []) for (const entry of group.students) if (entry.studentId) ids.add(entry.studentId);
  const byStudent = new Map<string, ReturnType<typeof eventResponse>[]>();
  for (const row of await events(familyDb, campusId, [...ids], date, date)) {
    if (!byStudent.has(row.student_id)) byStudent.set(row.student_id, []);
    byStudent.get(row.student_id)!.push(eventResponse(row));
  }
  return {
    date,
    schedule: schedule && { ...schedule, classes: schedule.classes.map((group) => ({ ...group, students: group.students.map((entry) => ({ ...entry, events: entry.studentId ? byStudent.get(entry.studentId) || [] : [] })) })) },
    students: students.map((s) => ({ id: s.id, name: s.display_name || s.name, classId: s.current_class_id || null, events: byStudent.get(String(s.id)) || [] })),
  };
}

export async function listStaffAttendanceMonth(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, monthValue: unknown, classId?: string) {
  await ensureKkumeumAttendanceSchema(familyDb);
  const month = validMonth(monthValue || kstDate().slice(0, 7));
  const [from, to] = monthRange(month);
  const students = await listKkumeumStudents(familyDb, context, campusId, { classId }) as Record<string, unknown>[];
  const rows = await events(familyDb, campusId, students.map((s) => String(s.id)), from, to);
  return { month, students: students.map((s) => {
    const own = rows.filter((r) => r.student_id === s.id);
    const days: Record<string, string[]> = {};
    for (const r of own) (days[r.event_date] ||= []).push(r.status);
    const counts = Object.fromEntries(Object.keys(ATTENDANCE_STATUSES).map((k) => [k, own.filter((r) => r.status === k).length]));
    return { id: s.id, name: s.display_name || s.name, classId: s.current_class_id || null, counts, days };
  }) };
}

// Staff marks one status for up to 60 students; each linked guardian gets one alert per child.
export async function markKkumeumAttendance(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  env: KkumeumPushEnv,
  input: Record<string, unknown>,
) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumAttendanceSchema(familyDb);
  const campusId = String(input.campusId ?? "").trim().slice(0, 120);
  const status = String(input.status ?? "") as AttendanceStatus;
  if (!campusId) throw new DataCoreAccessError(400, "캠퍼스를 선택해 주세요.");
  if (!Object.hasOwn(ATTENDANCE_STATUSES, status)) throw new DataCoreAccessError(400, "출결 상태를 선택해 주세요.");
  const studentIds = [...new Set((Array.isArray(input.studentIds) ? input.studentIds : []).map((id) => String(id).trim().slice(0, 120)).filter(Boolean))];
  if (!studentIds.length) throw new DataCoreAccessError(400, "학생을 선택해 주세요.");
  if (studentIds.length > MAX_STUDENTS_PER_MARK) throw new DataCoreAccessError(400, `한 번에 ${MAX_STUDENTS_PER_MARK}명까지 처리할 수 있습니다.`);
  const message = String(input.message ?? "").trim().slice(0, 500);
  for (const id of studentIds) {
    await requireKkumeumStudentAccess(familyDb, context, campusId, id);
    // Super admins skip the campus check above; a student of another campus is still refused, not skipped.
    if (!await familyDb.prepare("SELECT 1 FROM family_students WHERE id = ? AND campus_id = ?").bind(id, campusId).first()) {
      throw new DataCoreAccessError(403, "선택한 캠퍼스의 학생만 출석체크할 수 있습니다.");
    }
  }

  const now = new Date().toISOString(), date = kstDate(new Date(now));
  const marked = [];
  let sent = 0, failed = 0, code: string | null = null;
  for (const studentId of studentIds) {
    const student = await familyDb.prepare("SELECT id, name, display_name, current_class_id FROM family_students WHERE id = ? AND campus_id = ?")
      .bind(studentId, campusId).first<{ id: string; name: string; display_name: string | null; current_class_id: string | null }>();
    if (!student) continue;
    const id = crypto.randomUUID();
    await familyDb.batch([
      familyDb.prepare(`INSERT INTO family_attendance_events (id, campus_id, student_id, class_id, event_date, status, message, occurred_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, campusId, studentId, student.current_class_id, date, status, message || null, now, context.user?.internalUserId || null, now),
      familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
        VALUES (?, ?, 'staff', ?, 'attendance_mark', 'student', ?, ?, ?)`).bind(crypto.randomUUID(), campusId, context.user?.internalUserId || null, studentId, JSON.stringify({ status }), now),
    ]);
    const { guardians, push } = await notifyAttendance(familyDb, env, {
      id, campus_id: campusId, student_id: studentId, class_id: student.current_class_id, event_date: date,
      status, message, occurred_at: now, created_by: context.user?.internalUserId || null, created_at: now, canceled_at: null,
    }, false);
    sent += push.sent; failed += push.failed; code ||= push.code;
    marked.push({ id, studentId, status, time: kstTime(now), guardians });
  }
  return { date, marked, push: { sent, failed, code } };
}

// Only the conditional-update winner sends a correction; retries must not send it again.
export async function cancelKkumeumAttendance(familyDb: D1Database, context: DataCoreAccessContext, env: KkumeumPushEnv, id: string) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumAttendanceSchema(familyDb);
  const row = await familyDb.prepare("SELECT * FROM family_attendance_events WHERE id = ? AND canceled_at IS NULL").bind(id).first<EventRow>();
  if (!row) throw new DataCoreAccessError(404, "출결 기록을 찾을 수 없습니다.");
  await requireKkumeumStudentAccess(familyDb, context, row.campus_id, row.student_id);
  await assertKkumeumPilotCampus(familyDb, row.campus_id);
  const now = new Date().toISOString();
  if (row.event_date !== kstDate(new Date(now))) throw new DataCoreAccessError(409, "오늘 기록만 취소할 수 있습니다.");
  const result = await familyDb.batch([
    familyDb.prepare("UPDATE family_attendance_events SET canceled_at = ? WHERE id = ? AND canceled_at IS NULL").bind(now, id),
    familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
      SELECT ?, ?, 'staff', ?, 'attendance_cancel', 'attendance_event', ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), row.campus_id, context.user?.internalUserId || null, id, JSON.stringify({ status: row.status }), now),
  ]);
  if (Number(result[0].meta?.changes || 0) !== 1) throw new DataCoreAccessError(409, "이미 취소된 출결 기록입니다.");
  const notification = await notifyAttendance(familyDb, env, row, true);
  return { ok: true, id, ...notification };
}

// Guardian: one month of a linked child's marks (only children linked to this guardian).
export async function listGuardianChildAttendance(familyDb: D1Database, request: Request, studentId: string, monthValue: unknown) {
  await getGuardianChild(familyDb, request, studentId);
  await ensureKkumeumAttendanceSchema(familyDb);
  const month = validMonth(monthValue || kstDate().slice(0, 7));
  const [from, to] = monthRange(month);
  const rows = (await familyDb.prepare(`SELECT * FROM family_attendance_events WHERE student_id = ? AND event_date BETWEEN ? AND ? ORDER BY occurred_at`)
    .bind(studentId, from, to).all<EventRow>()).results || [];
  const corrections = rows.filter((row) => row.canceled_at).map((row) => ({
    id: row.id, studentId: row.student_id, date: row.event_date, status: row.status,
    label: ATTENDANCE_STATUSES[row.status], time: kstTime(row.occurred_at), canceledAt: row.canceled_at,
  }));
  return { month, today: kstDate(), events: rows.filter((row) => !row.canceled_at).map(eventResponse), corrections };
}

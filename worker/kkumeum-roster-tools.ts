import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import {
  SLOT, campusStudents, ensureKkumeumAttendanceRosterSchema, isManager, matchRosterStudent, norm, pickRosterMonth,
  type RosterClass, type RosterEntry, type StudentRow,
} from "./kkumeum-attendance-roster";
import { attendanceEventsBetween, ensureKkumeumAttendanceSchema, kstDate } from "./kkumeum-attendance";
import { fillCheckinCodes } from "./kkumeum-checkin";
import { listKkumeumStudents, updateKkumeumStudent } from "./kkumeum-staff";

// 명단 정리 (원장·관리자) and 출결 반영 출석부.
// 명단 정리 works on one month's saved 출석부 (the roster 출석체크 uses): link a roster row to the right
// 꿈이음 student (동명이인 · 휴원생), register it as a new student, move it to another 반 or change its
// 수업요일, and set 재원 · 휴원 · 퇴원. 휴원·퇴원 students drop out of 출석체크 and the 출결기 at once.
// 출결 반영 출석부 returns the month's roster with each student's day-by-day attendance so the 출석부
// page's own Excel writer can fill the date cells.

const LEFT_STATUSES = new Set(["leave", "withdrawn", "moved", "graduated"]);
const EDIT_STATUSES = new Set(["active", "leave", "withdrawn"]);
const DAY_ORDER = "월화수목금토일";
const slotRank = (slot: string) => DAY_ORDER.indexOf(slot[0]) * 3 + Number(slot[1]);

function requireManager(context: DataCoreAccessContext, campusId: string) {
  requireAuthenticatedAccess(context);
  if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "명단 정리는 캠퍼스 원장·관리자만 할 수 있습니다.");
}
function validMonth(value: unknown): string {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DataCoreAccessError(400, "출석부 월을 확인해 주세요.");
  return month;
}

async function loadRoster(familyDb: D1Database, campusId: string, month: string) {
  await ensureKkumeumAttendanceRosterSchema(familyDb);
  const row = await familyDb.prepare("SELECT roster_json, updated_at FROM family_attendance_rosters WHERE campus_id = ? AND year_month = ?")
    .bind(campusId, month).first<{ roster_json: string; updated_at: string }>();
  if (!row) throw new DataCoreAccessError(404, `${Number(month.slice(5))}월 출석부가 아직 없습니다. 업무 › 출석부에서 먼저 만들어 주세요.`);
  let classes: RosterClass[] = [];
  try { classes = (JSON.parse(row.roster_json) as { classes?: RosterClass[] }).classes || []; } catch { classes = []; }
  return { classes, updatedAt: row.updated_at };
}

async function saveRoster(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, month: string, classes: RosterClass[], updatedAt: string, detail: Record<string, unknown>) {
  const kept = classes.filter((c) => c.students.length);
  const now = new Date(Math.max(Date.now(), (Date.parse(updatedAt) || 0) + 1)).toISOString();
  const count = kept.reduce((n, c) => n + c.students.length, 0);
  const result = await familyDb.prepare(`UPDATE family_attendance_rosters SET roster_json = ?, student_count = ?, updated_at = ?
    WHERE campus_id = ? AND year_month = ? AND updated_at = ?`).bind(JSON.stringify({ classes: kept }), count, now, campusId, month, updatedAt).run();
  if (!result.meta?.changes) throw new DataCoreAccessError(409, "다른 곳에서 출석부가 바뀌었습니다. 새로고침한 뒤 다시 해 주세요.");
  await familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, 'staff', ?, 'attendance_roster.review', 'attendance_roster', ?, ?, ?)`)
    .bind(crypto.randomUUID(), campusId, context.user?.internalUserId || null, month, JSON.stringify(detail), now).run();
}

/** The roster row a request points at; the name must still match so a stale screen never edits the wrong child. */
function rosterEntry(classes: RosterClass[], key: unknown, name: unknown) {
  const [gi, si] = String(key ?? "").split(":").map(Number);
  const entry = classes[gi]?.students?.[si];
  if (!entry || norm(entry.name) !== norm(name)) throw new DataCoreAccessError(409, "출석부 명단이 바뀌었습니다. 새로고침한 뒤 다시 해 주세요.");
  return { group: classes[gi], entry, gi, si };
}

async function classIdFor(familyDb: D1Database, campusId: string, name: string, now: string): Promise<string> {
  const rows = (await familyDb.prepare("SELECT id, name FROM family_classes WHERE campus_id = ? AND active = 1").bind(campusId).all<{ id: string; name: string }>()).results || [];
  const found = rows.find((c) => norm(c.name) === norm(name));
  if (found) return found.id;
  const id = crypto.randomUUID();
  await familyDb.prepare(`INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)`)
    .bind(id, campusId, name, rows.length, now, now).run();
  return id;
}

/** 명단 정리 screen: every roster row with its 꿈이음 link, the rows to check, and 재원생 missing from the 출석부. */
export async function reviewAttendanceRoster(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, monthValue: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumAttendanceRosterSchema(familyDb);
  const months = ((await familyDb.prepare("SELECT year_month FROM family_attendance_rosters WHERE campus_id = ? ORDER BY year_month DESC LIMIT 24").bind(campusId)
    .all<{ year_month: string }>()).results || []).map((r) => r.year_month);
  const month = monthValue ? validMonth(monthValue) : pickRosterMonth(months, kstDate());
  if (!month) return { month: null, months, rows: [], notInRoster: [], classNames: [], updatedAt: null };
  const { classes, updatedAt } = await loadRoster(familyDb, campusId, month);
  const students = await campusStudents(familyDb, campusId);
  const byId = new Map(students.map((s) => [s.id, s]));
  const linked = new Set<string>();
  const brief = (s: StudentRow) => ({ id: s.id, name: s.display_name || s.name, className: s.class_name || "", status: s.status });
  const rows = classes.flatMap((group, gi) => group.students.map((entry, si) => {
    const own = entry.studentId ? byId.get(entry.studentId) : undefined;
    const match = own ? { studentId: own.id, reason: own.status === "active" ? "matched" : "left" } : matchRosterStudent(students, group.name, entry.name, entry.studentId);
    const student = match.studentId ? byId.get(match.studentId) : undefined;
    if (student) linked.add(student.id);
    const candidates = match.reason === "matched" || match.reason === "left" ? []
      : students.filter((s) => norm(s.name) === norm(entry.name) || (s.display_name && norm(s.display_name) === norm(entry.name))).map(brief);
    return { key: `${gi}:${si}`, className: group.name, no: entry.no, name: entry.name, slots: entry.slots || [], parentPhone: entry.parentPhone || "",
      studentId: student?.id || null, status: student?.status || null, reason: match.reason, candidates };
  }));
  const classNames = [...new Set([...classes.map((c) => c.name), ...students.filter((s) => s.class_name && s.status === "active").map((s) => s.class_name as string)])];
  const notInRoster = students.filter((s) => s.status === "active" && !linked.has(s.id)).map(brief);
  return { month, months, updatedAt, rows, notInRoster, classNames };
}

/** One 명단 정리 change, then the refreshed screen. */
export async function applyAttendanceRosterReview(familyDb: D1Database, context: DataCoreAccessContext, input: Record<string, unknown>) {
  const campusId = String(input.campusId ?? "").trim().slice(0, 120);
  if (!campusId) throw new DataCoreAccessError(400, "캠퍼스를 선택해 주세요.");
  requireManager(context, campusId);
  const action = String(input.action ?? "");
  const month = validMonth(input.month);
  const now = new Date().toISOString();

  if (action === "status") {
    const status = String(input.status ?? "");
    if (!EDIT_STATUSES.has(status)) throw new DataCoreAccessError(400, "재원·휴원·퇴원 중에서 골라 주세요.");
    const studentId = String(input.studentId ?? "");
    if (!await familyDb.prepare("SELECT 1 FROM family_students WHERE id = ? AND campus_id = ?").bind(studentId, campusId).first()) throw new DataCoreAccessError(404, "학생을 찾을 수 없습니다.");
    await updateKkumeumStudent(familyDb, context, studentId, { status });
    if (status === "active") await fillCheckinCodes(familyDb, campusId);
    return reviewAttendanceRoster(familyDb, context, campusId, month);
  }

  const { classes, updatedAt } = await loadRoster(familyDb, campusId, month);
  if (String(input.updatedAt ?? "") !== updatedAt) throw new DataCoreAccessError(409, "다른 곳에서 출석부가 바뀌었습니다. 새로고침한 뒤 다시 해 주세요.");
  const { group, entry, gi, si } = rosterEntry(classes, input.key, input.name);

  if (action === "link") {
    const student = await familyDb.prepare("SELECT id, status FROM family_students WHERE id = ? AND campus_id = ?").bind(String(input.studentId ?? ""), campusId)
      .first<{ id: string; status: string }>();
    if (!student) throw new DataCoreAccessError(404, "연결할 학생을 찾을 수 없습니다.");
    entry.studentId = student.id;
    await saveRoster(familyDb, context, campusId, month, classes, updatedAt, { action, name: entry.name, studentId: student.id });
    if (student.status !== "active" && input.reactivate === true) {
      await updateKkumeumStudent(familyDb, context, student.id, { status: "active" });
      await fillCheckinCodes(familyDb, campusId);
    }
  } else if (action === "create") {
    const classId = await classIdFor(familyDb, campusId, group.name, now);
    const id = crypto.randomUUID();
    await familyDb.batch([
      familyDb.prepare(`INSERT INTO family_students (id, campus_id, name, display_name, birth_year, school_name, grade, status, current_class_id, created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?, 'active', ?, ?, ?)`).bind(id, campusId, entry.name, entry.school || null, entry.grade || null, classId, now, now),
      familyDb.prepare("INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, classId, now, now),
      familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
        VALUES (?, ?, 'staff', ?, 'student.create', 'family_student', ?, ?, ?)`)
        .bind(crypto.randomUUID(), campusId, context.user?.internalUserId || null, id, JSON.stringify({ classId, source: "roster_review", month }), now),
    ]);
    entry.studentId = id;
    await saveRoster(familyDb, context, campusId, month, classes, updatedAt, { action, name: entry.name, studentId: id });
    await fillCheckinCodes(familyDb, campusId);
  } else if (action === "edit") {
    const className = String(input.className ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || group.name;
    const slots = [...new Set((Array.isArray(input.slots) ? input.slots : entry.slots || []).map(String).filter((s) => SLOT.test(s)))].sort((a, b) => slotRank(a) - slotRank(b));
    const status = input.status === undefined ? null : String(input.status);
    if (status !== null && !EDIT_STATUSES.has(status)) throw new DataCoreAccessError(400, "재원·휴원·퇴원 중에서 골라 주세요.");
    const moved = norm(className) !== norm(group.name);
    const next: RosterEntry = { ...entry, slots };
    if (moved) {
      group.students.splice(si, 1);
      const target = classes.find((c, i) => i !== gi && norm(c.name) === norm(className)) || (classes.push({ name: className, students: [] }), classes[classes.length - 1]);
      target.students.push(next);
    } else {
      group.students[si] = next;
    }
    await saveRoster(familyDb, context, campusId, month, classes, updatedAt, { action, name: entry.name, from: group.name, to: className, slots, status });
    if (entry.studentId) {
      const current = await familyDb.prepare("SELECT status, current_class_id FROM family_students WHERE id = ? AND campus_id = ?").bind(entry.studentId, campusId)
        .first<{ status: string; current_class_id: string | null }>();
      if (current) {
        const change: Record<string, unknown> = {};
        if (moved) change.classId = await classIdFor(familyDb, campusId, className, now);
        if (status && status !== current.status) change.status = status;
        if (Object.keys(change).length) await updateKkumeumStudent(familyDb, context, entry.studentId, change);
        if (status === "active") await fillCheckinCodes(familyDb, campusId);
      }
    }
  } else {
    throw new DataCoreAccessError(400, "지원하지 않는 명단 정리 요청입니다.");
  }
  return reviewAttendanceRoster(familyDb, context, campusId, month);
}

/** A day's marks → one 출석부 symbol: 보강 > 지각 > 조퇴 > 출석, 결석 only when the child never came. */
export function dayMark(statuses: string[]): string {
  const has = (s: string) => statuses.includes(s);
  if (has("makeup")) return "makeup";
  if (has("late")) return "late";
  if (has("early")) return "early";
  if (has("arrive") || has("leave")) return "present";
  return has("absent") ? "absent" : "";
}

/**
 * 출결 반영 출석부: the month's roster (as the 출석부 page saved it) with each student's day marks.
 * 원장·관리자 get every class; other staff only the students they may see.
 */
export async function attendanceSheet(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, monthValue: unknown) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 출석부에 접근할 권한이 없습니다.");
  const month = validMonth(monthValue);
  await ensureKkumeumAttendanceSchema(familyDb);
  const { classes, updatedAt } = await loadRoster(familyDb, campusId, month);
  const students = await campusStudents(familyDb, campusId);
  const byId = new Map(students.map((s) => [s.id, s]));
  const visible = isManager(context, campusId) ? null : new Set((await listKkumeumStudents(familyDb, context, campusId, {}) as { id: string }[]).map((s) => String(s.id)));
  const resolved = classes.map((group) => ({
    name: group.name,
    students: group.students.map((entry) => {
      const own = entry.studentId ? byId.get(entry.studentId) : undefined;
      const studentId = own?.id || matchRosterStudent(students, group.name, entry.name, entry.studentId).studentId;
      return { entry, studentId };
    }).filter((row) => !visible || (row.studentId && visible.has(row.studentId))),
  })).filter((group) => group.students.length);
  const ids = [...new Set(resolved.flatMap((g) => g.students.map((s) => s.studentId).filter(Boolean) as string[]))];
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byStudent = new Map<string, Record<string, string[]>>();
  for (const row of await attendanceEventsBetween(familyDb, campusId, ids, `${month}-01`, `${month}-${String(last).padStart(2, "0")}`)) {
    const days = byStudent.get(row.student_id) || byStudent.set(row.student_id, {}).get(row.student_id)!;
    (days[row.event_date] ||= []).push(row.status);
  }
  return {
    month, updatedAt, today: kstDate(),
    classes: resolved.map((group) => ({
      name: group.name,
      students: group.students.map(({ entry, studentId }) => {
        const days = studentId ? byStudent.get(studentId) || {} : {};
        const status = studentId ? byId.get(studentId)?.status || null : null;
        return {
          no: entry.no, name: entry.name, school: entry.school || "", grade: entry.grade || "",
          studentPhone: entry.studentPhone || "", parentPhone: entry.parentPhone || "", registered: entry.registered || null,
          slots: entry.slots || [], status: status && LEFT_STATUSES.has(status) ? status : status ? "active" : null,
          marks: Object.fromEntries(Object.entries(days).map(([date, list]) => [date, dayMark(list)]).filter(([, mark]) => mark)),
        };
      }),
    })),
  };
}

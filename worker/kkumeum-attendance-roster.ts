import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";

// 출석부 ↔ 출석체크 연동.
// When staff build a month's 반별 출석부 from the 종합 출석부, the same roster (반 · 학생 · 수업요일 ·
// 학생/학부모 전화) is saved here per campus and month. 출석체크 then shows, for today's date, exactly
// the students whose 수업요일 includes today's weekday, with call buttons for the student and parent.
// Saving also registers roster students that 꿈이음 does not have yet (additive only: nothing is
// renamed, moved or deactivated), so they can be marked and their guardians alerted.

export const SLOT = /^[월화수목금토일][123]$/;
const WEEKDAY = "일월화수목금토";
const MAX_CLASSES = 80;
const MAX_STUDENTS = 1000;

export type RosterEntry = {
  no: number | null;
  name: string;
  school: string;
  grade: string;
  studentPhone: string;
  parentPhone: string;
  slots: string[];
  registered?: { serial: number | null; text: string } | null;
  studentId?: string | null;
};
export type RosterClass = { name: string; students: RosterEntry[] };
export type StudentRow = { id: string; name: string; display_name: string | null; status: string; current_class_id: string | null; class_name: string | null };
type ClassRow = { id: string; name: string; active: number; sort_order: number };
type Match = { studentId: string | null; reason: "matched" | "missing" | "inactive" | "ambiguous" };

export const norm = (value: unknown) => String(value ?? "").normalize("NFC").replace(/\s+/g, "");
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// Phone numbers stay as typed (010-1234-5678) but only digits, +, - and spaces survive.
export function cleanPhone(value: unknown): string {
  const text = String(value ?? "").replace(/[^\d+\- ]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return /\d{3,}/.test(text) ? text : "";
}

export function isManager(context: DataCoreAccessContext, campusId: string): boolean {
  return context.isSuperAdmin || context.memberships.some(
    (m) => m.campusId === campusId && (m.role === "CAMPUS_DIRECTOR" || m.role === "CAMPUS_ADMIN"),
  );
}

function validMonth(value: unknown): string {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DataCoreAccessError(400, "출석부 월을 확인해 주세요.");
  return month;
}

/** Validates the roster sent by the 출석부 page into classes → students with their weekly slots. */
export function normalizeRoster(input: unknown): RosterClass[] {
  if (!Array.isArray(input) || !input.length) throw new DataCoreAccessError(400, "출석부 반·학생 명단이 비어 있습니다.");
  if (input.length > MAX_CLASSES) throw new DataCoreAccessError(400, `반은 ${MAX_CLASSES}개까지 연동할 수 있습니다.`);
  let total = 0;
  const classes = input.map((raw, index) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = clean(item.name, 120) || `${index + 1}반`;
    const list = Array.isArray(item.students) ? item.students : [];
    const students = list.map((rawStudent) => {
      const s = (rawStudent && typeof rawStudent === "object" ? rawStudent : {}) as Record<string, unknown>;
      const slots = [...new Set((Array.isArray(s.slots) ? s.slots : []).map((slot) => String(slot)).filter((slot) => SLOT.test(slot)))];
      const no = Number(s.no);
      const reg = (s.registered && typeof s.registered === "object" ? s.registered : null) as Record<string, unknown> | null;
      const serial = Number(reg?.serial);
      return {
        no: Number.isInteger(no) ? no : null,
        name: clean(s.name, 100),
        school: clean(s.school, 160),
        grade: clean(s.grade, 40),
        studentPhone: cleanPhone(s.studentPhone),
        parentPhone: cleanPhone(s.parentPhone),
        slots,
        // 등록일 rides along so 출결 반영 출석부 can print the same 등록일 column.
        registered: reg ? { serial: Number.isInteger(serial) && serial > 20000 && serial < 80000 ? serial : null, text: clean(reg.text, 20) } : null,
      };
    }).filter((s) => s.name);
    total += students.length;
    return { name, students };
  }).filter((c) => c.students.length);
  if (!classes.length) throw new DataCoreAccessError(400, "출석부에 학생이 없습니다.");
  if (total > MAX_STUDENTS) throw new DataCoreAccessError(400, `학생은 ${MAX_STUDENTS}명까지 연동할 수 있습니다.`);
  return classes;
}

/** Roster name → 꿈이음 student. Only active students match; a class name settles same-name students. */
export function matchRosterStudent(students: StudentRow[], className: string, name: string, hintId?: string | null): Match {
  if (hintId) {
    const hinted = students.find((s) => s.id === hintId && s.status === "active");
    if (hinted) return { studentId: hinted.id, reason: "matched" };
  }
  const key = norm(name);
  const candidates = students.filter((s) => norm(s.name) === key || (s.display_name && norm(s.display_name) === key));
  const active = candidates.filter((s) => s.status === "active");
  if (active.length === 1) return { studentId: active[0].id, reason: "matched" };
  if (active.length > 1) {
    const sameClass = active.filter((s) => norm(s.class_name) === norm(className));
    return sameClass.length === 1 ? { studentId: sameClass[0].id, reason: "matched" } : { studentId: null, reason: "ambiguous" };
  }
  return { studentId: null, reason: candidates.length ? "inactive" : "missing" };
}

export async function ensureKkumeumAttendanceRosterSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumPhase1Schema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_attendance_rosters (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      year_month TEXT NOT NULL,
      source_name TEXT,
      roster_json TEXT NOT NULL,
      student_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_attendance_rosters_campus_month ON family_attendance_rosters(campus_id, year_month)"),
  ]);
}

export async function campusStudents(familyDb: D1Database, campusId: string): Promise<StudentRow[]> {
  const result = await familyDb.prepare(`SELECT s.id, s.name, s.display_name, s.status, s.current_class_id, c.name AS class_name
    FROM family_students s LEFT JOIN family_classes c ON c.id = s.current_class_id AND c.campus_id = s.campus_id
    WHERE s.campus_id = ? LIMIT 3000`).bind(campusId).all<StudentRow>();
  return result.results || [];
}

/**
 * Saves the month's roster for 출석체크 and registers missing students (campus 원장·관리자 only).
 * The same month saved again replaces the earlier roster.
 */
export async function saveKkumeumAttendanceRoster(familyDb: D1Database, context: DataCoreAccessContext, input: Record<string, unknown>) {
  requireAuthenticatedAccess(context);
  const campusId = clean(input.campusId, 120);
  if (!campusId) throw new DataCoreAccessError(400, "캠퍼스를 선택해 주세요.");
  if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "출석체크 명단 연동은 캠퍼스 원장·관리자만 할 수 있습니다.");
  const month = validMonth(input.month);
  const classes = normalizeRoster(input.classes);
  await ensureKkumeumAttendanceRosterSchema(familyDb);

  const now = new Date().toISOString();
  const actor = context.user?.internalUserId || null;
  const statements: D1PreparedStatement[] = [];
  const classRows = (await familyDb.prepare("SELECT id, name, active, sort_order FROM family_classes WHERE campus_id = ?").bind(campusId).all<ClassRow>()).results || [];
  const students = await campusStudents(familyDb, campusId);
  const created = { classes: 0, students: 0 };
  const unmatched: { name: string; className: string; reason: string }[] = [];
  // The same name twice in one roster is one child in two classes unless the parent numbers differ.
  const seen = new Map<string, { parentPhone: string; studentId: string }[]>();

  for (const [index, group] of classes.entries()) {
    let cls = classRows.find((c) => c.active && norm(c.name) === norm(group.name));
    if (!cls) {
      cls = { id: crypto.randomUUID(), name: group.name, active: 1, sort_order: index };
      classRows.push(cls);
      created.classes++;
      statements.push(familyDb.prepare(`INSERT INTO family_classes (id, campus_id, name, stage, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, 1, ?, ?)`).bind(cls.id, campusId, group.name, index, now, now));
    }
    for (const entry of group.students) {
      const key = norm(entry.name);
      const same = (seen.get(key) || []).find((s) => !s.parentPhone || !entry.parentPhone || s.parentPhone.replace(/\D/g, "") === entry.parentPhone.replace(/\D/g, ""));
      if (same) { entry.studentId = same.studentId; continue; }
      const taken = new Set((seen.get(key) || []).map((s) => s.studentId));
      let match = matchRosterStudent(students.filter((s) => !taken.has(s.id)), group.name, entry.name);
      if (match.reason === "matched" && taken.size && norm(students.find((s) => s.id === match.studentId)?.class_name) !== norm(group.name)) {
        match = { studentId: null, reason: "missing" };
      }
      if (match.reason === "missing") {
        const id = crypto.randomUUID();
        students.push({ id, name: entry.name, display_name: null, status: "active", current_class_id: cls.id, class_name: group.name });
        created.students++;
        statements.push(
          familyDb.prepare(`INSERT INTO family_students (id, campus_id, name, display_name, birth_year, school_name, grade, status, current_class_id, created_at, updated_at)
            VALUES (?, ?, ?, NULL, NULL, ?, ?, 'active', ?, ?, ?)`).bind(id, campusId, entry.name, entry.school || null, entry.grade || null, cls.id, now, now),
          familyDb.prepare("INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), id, cls.id, now, now),
          familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
            VALUES (?, ?, 'staff', ?, 'student.create', 'family_student', ?, ?, ?)`)
            .bind(crypto.randomUUID(), campusId, actor, id, JSON.stringify({ classId: cls.id, source: "attendance_roster", month }), now),
        );
        match = { studentId: id, reason: "matched" };
      }
      entry.studentId = match.studentId;
      if (match.studentId) (seen.get(key) || seen.set(key, []).get(key)!).push({ parentPhone: entry.parentPhone, studentId: match.studentId });
      else unmatched.push({ name: entry.name, className: group.name, reason: match.reason });
    }
  }

  const studentCount = classes.reduce((n, c) => n + c.students.length, 0);
  statements.push(
    familyDb.prepare(`INSERT INTO family_attendance_rosters (id, campus_id, year_month, source_name, roster_json, student_count, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campus_id, year_month) DO UPDATE SET source_name = excluded.source_name, roster_json = excluded.roster_json,
        student_count = excluded.student_count, created_by = excluded.created_by, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), campusId, month, clean(input.sourceName, 200) || null, JSON.stringify({ classes }), studentCount, actor, now, now),
    familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
      VALUES (?, ?, 'staff', ?, 'attendance_roster.save', 'attendance_roster', ?, ?, ?)`)
      .bind(crypto.randomUUID(), campusId, actor, month, JSON.stringify({ classes: classes.length, students: studentCount, created }), now),
  );
  for (let i = 0; i < statements.length; i += 50) await familyDb.batch(statements.slice(i, i + 50));
  return { month, classes: classes.length, students: studentCount, created, unmatched };
}

/** The roster to use on a date: that month's, else the latest earlier one, else the nearest later one. */
export function pickRosterMonth(months: string[], date: string): string | null {
  const month = date.slice(0, 7);
  if (months.includes(month)) return month;
  const earlier = months.filter((m) => m < month).sort().at(-1);
  return earlier || months.filter((m) => m > month).sort()[0] || null;
}

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * 출석체크's schedule for one day. Managers see the whole roster; other staff only the roster rows
 * that match a student they may already see (visibleIds). Phone numbers ride along for the call buttons.
 */
export async function attendanceScheduleForDay(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  date: string,
  visibleIds: Set<string>,
) {
  await ensureKkumeumAttendanceRosterSchema(familyDb);
  const months = ((await familyDb.prepare("SELECT year_month FROM family_attendance_rosters WHERE campus_id = ?").bind(campusId).all<{ year_month: string }>()).results || [])
    .map((r) => r.year_month);
  const month = pickRosterMonth(months, date);
  if (!month) return null;
  const row = await familyDb.prepare("SELECT year_month, source_name, roster_json, updated_at FROM family_attendance_rosters WHERE campus_id = ? AND year_month = ?")
    .bind(campusId, month).first<{ year_month: string; source_name: string | null; roster_json: string; updated_at: string }>();
  if (!row) return null;
  let classes: RosterClass[] = [];
  try { classes = (JSON.parse(row.roster_json) as { classes?: RosterClass[] }).classes || []; } catch { classes = []; }
  const students = await campusStudents(familyDb, campusId);
  const manager = isManager(context, campusId);
  const weekday = weekdayOf(date);
  let today = 0;
  // 명단 정리에서 휴원·퇴원 처리한 학생 rows leave 출석체크 (they stay in the saved 출석부).
  const left = new Set(students.filter((s) => s.status !== "active").map((s) => s.id));
  const out = classes.map((group) => ({
    name: group.name,
    students: group.students.filter((entry) => !entry.studentId || !left.has(entry.studentId)).map((entry, index) => {
      const match = matchRosterStudent(students, group.name, entry.name, entry.studentId);
      const times = (entry.slots || []).filter((slot) => slot[0] === weekday).map((slot) => slot.slice(1));
      return {
        key: `${group.name}#${index}`,
        name: entry.name,
        studentId: match.studentId,
        unmatched: match.studentId ? null : match.reason,
        today: times.length > 0,
        times,
        slots: entry.slots || [],
        studentPhone: entry.studentPhone || "",
        parentPhone: entry.parentPhone || "",
      };
    }).filter((entry) => manager || (entry.studentId !== null && visibleIds.has(entry.studentId))),
  })).filter((group) => group.students.length);
  for (const group of out) today += group.students.filter((s) => s.today).length;
  return {
    month: row.year_month,
    exact: row.year_month === date.slice(0, 7),
    sourceName: row.source_name || "",
    updatedAt: row.updated_at,
    weekday,
    todayCount: today,
    classes: out,
  };
}

/** The saved roster months for the 출석부 page (manager or any campus staff who can see it). */
export async function attendanceRosterStatus(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 출석부에 접근할 권한이 없습니다.");
  await ensureKkumeumAttendanceRosterSchema(familyDb);
  const rows = (await familyDb.prepare("SELECT year_month, source_name, student_count, updated_at FROM family_attendance_rosters WHERE campus_id = ? ORDER BY year_month DESC LIMIT 24")
    .bind(campusId).all<{ year_month: string; source_name: string | null; student_count: number; updated_at: string }>()).results || [];
  return { rosters: rows.map((r) => ({ month: r.year_month, sourceName: r.source_name || "", students: r.student_count, updatedAt: r.updated_at })), canSave: isManager(context, campusId) };
}

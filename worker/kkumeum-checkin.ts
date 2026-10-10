import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { campusDisplayName } from "./campus-directory";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";
import {
  ATTENDANCE_STATUSES, type AttendanceStatus, type AttendanceStudent,
  ensureKkumeumAttendanceSchema, kstDate, latestAttendanceToday, recordAttendanceEvent,
} from "./kkumeum-attendance";
import { ensureKkumeumAttendanceRosterSchema, pickRosterMonth, weekdayOf, type RosterClass } from "./kkumeum-attendance-roster";
import { ensureKkumeumInviteSchema, issueKkumeumInviteCode } from "./kkumeum-invite-codes";
import type { KkumeumPushEnv } from "./kkumeum-push";

// 출결기 (등하원 번호 태블릿) and the 출결 설정 that make 출석체크 run by itself:
// - 등하원 번호: a 4-digit number per student (unique in the campus) typed on the 출결기.
// - 출결기: a tablet paired once with a 6-digit 연결번호 (no staff login on it); it can only check students in.
// - 타임 시간: when each 1·2·3타임 starts, so a late 등원 is marked 지각 automatically.
// - 담당 선생님 per class (teachers see their classes in 출석체크) and 인증키 for many students at once.

const KIOSK_COOKIE = "kkumeum_kiosk";
const KIOSK_MAX_AGE = 60 * 60 * 24 * 365;
const PAIRING_MINUTES = 10;
const KIOSK_FAILURES = 20, KIOSK_WINDOW_MS = 10 * 60_000;
const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const norm = (value: unknown) => String(value ?? "").normalize("NFC").replace(/\s+/g, "");
const text = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
function randomDigits(length: number): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(length)), (n) => String(n % 10)).join("");
}
function isManager(context: DataCoreAccessContext, campusId: string): boolean {
  return context.isSuperAdmin || context.memberships.some((m) => m.campusId === campusId && ["CAMPUS_DIRECTOR", "CAMPUS_ADMIN"].includes(m.role));
}
function requireManager(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (!campusId) throw new DataCoreAccessError(400, "캠퍼스를 선택해 주세요.");
  if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "출결 설정은 캠퍼스 원장·관리자만 바꿀 수 있습니다.");
}
function requireCampusStaff(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 출결 정보에 접근할 권한이 없습니다.");
}
async function audit(familyDb: D1Database, campusId: string, actorType: string, actorId: string | null, action: string, resourceId: string, meta: Record<string, unknown> = {}) {
  await familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'attendance_checkin', ?, ?, ?)`).bind(crypto.randomUUID(), campusId, actorType, actorId, action, resourceId, JSON.stringify(meta), new Date().toISOString()).run();
}

export async function ensureKkumeumCheckinSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumAttendanceSchema(familyDb);
  await ensureKkumeumAttendanceRosterSchema(familyDb);
  await ensureKkumeumInviteSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_checkin_codes (
      student_id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      code TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_checkin_codes_campus_code ON family_checkin_codes(campus_id, code)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_kiosk_devices (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      pairing_hash TEXT,
      pairing_expires_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      paired_at TEXT,
      last_seen_at TEXT,
      revoked_at TEXT,
      fail_count INTEGER NOT NULL DEFAULT 0,
      fail_window_at TEXT
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_kiosk_devices_campus ON family_kiosk_devices(campus_id, revoked_at)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_attendance_settings (
      campus_id TEXT PRIMARY KEY NOT NULL,
      settings_json TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )`),
  ]);
}

// ---------- 타임 시간 ----------
export type AttendanceSettings = { weekday: Record<string, string>; weekend: Record<string, string>; lateMinutes: number };
const DEFAULT_SETTINGS: AttendanceSettings = { weekday: { 1: "", 2: "", 3: "" }, weekend: { 1: "", 2: "", 3: "" }, lateMinutes: 10 };
function cleanSettings(input: unknown): AttendanceSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const times = (value: unknown) => {
    const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    return Object.fromEntries(["1", "2", "3"].map((k) => { const t = String(src[k] ?? "").trim(); return [k, SLOT_TIME.test(t) ? t : ""]; }));
  };
  const late = Number(raw.lateMinutes);
  return { weekday: times(raw.weekday), weekend: times(raw.weekend), lateMinutes: Number.isInteger(late) && late >= 0 && late <= 120 ? late : 10 };
}
export async function getAttendanceSettings(familyDb: D1Database, campusId: string): Promise<AttendanceSettings> {
  await ensureKkumeumCheckinSchema(familyDb);
  const row = await familyDb.prepare("SELECT settings_json FROM family_attendance_settings WHERE campus_id = ?").bind(campusId).first<{ settings_json: string }>();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try { return cleanSettings(JSON.parse(row.settings_json)); } catch { return structuredClone(DEFAULT_SETTINGS); }
}
export async function readAttendanceSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireCampusStaff(context, campusId);
  return { settings: await getAttendanceSettings(familyDb, campusId), canEdit: isManager(context, campusId) };
}
export async function saveAttendanceSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, input: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  const settings = cleanSettings(input);
  await familyDb.prepare(`INSERT INTO family_attendance_settings (campus_id, settings_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(campus_id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(campusId, JSON.stringify(settings), context.user?.internalUserId || null, new Date().toISOString()).run();
  return { settings };
}
/** Start time of a 타임 on a date ("10:00"), from the campus settings; "" when not set. */
export function slotStart(settings: AttendanceSettings, date: string, slot: string): string {
  const weekend = ["토", "일"].includes(weekdayOf(date));
  return (weekend ? settings.weekend : settings.weekday)[slot] || "";
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const kstMinutes = (iso: string) => { const d = new Date(new Date(iso).getTime() + 9 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** Today's 타임 of a student from the month's 출석부 (matched by id saved at 연동, else by name). */
export async function studentSlotsOn(familyDb: D1Database, campusId: string, student: { id: string; name: string; display_name?: string | null }, date: string): Promise<string[]> {
  const months = ((await familyDb.prepare("SELECT year_month FROM family_attendance_rosters WHERE campus_id = ?").bind(campusId).all<{ year_month: string }>()).results || []).map((r) => r.year_month);
  const month = pickRosterMonth(months, date);
  if (!month) return [];
  const row = await familyDb.prepare("SELECT roster_json FROM family_attendance_rosters WHERE campus_id = ? AND year_month = ?").bind(campusId, month).first<{ roster_json: string }>();
  let classes: RosterClass[] = [];
  try { classes = (JSON.parse(row?.roster_json || "{}") as { classes?: RosterClass[] }).classes || []; } catch { classes = []; }
  const names = new Set([norm(student.name), norm(student.display_name)].filter(Boolean));
  const entries = classes.flatMap((c) => c.students).filter((e) => e.studentId === student.id || (!e.studentId && names.has(norm(e.name))));
  const weekday = weekdayOf(date);
  return [...new Set(entries.flatMap((e) => (e.slots || []).filter((s) => s[0] === weekday).map((s) => s.slice(1))))].sort();
}
/** 등원 after (first 타임 today start + late minutes) becomes 지각; otherwise stays 등원. */
export async function autoLateStatus(familyDb: D1Database, campusId: string, student: AttendanceStudent, at: string): Promise<{ status: AttendanceStatus; slot: string; start: string }> {
  const date = kstDate(new Date(at));
  const slots = await studentSlotsOn(familyDb, campusId, student, date);
  const settings = await getAttendanceSettings(familyDb, campusId);
  const first = slots.map((slot) => ({ slot, start: slotStart(settings, date, slot) })).find((s) => s.start);
  if (!first) return { status: "arrive", slot: slots[0] || "", start: "" };
  return { status: kstMinutes(at) > minutesOf(first.start) + settings.lateMinutes ? "late" : "arrive", slot: first.slot, start: first.start };
}

// ---------- 등하원 번호 ----------
async function freeCode(familyDb: D1Database, campusId: string, taken: Set<string>): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  throw new DataCoreAccessError(409, "남은 4자리 번호가 없습니다. 일부 번호를 5~6자리로 바꿔 주세요.");
}
/** Gives a 4-digit number to every 재원 student of the campus who has none (existing numbers never change). */
export async function fillCheckinCodes(familyDb: D1Database, campusId: string): Promise<number> {
  await ensureKkumeumCheckinSchema(familyDb);
  const taken = new Set(((await familyDb.prepare("SELECT code FROM family_checkin_codes WHERE campus_id = ?").bind(campusId).all<{ code: string }>()).results || []).map((r) => r.code));
  const missing = (await familyDb.prepare(`SELECT s.id FROM family_students s LEFT JOIN family_checkin_codes c ON c.student_id = s.id
    WHERE s.campus_id = ? AND s.status = 'active' AND c.student_id IS NULL`).bind(campusId).all<{ id: string }>()).results || [];
  const now = new Date().toISOString(), statements: D1PreparedStatement[] = [];
  for (const row of missing) statements.push(familyDb.prepare("INSERT INTO family_checkin_codes (student_id, campus_id, code, updated_at) VALUES (?, ?, ?, ?)").bind(row.id, campusId, await freeCode(familyDb, campusId, taken), now));
  for (let i = 0; i < statements.length; i += 50) await familyDb.batch(statements.slice(i, i + 50));
  return statements.length;
}
export async function campusCheckinCodes(familyDb: D1Database, campusId: string): Promise<Map<string, string>> {
  await ensureKkumeumCheckinSchema(familyDb);
  const rows = (await familyDb.prepare("SELECT student_id, code FROM family_checkin_codes WHERE campus_id = ?").bind(campusId).all<{ student_id: string; code: string }>()).results || [];
  return new Map(rows.map((r) => [r.student_id, r.code]));
}
export async function guardianCounts(familyDb: D1Database, studentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < studentIds.length; i += 80) {
    const ids = studentIds.slice(i, i + 80);
    if (!ids.length) continue;
    const rows = (await familyDb.prepare(`SELECT sg.student_id, COUNT(*) AS n FROM student_guardians sg JOIN family_guardians g ON g.id = sg.guardian_id
      WHERE g.status = 'active' AND sg.student_id IN (${ids.map(() => "?").join(",")}) GROUP BY sg.student_id`).bind(...ids).all<{ student_id: string; n: number }>()).results || [];
    for (const r of rows) counts.set(r.student_id, Number(r.n));
  }
  return counts;
}
/** Phones from the 출석부 in use today, by 꿈이음 student id (for 문자 보내기). */
async function rosterPhones(familyDb: D1Database, campusId: string): Promise<Map<string, { parentPhone: string; studentPhone: string }>> {
  const months = ((await familyDb.prepare("SELECT year_month FROM family_attendance_rosters WHERE campus_id = ?").bind(campusId).all<{ year_month: string }>()).results || []).map((r) => r.year_month);
  const month = pickRosterMonth(months, kstDate());
  const out = new Map<string, { parentPhone: string; studentPhone: string }>();
  if (!month) return out;
  const row = await familyDb.prepare("SELECT roster_json FROM family_attendance_rosters WHERE campus_id = ? AND year_month = ?").bind(campusId, month).first<{ roster_json: string }>();
  try {
    for (const c of (JSON.parse(row?.roster_json || "{}") as { classes?: RosterClass[] }).classes || []) for (const e of c.students) {
      if (e.studentId && !out.has(e.studentId)) out.set(e.studentId, { parentPhone: e.parentPhone || "", studentPhone: e.studentPhone || "" });
    }
  } catch { /* An unreadable roster only means no phone numbers. */ }
  return out;
}

/** 출결 설정 학생 표: 반 · 등하원 번호 · 보호자 연결 · 학부모 번호 (원장·관리자). */
export async function listCheckinStudents(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  await fillCheckinCodes(familyDb, campusId);
  const students = (await familyDb.prepare(`SELECT s.id, s.name, s.display_name, s.status, s.current_class_id, c.name AS class_name
    FROM family_students s LEFT JOIN family_classes c ON c.id = s.current_class_id WHERE s.campus_id = ? AND s.status = 'active'
    ORDER BY c.sort_order, c.name, s.name LIMIT 3000`).bind(campusId).all<{ id: string; name: string; display_name: string | null; current_class_id: string | null; class_name: string | null }>()).results || [];
  const codes = await campusCheckinCodes(familyDb, campusId);
  const guardians = await guardianCounts(familyDb, students.map((s) => s.id));
  const phones = await rosterPhones(familyDb, campusId);
  return { students: students.map((s) => ({ id: s.id, name: s.display_name || s.name, classId: s.current_class_id, className: s.class_name || "반 미지정",
    code: codes.get(s.id) || "", guardians: guardians.get(s.id) || 0, parentPhone: phones.get(s.id)?.parentPhone || "", studentPhone: phones.get(s.id)?.studentPhone || "" })) };
}
export async function setCheckinCode(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, studentId: string, code: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  const value = String(code ?? "").trim();
  if (!/^\d{4,6}$/.test(value)) throw new DataCoreAccessError(400, "등하원 번호는 숫자 4~6자리로 정해 주세요.");
  if (!await familyDb.prepare("SELECT 1 FROM family_students WHERE id = ? AND campus_id = ?").bind(studentId, campusId).first()) throw new DataCoreAccessError(403, "이 캠퍼스 학생이 아닙니다.");
  const other = await familyDb.prepare("SELECT student_id FROM family_checkin_codes WHERE campus_id = ? AND code = ? AND student_id != ?").bind(campusId, value, studentId).first();
  if (other) throw new DataCoreAccessError(409, `${value}번은 다른 학생이 쓰고 있습니다.`);
  await familyDb.prepare(`INSERT INTO family_checkin_codes (student_id, campus_id, code, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(student_id) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at`).bind(studentId, campusId, value, new Date().toISOString()).run();
  await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "checkin_code_set", studentId, { code: value });
  return { studentId, code: value };
}

/** 미연결 보호자: 인증키를 한꺼번에 발급 (each code shown once in this response). */
export async function issueInvitesForUnlinked(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, studentIds?: unknown) {
  requireManager(context, campusId);
  const list = await listCheckinStudents(familyDb, context, campusId);
  const wanted = Array.isArray(studentIds) && studentIds.length ? new Set(studentIds.map(String)) : null;
  const targets = list.students.filter((s) => (wanted ? wanted.has(s.id) : s.guardians === 0)).slice(0, 300);
  const issued = [];
  for (const s of targets) {
    const r = await issueKkumeumInviteCode(familyDb, context, campusId, s.id);
    issued.push({ studentId: s.id, name: s.name, className: s.className, code: r.code, parentPhone: s.parentPhone });
  }
  return { issued };
}

// ---------- 담당 선생님 ----------
// Read-only DATA CORE staff directory, used only to show 담당 선생님 names.
// 꿈이음 records are never written there; they stay in FAMILY_DB.
export const staffDirectoryDb = (env: { DB?: D1Database }) => env.DB;

export async function listClassTeachers(familyDb: D1Database, db: D1Database | undefined, context: DataCoreAccessContext, campusId: string) {
  requireManager(context, campusId);
  await ensureKkumeumPhase1Schema(familyDb);
  const classes = (await familyDb.prepare("SELECT id, name FROM family_classes WHERE campus_id = ? AND active = 1 ORDER BY sort_order, name").bind(campusId).all<{ id: string; name: string }>()).results || [];
  const assigned = (await familyDb.prepare(`SELECT a.class_id, a.staff_user_id FROM class_staff_assignments a JOIN family_classes c ON c.id = a.class_id
    WHERE c.campus_id = ? AND a.ended_at IS NULL`).bind(campusId).all<{ class_id: string; staff_user_id: string }>()).results || [];
  const staff = db ? ((await db.prepare(`SELECT DISTINCT u.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.campus_id = ? AND m.role IN ('TEACHER','CAMPUS_DIRECTOR','CAMPUS_ADMIN') AND COALESCE(u.status,'active') = 'active' ORDER BY u.display_name`).bind(campusId)
    .all<{ id: string; display_name: string; role: string }>()).results || []) : [];
  return { staff: staff.map((s) => ({ id: s.id, name: s.display_name, role: s.role })),
    classes: classes.map((c) => ({ id: c.id, name: c.name, teacherIds: assigned.filter((a) => a.class_id === c.id).map((a) => a.staff_user_id) })) };
}
export async function setClassTeachers(familyDb: D1Database, db: D1Database | undefined, context: DataCoreAccessContext, campusId: string, classId: string, teacherIds: unknown) {
  requireManager(context, campusId);
  const current = await listClassTeachers(familyDb, db, context, campusId);
  const cls = current.classes.find((c) => c.id === classId);
  if (!cls) throw new DataCoreAccessError(404, "반을 찾을 수 없습니다.");
  const allowed = new Set(current.staff.map((s) => s.id));
  const next = [...new Set((Array.isArray(teacherIds) ? teacherIds : []).map(String))].filter((id) => allowed.has(id)).slice(0, 10);
  const now = new Date().toISOString(), statements: D1PreparedStatement[] = [];
  for (const id of cls.teacherIds.filter((id) => !next.includes(id))) statements.push(familyDb.prepare("UPDATE class_staff_assignments SET ended_at = ?, updated_at = ? WHERE class_id = ? AND staff_user_id = ? AND ended_at IS NULL").bind(now, now, classId, id));
  for (const id of next.filter((id) => !cls.teacherIds.includes(id))) statements.push(familyDb.prepare(`INSERT INTO class_staff_assignments (id, class_id, staff_user_id, role, can_edit_reports, can_manage_artworks, started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, ?, 'TEACHER', 1, 1, ?, NULL, ?, ?)`).bind(crypto.randomUUID(), classId, id, now, now, now));
  if (statements.length) await familyDb.batch(statements);
  await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "class_teachers_set", classId, { teachers: next.length });
  return { classId, teacherIds: next };
}
/** 출석체크 반 제목에 보일 담당 선생님 이름 (반 이름 기준). */
export async function teacherNamesByClass(familyDb: D1Database, db: D1Database | undefined, campusId: string): Promise<Record<string, string[]>> {
  if (!db) return {};
  const rows = (await familyDb.prepare(`SELECT c.name AS class_name, a.staff_user_id FROM class_staff_assignments a JOIN family_classes c ON c.id = a.class_id
    WHERE c.campus_id = ? AND c.active = 1 AND a.ended_at IS NULL`).bind(campusId).all<{ class_name: string; staff_user_id: string }>()).results || [];
  if (!rows.length) return {};
  const ids = [...new Set(rows.map((r) => r.staff_user_id))];
  const names = new Map(((await db.prepare(`SELECT id, display_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; display_name: string }>()).results || []).map((u) => [u.id, u.display_name]));
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[norm(r.class_name)] ||= []).push(names.get(r.staff_user_id) || "선생님");
  return out;
}

// ---------- 출결기 (staff side) ----------
export async function listKiosks(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  const today = kstDate();
  const rows = (await familyDb.prepare(`SELECT id, label, paired_at, last_seen_at, pairing_expires_at, token_hash IS NOT NULL AS paired FROM family_kiosk_devices
    WHERE campus_id = ? AND revoked_at IS NULL ORDER BY created_at`).bind(campusId).all<{ id: string; label: string; paired_at: string | null; last_seen_at: string | null; pairing_expires_at: string | null; paired: number }>()).results || [];
  const counts = new Map(((await familyDb.prepare(`SELECT created_by, COUNT(*) AS n FROM family_attendance_events WHERE campus_id = ? AND event_date = ? AND canceled_at IS NULL AND created_by LIKE 'kiosk:%' GROUP BY created_by`)
    .bind(campusId, today).all<{ created_by: string; n: number }>()).results || []).map((r) => [r.created_by.slice(6), Number(r.n)]));
  return { kiosks: rows.filter((r) => r.paired || (r.pairing_expires_at && Date.parse(r.pairing_expires_at) > Date.now())).map((r) => ({
    id: r.id, label: r.label, paired: Boolean(r.paired), pairedAt: r.paired_at, lastSeenAt: r.last_seen_at, pairingExpiresAt: r.paired ? null : r.pairing_expires_at, todayCount: counts.get(r.id) || 0 })) };
}
/** A new 출결기: the 6-digit 연결번호 is valid for 10 minutes and shown only here. */
export async function createKioskPairing(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, label: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  const name = text(label, 40) || "출결기";
  const code = randomDigits(6), now = new Date(), expires = new Date(now.getTime() + PAIRING_MINUTES * 60_000).toISOString();
  const id = crypto.randomUUID();
  await familyDb.prepare(`INSERT INTO family_kiosk_devices (id, campus_id, label, pairing_hash, pairing_expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, campusId, name, await sha256(`pair:${code}`), expires, context.user?.internalUserId || null, now.toISOString()).run();
  await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "kiosk_pairing_create", id, { label: name });
  return { id, label: name, pairingCode: `${code.slice(0, 3)} ${code.slice(3)}`, expiresAt: expires };
}
export async function revokeKiosk(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, id: string) {
  requireManager(context, campusId);
  await ensureKkumeumCheckinSchema(familyDb);
  const done = await familyDb.prepare("UPDATE family_kiosk_devices SET revoked_at = ?, token_hash = NULL WHERE id = ? AND campus_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id, campusId).run();
  if (!done.meta?.changes) throw new DataCoreAccessError(404, "출결기를 찾을 수 없습니다.");
  await audit(familyDb, campusId, "staff", context.user?.internalUserId || null, "kiosk_revoke", id);
  return { ok: true };
}

// ---------- 출결기 (tablet side, no staff login) ----------
type Device = { id: string; campus_id: string; label: string; fail_count: number; fail_window_at: string | null };
function cookieToken(request: Request): string {
  const entry = (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(`${KIOSK_COOKIE}=`));
  return entry ? entry.slice(KIOSK_COOKIE.length + 1) : "";
}
function sameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
}
async function deviceOf(familyDb: D1Database, request: Request): Promise<Device | null> {
  const token = cookieToken(request);
  if (!token) return null;
  await ensureKkumeumCheckinSchema(familyDb);
  return familyDb.prepare("SELECT id, campus_id, label, fail_count, fail_window_at FROM family_kiosk_devices WHERE token_hash = ? AND revoked_at IS NULL").bind(await sha256(`kiosk:${token}`)).first<Device>();
}
const kioskInfo = (d: Device) => ({ paired: true, label: d.label, campusId: d.campus_id, campusName: campusDisplayName(d.campus_id, d.campus_id) });

export async function kioskSession(familyDb: D1Database, request: Request) {
  const device = await deviceOf(familyDb, request);
  return device ? kioskInfo(device) : { paired: false };
}
export async function pairKiosk(familyDb: D1Database, request: Request, input: Record<string, unknown>) {
  sameOrigin(request);
  await ensureKkumeumCheckinSchema(familyDb);
  const key = await sha256(`kiosk-pair:${request.headers.get("cf-connecting-ip") || "local"}`);
  const attempt = await familyDb.prepare("SELECT window_started_at, failures FROM family_invite_attempts WHERE key_hash = ?").bind(key).first<{ window_started_at: string; failures: number }>();
  if (attempt && Date.now() - Date.parse(attempt.window_started_at) < 15 * 60_000 && attempt.failures >= 10) throw new DataCoreAccessError(429, "연결번호를 여러 번 틀렸습니다. 15분 뒤에 다시 시도해 주세요.");
  const code = String(input.code ?? "").replace(/\D/g, "");
  const now = new Date().toISOString();
  const device = code.length === 6 ? await familyDb.prepare(`SELECT id, campus_id, label, fail_count, fail_window_at FROM family_kiosk_devices
    WHERE pairing_hash = ? AND pairing_expires_at > ? AND token_hash IS NULL AND revoked_at IS NULL`).bind(await sha256(`pair:${code}`), now).first<Device>() : null;
  if (!device) {
    if (!attempt || Date.now() - Date.parse(attempt.window_started_at) >= 15 * 60_000) await familyDb.prepare("INSERT INTO family_invite_attempts (key_hash, window_started_at, failures) VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET window_started_at = excluded.window_started_at, failures = 1").bind(key, now).run();
    else await familyDb.prepare("UPDATE family_invite_attempts SET failures = failures + 1 WHERE key_hash = ?").bind(key).run();
    throw new DataCoreAccessError(401, "연결번호를 다시 확인해 주세요. 출결 설정 화면의 6자리 번호이고 10분 동안만 쓸 수 있습니다.");
  }
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]!));
  await familyDb.prepare("UPDATE family_kiosk_devices SET token_hash = ?, pairing_hash = NULL, pairing_expires_at = NULL, paired_at = ?, last_seen_at = ? WHERE id = ?")
    .bind(await sha256(`kiosk:${token}`), now, now, device.id).run();
  await audit(familyDb, device.campus_id, "kiosk", device.id, "kiosk_paired", device.id);
  return { ...kioskInfo(device), setCookie: `${KIOSK_COOKIE}=${token}; Max-Age=${KIOSK_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Strict` };
}
export async function unpairKiosk(familyDb: D1Database, request: Request) {
  sameOrigin(request);
  const device = await deviceOf(familyDb, request);
  if (device) {
    await familyDb.prepare("UPDATE family_kiosk_devices SET revoked_at = ?, token_hash = NULL WHERE id = ?").bind(new Date().toISOString(), device.id).run();
    await audit(familyDb, device.campus_id, "kiosk", device.id, "kiosk_unpaired", device.id);
  }
  return { ok: true, setCookie: `${KIOSK_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict` };
}

/**
 * 출결기 등원/하원. A double press (same 등원 or 하원 again) is answered without a new record or alert.
 * A queued press from a tablet that was offline keeps its own time (up to 12 hours back).
 */
export async function kioskCheckin(familyDb: D1Database, env: KkumeumPushEnv, request: Request, input: Record<string, unknown>) {
  sameOrigin(request);
  const device = await deviceOf(familyDb, request);
  if (!device) throw new DataCoreAccessError(401, "이 태블릿은 출결기로 연결되어 있지 않습니다.");
  const nowMs = Date.now();
  const windowOpen = device.fail_window_at && nowMs - Date.parse(device.fail_window_at) < KIOSK_WINDOW_MS;
  if (windowOpen && device.fail_count >= KIOSK_FAILURES) throw new DataCoreAccessError(429, "잘못된 번호가 너무 많이 입력되었습니다. 잠시 뒤에 다시 눌러 주세요.");
  const action = input.action === "leave" ? "leave" : input.action === "arrive" ? "arrive" : "";
  if (!action) throw new DataCoreAccessError(400, "등원 또는 하원을 눌러 주세요.");
  const code = String(input.code ?? "").replace(/\D/g, "").slice(0, 6);
  const atRaw = Date.parse(String(input.at ?? ""));
  const at = Number.isFinite(atRaw) && atRaw <= nowMs + 60_000 && atRaw >= nowMs - 12 * 3600_000 ? new Date(Math.min(atRaw, nowMs)).toISOString() : new Date(nowMs).toISOString();
  const student = code.length >= 4 ? await familyDb.prepare(`SELECT s.id, s.name, s.display_name, s.current_class_id FROM family_checkin_codes k JOIN family_students s ON s.id = k.student_id
    WHERE k.campus_id = ? AND k.code = ? AND s.campus_id = ? AND s.status = 'active'`).bind(device.campus_id, code, device.campus_id).first<AttendanceStudent>() : null;
  const seen = new Date(nowMs).toISOString();
  if (!student) {
    await familyDb.prepare("UPDATE family_kiosk_devices SET fail_count = ?, fail_window_at = ?, last_seen_at = ? WHERE id = ?")
      .bind(windowOpen ? device.fail_count + 1 : 1, windowOpen ? device.fail_window_at : seen, seen, device.id).run();
    throw new DataCoreAccessError(404, "번호를 다시 확인해 주세요.");
  }
  await familyDb.prepare("UPDATE family_kiosk_devices SET last_seen_at = ? WHERE id = ?").bind(seen, device.id).run();
  const name = student.display_name || student.name;
  const latest = await latestAttendanceToday(familyDb, student.id);
  const arrivedStatuses = ["arrive", "late", "makeup"];
  if (latest && ((action === "arrive" && arrivedStatuses.includes(latest.status)) || (action === "leave" && latest.status === "leave"))) {
    return { duplicate: true, name, status: latest.status, label: ATTENDANCE_STATUSES[latest.status], time: new Date(new Date(latest.occurred_at).getTime() + 9 * 3600_000).toISOString().slice(11, 16) };
  }
  const late = action === "arrive" ? await autoLateStatus(familyDb, device.campus_id, student, at) : { status: "leave" as AttendanceStatus, slot: "", start: "" };
  const result = await recordAttendanceEvent(familyDb, env, { campusId: device.campus_id, student, status: late.status, now: at, actorType: "kiosk", actorId: device.id });
  return { duplicate: false, name, status: late.status, label: ATTENDANCE_STATUSES[late.status], time: result.time, slot: late.slot, slotStart: late.start,
    notified: result.push.sent > 0, guardians: result.guardians };
}

/** 출석체크 day view extras: 등하원 번호, 보호자 연결 수, 반 담당 선생님, 타임 시작 시각, 출결 설정 권한. */
export async function augmentAttendanceDay<T extends { date: string; students: { id: unknown }[]; schedule: { classes: { name: string; students: { studentId: string | null }[] }[] } | null }>(
  familyDb: D1Database, db: D1Database | undefined, context: DataCoreAccessContext, campusId: string, day: T,
) {
  await ensureKkumeumCheckinSchema(familyDb);
  await fillCheckinCodes(familyDb, campusId);
  const ids = new Set(day.students.map((s) => String(s.id)));
  for (const c of day.schedule?.classes || []) for (const e of c.students) if (e.studentId) ids.add(e.studentId);
  const codes = await campusCheckinCodes(familyDb, campusId);
  const guardians = await guardianCounts(familyDb, [...ids]);
  const settings = await getAttendanceSettings(familyDb, campusId);
  const contacts: Record<string, { code: string; guardians: number }> = {};
  for (const id of ids) contacts[id] = { code: codes.get(id) || "", guardians: guardians.get(id) || 0 };
  const slotStarts = Object.fromEntries(["1", "2", "3"].map((k) => [k, slotStart(settings, day.date, k)]));
  return { ...day, contacts, teachers: await teacherNamesByClass(familyDb, db, campusId), slotStarts, lateMinutes: settings.lateMinutes, canManage: isManager(context, campusId) };
}

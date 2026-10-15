import { DataCoreAccessContext, DataCoreAccessError } from "./data-core-access";
import { campusStudents, matchRosterStudent, norm, pickRosterMonth, type StudentRow } from "./kkumeum-attendance-roster";
import { kstDate } from "./kkumeum-attendance";
import { fillCheckinCodes } from "./kkumeum-checkin";
import { classIdFor, loadRoster, requireManager, saveRoster } from "./kkumeum-roster-tools";
import { updateKkumeumStudent } from "./kkumeum-staff";

// 출석부 → 꿈이음 반영 (원장·관리자).
// 출석부를 만들면 그 달 명단과 꿈이음 반·학생을 비교해 다른 곳을 학생마다 보여 준다:
//   새 학생 등록 · 반 이동 · 재원으로 되돌리기 · 출석부에 없는 재원생 휴원 · 출석부에 없는 반 숨기기,
//   그리고 동명이인처럼 사람이 골라야 하는 줄(명단 정리로 안내).
// 체크한 것만 적용하고, "적용 안 함"을 고른 줄은 그 달에는 다시 묻지 않는다 (되돌릴 수 있다).

type ItemType = "new" | "move" | "reactivate" | "leave" | "hide";
export type SyncItem = {
  key: string; type: ItemType; name: string; studentId: string | null; classId?: string | null;
  fromClass: string; toClass: string; status?: string | null; rosterKey?: string; rosterKeys?: string[]; phone?: string; activeCount?: number;
  checked: boolean; skipped: boolean;
};
const ORDER: ItemType[] = ["new", "reactivate", "move", "leave", "hide"];
const DEFAULT_CHECKED: Record<ItemType, boolean> = { new: true, reactivate: true, move: true, leave: false, hide: true };

async function ensureSyncSchema(familyDb: D1Database) {
  await familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_roster_sync_skips (
    campus_id TEXT NOT NULL,
    year_month TEXT NOT NULL,
    item_key TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (campus_id, year_month, item_key)
  )`).run();
}
function validMonth(value: unknown): string {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DataCoreAccessError(400, "출석부 월을 확인해 주세요.");
  return month;
}

async function buildPlan(familyDb: D1Database, campusId: string, month: string) {
  const { classes, updatedAt } = await loadRoster(familyDb, campusId, month);
  const students = await campusStudents(familyDb, campusId);
  const byId = new Map(students.map((s) => [s.id, s]));
  const items: SyncItem[] = [];
  const ambiguous: { name: string; className: string; candidates: { id: string; name: string; className: string; status: string }[] }[] = [];
  const linked = new Set<string>();
  const rosterClassesOf = new Map<string, string[]>();
  const link = (s: StudentRow, className: string) => { linked.add(s.id); rosterClassesOf.set(s.id, [...(rosterClassesOf.get(s.id) || []), className]); };
  const brief = (s: StudentRow) => ({ id: s.id, name: s.display_name || s.name, className: s.class_name || "", status: s.status });

  classes.forEach((group, gi) => group.students.forEach((entry, si) => {
    const rosterKey = `${gi}:${si}`;
    const own = entry.studentId ? byId.get(entry.studentId) : undefined;
    let student = own;
    let reason = own ? (own.status === "active" ? "matched" : "inactive") : "";
    if (!own) {
      const match = matchRosterStudent(students, group.name, entry.name);
      reason = match.reason;
      student = match.studentId ? byId.get(match.studentId) : undefined;
      if (match.reason === "inactive") {
        const inactive = students.filter((s) => s.status !== "active" && (norm(s.name) === norm(entry.name) || norm(s.display_name) === norm(entry.name)));
        if (inactive.length === 1) student = inactive[0]; else reason = "ambiguous";
      }
    }
    if (student && reason === "matched") { link(student, group.name); return; }
    if (student && reason === "inactive") {
      linked.add(student.id);
      items.push({ key: `reactivate:${student.id}`, type: "reactivate", name: entry.name, studentId: student.id, fromClass: student.class_name || "", toClass: group.name,
        status: student.status, rosterKey, checked: DEFAULT_CHECKED.reactivate, skipped: false });
      return;
    }
    if (reason === "missing") {
      // 같은 아이가 출석부 두 반에 있으면 (보호자 번호가 같거나 비어 있으면) 한 명으로 등록한다.
      const phone = String(entry.parentPhone || "").replace(/\D/g, "");
      const same = items.find((i) => i.type === "new" && norm(i.name) === norm(entry.name) && (!phone || !i.phone || i.phone === phone));
      if (same) { same.rosterKeys!.push(rosterKey); return; }
      items.push({ key: `new:${rosterKey}:${norm(entry.name)}`, type: "new", name: entry.name, studentId: null, fromClass: "", toClass: group.name, rosterKey,
        rosterKeys: [rosterKey], phone, checked: DEFAULT_CHECKED.new, skipped: false });
      return;
    }
    ambiguous.push({ name: entry.name, className: group.name,
      candidates: students.filter((s) => norm(s.name) === norm(entry.name) || norm(s.display_name) === norm(entry.name)).map(brief) });
  }));

  // 반 이동: 출석부의 반이 꿈이음 반과 다르면 (출석부 여러 반에 있으면 그중 하나에 있으면 그대로).
  for (const [id, names] of rosterClassesOf) {
    const s = byId.get(id)!;
    if (names.some((n) => norm(n) === norm(s.class_name))) continue;
    items.push({ key: `move:${id}:${norm(names[0])}`, type: "move", name: s.display_name || s.name, studentId: id, fromClass: s.class_name || "반 없음", toClass: names[0],
      checked: DEFAULT_CHECKED.move, skipped: false });
  }
  // 출석부에 없는 재원생 → 휴원 (기본은 체크하지 않음).
  for (const s of students) {
    if (s.status !== "active" || linked.has(s.id)) continue;
    items.push({ key: `leave:${s.id}`, type: "leave", name: s.display_name || s.name, studentId: s.id, fromClass: s.class_name || "반 없음", toClass: "",
      checked: DEFAULT_CHECKED.leave, skipped: false });
  }
  // 출석부에 없는 반 → 목록에서 숨기기 (학생이 남아 있으면 적용할 때 건너뜀).
  const rosterNames = new Set(classes.map((c) => norm(c.name)));
  const classRows = (await familyDb.prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM family_students s WHERE s.current_class_id = c.id AND s.status = 'active') AS n
    FROM family_classes c WHERE c.campus_id = ? AND c.active = 1 ORDER BY c.sort_order, c.name`).bind(campusId).all<{ id: string; name: string; n: number }>()).results || [];
  for (const c of classRows) {
    if (rosterNames.has(norm(c.name))) continue;
    items.push({ key: `hide:${c.id}`, type: "hide", name: c.name, studentId: null, classId: c.id, fromClass: c.name, toClass: "", activeCount: c.n,
      checked: DEFAULT_CHECKED.hide, skipped: false });
  }

  const skipped = new Set(((await familyDb.prepare("SELECT item_key FROM family_roster_sync_skips WHERE campus_id = ? AND year_month = ?").bind(campusId, month)
    .all<{ item_key: string }>()).results || []).map((r) => r.item_key));
  for (const item of items) item.skipped = skipped.has(item.key);
  items.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.toClass.localeCompare(b.toClass, "ko") || a.name.localeCompare(b.name, "ko"));
  return { classes, updatedAt, items, ambiguous };
}

/** 출석부와 꿈이음 명단의 차이. summary=1이면 개수만 (꿈이음 첫 화면 알림 줄). */
export async function rosterSyncPlan(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, monthValue: unknown, summaryOnly = false) {
  requireManager(context, campusId);
  await ensureSyncSchema(familyDb);
  const months = ((await familyDb.prepare("SELECT year_month FROM family_attendance_rosters WHERE campus_id = ? ORDER BY year_month DESC LIMIT 24").bind(campusId)
    .all<{ year_month: string }>().catch(() => ({ results: [] as { year_month: string }[] }))).results || []).map((r) => r.year_month);
  const month = monthValue ? validMonth(monthValue) : pickRosterMonth(months, kstDate());
  if (!month || !months.includes(month)) return { month: month || null, months, updatedAt: null, items: [], ambiguous: [], pending: 0 };
  const plan = await buildPlan(familyDb, campusId, month);
  const pending = plan.items.filter((i) => !i.skipped).length + plan.ambiguous.length;
  if (summaryOnly) return { month, months, pending, updatedAt: plan.updatedAt };
  // 보호자 번호와 출석부 줄 위치는 화면에 보내지 않는다.
  const items = plan.items.map((item) => {
    const out: Record<string, unknown> = { ...item, rows: item.rosterKeys?.length || 1 };
    delete out.phone; delete out.rosterKey; delete out.rosterKeys;
    return out;
  });
  return { month, months, updatedAt: plan.updatedAt, items, ambiguous: plan.ambiguous, pending };
}

/** 체크한 줄 적용 · 적용 안 함 · 다시 보기. */
export async function applyRosterSync(familyDb: D1Database, context: DataCoreAccessContext, input: Record<string, unknown>) {
  const campusId = String(input.campusId ?? "").trim().slice(0, 120);
  if (!campusId) throw new DataCoreAccessError(400, "캠퍼스를 선택해 주세요.");
  requireManager(context, campusId);
  await ensureSyncSchema(familyDb);
  const month = validMonth(input.month);
  const keys = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map((k) => String(k).slice(0, 300)))];
  const apply = keys(input.apply), skip = keys(input.skip), unskip = keys(input.unskip);
  if (!apply.length && !skip.length && !unskip.length) throw new DataCoreAccessError(400, "적용할 줄을 골라 주세요.");
  const plan = await buildPlan(familyDb, campusId, month);
  if (String(input.updatedAt ?? "") !== plan.updatedAt) throw new DataCoreAccessError(409, "출석부가 다시 만들어졌습니다. 새로고침한 뒤 다시 골라 주세요.");
  const byKey = new Map(plan.items.map((i) => [i.key, i]));
  for (const k of [...apply, ...skip]) if (!byKey.has(k)) throw new DataCoreAccessError(409, "명단이 바뀌었습니다. 새로고침한 뒤 다시 골라 주세요.");

  const now = new Date().toISOString();
  const actor = context.user?.internalUserId || null;
  const done: Record<ItemType, number> = { new: 0, reactivate: 0, move: 0, leave: 0, hide: 0 };
  const notHidden: string[] = [];
  let rosterChanged = false;
  const entryAt = (rosterKey: string) => { const [gi, si] = rosterKey.split(":").map(Number); return plan.classes[gi]?.students?.[si]; };
  const chosen = apply.map((k) => byKey.get(k)!).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

  // 적용할 때 출석부의 반은 모두 꿈이음에 있게 한다 (반소식 대상이 되도록).
  if (chosen.length) for (const group of plan.classes) await classIdFor(familyDb, campusId, group.name, now);
  for (const item of chosen) {
    if (item.type === "new") {
      const classId = await classIdFor(familyDb, campusId, item.toClass, now);
      const entry = entryAt(item.rosterKey!);
      const id = crypto.randomUUID();
      await familyDb.batch([
        familyDb.prepare(`INSERT INTO family_students (id, campus_id, name, display_name, birth_year, school_name, grade, status, current_class_id, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, ?, ?, 'active', ?, ?, ?)`).bind(id, campusId, item.name, entry?.school || null, entry?.grade || null, classId, now, now),
        familyDb.prepare("INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, classId, now, now),
        familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
          VALUES (?, ?, 'staff', ?, 'student.create', 'family_student', ?, ?, ?)`).bind(crypto.randomUUID(), campusId, actor, id, JSON.stringify({ classId, source: "roster_sync", month }), now),
      ]);
      for (const key of item.rosterKeys || [item.rosterKey!]) { const e = entryAt(key); if (e) { e.studentId = id; rosterChanged = true; } }
    } else if (item.type === "reactivate") {
      const classId = await classIdFor(familyDb, campusId, item.toClass, now);
      await updateKkumeumStudent(familyDb, context, item.studentId!, { status: "active", classId });
      const entry = entryAt(item.rosterKey!);
      if (entry) { entry.studentId = item.studentId; rosterChanged = true; }
    } else if (item.type === "move") {
      await updateKkumeumStudent(familyDb, context, item.studentId!, { classId: await classIdFor(familyDb, campusId, item.toClass, now) });
    } else if (item.type === "leave") {
      await updateKkumeumStudent(familyDb, context, item.studentId!, { status: "leave" });
    } else if (item.type === "hide") {
      const left = await familyDb.prepare("SELECT COUNT(*) AS n FROM family_students WHERE current_class_id = ? AND status = 'active'").bind(item.classId).first<{ n: number }>();
      if ((left?.n || 0) > 0) { notHidden.push(item.name); continue; }
      await familyDb.prepare("UPDATE family_classes SET active = 0, updated_at = ? WHERE id = ? AND campus_id = ?").bind(now, item.classId, campusId).run();
    }
    done[item.type]++;
  }
  if (rosterChanged) await saveRoster(familyDb, context, campusId, month, plan.classes, plan.updatedAt!, { action: "roster_sync", applied: done });
  const statements = [
    ...skip.map((k) => familyDb.prepare(`INSERT INTO family_roster_sync_skips (campus_id, year_month, item_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campus_id, year_month, item_key) DO NOTHING`).bind(campusId, month, k, actor, now)),
    ...unskip.map((k) => familyDb.prepare("DELETE FROM family_roster_sync_skips WHERE campus_id = ? AND year_month = ? AND item_key = ?").bind(campusId, month, k)),
  ];
  if (chosen.length || skip.length) statements.push(familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, 'staff', ?, 'attendance_roster.sync', 'attendance_roster', ?, ?, ?)`).bind(crypto.randomUUID(), campusId, actor, month, JSON.stringify({ applied: done, skipped: skip.length, notHidden }), now));
  if (statements.length) await familyDb.batch(statements);
  if (done.new || done.reactivate) await fillCheckinCodes(familyDb, campusId);
  return { ...(await rosterSyncPlan(familyDb, context, campusId, month)), result: { applied: done, skipped: skip.length, notHidden } };
}

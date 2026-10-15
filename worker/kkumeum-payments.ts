import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { kkumeumGuardianSessionIdentity } from "./kkumeum-guardian-auth";
import { dispatchGuardianDirectPush, type KkumeumPushEnv } from "./kkumeum-push";

// 꿈이음 4단계: 수납관리.
// - 원장·관리자가 달마다 청구를 만든다 (항목, 학생별 금액, 납부일). 학원에서 받은 돈은 "수납 처리"로 기록한다
//   (날짜 · 금액 · 방법). 앱에서 직접 결제하지 않는다.
// - 미납 보호자에게 알림을 보낸다. 자동 알림을 켜면 매일 오전 10시에 납부일 하루 전과 납부일 3일 뒤 미납에 한 번씩 보낸다.
// - 날짜별 수납 합계(일일 결산)를 보고 CSV로 받는다. 나중에 결산 프로그램이 같은 API를 읽는다.
// - 보호자는 자녀의 청구와 납부 상태, 학원이 적은 납부 방법 안내를 본다.
// 금액과 수납 기록은 원장·관리자만 보고 고친다. 모든 변경은 family_audit_logs에 남는다.

const METHODS = new Set(["card", "transfer", "cash", "other"]);
const MAX_ITEMS = 300;
const MAX_AMOUNT = 100_000_000;

type BillRow = {
  id: string; campus_id: string; student_id: string; month: string; title: string; amount: number; due_date: string;
  status: string; paid_at: string | null; paid_amount: number | null; method: string | null; memo: string;
  reminded_on: string | null; remind_count: number; created_by: string | null; created_at: string; updated_at: string;
};
export type PaymentSettings = { autoRemind: boolean; guide: string };
const DEFAULT_SETTINGS: PaymentSettings = { autoRemind: false, guide: "" };

export async function ensureKkumeumPaymentsSchema(familyDb: D1Database): Promise<void> {
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_bills (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      month TEXT NOT NULL,
      title TEXT NOT NULL,
      amount INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at TEXT,
      paid_amount INTEGER,
      method TEXT,
      memo TEXT NOT NULL DEFAULT '',
      reminded_on TEXT,
      remind_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campus_id, student_id, month, title)
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_bills_month_idx ON family_bills(campus_id, month, status)"),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_bills_paid_idx ON family_bills(campus_id, paid_at)"),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_bills_student_idx ON family_bills(student_id, month)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_payment_settings (
      campus_id TEXT PRIMARY KEY NOT NULL,
      settings_json TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )`),
  ]);
}

// ---- helpers ----
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
export const kstToday = (date = new Date()) => new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
function parseDay(value: unknown, label: string): string {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new DataCoreAccessError(400, `${label} 날짜를 확인해 주세요.`);
  return text;
}
function parseMonth(value: unknown): string {
  const text = clean(value, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new DataCoreAccessError(400, "청구 월을 확인해 주세요.");
  return text;
}
function parseAmount(value: unknown, label = "금액"): number {
  const n = Number(String(value ?? "").replace(/[,\s원]/g, ""));
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new DataCoreAccessError(400, `${label}은 0원 이상 1억 원 이하의 숫자로 입력해 주세요.`);
  return n;
}
function isManager(context: DataCoreAccessContext, campusId: string): boolean {
  return context.isSuperAdmin || context.memberships.some((m) => m.campusId === campusId && (m.role === "CAMPUS_DIRECTOR" || m.role === "CAMPUS_ADMIN"));
}
function requireManager(context: DataCoreAccessContext, campusId: string) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 수납 정보에 접근할 권한이 없습니다.");
  if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "수납관리는 원장·관리자만 할 수 있습니다.");
}
async function audit(familyDb: D1Database, context: DataCoreAccessContext, action: string, campusId: string, resourceId: string, metadata: Record<string, unknown>) {
  await familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
    VALUES (?, ?, 'staff', ?, ?, 'bill', ?, ?, ?)`)
    .bind(crypto.randomUUID(), campusId, context.user?.internalUserId || "unknown", action, resourceId, JSON.stringify(metadata), new Date().toISOString()).run();
}

function settingsFrom(raw: unknown): PaymentSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { autoRemind: input.autoRemind === true, guide: clean(input.guide, 600) };
}
export async function paymentSettings(familyDb: D1Database, campusId: string): Promise<PaymentSettings> {
  const row = await familyDb.prepare("SELECT settings_json FROM family_payment_settings WHERE campus_id = ?").bind(campusId).first<{ settings_json: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try { return settingsFrom(JSON.parse(row.settings_json)); } catch { return { ...DEFAULT_SETTINGS }; }
}

const billResponse = (row: BillRow & { student_name?: string; class_name?: string | null }) => ({
  id: row.id, studentId: row.student_id, studentName: row.student_name || "", className: row.class_name || "반 미지정",
  month: row.month, title: row.title, amount: row.amount, dueDate: row.due_date, status: row.status,
  paidAt: row.paid_at, paidAmount: row.paid_amount, method: row.method, memo: row.memo, remindCount: row.remind_count,
});
const BILL_SELECT = `SELECT b.*, COALESCE(s.display_name, s.name) AS student_name, c.name AS class_name
  FROM family_bills b LEFT JOIN family_students s ON s.id = b.student_id LEFT JOIN family_classes c ON c.id = s.current_class_id`;

async function guardiansOf(familyDb: D1Database, studentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const rows = (await familyDb.prepare(`SELECT sg.student_id, sg.guardian_id FROM student_guardians sg INNER JOIN family_guardians g ON g.id = sg.guardian_id
      WHERE g.status = 'active' AND sg.student_id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ student_id: string; guardian_id: string }>()).results || [];
    for (const r of rows) map.set(r.student_id, [...(map.get(r.student_id) || []), r.guardian_id]);
  }
  return map;
}
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

// ---- staff ----
export async function listBills(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, monthValue: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  const month = monthValue ? parseMonth(monthValue) : kstToday().slice(0, 7);
  const rows = (await familyDb.prepare(`${BILL_SELECT} WHERE b.campus_id = ? AND b.month = ? AND b.status <> 'canceled' ORDER BY c.name, s.name, b.title LIMIT 2000`)
    .bind(campusId, month).all<BillRow & { student_name: string; class_name: string | null }>()).results || [];
  const bills = rows.map(billResponse);
  const paid = bills.filter((b) => b.status === "paid");
  const today = kstToday();
  return {
    month, bills, settings: await paymentSettings(familyDb, campusId),
    totals: {
      count: bills.length, paidCount: paid.length, unpaidCount: bills.length - paid.length,
      overdueCount: bills.filter((b) => b.status === "unpaid" && b.dueDate < today).length,
      billed: bills.reduce((n, b) => n + b.amount, 0), paid: paid.reduce((n, b) => n + (b.paidAmount ?? b.amount), 0),
      unpaid: bills.filter((b) => b.status === "unpaid").reduce((n, b) => n + b.amount, 0),
    },
  };
}

/** 청구 만들기: 학생마다 금액 하나. 같은 달·같은 항목이 이미 있으면 건너뛴다. */
export async function createBills(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, input: Record<string, unknown>) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  const month = parseMonth(input.month);
  const title = clean(input.title, 80);
  if (!title) throw new DataCoreAccessError(400, "청구 항목 이름을 입력해 주세요. 예: 11월 수강료");
  const dueDate = parseDay(input.dueDate, "납부일");
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw new DataCoreAccessError(400, "청구할 학생을 골라 주세요.");
  if (items.length > MAX_ITEMS) throw new DataCoreAccessError(400, `한 번에 ${MAX_ITEMS}명까지 청구할 수 있습니다.`);
  const parsed = new Map<string, number>();
  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const studentId = clean(item.studentId, 120);
    if (!studentId) throw new DataCoreAccessError(400, "학생을 다시 골라 주세요.");
    parsed.set(studentId, parseAmount(item.amount));
  }
  const ids = [...parsed.keys()];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = (await familyDb.prepare(`SELECT id FROM family_students WHERE campus_id = ? AND id IN (${chunk.map(() => "?").join(",")})`).bind(campusId, ...chunk).all<{ id: string }>()).results || [];
    rows.forEach((r) => known.add(r.id));
  }
  if (known.size !== ids.length) throw new DataCoreAccessError(400, "이 캠퍼스 학생만 청구할 수 있습니다.");
  const now = new Date().toISOString();
  let created = 0;
  for (const [studentId, amount] of parsed) {
    const result = await familyDb.prepare(`INSERT INTO family_bills (id, campus_id, student_id, month, title, amount, due_date, status, memo, remind_count, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', '', 0, ?, ?, ?) ON CONFLICT(campus_id, student_id, month, title) DO NOTHING`)
      .bind(crypto.randomUUID(), campusId, studentId, month, title, amount, dueDate, context.user?.internalUserId || null, now, now).run();
    created += Number(result.meta?.changes || 0);
  }
  await audit(familyDb, context, "bill.create", campusId, `${month}:${title}`, { month, title, dueDate, requested: parsed.size, created });
  return { created, skipped: parsed.size - created, ...(await listBills(familyDb, context, campusId, month)) };
}

/** 수납 처리 · 되돌리기 · 금액/납부일 수정 · 청구 취소. */
export async function updateBill(familyDb: D1Database, context: DataCoreAccessContext, billId: string, input: Record<string, unknown>) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumPaymentsSchema(familyDb);
  const row = await familyDb.prepare("SELECT * FROM family_bills WHERE id = ?").bind(billId).first<BillRow>();
  if (!row) throw new DataCoreAccessError(404, "청구를 찾을 수 없습니다.");
  requireManager(context, row.campus_id);
  const action = String(input.action || "");
  const now = new Date().toISOString();
  const memo = input.memo === undefined ? row.memo : clean(input.memo, 300);
  if (action === "pay") {
    const paidAt = input.paidAt ? parseDay(input.paidAt, "수납") : kstToday();
    const paidAmount = input.paidAmount === undefined || input.paidAmount === "" ? row.amount : parseAmount(input.paidAmount, "받은 금액");
    const method = String(input.method || "transfer");
    if (!METHODS.has(method)) throw new DataCoreAccessError(400, "수납 방법을 골라 주세요.");
    await familyDb.prepare("UPDATE family_bills SET status = 'paid', paid_at = ?, paid_amount = ?, method = ?, memo = ?, updated_at = ? WHERE id = ?")
      .bind(paidAt, paidAmount, method, memo, now, row.id).run();
    await audit(familyDb, context, "bill.pay", row.campus_id, row.id, { paidAt, paidAmount, method });
  } else if (action === "unpay") {
    await familyDb.prepare("UPDATE family_bills SET status = 'unpaid', paid_at = NULL, paid_amount = NULL, method = NULL, memo = ?, updated_at = ? WHERE id = ?").bind(memo, now, row.id).run();
    await audit(familyDb, context, "bill.unpay", row.campus_id, row.id, { previous: { paidAt: row.paid_at, paidAmount: row.paid_amount, method: row.method } });
  } else if (action === "edit") {
    const amount = input.amount === undefined ? row.amount : parseAmount(input.amount);
    const dueDate = input.dueDate === undefined ? row.due_date : parseDay(input.dueDate, "납부일");
    await familyDb.prepare("UPDATE family_bills SET amount = ?, due_date = ?, memo = ?, updated_at = ? WHERE id = ?").bind(amount, dueDate, memo, now, row.id).run();
    await audit(familyDb, context, "bill.edit", row.campus_id, row.id, { amount, dueDate, previous: { amount: row.amount, dueDate: row.due_date } });
  } else if (action === "cancel") {
    if (row.status === "paid") throw new DataCoreAccessError(409, "수납된 청구는 먼저 수납을 되돌린 뒤 취소해 주세요.");
    await familyDb.prepare("UPDATE family_bills SET status = 'canceled', memo = ?, updated_at = ? WHERE id = ?").bind(memo, now, row.id).run();
    await audit(familyDb, context, "bill.cancel", row.campus_id, row.id, { amount: row.amount });
  } else throw new DataCoreAccessError(400, "처리할 일을 골라 주세요.");
  const next = await familyDb.prepare(`${BILL_SELECT} WHERE b.id = ?`).bind(row.id).first<BillRow & { student_name: string; class_name: string | null }>();
  return { bill: next ? billResponse(next) : null };
}

async function sendReminders(familyDb: D1Database, env: KkumeumPushEnv, bills: BillRow[], today: string) {
  const guardians = await guardiansOf(familyDb, [...new Set(bills.map((b) => b.student_id))]);
  let sent = 0, reached = 0;
  for (const bill of bills) {
    const ids = guardians.get(bill.student_id) || [];
    if (!ids.length) continue;
    reached += ids.length;
    const late = bill.due_date < today;
    const push = await dispatchGuardianDirectPush(familyDb, env, ids, {
      kind: "bill", title: late ? "꿈이음 · 납부 안내" : "꿈이음 · 납부일 안내",
      body: `${bill.title} ${won(bill.amount)} · 납부일 ${Number(bill.due_date.slice(5, 7))}/${Number(bill.due_date.slice(8, 10))}${late ? " (지났어요)" : ""}`,
      route: "/family/?openBills=1",
    });
    sent += push.sent;
    await familyDb.prepare("UPDATE family_bills SET reminded_on = ?, remind_count = remind_count + 1 WHERE id = ?").bind(today, bill.id).run();
  }
  return { bills: bills.length, guardians: reached, sent };
}

/** 미납 보호자에게 지금 알림 (그 달 미납 전체, 오늘 이미 보낸 청구는 빼고). */
export async function remindUnpaid(familyDb: D1Database, context: DataCoreAccessContext, env: KkumeumPushEnv, campusId: string, monthValue: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  const month = parseMonth(monthValue);
  const today = kstToday();
  const bills = (await familyDb.prepare("SELECT * FROM family_bills WHERE campus_id = ? AND month = ? AND status = 'unpaid' AND (reminded_on IS NULL OR reminded_on <> ?)")
    .bind(campusId, month, today).all<BillRow>()).results || [];
  const result = await sendReminders(familyDb, env, bills, today);
  await audit(familyDb, context, "bill.remind", campusId, month, result);
  return result;
}

/** 자동 알림 (매일 오전 10시 cron): 자동 알림을 켠 캠퍼스의 납부일 하루 전, 납부일 3일 뒤 미납. */
export async function runAutoBillReminders(familyDb: D1Database, env: KkumeumPushEnv, now = new Date()) {
  await ensureKkumeumPaymentsSchema(familyDb);
  const today = kstToday(now);
  const campuses = ((await familyDb.prepare("SELECT campus_id, settings_json FROM family_payment_settings").all<{ campus_id: string; settings_json: string }>()).results || [])
    .filter((r) => { try { return JSON.parse(r.settings_json).autoRemind === true; } catch { return false; } }).map((r) => r.campus_id);
  let total = { bills: 0, guardians: 0, sent: 0 };
  for (const campusId of campuses) {
    const bills = (await familyDb.prepare(`SELECT * FROM family_bills WHERE campus_id = ? AND status = 'unpaid' AND due_date IN (?, ?) AND (reminded_on IS NULL OR reminded_on <> ?)`)
      .bind(campusId, addDays(today, 1), addDays(today, -3), today).all<BillRow>()).results || [];
    const r = await sendReminders(familyDb, env, bills, today);
    total = { bills: total.bills + r.bills, guardians: total.guardians + r.guardians, sent: total.sent + r.sent };
  }
  return { date: today, campuses: campuses.length, ...total };
}

/** 일일 결산: 그날 수납 처리한 돈, 방법별 합계. */
export async function dailyPayments(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, dateValue: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  const date = dateValue ? parseDay(dateValue, "조회") : kstToday();
  const rows = (await familyDb.prepare(`${BILL_SELECT} WHERE b.campus_id = ? AND b.status = 'paid' AND b.paid_at = ? ORDER BY c.name, s.name`)
    .bind(campusId, date).all<BillRow & { student_name: string; class_name: string | null }>()).results || [];
  const payments = rows.map(billResponse);
  const byMethod = Object.fromEntries([...METHODS].map((m) => [m, payments.filter((p) => p.method === m).reduce((n, p) => n + (p.paidAmount ?? 0), 0)]));
  return { date, payments, byMethod, total: payments.reduce((n, p) => n + (p.paidAmount ?? 0), 0), count: payments.length };
}

export async function readPaymentSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  return { settings: await paymentSettings(familyDb, campusId) };
}
export async function savePaymentSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, raw: unknown) {
  requireManager(context, campusId);
  await ensureKkumeumPaymentsSchema(familyDb);
  const settings = settingsFrom(raw);
  await familyDb.prepare(`INSERT INTO family_payment_settings (campus_id, settings_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(campus_id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(campusId, JSON.stringify(settings), context.user?.internalUserId || null, new Date().toISOString()).run();
  await audit(familyDb, context, "bill.settings", campusId, campusId, settings);
  return { settings };
}

// ---- guardian ----
export async function listGuardianBills(familyDb: D1Database, request: Request) {
  await ensureKkumeumPaymentsSchema(familyDb);
  const identity = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!identity) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (identity.mustChangePassword) throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  const children = (await familyDb.prepare(`SELECT s.id, s.campus_id, COALESCE(s.display_name, s.name) AS name FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id WHERE sg.guardian_id = ? AND s.status = 'active' ORDER BY s.name`)
    .bind(identity.guardianId).all<{ id: string; campus_id: string; name: string }>()).results || [];
  if (!children.length) return { bills: [], guides: {}, unpaidCount: 0 };
  const since = addDays(kstToday(), -370).slice(0, 7);
  const rows = (await familyDb.prepare(`SELECT b.*, COALESCE(s.display_name, s.name) AS student_name FROM family_bills b INNER JOIN family_students s ON s.id = b.student_id
    WHERE b.student_id IN (${children.map(() => "?").join(",")}) AND b.campus_id = s.campus_id AND b.status <> 'canceled' AND b.month >= ? ORDER BY b.month DESC, b.due_date DESC LIMIT 200`)
    .bind(...children.map((c) => c.id), since).all<BillRow & { student_name: string }>()).results || [];
  const guides: Record<string, string> = {};
  for (const campusId of new Set(children.map((c) => c.campus_id))) { const g = (await paymentSettings(familyDb, campusId)).guide; if (g) guides[campusId] = g; }
  const bills = rows.map((r) => ({
    id: r.id, campusId: r.campus_id, studentName: r.student_name, month: r.month, title: r.title, amount: r.amount, dueDate: r.due_date,
    paid: r.status === "paid", paidAt: r.paid_at, paidAmount: r.paid_amount,
  }));
  return { bills, guides, unpaidCount: bills.filter((b) => !b.paid).length };
}

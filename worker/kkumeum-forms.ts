import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { requireKkumeumClassAccess, requireKkumeumStudentAccess } from "./kkumeum-core";
import { kkumeumGuardianSessionIdentity, type KkumeumGuardianIdentity } from "./kkumeum-guardian-auth";
import { dispatchGuardianDirectPush, type KkumeumPushEnv } from "./kkumeum-push";

// 꿈이음 3단계: 신청서 · 동의서.
// - 교직원이 양식을 만든다: 제목, 안내글, 질문(하나 고르기 · 여러 개 고르기 · 직접 쓰기), 마감일, 대상(캠퍼스 전체 · 반 · 학생).
//   동의서는 마지막에 "동의 / 동의하지 않음"을 꼭 고른다.
// - 보호자는 앱의 신청/동의서에서 자녀별로 한 번 제출하고, 마감 전에는 고칠 수 있다.
// - 교직원은 제출 현황(제출 · 미제출 · 동의 수, 질문별 집계)을 보고, 미제출 보호자에게 다시 알림을 보낸다.
// 원장·관리자는 캠퍼스 전체, 선생님은 담당 반 학생만 대상으로 고르고 볼 수 있다.
// 기존 개인정보 동의(consents 테이블)와는 다른 기능이라 이름을 family_forms로 나눈다.

const KINDS = new Set(["application", "consent"]);
const QUESTION_TYPES = new Set(["choice", "multi", "text"]);
const MAX_QUESTIONS = 15;
const MAX_OPTIONS = 10;
const MAX_TARGETS = 200;

type FormRow = {
  id: string; campus_id: string; kind: string; title: string; body: string; questions_json: string; deadline: string | null;
  status: string; created_by: string | null; created_by_name: string; created_at: string; updated_at: string; closed_at: string | null;
};
type ResponseRow = {
  id: string; form_id: string; student_id: string; guardian_id: string; guardian_name: string; answers_json: string;
  consent: string | null; submitted_at: string; updated_at: string;
};
export type FormQuestion = { id: string; type: "choice" | "multi" | "text"; label: string; options: string[]; required: boolean };
type Target = { targetType: "campus" | "class" | "student"; targetId: string };

export async function ensureKkumeumFormsSchema(familyDb: D1Database): Promise<void> {
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_forms (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_by TEXT,
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_forms_campus_idx ON family_forms(campus_id, created_at)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_form_targets (
      form_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (form_id, target_type, target_id),
      FOREIGN KEY (form_id) REFERENCES family_forms(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_form_targets_target_idx ON family_form_targets(target_type, target_id)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_form_responses (
      id TEXT PRIMARY KEY NOT NULL,
      form_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      guardian_id TEXT NOT NULL,
      guardian_name TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      consent TEXT,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (form_id, student_id),
      FOREIGN KEY (form_id) REFERENCES family_forms(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_form_responses_guardian_idx ON family_form_responses(guardian_id, updated_at)"),
  ]);
}

// ---- shared helpers ----
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const kstToday = (date = new Date()) => new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const parseQuestions = (raw: string): FormQuestion[] => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const parseAnswers = (raw: string): Record<string, string | string[]> => { try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
/** 마감일이 지났거나 마감된 양식은 더 받지 않는다 (마감일 당일 자정까지, 한국 시간). */
const isOpen = (form: Pick<FormRow, "status" | "deadline">, date = new Date()) => form.status === "open" && (!form.deadline || kstToday(date) <= form.deadline);

function isManager(context: DataCoreAccessContext, campusId: string): boolean {
  return context.isSuperAdmin || context.memberships.some((m) => m.campusId === campusId && (m.role === "CAMPUS_DIRECTOR" || m.role === "CAMPUS_ADMIN"));
}
function isWriter(context: DataCoreAccessContext, campusId: string): boolean {
  return isManager(context, campusId) || context.memberships.some((m) => m.campusId === campusId && m.role === "TEACHER");
}
function requireCampusStaff(context: DataCoreAccessContext, campusId: string) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 신청/동의서에 접근할 권한이 없습니다.");
}
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
}

function parseDeadline(value: unknown): string | null {
  const text = clean(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new DataCoreAccessError(400, "마감일 날짜를 확인해 주세요.");
  return text;
}

/** 질문 목록을 정리한다. 고르기 질문은 보기가 2개 이상이어야 한다. */
export function normalizeQuestions(raw: unknown): FormQuestion[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new DataCoreAccessError(400, "질문 형식이 올바르지 않습니다.");
  if (raw.length > MAX_QUESTIONS) throw new DataCoreAccessError(400, `질문은 ${MAX_QUESTIONS}개까지 넣을 수 있습니다.`);
  return raw.map((item, index) => {
    const q = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const type = String(q.type || "choice");
    if (!QUESTION_TYPES.has(type)) throw new DataCoreAccessError(400, "질문 종류를 확인해 주세요.");
    const label = clean(q.label, 200);
    if (!label) throw new DataCoreAccessError(400, `${index + 1}번 질문 내용을 입력해 주세요.`);
    const options = type === "text" ? [] : [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => clean(o, 60)).filter(Boolean))];
    if (type !== "text" && options.length < 2) throw new DataCoreAccessError(400, `${index + 1}번 질문의 보기를 2개 이상 입력해 주세요.`);
    if (options.length > MAX_OPTIONS) throw new DataCoreAccessError(400, `보기는 질문마다 ${MAX_OPTIONS}개까지 넣을 수 있습니다.`);
    return { id: `q${index + 1}`, type: type as FormQuestion["type"], label, options, required: q.required !== false };
  });
}

/** 보호자 답을 질문에 맞춰 확인한다. 보기에 없는 값, 빠진 필수 답은 거절한다. */
export function normalizeAnswers(questions: FormQuestion[], raw: unknown): Record<string, string | string[]> {
  const input = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};
  for (const q of questions) {
    const value = input[q.id];
    if (q.type === "multi") {
      const picked = [...new Set((Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v)))];
      if (picked.some((v) => !q.options.includes(v))) throw new DataCoreAccessError(400, `"${q.label}" 보기를 다시 골라 주세요.`);
      if (q.required && !picked.length) throw new DataCoreAccessError(400, `"${q.label}"에 답해 주세요.`);
      if (picked.length) out[q.id] = q.options.filter((o) => picked.includes(o));
    } else if (q.type === "choice") {
      const picked = clean(value, 60);
      if (picked && !q.options.includes(picked)) throw new DataCoreAccessError(400, `"${q.label}" 보기를 다시 골라 주세요.`);
      if (q.required && !picked) throw new DataCoreAccessError(400, `"${q.label}"에 답해 주세요.`);
      if (picked) out[q.id] = picked;
    } else {
      const text = clean(value, 1000);
      if (q.required && !text) throw new DataCoreAccessError(400, `"${q.label}"에 답해 주세요.`);
      if (text) out[q.id] = text;
    }
  }
  return out;
}

function normalizeTargets(raw: unknown): Target[] {
  if (!Array.isArray(raw) || !raw.length) throw new DataCoreAccessError(400, "받을 대상(캠퍼스 전체 · 반 · 학생)을 골라 주세요.");
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const item of raw) {
    const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const targetType = String(t.targetType || "");
    const targetId = clean(t.targetId, 120);
    if (!["campus", "class", "student"].includes(targetType) || !targetId) throw new DataCoreAccessError(400, "대상을 다시 골라 주세요.");
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ targetType: targetType as Target["targetType"], targetId });
  }
  if (targets.length > MAX_TARGETS) throw new DataCoreAccessError(400, `대상은 한 번에 ${MAX_TARGETS}개까지 고를 수 있습니다.`);
  return targets;
}

async function validateTargets(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, targets: Target[]) {
  for (const t of targets) {
    if (t.targetType === "campus") {
      if (t.targetId !== campusId) throw new DataCoreAccessError(400, "현재 캠퍼스만 대상으로 고를 수 있습니다.");
      if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "캠퍼스 전체에 보내는 양식은 원장·관리자만 만들 수 있습니다.");
    } else if (t.targetType === "class") {
      const row = await familyDb.prepare("SELECT campus_id FROM family_classes WHERE id = ?").bind(t.targetId).first<{ campus_id: string }>();
      if (!row || row.campus_id !== campusId) throw new DataCoreAccessError(400, "이 캠퍼스의 반만 고를 수 있습니다.");
      await requireKkumeumClassAccess(familyDb, context, campusId, t.targetId);
    } else {
      const row = await familyDb.prepare("SELECT campus_id FROM family_students WHERE id = ?").bind(t.targetId).first<{ campus_id: string }>();
      if (!row || row.campus_id !== campusId) throw new DataCoreAccessError(400, "이 캠퍼스의 학생만 고를 수 있습니다.");
      await requireKkumeumStudentAccess(familyDb, context, campusId, t.targetId);
    }
  }
}

// 대상이 된 재원생 (캠퍼스 전체 · 반 · 학생 대상을 합친 것).
const TARGET_STUDENTS_SQL = `SELECT s.id, COALESCE(s.display_name, s.name) AS name, s.current_class_id, c.name AS class_name
  FROM family_students s LEFT JOIN family_classes c ON c.id = s.current_class_id
  WHERE s.campus_id = ? AND s.status = 'active' AND (
    EXISTS (SELECT 1 FROM family_form_targets t WHERE t.form_id = ? AND t.target_type = 'campus' AND t.target_id = s.campus_id)
    OR EXISTS (SELECT 1 FROM family_form_targets t WHERE t.form_id = ? AND t.target_type = 'class' AND t.target_id = s.current_class_id)
    OR EXISTS (SELECT 1 FROM family_form_targets t WHERE t.form_id = ? AND t.target_type = 'student' AND t.target_id = s.id))`;
type TargetStudent = { id: string; name: string; current_class_id: string | null; class_name: string | null };
async function targetStudents(familyDb: D1Database, form: Pick<FormRow, "id" | "campus_id">): Promise<TargetStudent[]> {
  return (await familyDb.prepare(`${TARGET_STUDENTS_SQL} ORDER BY c.name, s.name LIMIT 2000`).bind(form.campus_id, form.id, form.id, form.id).all<TargetStudent>()).results || [];
}
async function guardiansOf(familyDb: D1Database, studentIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < studentIds.length; i += 90) {
    const chunk = studentIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const rows = (await familyDb.prepare(`SELECT DISTINCT sg.guardian_id FROM student_guardians sg INNER JOIN family_guardians g ON g.id = sg.guardian_id
      WHERE g.status = 'active' AND sg.student_id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ guardian_id: string }>()).results || [];
    ids.push(...rows.map((r) => r.guardian_id));
  }
  return [...new Set(ids)];
}

// 선생님은 담당 반 학생만 본다.
async function teacherStudentIds(familyDb: D1Database, context: DataCoreAccessContext, campusId: string): Promise<Set<string> | null> {
  if (isManager(context, campusId)) return null;
  const rows = (await familyDb.prepare(`SELECT s.id FROM family_students s INNER JOIN class_staff_assignments a ON a.class_id = s.current_class_id
    WHERE s.campus_id = ? AND a.staff_user_id = ? AND a.ended_at IS NULL`).bind(campusId, context.user?.internalUserId || "").all<{ id: string }>()).results || [];
  return new Set(rows.map((r) => r.id));
}

const formSummary = (row: FormRow) => ({
  id: row.id, campusId: row.campus_id, kind: row.kind, title: row.title, body: row.body, questions: parseQuestions(row.questions_json),
  deadline: row.deadline, status: row.status, open: isOpen(row), createdByName: row.created_by_name, createdAt: row.created_at, closedAt: row.closed_at,
});

// ---- staff side ----
export async function listStaffForms(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumFormsSchema(familyDb);
  const rows = (await familyDb.prepare("SELECT * FROM family_forms WHERE campus_id = ? ORDER BY created_at DESC LIMIT 200").bind(campusId).all<FormRow>()).results || [];
  const mine = await teacherStudentIds(familyDb, context, campusId);
  const forms = [];
  for (const row of rows) {
    let students = await targetStudents(familyDb, row);
    if (mine) {
      students = students.filter((s) => mine.has(s.id));
      if (!students.length && row.created_by !== context.user?.internalUserId) continue;
    }
    const ids = new Set(students.map((s) => s.id));
    const responses = ((await familyDb.prepare("SELECT student_id, consent FROM family_form_responses WHERE form_id = ?").bind(row.id).all<{ student_id: string; consent: string | null }>()).results || [])
      .filter((r) => ids.has(r.student_id));
    forms.push({ ...formSummary(row), targetCount: students.length, submittedCount: responses.length, agreeCount: responses.filter((r) => r.consent === "agree").length });
  }
  return { forms, canWrite: isWriter(context, campusId), canManage: isManager(context, campusId) };
}

export async function createStaffForm(familyDb: D1Database, context: DataCoreAccessContext, env: KkumeumPushEnv, campusId: string, input: Record<string, unknown>) {
  requireCampusStaff(context, campusId);
  if (!isWriter(context, campusId)) throw new DataCoreAccessError(403, "신청/동의서는 원장·관리자와 담당 선생님만 만들 수 있습니다.");
  await ensureKkumeumFormsSchema(familyDb);
  const kind = KINDS.has(String(input.kind)) ? String(input.kind) : "application";
  const title = clean(input.title, 120);
  if (!title) throw new DataCoreAccessError(400, "제목을 입력해 주세요.");
  const body = clean(input.body, 4000);
  const questions = normalizeQuestions(input.questions);
  if (kind === "application" && !questions.length) throw new DataCoreAccessError(400, "신청서에는 질문을 한 개 이상 넣어 주세요.");
  const deadline = parseDeadline(input.deadline);
  if (deadline && deadline < kstToday()) throw new DataCoreAccessError(400, "마감일은 오늘이나 그 뒤로 정해 주세요.");
  const targets = normalizeTargets(input.targets);
  await validateTargets(familyDb, context, campusId, targets);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await familyDb.batch([
    familyDb.prepare(`INSERT INTO family_forms (id, campus_id, kind, title, body, questions_json, deadline, status, created_by, created_by_name, created_at, updated_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL)`)
      .bind(id, campusId, kind, title, body, JSON.stringify(questions), deadline, context.user?.internalUserId || null, context.user?.displayName || "선생님", now, now),
    ...targets.map((t) => familyDb.prepare("INSERT INTO family_form_targets (form_id, target_type, target_id) VALUES (?, ?, ?)").bind(id, t.targetType, t.targetId)),
  ]);
  const students = await targetStudents(familyDb, { id, campus_id: campusId });
  const push = await dispatchGuardianDirectPush(familyDb, env, await guardiansOf(familyDb, students.map((s) => s.id)), {
    kind: "form", title: kind === "consent" ? "꿈이음 · 동의서" : "꿈이음 · 신청서",
    body: `${title}${deadline ? ` (마감 ${deadline.slice(5).replace("-", "/")})` : ""}`, route: `/family/?openForm=${encodeURIComponent(id)}`,
  });
  return { ...(await getStaffForm(familyDb, context, id)), push };
}

async function staffFormRow(familyDb: D1Database, context: DataCoreAccessContext, formId: string) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumFormsSchema(familyDb);
  const row = await familyDb.prepare("SELECT * FROM family_forms WHERE id = ?").bind(formId).first<FormRow>();
  if (!row) throw new DataCoreAccessError(404, "양식을 찾을 수 없습니다.");
  requireCampusStaff(context, row.campus_id);
  return row;
}
const canChange = (context: DataCoreAccessContext, row: FormRow) => isManager(context, row.campus_id) || (Boolean(row.created_by) && row.created_by === context.user?.internalUserId);

/** 제출 현황: 학생별 제출 여부와 답, 질문별 집계. 선생님은 담당 반 학생만. */
export async function getStaffForm(familyDb: D1Database, context: DataCoreAccessContext, formId: string) {
  const row = await staffFormRow(familyDb, context, formId);
  const mine = await teacherStudentIds(familyDb, context, row.campus_id);
  let students = await targetStudents(familyDb, row);
  if (mine) {
    students = students.filter((s) => mine.has(s.id));
    if (!students.length && row.created_by !== context.user?.internalUserId) throw new DataCoreAccessError(403, "담당 반 학생이 받은 양식만 볼 수 있습니다.");
  }
  const responses = new Map(((await familyDb.prepare("SELECT * FROM family_form_responses WHERE form_id = ?").bind(row.id).all<ResponseRow>()).results || []).map((r) => [r.student_id, r]));
  const questions = parseQuestions(row.questions_json);
  const rows = students.map((s) => {
    const r = responses.get(s.id);
    return {
      studentId: s.id, studentName: s.name, className: s.class_name || "반 미지정", submitted: Boolean(r),
      guardianName: r?.guardian_name || "", consent: r?.consent || null, answers: r ? parseAnswers(r.answers_json) : {}, submittedAt: r?.updated_at || null,
    };
  });
  const tally = questions.filter((q) => q.type !== "text").map((q) => ({
    id: q.id, label: q.label,
    counts: q.options.map((option) => ({ option, count: rows.filter((r) => { const a = r.answers[q.id]; return Array.isArray(a) ? a.includes(option) : a === option; }).length })),
  }));
  return {
    form: formSummary(row), rows, tally,
    summary: { targetCount: rows.length, submittedCount: rows.filter((r) => r.submitted).length, agreeCount: rows.filter((r) => r.consent === "agree").length, disagreeCount: rows.filter((r) => r.consent === "disagree").length },
    canChange: canChange(context, row),
  };
}

/** 마감하기 / 다시 받기. 만든 사람이나 원장·관리자만. */
export async function setStaffFormStatus(familyDb: D1Database, context: DataCoreAccessContext, formId: string, statusValue: unknown) {
  const row = await staffFormRow(familyDb, context, formId);
  if (!canChange(context, row)) throw new DataCoreAccessError(403, "만든 선생님이나 원장·관리자만 마감할 수 있습니다.");
  const status = String(statusValue);
  if (!["open", "closed"].includes(status)) throw new DataCoreAccessError(400, "상태를 확인해 주세요.");
  const now = new Date().toISOString();
  await familyDb.prepare("UPDATE family_forms SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?").bind(status, status === "closed" ? now : null, now, row.id).run();
  return getStaffForm(familyDb, context, row.id);
}

/** 아직 아무도 제출하지 않은 양식만 지울 수 있다. 제출이 있으면 마감한다. */
export async function deleteStaffForm(familyDb: D1Database, context: DataCoreAccessContext, formId: string) {
  const row = await staffFormRow(familyDb, context, formId);
  if (!canChange(context, row)) throw new DataCoreAccessError(403, "만든 선생님이나 원장·관리자만 지울 수 있습니다.");
  const n = await familyDb.prepare("SELECT COUNT(*) AS n FROM family_form_responses WHERE form_id = ?").bind(row.id).first<{ n: number }>();
  if ((n?.n || 0) > 0) throw new DataCoreAccessError(409, "이미 제출한 보호자가 있어 지울 수 없습니다. 대신 마감해 주세요.");
  await familyDb.batch([
    familyDb.prepare("DELETE FROM family_form_targets WHERE form_id = ?").bind(row.id),
    familyDb.prepare("DELETE FROM family_forms WHERE id = ?").bind(row.id),
  ]);
  return listStaffForms(familyDb, context, row.campus_id);
}

/** 미제출 보호자에게 다시 알림. */
export async function remindStaffForm(familyDb: D1Database, context: DataCoreAccessContext, env: KkumeumPushEnv, formId: string) {
  const detail = await getStaffForm(familyDb, context, formId);
  if (!detail.form.open) throw new DataCoreAccessError(400, "마감된 양식은 다시 알릴 수 없습니다.");
  const waiting = detail.rows.filter((r) => !r.submitted).map((r) => r.studentId);
  const guardians = await guardiansOf(familyDb, waiting);
  const push = await dispatchGuardianDirectPush(familyDb, env, guardians, {
    kind: "form", title: detail.form.kind === "consent" ? "꿈이음 · 동의서 제출 안내" : "꿈이음 · 신청서 제출 안내",
    body: `${detail.form.title} · 아직 제출하지 않았어요`, route: `/family/?openForm=${encodeURIComponent(detail.form.id)}`,
  });
  return { students: waiting.length, guardians: guardians.length, push };
}

// ---- guardian side ----
async function requireGuardian(familyDb: D1Database, request: Request): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumFormsSchema(familyDb);
  const identity = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!identity) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (identity.mustChangePassword) throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  return identity;
}
type Child = { id: string; campus_id: string; name: string; current_class_id: string | null };
async function guardianChildren(familyDb: D1Database, guardianId: string): Promise<Child[]> {
  return (await familyDb.prepare(`SELECT s.id, s.campus_id, COALESCE(s.display_name, s.name) AS name, s.current_class_id FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id WHERE sg.guardian_id = ? AND s.status = 'active' ORDER BY s.name`)
    .bind(guardianId).all<Child>()).results || [];
}
/** 보호자 자녀가 대상인 양식 id 목록. */
async function formsForChild(familyDb: D1Database, child: Child): Promise<string[]> {
  const rows = (await familyDb.prepare(`SELECT DISTINCT f.id FROM family_forms f INNER JOIN family_form_targets t ON t.form_id = f.id
    WHERE f.campus_id = ? AND ((t.target_type = 'campus' AND t.target_id = ?) OR (t.target_type = 'class' AND t.target_id = ?) OR (t.target_type = 'student' AND t.target_id = ?))`)
    .bind(child.campus_id, child.campus_id, child.current_class_id || "", child.id).all<{ id: string }>()).results || [];
  return rows.map((r) => r.id);
}

/** 학부모용 일정에 쓰는 자녀 캠퍼스 목록. */
export async function guardianScheduleScope(familyDb: D1Database, request: Request) {
  const guardian = await requireGuardian(familyDb, request);
  const children = await guardianChildren(familyDb, guardian.guardianId);
  return { guardianId: guardian.guardianId, campusIds: [...new Set(children.map((c) => c.campus_id))] };
}

export async function listGuardianForms(familyDb: D1Database, request: Request) {
  const guardian = await requireGuardian(familyDb, request);
  const children = await guardianChildren(familyDb, guardian.guardianId);
  const byForm = new Map<string, Child[]>();
  for (const child of children) for (const id of await formsForChild(familyDb, child)) byForm.set(id, [...(byForm.get(id) || []), child]);
  const forms = [];
  for (const [id, kids] of byForm) {
    const row = await familyDb.prepare("SELECT * FROM family_forms WHERE id = ?").bind(id).first<FormRow>();
    if (!row) continue;
    const done = new Set(((await familyDb.prepare(`SELECT student_id FROM family_form_responses WHERE form_id = ? AND student_id IN (${kids.map(() => "?").join(",")})`)
      .bind(id, ...kids.map((k) => k.id)).all<{ student_id: string }>()).results || []).map((r) => r.student_id));
    const open = isOpen(row);
    // 마감된 양식은 제출한 것만 남긴다 (기록 확인용).
    if (!open && !done.size) continue;
    forms.push({
      id: row.id, kind: row.kind, title: row.title, deadline: row.deadline, open, createdAt: row.created_at,
      children: kids.map((k) => ({ id: k.id, name: k.name, submitted: done.has(k.id) })),
      waiting: open && kids.some((k) => !done.has(k.id)),
    });
  }
  forms.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.createdAt.localeCompare(a.createdAt));
  return { forms, waiting: forms.filter((f) => f.waiting).length };
}

async function guardianForm(familyDb: D1Database, guardianId: string, formId: string) {
  const row = await familyDb.prepare("SELECT * FROM family_forms WHERE id = ?").bind(formId).first<FormRow>();
  if (!row) throw new DataCoreAccessError(404, "양식을 찾을 수 없습니다.");
  const kids: Child[] = [];
  for (const child of await guardianChildren(familyDb, guardianId)) if ((await formsForChild(familyDb, child)).includes(formId)) kids.push(child);
  if (!kids.length) throw new DataCoreAccessError(404, "양식을 찾을 수 없습니다.");
  return { row, kids };
}

export async function getGuardianForm(familyDb: D1Database, request: Request, formId: string) {
  const guardian = await requireGuardian(familyDb, request);
  const { row, kids } = await guardianForm(familyDb, guardian.guardianId, formId);
  const responses = new Map(((await familyDb.prepare(`SELECT * FROM family_form_responses WHERE form_id = ? AND student_id IN (${kids.map(() => "?").join(",")})`)
    .bind(row.id, ...kids.map((k) => k.id)).all<ResponseRow>()).results || []).map((r) => [r.student_id, r]));
  const s = formSummary(row);
  return {
    form: { id: s.id, kind: s.kind, title: s.title, body: s.body, questions: s.questions, deadline: s.deadline, open: s.open, createdByName: s.createdByName, createdAt: s.createdAt },
    children: kids.map((k) => {
      const r = responses.get(k.id);
      return { id: k.id, name: k.name, submitted: Boolean(r), answers: r ? parseAnswers(r.answers_json) : {}, consent: r?.consent || null, submittedAt: r?.updated_at || null, guardianName: r?.guardian_name || "" };
    }),
  };
}

/** 자녀 한 명 몫으로 제출 (마감 전에는 다시 제출해 고칠 수 있다). */
export async function submitGuardianForm(familyDb: D1Database, request: Request, formId: string, input: Record<string, unknown>) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const { row, kids } = await guardianForm(familyDb, guardian.guardianId, formId);
  const child = kids.find((k) => k.id === clean(input.studentId, 120));
  if (!child) throw new DataCoreAccessError(403, "이 양식을 받은 자녀를 골라 주세요.");
  if (!isOpen(row)) throw new DataCoreAccessError(409, "마감된 양식이라 제출할 수 없습니다.");
  const answers = normalizeAnswers(parseQuestions(row.questions_json), input.answers);
  let consent: string | null = null;
  if (row.kind === "consent") {
    consent = String(input.consent || "");
    if (!["agree", "disagree"].includes(consent)) throw new DataCoreAccessError(400, "동의 여부를 골라 주세요.");
  }
  const now = new Date().toISOString();
  await familyDb.prepare(`INSERT INTO family_form_responses (id, form_id, student_id, guardian_id, guardian_name, answers_json, consent, submitted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(form_id, student_id) DO UPDATE SET guardian_id = excluded.guardian_id, guardian_name = excluded.guardian_name,
      answers_json = excluded.answers_json, consent = excluded.consent, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), row.id, child.id, guardian.guardianId, guardian.displayName, JSON.stringify(answers), consent, now, now).run();
  return getGuardianForm(familyDb, request, row.id);
}

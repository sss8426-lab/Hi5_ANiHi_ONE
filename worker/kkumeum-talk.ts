import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { ensureKkumeumAnnouncementSchema, guardianCanViewPublishedAnnouncement } from "./kkumeum-announcements";
import { kkumeumGuardianSessionIdentity, type KkumeumGuardianIdentity } from "./kkumeum-guardian-auth";
import { dispatchGuardianDirectPush, type KkumeumPushEnv } from "./kkumeum-push";

// 꿈이음 2단계: 보호자 ↔ 학원 대화.
// - 소식 답변: a guardian answers a published 소식; one thread per (소식, 보호자), seen only by that guardian
//   and the campus staff (never by other parents). Staff read them in 답변모음 and reply.
// - 1:1 문의: a guardian asks about one child; staff answer in 문의모음. Outside the campus 운영시간 an
//   automatic notice (자동 안내) is added right away.
// - 사진 첨부 (up to 3 images per message, private R2), 자주 쓰는 글 for staff, and a push to the guardian
//   when staff answer. 원장·관리자 see every thread of the campus; 선생님 only threads of their class students.

const KINDS = new Set(["reply", "inquiry"]);
const MAX_BODY = 2000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const GUARDIAN_MESSAGES_PER_HOUR = 30;
const IMAGE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/gif": (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  "image/webp": (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

type ThreadRow = {
  id: string; campus_id: string; kind: string; announcement_id: string | null; guardian_id: string; student_id: string;
  title: string; status: string; guardian_unread: number; staff_unread: number; last_message_at: string; last_preview: string | null; created_at: string;
};
type MessageRow = { id: string; thread_id: string; author_type: string; author_id: string | null; author_name: string; body: string; files_json: string | null; created_at: string };
type DayHours = { start: string; end: string };
export type TalkSettings = { enabled: boolean; weekday: DayHours; saturday: DayHours; sunday: DayHours; autoReply: string };
type IncomingFile = { type: string; bytes: Uint8Array };
type MessageInput = { body: string; files: IncomingFile[]; fields: Record<string, string> };

const DEFAULT_SETTINGS: TalkSettings = {
  enabled: false,
  weekday: { start: "13:00", end: "22:00" },
  saturday: { start: "10:00", end: "18:00" },
  sunday: { start: "", end: "" },
  autoReply: "문의 감사합니다. 지금은 상담 시간이 아니에요. 운영시간에 확인한 뒤 바로 답변드리겠습니다.",
};

export async function ensureKkumeumTalkSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumAnnouncementSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_threads (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      announcement_id TEXT,
      guardian_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      guardian_unread INTEGER NOT NULL DEFAULT 0,
      staff_unread INTEGER NOT NULL DEFAULT 1,
      last_message_at TEXT NOT NULL,
      last_preview TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_threads_campus_idx ON family_threads(campus_id, kind, last_message_at)"),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_threads_guardian_idx ON family_threads(guardian_id, kind, last_message_at)"),
    familyDb.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_threads_reply_unique ON family_threads(announcement_id, guardian_id) WHERE kind = 'reply'"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_thread_messages (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      files_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES family_threads(id) ON DELETE CASCADE
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_thread_messages_thread_idx ON family_thread_messages(thread_id, created_at)"),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_thread_messages_author_idx ON family_thread_messages(author_type, author_id, created_at)"),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_thread_files (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES family_threads(id) ON DELETE CASCADE
    )`),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_talk_settings (
      campus_id TEXT PRIMARY KEY NOT NULL,
      settings_json TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_staff_snippets (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      owner_user_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    familyDb.prepare("CREATE INDEX IF NOT EXISTS family_staff_snippets_campus_idx ON family_staff_snippets(campus_id, created_at)"),
  ]);
}

// ---- shared helpers ----
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const preview = (body: string, files: number) => (body.replace(/\s+/g, " ").slice(0, 80) || (files ? `사진 ${files}장` : ""));
const kstParts = (date = new Date()) => { const k = new Date(date.getTime() + 9 * 3600_000); return { day: k.getUTCDay(), minutes: k.getUTCHours() * 60 + k.getUTCMinutes() }; };
const minutesOf = (hm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

function isManager(context: DataCoreAccessContext, campusId: string): boolean {
  return context.isSuperAdmin || context.memberships.some((m) => m.campusId === campusId && (m.role === "CAMPUS_DIRECTOR" || m.role === "CAMPUS_ADMIN"));
}
function requireCampusStaff(context: DataCoreAccessContext, campusId: string) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스의 꿈이음 대화에 접근할 권한이 없습니다.");
}
async function requireGuardian(familyDb: D1Database, request: Request): Promise<KkumeumGuardianIdentity> {
  await ensureKkumeumTalkSchema(familyDb);
  const identity = await kkumeumGuardianSessionIdentity(familyDb, request);
  if (!identity) throw new DataCoreAccessError(401, "보호자 로그인이 필요합니다.");
  if (identity.mustChangePassword) throw new DataCoreAccessError(403, "보호자 비밀번호를 먼저 변경해야 합니다.");
  return identity;
}
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new DataCoreAccessError(403, "허용되지 않은 요청 출처입니다.");
}

/** JSON ({body, ...}) or multipart (body, fields, files[]) — photos are checked by their first bytes, not the name. */
export async function readMessageInput(request: Request): Promise<MessageInput> {
  const type = request.headers.get("content-type") || "";
  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const fields: Record<string, string> = {};
    const files: IncomingFile[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") { if (key !== "files") fields[key] = value; continue; }
      if (key !== "files" || !value.size) continue;
      if (files.length >= MAX_FILES) throw new DataCoreAccessError(400, `사진은 한 번에 ${MAX_FILES}장까지 보낼 수 있습니다.`);
      if (value.size > MAX_FILE_BYTES) throw new DataCoreAccessError(400, "사진 한 장은 8MB 이하로 보내 주세요.");
      const bytes = new Uint8Array(await value.arrayBuffer());
      const mime = Object.keys(IMAGE_TYPES).find((m) => IMAGE_TYPES[m](bytes));
      if (!mime) throw new DataCoreAccessError(400, "사진(JPG·PNG·WEBP·GIF)만 보낼 수 있습니다.");
      files.push({ type: mime, bytes });
    }
    return { body: clean(fields.body, MAX_BODY), files, fields };
  }
  const json = await request.json().catch(() => ({})) as Record<string, unknown>;
  const fields = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { body: clean(json.body, MAX_BODY), files: [], fields };
}

function settingsFrom(raw: unknown): TalkSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hours = (value: unknown, fallback: DayHours): DayHours => {
    const v = (value && typeof value === "object" ? value : fallback) as Record<string, unknown>;
    const start = /^\d{2}:\d{2}$/.test(String(v.start ?? "")) ? String(v.start) : "";
    const end = /^\d{2}:\d{2}$/.test(String(v.end ?? "")) ? String(v.end) : "";
    return start && end && minutesOf(start) < minutesOf(end) ? { start, end } : { start: "", end: "" };
  };
  return {
    enabled: input.enabled === true,
    weekday: hours(input.weekday, DEFAULT_SETTINGS.weekday),
    saturday: hours(input.saturday, DEFAULT_SETTINGS.saturday),
    sunday: hours(input.sunday, DEFAULT_SETTINGS.sunday),
    autoReply: clean(input.autoReply, 500) || DEFAULT_SETTINGS.autoReply,
  };
}
export async function talkSettings(familyDb: D1Database, campusId: string): Promise<TalkSettings> {
  const row = await familyDb.prepare("SELECT settings_json FROM family_talk_settings WHERE campus_id = ?").bind(campusId).first<{ settings_json: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try { return settingsFrom(JSON.parse(row.settings_json)); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function hoursLabel(s: TalkSettings): string {
  const part = (name: string, h: DayHours) => `${name} ${h.start ? `${h.start}~${h.end}` : "휴무"}`;
  return [part("평일", s.weekday), part("토", s.saturday), part("일", s.sunday)].join(" · ");
}
export function isOpenNow(s: TalkSettings, date = new Date()): boolean {
  const { day, minutes } = kstParts(date);
  const h = day === 0 ? s.sunday : day === 6 ? s.saturday : s.weekday;
  return Boolean(h.start) && minutes >= minutesOf(h.start) && minutes < minutesOf(h.end);
}

async function addMessage(
  familyDb: D1Database, files: R2Bucket | undefined, thread: { id: string; campus_id: string },
  author: { type: "guardian" | "staff" | "auto"; id: string | null; name: string }, input: { body: string; files: IncomingFile[] }, now: string,
) {
  if (!input.body && !input.files.length) throw new DataCoreAccessError(400, "내용을 입력하거나 사진을 골라 주세요.");
  if (input.files.length && !files) throw new DataCoreAccessError(503, "사진 저장소(FAMILY_FILES)가 연결되지 않아 사진을 보낼 수 없습니다.");
  const messageId = crypto.randomUUID();
  const stored: { id: string; type: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const file of input.files) {
    const id = crypto.randomUUID(), key = `talk/${thread.campus_id}/${thread.id}/${id}`;
    await files!.put(key, file.bytes, { httpMetadata: { contentType: file.type } });
    stored.push({ id, type: file.type });
    statements.push(familyDb.prepare("INSERT INTO family_thread_files (id, thread_id, message_id, r2_key, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, thread.id, messageId, key, file.type, file.bytes.byteLength, now));
  }
  statements.unshift(familyDb.prepare(`INSERT INTO family_thread_messages (id, thread_id, author_type, author_id, author_name, body, files_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(messageId, thread.id, author.type, author.id, author.name, input.body, stored.length ? JSON.stringify(stored) : null, now));
  await familyDb.batch(statements);
  return { messageId, preview: preview(input.body, stored.length) };
}

const messageResponse = (row: MessageRow) => ({
  id: row.id, author: row.author_type, authorName: row.author_name, body: row.body, createdAt: row.created_at,
  files: (() => { try { return (JSON.parse(row.files_json || "[]") as { id: string; type: string }[]); } catch { return []; } })(),
});
async function threadMessages(familyDb: D1Database, threadId: string) {
  const rows = (await familyDb.prepare("SELECT * FROM family_thread_messages WHERE thread_id = ? ORDER BY created_at, id LIMIT 300").bind(threadId).all<MessageRow>()).results || [];
  return rows.map(messageResponse);
}

// ---- guardian side ----
async function guardianChild(familyDb: D1Database, guardianId: string, studentId: string) {
  return familyDb.prepare(`SELECT s.id, s.campus_id, COALESCE(s.display_name, s.name) AS name FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id WHERE sg.guardian_id = ? AND s.id = ? AND s.status = 'active' LIMIT 1`)
    .bind(guardianId, studentId).first<{ id: string; campus_id: string; name: string }>();
}
async function guardianChildren(familyDb: D1Database, guardianId: string) {
  return (await familyDb.prepare(`SELECT s.id, s.campus_id, COALESCE(s.display_name, s.name) AS name FROM student_guardians sg
    INNER JOIN family_students s ON s.id = sg.student_id WHERE sg.guardian_id = ? AND s.status = 'active' ORDER BY s.name`)
    .bind(guardianId).all<{ id: string; campus_id: string; name: string }>()).results || [];
}
async function guardianRateLimit(familyDb: D1Database, guardianId: string) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const row = await familyDb.prepare("SELECT COUNT(*) AS n FROM family_thread_messages WHERE author_type = 'guardian' AND author_id = ? AND created_at > ?")
    .bind(guardianId, since).first<{ n: number }>();
  if ((row?.n || 0) >= GUARDIAN_MESSAGES_PER_HOUR) throw new DataCoreAccessError(429, "메시지를 너무 많이 보냈습니다. 잠시 후 다시 보내 주세요.");
}
const guardianThread = (row: ThreadRow & { student_name?: string; announcement_title?: string | null }) => ({
  id: row.id, kind: row.kind, title: row.title, status: row.status, studentId: row.student_id, studentName: row.student_name || "",
  announcementId: row.announcement_id, unread: Boolean(row.guardian_unread), lastPreview: row.last_preview || "", lastMessageAt: row.last_message_at,
});

/** 답변모음 / 문의모음 for the signed-in guardian, plus each child's campus 운영시간 for the 문의 form. */
export async function listGuardianThreads(familyDb: D1Database, request: Request, kindValue: unknown) {
  const guardian = await requireGuardian(familyDb, request);
  const kind = KINDS.has(String(kindValue)) ? String(kindValue) : "inquiry";
  const rows = (await familyDb.prepare(`SELECT t.*, COALESCE(s.display_name, s.name) AS student_name FROM family_threads t
    LEFT JOIN family_students s ON s.id = t.student_id WHERE t.guardian_id = ? AND t.kind = ? ORDER BY t.last_message_at DESC LIMIT 100`)
    .bind(guardian.guardianId, kind).all<ThreadRow & { student_name: string }>()).results || [];
  const children = await guardianChildren(familyDb, guardian.guardianId);
  const campuses = [...new Set(children.map((c) => c.campus_id))];
  const hours: Record<string, { label: string; open: boolean; enabled: boolean }> = {};
  for (const id of campuses) { const s = await talkSettings(familyDb, id); hours[id] = { label: hoursLabel(s), open: isOpenNow(s), enabled: s.enabled }; }
  const unread = await familyDb.prepare("SELECT kind, COUNT(*) AS n FROM family_threads WHERE guardian_id = ? AND guardian_unread = 1 GROUP BY kind")
    .bind(guardian.guardianId).all<{ kind: string; n: number }>();
  return {
    kind, threads: rows.map(guardianThread),
    children: children.map((c) => ({ id: c.id, name: c.name, campusId: c.campus_id })), hours,
    unread: Object.fromEntries((unread.results || []).map((r) => [r.kind, r.n])),
  };
}

export async function getGuardianThread(familyDb: D1Database, request: Request, threadId: string) {
  const guardian = await requireGuardian(familyDb, request);
  const row = await familyDb.prepare(`SELECT t.*, COALESCE(s.display_name, s.name) AS student_name FROM family_threads t
    LEFT JOIN family_students s ON s.id = t.student_id WHERE t.id = ? AND t.guardian_id = ?`).bind(threadId, guardian.guardianId).first<ThreadRow & { student_name: string }>();
  if (!row) throw new DataCoreAccessError(404, "대화를 찾을 수 없습니다.");
  if (row.guardian_unread) await familyDb.prepare("UPDATE family_threads SET guardian_unread = 0 WHERE id = ?").bind(row.id).run();
  return { thread: { ...guardianThread(row), unread: false }, messages: await threadMessages(familyDb, row.id) };
}

/** A 1:1 문의 about one child. Outside 운영시간 the 자동 안내 is added at once. */
export async function createGuardianInquiry(familyDb: D1Database, files: R2Bucket | undefined, request: Request) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const input = await readMessageInput(request);
  const child = await guardianChild(familyDb, guardian.guardianId, clean(input.fields.studentId, 120));
  if (!child) throw new DataCoreAccessError(403, "연결된 자녀를 골라 주세요.");
  await guardianRateLimit(familyDb, guardian.guardianId);
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const title = clean(input.fields.title, 80) || preview(input.body, input.files.length).slice(0, 40) || "문의";
  await familyDb.prepare(`INSERT INTO family_threads (id, campus_id, kind, announcement_id, guardian_id, student_id, title, status, guardian_unread, staff_unread, last_message_at, last_preview, created_at)
    VALUES (?, ?, 'inquiry', NULL, ?, ?, ?, 'open', 0, 1, ?, NULL, ?)`).bind(id, child.campus_id, guardian.guardianId, child.id, title, now, now).run();
  const thread = { id, campus_id: child.campus_id };
  const sent = await addMessage(familyDb, files, thread, { type: "guardian", id: guardian.guardianId, name: guardian.displayName }, input, now);
  await familyDb.prepare("UPDATE family_threads SET last_preview = ? WHERE id = ?").bind(sent.preview, id).run();
  const settings = await talkSettings(familyDb, child.campus_id);
  if (settings.enabled && !isOpenNow(settings)) {
    const later = new Date(Date.parse(now) + 1).toISOString();
    await addMessage(familyDb, files, thread, { type: "auto", id: null, name: "자동 안내" }, { body: `${settings.autoReply}\n운영시간: ${hoursLabel(settings)}`, files: [] }, later);
  }
  return getGuardianThread(familyDb, request, id);
}

/** 소식 답변: one thread per 소식 and guardian; the first answer opens it, later ones continue it. */
export async function replyToNotice(familyDb: D1Database, files: R2Bucket | undefined, request: Request, announcementId: string) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  if (!await guardianCanViewPublishedAnnouncement(familyDb, announcementId, guardian.guardianId)) throw new DataCoreAccessError(403, "이 소식에 답변할 수 없습니다.");
  const input = await readMessageInput(request);
  await guardianRateLimit(familyDb, guardian.guardianId);
  const notice = await familyDb.prepare("SELECT id, campus_id, title FROM announcements WHERE id = ?").bind(announcementId).first<{ id: string; campus_id: string | null; title: string }>();
  if (!notice) throw new DataCoreAccessError(404, "소식을 찾을 수 없습니다.");
  const now = new Date().toISOString();
  let thread = await familyDb.prepare("SELECT * FROM family_threads WHERE kind = 'reply' AND announcement_id = ? AND guardian_id = ?").bind(announcementId, guardian.guardianId).first<ThreadRow>();
  if (!thread) {
    const children = await guardianChildren(familyDb, guardian.guardianId);
    const asked = children.find((c) => c.id === clean(input.fields.studentId, 120));
    const child = asked || children.find((c) => c.campus_id === notice.campus_id) || children[0];
    if (!child) throw new DataCoreAccessError(403, "연결된 자녀가 없어 답변할 수 없습니다.");
    const id = crypto.randomUUID();
    await familyDb.prepare(`INSERT INTO family_threads (id, campus_id, kind, announcement_id, guardian_id, student_id, title, status, guardian_unread, staff_unread, last_message_at, last_preview, created_at)
      VALUES (?, ?, 'reply', ?, ?, ?, ?, 'open', 0, 1, ?, NULL, ?) ON CONFLICT DO NOTHING`)
      .bind(id, notice.campus_id || child.campus_id, announcementId, guardian.guardianId, child.id, clean(notice.title, 120) || "소식", now, now).run();
    thread = await familyDb.prepare("SELECT * FROM family_threads WHERE kind = 'reply' AND announcement_id = ? AND guardian_id = ?").bind(announcementId, guardian.guardianId).first<ThreadRow>();
  }
  if (!thread) throw new DataCoreAccessError(500, "답변을 저장하지 못했습니다.");
  const sent = await addMessage(familyDb, files, thread, { type: "guardian", id: guardian.guardianId, name: guardian.displayName }, input, now);
  await familyDb.prepare("UPDATE family_threads SET status = 'open', staff_unread = 1, last_message_at = ?, last_preview = ? WHERE id = ?").bind(now, sent.preview, thread.id).run();
  return getGuardianThread(familyDb, request, thread.id);
}

/** The guardian's own answer thread on one 소식 (empty when none yet). */
export async function guardianNoticeReplies(familyDb: D1Database, request: Request, announcementId: string) {
  const guardian = await requireGuardian(familyDb, request);
  const thread = await familyDb.prepare("SELECT id FROM family_threads WHERE kind = 'reply' AND announcement_id = ? AND guardian_id = ?").bind(announcementId, guardian.guardianId).first<{ id: string }>();
  return thread ? getGuardianThread(familyDb, request, thread.id) : { thread: null, messages: [] };
}

export async function guardianThreadMessage(familyDb: D1Database, files: R2Bucket | undefined, request: Request, threadId: string) {
  assertSameOrigin(request);
  const guardian = await requireGuardian(familyDb, request);
  const thread = await familyDb.prepare("SELECT * FROM family_threads WHERE id = ? AND guardian_id = ?").bind(threadId, guardian.guardianId).first<ThreadRow>();
  if (!thread) throw new DataCoreAccessError(404, "대화를 찾을 수 없습니다.");
  const input = await readMessageInput(request);
  await guardianRateLimit(familyDb, guardian.guardianId);
  const now = new Date().toISOString();
  const sent = await addMessage(familyDb, files, thread, { type: "guardian", id: guardian.guardianId, name: guardian.displayName }, input, now);
  await familyDb.prepare("UPDATE family_threads SET status = 'open', staff_unread = 1, last_message_at = ?, last_preview = ? WHERE id = ?").bind(now, sent.preview, thread.id).run();
  return getGuardianThread(familyDb, request, thread.id);
}

function fileResponse(object: R2ObjectBody, mime: string): Response {
  const headers = new Headers({ "content-type": mime, "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff" });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
export async function readGuardianTalkFile(familyDb: D1Database, files: R2Bucket, request: Request, fileId: string) {
  const guardian = await requireGuardian(familyDb, request);
  const row = await familyDb.prepare(`SELECT f.r2_key, f.mime_type FROM family_thread_files f INNER JOIN family_threads t ON t.id = f.thread_id
    WHERE f.id = ? AND t.guardian_id = ?`).bind(fileId, guardian.guardianId).first<{ r2_key: string; mime_type: string }>();
  if (!row) throw new DataCoreAccessError(403, "이 사진을 볼 권한이 없습니다.");
  const object = await files.get(row.r2_key);
  if (!object) throw new DataCoreAccessError(404, "사진을 찾을 수 없습니다.");
  return fileResponse(object, row.mime_type);
}

// ---- staff side ----
// 선생님: threads of students in their assigned classes. 원장·관리자: every thread of the campus.
function staffScope(context: DataCoreAccessContext, campusId: string) {
  if (isManager(context, campusId)) return { sql: "", bindings: [] as string[] };
  return {
    sql: ` AND t.student_id IN (SELECT s.id FROM family_students s INNER JOIN class_staff_assignments a ON a.class_id = s.current_class_id
      WHERE s.campus_id = t.campus_id AND a.staff_user_id = ? AND a.ended_at IS NULL)`,
    bindings: [context.user?.internalUserId || ""],
  };
}
const staffThread = (row: ThreadRow & { student_name?: string; guardian_name?: string; announcement_title?: string | null }) => ({
  id: row.id, kind: row.kind, title: row.title, status: row.status, studentId: row.student_id, studentName: row.student_name || "",
  guardianName: row.guardian_name || "보호자", announcementId: row.announcement_id, unread: Boolean(row.staff_unread),
  lastPreview: row.last_preview || "", lastMessageAt: row.last_message_at, createdAt: row.created_at,
});
const STAFF_THREAD_SELECT = `SELECT t.*, COALESCE(s.display_name, s.name) AS student_name, g.display_name AS guardian_name
  FROM family_threads t LEFT JOIN family_students s ON s.id = t.student_id LEFT JOIN family_guardians g ON g.id = t.guardian_id`;

export async function listStaffThreads(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, kindValue: unknown, filter: unknown) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumTalkSchema(familyDb);
  const kind = KINDS.has(String(kindValue)) ? String(kindValue) : "inquiry";
  const scope = staffScope(context, campusId);
  const open = filter === "open" ? " AND t.status = 'open'" : "";
  const rows = (await familyDb.prepare(`${STAFF_THREAD_SELECT} WHERE t.campus_id = ? AND t.kind = ?${open}${scope.sql} ORDER BY t.staff_unread DESC, t.last_message_at DESC LIMIT 200`)
    .bind(campusId, kind, ...scope.bindings).all<ThreadRow & { student_name: string; guardian_name: string }>()).results || [];
  return { kind, threads: rows.map(staffThread), canManage: isManager(context, campusId) };
}

/** Unread counts for the 답변모음 · 문의모음 badges. */
export async function staffThreadSummary(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumTalkSchema(familyDb);
  const scope = staffScope(context, campusId);
  const rows = (await familyDb.prepare(`SELECT t.kind, COUNT(*) AS n FROM family_threads t WHERE t.campus_id = ? AND t.staff_unread = 1${scope.sql} GROUP BY t.kind`)
    .bind(campusId, ...scope.bindings).all<{ kind: string; n: number }>()).results || [];
  const counts = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  return { answers: counts.reply || 0, inquiries: counts.inquiry || 0 };
}

async function staffThreadRow(familyDb: D1Database, context: DataCoreAccessContext, threadId: string) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumTalkSchema(familyDb);
  const base = await familyDb.prepare("SELECT campus_id FROM family_threads WHERE id = ?").bind(threadId).first<{ campus_id: string }>();
  if (!base) throw new DataCoreAccessError(404, "대화를 찾을 수 없습니다.");
  requireCampusStaff(context, base.campus_id);
  const scope = staffScope(context, base.campus_id);
  const row = await familyDb.prepare(`${STAFF_THREAD_SELECT} WHERE t.id = ?${scope.sql}`).bind(threadId, ...scope.bindings)
    .first<ThreadRow & { student_name: string; guardian_name: string }>();
  if (!row) throw new DataCoreAccessError(403, "담당 반 학생의 대화만 볼 수 있습니다.");
  return row;
}

export async function getStaffThread(familyDb: D1Database, context: DataCoreAccessContext, threadId: string) {
  const row = await staffThreadRow(familyDb, context, threadId);
  if (row.staff_unread) await familyDb.prepare("UPDATE family_threads SET staff_unread = 0 WHERE id = ?").bind(row.id).run();
  const notice = row.announcement_id ? await familyDb.prepare("SELECT title, body, published_at FROM announcements WHERE id = ?").bind(row.announcement_id)
    .first<{ title: string; body: string; published_at: string | null }>() : null;
  return {
    thread: { ...staffThread(row), unread: false },
    notice: notice ? { title: notice.title, body: notice.body, publishedAt: notice.published_at } : null,
    messages: await threadMessages(familyDb, row.id), canManage: isManager(context, row.campus_id),
  };
}

/** Staff answer: saved, thread marked 답변 완료, and the guardian gets a push. */
export async function staffThreadMessage(familyDb: D1Database, files: R2Bucket | undefined, context: DataCoreAccessContext, env: KkumeumPushEnv, request: Request, threadId: string) {
  const row = await staffThreadRow(familyDb, context, threadId);
  const input = await readMessageInput(request);
  const now = new Date().toISOString();
  const name = context.user?.displayName || "선생님";
  const sent = await addMessage(familyDb, files, row, { type: "staff", id: context.user?.internalUserId || null, name }, input, now);
  await familyDb.prepare("UPDATE family_threads SET status = 'answered', staff_unread = 0, guardian_unread = 1, last_message_at = ?, last_preview = ? WHERE id = ?")
    .bind(now, sent.preview, row.id).run();
  const push = await dispatchGuardianDirectPush(familyDb, env, [row.guardian_id], {
    kind: "talk", title: row.kind === "reply" ? "꿈이음 · 소식 답장" : "꿈이음 · 문의 답변",
    body: `${row.student_name ? `${row.student_name} · ` : ""}${sent.preview}`, route: `/family/?openThread=${encodeURIComponent(row.id)}`,
  });
  return { ...(await getStaffThread(familyDb, context, row.id)), push };
}

/** 처리 완료 (no answer needed) or 다시 열기. */
export async function setStaffThreadStatus(familyDb: D1Database, context: DataCoreAccessContext, threadId: string, statusValue: unknown) {
  const row = await staffThreadRow(familyDb, context, threadId);
  const status = String(statusValue);
  if (!["open", "answered", "closed"].includes(status)) throw new DataCoreAccessError(400, "상태를 확인해 주세요.");
  await familyDb.prepare("UPDATE family_threads SET status = ?, staff_unread = 0 WHERE id = ?").bind(status, row.id).run();
  return getStaffThread(familyDb, context, row.id);
}

export async function readStaffTalkFile(familyDb: D1Database, files: R2Bucket, context: DataCoreAccessContext, fileId: string) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumTalkSchema(familyDb);
  const file = await familyDb.prepare("SELECT thread_id, r2_key, mime_type FROM family_thread_files WHERE id = ?").bind(fileId).first<{ thread_id: string; r2_key: string; mime_type: string }>();
  if (!file) throw new DataCoreAccessError(404, "사진을 찾을 수 없습니다.");
  await staffThreadRow(familyDb, context, file.thread_id);
  const object = await files.get(file.r2_key);
  if (!object) throw new DataCoreAccessError(404, "사진을 찾을 수 없습니다.");
  return fileResponse(object, file.mime_type);
}

// ---- 운영시간 · 자동 안내 (원장·관리자) ----
export async function readTalkSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumTalkSchema(familyDb);
  const settings = await talkSettings(familyDb, campusId);
  return { settings, label: hoursLabel(settings), openNow: isOpenNow(settings), canManage: isManager(context, campusId) };
}
export async function saveTalkSettings(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, raw: unknown) {
  requireCampusStaff(context, campusId);
  if (!isManager(context, campusId)) throw new DataCoreAccessError(403, "문의 운영시간은 원장·관리자만 바꿀 수 있습니다.");
  await ensureKkumeumTalkSchema(familyDb);
  const settings = settingsFrom(raw);
  const now = new Date().toISOString();
  await familyDb.prepare(`INSERT INTO family_talk_settings (campus_id, settings_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(campus_id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(campusId, JSON.stringify(settings), context.user?.internalUserId || null, now).run();
  return readTalkSettings(familyDb, context, campusId);
}

// ---- 자주 쓰는 글 (campus-shared; the writer or 원장·관리자 may delete) ----
export async function listSnippets(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumTalkSchema(familyDb);
  const rows = (await familyDb.prepare("SELECT id, owner_user_id, title, body FROM family_staff_snippets WHERE campus_id = ? ORDER BY created_at LIMIT 100").bind(campusId)
    .all<{ id: string; owner_user_id: string | null; title: string; body: string }>()).results || [];
  const me = context.user?.internalUserId, manager = isManager(context, campusId);
  return { snippets: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, canDelete: manager || r.owner_user_id === me })) };
}
export async function createSnippet(familyDb: D1Database, context: DataCoreAccessContext, campusId: string, input: Record<string, unknown>) {
  requireCampusStaff(context, campusId);
  await ensureKkumeumTalkSchema(familyDb);
  const body = clean(input.body, MAX_BODY), title = clean(input.title, 40) || body.replace(/\s+/g, " ").slice(0, 20);
  if (!body) throw new DataCoreAccessError(400, "저장할 글을 입력해 주세요.");
  const count = await familyDb.prepare("SELECT COUNT(*) AS n FROM family_staff_snippets WHERE campus_id = ?").bind(campusId).first<{ n: number }>();
  if ((count?.n || 0) >= 100) throw new DataCoreAccessError(400, "자주 쓰는 글은 캠퍼스마다 100개까지 저장할 수 있습니다.");
  await familyDb.prepare("INSERT INTO family_staff_snippets (id, campus_id, owner_user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), campusId, context.user?.internalUserId || null, title, body, new Date().toISOString()).run();
  return listSnippets(familyDb, context, campusId);
}
export async function deleteSnippet(familyDb: D1Database, context: DataCoreAccessContext, snippetId: string) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumTalkSchema(familyDb);
  const row = await familyDb.prepare("SELECT campus_id, owner_user_id FROM family_staff_snippets WHERE id = ?").bind(snippetId).first<{ campus_id: string; owner_user_id: string | null }>();
  if (!row) throw new DataCoreAccessError(404, "글을 찾을 수 없습니다.");
  requireCampusStaff(context, row.campus_id);
  if (!isManager(context, row.campus_id) && row.owner_user_id !== context.user?.internalUserId) throw new DataCoreAccessError(403, "직접 저장한 글만 지울 수 있습니다.");
  await familyDb.prepare("DELETE FROM family_staff_snippets WHERE id = ?").bind(snippetId).run();
  return listSnippets(familyDb, context, row.campus_id);
}

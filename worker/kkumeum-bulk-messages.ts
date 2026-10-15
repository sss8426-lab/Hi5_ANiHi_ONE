import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { requireKkumeumStudentAccess } from "./kkumeum-core";
import { dispatchGuardianAnnouncementPush, type KkumeumPushEnv } from "./kkumeum-push";
import { createStaffAnnouncementDraft, publishStaffAnnouncement } from "./kkumeum-staff-announcements";

// 꿈이음 4단계: 개인별 일괄 전송.
// 글 하나에 %이름% · %값%을 넣고 학생마다 값을 적으면, 학생마다 따로 채운 아이소식(child-message)을 만들어 바로 보낸다.
// 예: "%이름% 학생의 이번 달 실기 점수는 %값%점입니다." 각 소식은 그 학생 보호자에게만 보인다.
// 대상 권한은 기존 아이소식 규칙(선생님은 담당 반 학생만)을 그대로 쓴다.

const MAX_ROWS = 100;
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
export const fillTemplate = (template: string, name: string, value: string) => template.replace(/%이름%/g, name).replace(/%값%/g, value);

export async function sendBulkMessages(familyDb: D1Database, context: DataCoreAccessContext, env: KkumeumPushEnv, campusId: string, input: Record<string, unknown>) {
  requireAuthenticatedAccess(context);
  const title = clean(input.title, 160), body = clean(input.body, 5900);
  if (!title || !body) throw new DataCoreAccessError(400, "제목과 내용을 입력해 주세요.");
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new DataCoreAccessError(400, "보낼 학생을 골라 주세요.");
  if (rows.length > MAX_ROWS) throw new DataCoreAccessError(400, `한 번에 ${MAX_ROWS}명까지 보낼 수 있습니다.`);
  const usesValue = /%값%/.test(title + body);
  const seen = new Set<string>();
  const items: { studentId: string; value: string }[] = [];
  for (const raw of rows) {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const studentId = clean(row.studentId, 120), value = clean(row.value, 200);
    if (!studentId || seen.has(studentId)) continue;
    if (usesValue && !value) throw new DataCoreAccessError(400, "%값%을 쓴 글은 학생마다 값을 모두 입력해 주세요.");
    seen.add(studentId); items.push({ studentId, value });
  }
  const names = new Map<string, string>();
  for (let i = 0; i < items.length; i += 90) {
    const chunk = items.slice(i, i + 90).map((r) => r.studentId);
    const found = (await familyDb.prepare(`SELECT id, COALESCE(display_name, name) AS name FROM family_students WHERE campus_id = ? AND id IN (${chunk.map(() => "?").join(",")})`)
      .bind(campusId, ...chunk).all<{ id: string; name: string }>()).results || [];
    found.forEach((r) => names.set(r.id, r.name));
  }
  if (names.size !== items.length) throw new DataCoreAccessError(400, "이 캠퍼스 학생만 고를 수 있습니다.");
  // 하나라도 권한이 없으면 아무것도 보내지 않는다.
  for (const item of items) await requireKkumeumStudentAccess(familyDb, context, campusId, item.studentId);
  const sent: { studentId: string; announcementId: string; push: { sent: number } }[] = [];
  for (const item of items) {
    const name = names.get(item.studentId) || "";
    const draft = await createStaffAnnouncementDraft(familyDb, context, {
      campusId, announcementType: "child-message", title: fillTemplate(title, name, item.value).slice(0, 160),
      body: fillTemplate(body, name, item.value).slice(0, 6000), targets: [{ targetType: "student", targetId: item.studentId }],
    });
    await publishStaffAnnouncement(familyDb, context, draft.id);
    const push = await dispatchGuardianAnnouncementPush(familyDb, env, draft.id);
    sent.push({ studentId: item.studentId, announcementId: draft.id, push: { sent: push.sent } });
  }
  return { count: sent.length, sent };
}

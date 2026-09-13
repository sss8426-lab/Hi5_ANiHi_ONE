import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKkumeumAnnouncementSchema } from "./kkumeum-announcements";
import {
  requireKkumeumClassAccess,
  requireKkumeumStudentAccess,
} from "./kkumeum-core";

const ANNOUNCEMENT_TYPES = new Set([
  "child-message",
  "class-news",
  "campus-news",
  "organization-notice",
  "selected-delivery",
]);
const TARGET_TYPES = new Set(["organization", "campus", "class", "student", "guardian"]);

type NoticeTarget = {
  targetType: string;
  targetId: string | null;
};

type NoticeInput = {
  campusId?: unknown;
  announcementType?: unknown;
  title?: unknown;
  body?: unknown;
  targets?: unknown;
};

type NoticeRow = {
  id: string;
  campus_id: string | null;
  author_user_id: string;
  announcement_type: string;
  title: string;
  body: string;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown, max = 240): string {
  return String(value ?? "").trim().slice(0, max);
}

function actorId(context: DataCoreAccessContext): string {
  requireAuthenticatedAccess(context);
  if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  return context.user.internalUserId;
}

function hasCampusRole(context: DataCoreAccessContext, campusId: string, role: string): boolean {
  return context.memberships.some(
    (membership) => membership.campusId === campusId && (membership.role === role || (role === "CAMPUS_DIRECTOR" && membership.role === "CAMPUS_ADMIN")),
  );
}

export async function ensureKkumeumStaffAnnouncementSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumAnnouncementSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_staff_notice_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL,
      staff_user_id TEXT NOT NULL,
      can_publish_campus INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(campus_id, staff_user_id)
    )`),
    familyDb.prepare(
      "CREATE INDEX IF NOT EXISTS family_staff_notice_permissions_staff_idx ON family_staff_notice_permissions(staff_user_id, campus_id)",
    ),
  ]);
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  action: string,
  announcementId: string,
  campusId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await familyDb.prepare(
    `INSERT INTO family_audit_logs (
       id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
     ) VALUES (?, ?, 'staff', ?, ?, 'announcement', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    campusId,
    actorId(context),
    action,
    announcementId,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ).run();
}

async function staffCampusPermission(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
): Promise<boolean> {
  if (!hasCampusRole(context, campusId, "STAFF")) return false;
  const permission = await familyDb.prepare(
    `SELECT can_publish_campus
     FROM family_staff_notice_permissions
     WHERE campus_id = ? AND staff_user_id = ?
     LIMIT 1`,
  ).bind(campusId, actorId(context)).first<{ can_publish_campus: number }>();
  return Boolean(permission?.can_publish_campus);
}

async function canPublishCampus(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
): Promise<boolean> {
  if (context.isSuperAdmin) return true;
  if (!context.campusIds.includes(campusId)) return false;
  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return true;
  return staffCampusPermission(familyDb, context, campusId);
}

export async function staffAnnouncementCapabilities(familyDb: D1Database, context: DataCoreAccessContext, campusId: string) {
  await ensureKkumeumStaffAnnouncementSchema(familyDb);
  actorId(context);
  if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) throw new DataCoreAccessError(403, "해당 캠퍼스 접근 권한이 없습니다.");
  return { canPublishCampus: await canPublishCampus(familyDb, context, campusId) };
}

function normalizeTargets(value: unknown): NoticeTarget[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DataCoreAccessError(400, "소식 전달 대상을 하나 이상 선택해야 합니다.");
  }
  if (value.length > 200) throw new DataCoreAccessError(400, "한 번에 선택할 수 있는 전달 대상이 너무 많습니다.");
  const seen = new Set<string>();
  const targets: NoticeTarget[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new DataCoreAccessError(400, "전달 대상 형식이 올바르지 않습니다.");
    const row = raw as Record<string, unknown>;
    const targetType = text(row.targetType, 40);
    const targetId = text(row.targetId, 120) || null;
    if (!TARGET_TYPES.has(targetType)) throw new DataCoreAccessError(400, "지원하지 않는 전달 대상 유형입니다.");
    if (targetType !== "organization" && !targetId) {
      throw new DataCoreAccessError(400, "전달 대상 ID가 필요합니다.");
    }
    if (targetType === "organization" && targetId) {
      throw new DataCoreAccessError(400, "전체공지는 별도 대상 ID를 사용하지 않습니다.");
    }
    const key = `${targetType}:${targetId || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ targetType, targetId });
    }
  }
  return targets;
}

function assertTypeTargetCompatibility(announcementType: string, targets: NoticeTarget[]): void {
  const types = new Set(targets.map((target) => target.targetType));
  const allowed =
    announcementType === "organization-notice" ? new Set(["organization"])
      : announcementType === "campus-news" ? new Set(["campus"])
        : announcementType === "class-news" ? new Set(["class"])
          : announcementType === "child-message" ? new Set(["student", "guardian"])
            : new Set(["campus", "class", "student", "guardian"]);
  for (const type of types) {
    if (!allowed.has(type)) throw new DataCoreAccessError(400, "소식 유형과 전달 대상 유형이 맞지 않습니다.");
  }
}

async function targetCampus(
  familyDb: D1Database,
  target: NoticeTarget,
): Promise<string | null> {
  if (target.targetType === "organization") return null;
  if (target.targetType === "campus") return target.targetId;
  if (target.targetType === "class") {
    const row = await familyDb.prepare(
      "SELECT campus_id FROM family_classes WHERE id = ? AND active = 1 LIMIT 1",
    ).bind(target.targetId).first<{ campus_id: string }>();
    if (!row) throw new DataCoreAccessError(400, "전달할 반을 찾을 수 없습니다.");
    return row.campus_id;
  }
  if (target.targetType === "student") {
    const row = await familyDb.prepare(
      "SELECT campus_id FROM family_students WHERE id = ? AND status != 'deleted' LIMIT 1",
    ).bind(target.targetId).first<{ campus_id: string }>();
    if (!row) throw new DataCoreAccessError(400, "전달할 학생을 찾을 수 없습니다.");
    return row.campus_id;
  }
  return null;
}

async function requireGuardianTargetAccess(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  campusId: string | null,
): Promise<string> {
  if (context.isSuperAdmin) {
    const row = await familyDb.prepare(
      `SELECT s.campus_id
       FROM student_guardians sg
       JOIN family_students s ON s.id = sg.student_id
       WHERE sg.guardian_id = ?
       ${campusId ? "AND s.campus_id = ?" : ""}
       LIMIT 1`,
    ).bind(...(campusId ? [guardianId, campusId] : [guardianId])).first<{ campus_id: string }>();
    if (!row) throw new DataCoreAccessError(400, "연결된 보호자를 찾을 수 없습니다.");
    return row.campus_id;
  }
  if (!campusId || !context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스 보호자에게 전달할 권한이 없습니다.");
  }
  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) {
    const row = await familyDb.prepare(
      `SELECT s.campus_id
       FROM student_guardians sg
       JOIN family_students s ON s.id = sg.student_id
       WHERE sg.guardian_id = ? AND s.campus_id = ?
       LIMIT 1`,
    ).bind(guardianId, campusId).first<{ campus_id: string }>();
    if (!row) throw new DataCoreAccessError(403, "해당 캠퍼스에 연결된 보호자만 선택할 수 있습니다.");
    return row.campus_id;
  }
  if (hasCampusRole(context, campusId, "TEACHER")) {
    const row = await familyDb.prepare(
      `SELECT s.campus_id
       FROM student_guardians sg
       JOIN family_students s ON s.id = sg.student_id
       JOIN family_classes c ON c.id = s.current_class_id AND c.campus_id = s.campus_id
       JOIN class_staff_assignments a ON a.class_id = c.id
       WHERE sg.guardian_id = ?
         AND s.campus_id = ?
         AND a.staff_user_id = ?
         AND a.ended_at IS NULL
       LIMIT 1`,
    ).bind(guardianId, campusId, actorId(context)).first<{ campus_id: string }>();
    if (!row) throw new DataCoreAccessError(403, "배정된 학생의 보호자만 선택할 수 있습니다.");
    return row.campus_id;
  }
  throw new DataCoreAccessError(403, "보호자 개인 전달 권한이 없습니다.");
}

async function validateTargets(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string | null,
  announcementType: string,
  targets: NoticeTarget[],
): Promise<void> {
  assertTypeTargetCompatibility(announcementType, targets);
  for (const target of targets) {
    if (target.targetType === "organization") {
      if (!context.isSuperAdmin || campusId) {
        throw new DataCoreAccessError(403, "전체공지는 최고관리자만 발행할 수 있습니다.");
      }
      continue;
    }
    if (target.targetType === "guardian") {
      await requireGuardianTargetAccess(familyDb, context, String(target.targetId), campusId);
      continue;
    }
    const resolvedCampusId = await targetCampus(familyDb, target);
    if (!resolvedCampusId) throw new DataCoreAccessError(400, "전달 대상 캠퍼스를 확인할 수 없습니다.");
    if (campusId && campusId !== resolvedCampusId) {
      throw new DataCoreAccessError(403, "다른 캠퍼스 전달 대상을 함께 선택할 수 없습니다.");
    }
    if (target.targetType === "campus") {
      if (!(await canPublishCampus(familyDb, context, resolvedCampusId))) {
        throw new DataCoreAccessError(403, "캠퍼스 전체 공지를 발행할 권한이 없습니다.");
      }
      continue;
    }
    if (target.targetType === "class") {
      await requireKkumeumClassAccess(familyDb, context, resolvedCampusId, String(target.targetId));
      continue;
    }
    if (target.targetType === "student") {
      await requireKkumeumStudentAccess(familyDb, context, resolvedCampusId, String(target.targetId));
    }
  }
}

function parseInput(input: NoticeInput, fallback?: NoticeRow & { targets: NoticeTarget[] }) {
  const campusValue = input.campusId === undefined ? fallback?.campus_id : text(input.campusId, 120) || null;
  const announcementType = input.announcementType === undefined
    ? fallback?.announcement_type || ""
    : text(input.announcementType, 60);
  const title = input.title === undefined ? fallback?.title || "" : text(input.title, 160);
  const body = input.body === undefined ? fallback?.body || "" : text(input.body, 6000);
  const targets = input.targets === undefined
    ? fallback?.targets || []
    : normalizeTargets(input.targets);
  if (!ANNOUNCEMENT_TYPES.has(announcementType)) throw new DataCoreAccessError(400, "지원하지 않는 소식 유형입니다.");
  if (!title) throw new DataCoreAccessError(400, "소식 제목이 필요합니다.");
  if (!body) throw new DataCoreAccessError(400, "소식 내용이 필요합니다.");
  if (!targets.length) throw new DataCoreAccessError(400, "소식 전달 대상을 하나 이상 선택해야 합니다.");
  if (announcementType === "organization-notice" && campusValue) {
    throw new DataCoreAccessError(400, "전체공지는 campusId를 지정하지 않습니다.");
  }
  if (announcementType !== "organization-notice" && !campusValue && !fallback) {
    // SUPER_ADMIN selected-delivery may intentionally span campuses.
    const onlySelected = announcementType === "selected-delivery";
    if (!onlySelected) throw new DataCoreAccessError(400, "campusId가 필요합니다.");
  }
  return { campusId: campusValue || null, announcementType, title, body, targets };
}

async function loadDraft(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  announcementId: string,
): Promise<NoticeRow & { targets: NoticeTarget[] }> {
  await ensureKkumeumStaffAnnouncementSchema(familyDb);
  const row = await familyDb.prepare(
    `SELECT * FROM announcements WHERE id = ? LIMIT 1`,
  ).bind(announcementId).first<NoticeRow>();
  if (!row) throw new DataCoreAccessError(404, "소식을 찾을 수 없습니다.");
  if (!context.isSuperAdmin && row.author_user_id !== actorId(context)) {
    throw new DataCoreAccessError(403, "본인이 작성한 소식만 수정하거나 발행할 수 있습니다.");
  }
  if (row.status !== "draft") throw new DataCoreAccessError(409, "임시저장 상태의 소식만 수정하거나 발행할 수 있습니다.");
  const result = await familyDb.prepare(
    `SELECT target_type, target_id FROM announcement_targets WHERE announcement_id = ? ORDER BY created_at, id`,
  ).bind(announcementId).all<{ target_type: string; target_id: string | null }>();
  return {
    ...row,
    targets: (result.results || []).map((target) => ({ targetType: target.target_type, targetId: target.target_id })),
  };
}

export async function createStaffAnnouncementDraft(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  rawInput: NoticeInput,
) {
  await ensureKkumeumStaffAnnouncementSchema(familyDb);
  const input = parseInput(rawInput);
  await validateTargets(familyDb, context, input.campusId, input.announcementType, input.targets);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    familyDb.prepare(
      `INSERT INTO announcements (
         id, campus_id, author_user_id, announcement_type, title, body,
         status, published_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`,
    ).bind(id, input.campusId, actorId(context), input.announcementType, input.title, input.body, now, now),
    ...input.targets.map((target) => familyDb.prepare(
      `INSERT INTO announcement_targets (id, announcement_id, target_type, target_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, target.targetType, target.targetId, now)),
  ];
  await familyDb.batch(statements);
  await audit(familyDb, context, "announcement.create", id, input.campusId, {
    announcementType: input.announcementType,
    targetCount: input.targets.length,
    status: "draft",
  });
  return { id, campusId: input.campusId, announcementType: input.announcementType, title: input.title, status: "draft", targetCount: input.targets.length, createdAt: now };
}

export async function updateStaffAnnouncementDraft(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  announcementId: string,
  rawInput: NoticeInput,
) {
  const existing = await loadDraft(familyDb, context, announcementId);
  const input = parseInput(rawInput, existing);
  await validateTargets(familyDb, context, input.campusId, input.announcementType, input.targets);
  const now = new Date().toISOString();
  await familyDb.batch([
    familyDb.prepare(
      `UPDATE announcements
       SET campus_id = ?, announcement_type = ?, title = ?, body = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    ).bind(input.campusId, input.announcementType, input.title, input.body, now, announcementId),
    familyDb.prepare("DELETE FROM announcement_targets WHERE announcement_id = ?").bind(announcementId),
    ...input.targets.map((target) => familyDb.prepare(
      `INSERT INTO announcement_targets (id, announcement_id, target_type, target_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), announcementId, target.targetType, target.targetId, now)),
  ]);
  await audit(familyDb, context, "announcement.update", announcementId, input.campusId, {
    announcementType: input.announcementType,
    targetCount: input.targets.length,
    status: "draft",
  });
  return { id: announcementId, campusId: input.campusId, announcementType: input.announcementType, title: input.title, status: "draft", targetCount: input.targets.length, updatedAt: now };
}

export async function publishStaffAnnouncement(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  announcementId: string,
) {
  const existing = await loadDraft(familyDb, context, announcementId);
  await validateTargets(
    familyDb,
    context,
    existing.campus_id,
    existing.announcement_type,
    existing.targets,
  );
  const publishedAt = new Date().toISOString();
  const published = await familyDb.prepare(
    `UPDATE announcements SET status = 'published', published_at = ?, updated_at = ?
     WHERE id = ? AND status = 'draft'`,
  ).bind(publishedAt, publishedAt, announcementId).run();
  // Only the request that changed the draft may dispatch the notification.
  if (Number(published.meta?.changes || 0) !== 1) {
    throw new DataCoreAccessError(409, "이미 발행되었거나 상태가 변경된 소식입니다.");
  }
  await audit(familyDb, context, "announcement.publish", announcementId, existing.campus_id, {
    announcementType: existing.announcement_type,
    targetCount: existing.targets.length,
    status: "published",
  });
  return { id: announcementId, status: "published", publishedAt };
}

export async function listStaffAnnouncements(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId?: string | null,
) {
  await ensureKkumeumStaffAnnouncementSchema(familyDb);
  requireAuthenticatedAccess(context);
  const bindings: unknown[] = [];
  const conditions: string[] = ["a.status != 'archived'"];
  if (!context.isSuperAdmin && !context.memberships.length) throw new DataCoreAccessError(403, "조직 소식 접근 권한이 없습니다.");
  if (!context.isSuperAdmin && !campusId) {
    conditions.push(`(a.campus_id IN (${context.campusIds.map(() => "?").join(",") || "NULL"}) OR (a.campus_id IS NULL AND a.announcement_type = 'organization-notice' AND a.status = 'published'))`);
    bindings.push(...context.campusIds);
  }
  if (campusId) {
    if (!context.isSuperAdmin && !context.campusIds.includes(campusId)) {
      throw new DataCoreAccessError(403, "해당 캠퍼스 소식을 확인할 권한이 없습니다.");
    }
    conditions.push(`(a.campus_id = ? OR (a.campus_id IS NULL AND a.announcement_type = 'organization-notice' ${context.isSuperAdmin ? "" : "AND a.status = 'published'"}))`);
    bindings.push(campusId);
  }
  if (!context.isSuperAdmin) {
    const directorCampuses = context.memberships
      .filter((membership) => ['CAMPUS_DIRECTOR', 'CAMPUS_ADMIN'].includes(membership.role) && membership.campusId)
      .map((membership) => String(membership.campusId));
    if (directorCampuses.length && campusId && directorCampuses.includes(campusId)) {
      // Directors may see notices for their selected campus.
    } else {
      conditions.push("(a.author_user_id = ? OR (a.campus_id IS NULL AND a.announcement_type = 'organization-notice' AND a.status = 'published'))");
      bindings.push(actorId(context));
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await familyDb.prepare(
    `SELECT a.id, a.campus_id, a.announcement_type, a.title, a.status,
            a.published_at, a.created_at, a.updated_at,
            COUNT(t.id) AS target_count,
            (SELECT json_group_array(json_object('targetType', nt.target_type, 'targetId', nt.target_id)) FROM announcement_targets nt WHERE nt.announcement_id = a.id) AS targets_json,
            (SELECT COUNT(*) FROM read_receipts r WHERE r.resource_type = 'announcement' AND r.resource_id = a.id) AS read_count
     FROM announcements a
     LEFT JOIN announcement_targets t ON t.announcement_id = a.id
     ${where}
     GROUP BY a.id
     ORDER BY a.updated_at DESC
     LIMIT 100`,
  ).bind(...bindings).all<{
    id: string;
    campus_id: string | null;
    announcement_type: string;
    title: string;
    status: string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    target_count: number;
    targets_json: string;
    read_count: number;
  }>();
  const notices = (result.results || []).map((row) => ({
    id: row.id,
    campusId: row.campus_id,
    announcementType: row.announcement_type,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetCount: Number(row.target_count || 0),
    targets: JSON.parse(row.targets_json || "[]") as NoticeTarget[],
    readCount: Number(row.read_count || 0),
  }));
  if (context.isSuperAdmin) return notices;
  // Reuse current target checks after class assignments change, including list metadata.
  const checks = new Map<string, Promise<void>>();
  const visible = [];
  for (const notice of notices) {
    if ((!notice.campusId && notice.announcementType === "organization-notice" && notice.status === "published")
      || (notice.campusId && hasCampusRole(context, notice.campusId, "CAMPUS_DIRECTOR"))) {
      visible.push(notice);
      continue;
    }
    try {
      for (const target of notice.targets) {
        const key = JSON.stringify([notice.campusId, notice.announcementType, target.targetType, target.targetId]);
        let check = checks.get(key);
        if (!check) {
          check = validateTargets(familyDb, context, notice.campusId, notice.announcementType, [target]);
          checks.set(key, check);
        }
        await check;
      }
      visible.push(notice);
    } catch (error) {
      if (!(error instanceof DataCoreAccessError) || ![400, 403, 404].includes(error.status)) throw error;
    }
  }
  return visible;
}

// Detail uses the same author/campus boundary as the staff list, without its 100-row limit.
export async function getStaffAnnouncement(familyDb: D1Database, context: DataCoreAccessContext, id: string) {
  await ensureKkumeumStaffAnnouncementSchema(familyDb);
  const actor = actorId(context);
  const row = await familyDb.prepare("SELECT * FROM announcements WHERE id = ? AND status != 'archived'")
    .bind(id).first<NoticeRow>();
  if (!row) throw new DataCoreAccessError(404, "소식을 찾을 수 없습니다.");
  const director = Boolean(row.campus_id && context.campusIds.includes(row.campus_id)
    && hasCampusRole(context, row.campus_id, "CAMPUS_DIRECTOR"));
  const publicOrganizationNotice = !row.campus_id && row.announcement_type === "organization-notice"
    && row.status === "published" && context.memberships.length > 0;
  if (!context.isSuperAdmin && !publicOrganizationNotice && (!row.campus_id || !context.campusIds.includes(row.campus_id)
    || (!director && row.author_user_id !== actor))) {
    throw new DataCoreAccessError(403, "이 소식을 볼 권한이 없습니다.");
  }
  const targets = await familyDb.prepare("SELECT target_type AS targetType, target_id AS targetId FROM announcement_targets WHERE announcement_id = ? ORDER BY created_at, id")
    .bind(id).all<NoticeTarget>();
  if (!context.isSuperAdmin && !director && !publicOrganizationNotice) {
    await validateTargets(familyDb, context, row.campus_id, row.announcement_type, targets.results || []);
  }
  const receipt = await familyDb.prepare("SELECT COUNT(*) AS count FROM read_receipts WHERE resource_type = 'announcement' AND resource_id = ?")
    .bind(id).first<{ count: number }>();
  return { id: row.id, campusId: row.campus_id, announcementType: row.announcement_type,
    title: row.title, body: row.body, status: row.status, publishedAt: row.published_at,
    createdAt: row.created_at, updatedAt: row.updated_at, targets: targets.results || [],
    readCount: Number(receipt?.count || 0),
    canEdit: row.status === "draft" && (context.isSuperAdmin || row.author_user_id === actor) };
}

export async function archiveStaffAnnouncement(familyDb: D1Database, context: DataCoreAccessContext, id: string) {
  const notice = await getStaffAnnouncement(familyDb, context, id);
  if (!notice.canEdit) throw new DataCoreAccessError(403, "본인의 임시저장 소식만 삭제할 수 있습니다.");
  const result = await familyDb.prepare("UPDATE announcements SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(new Date().toISOString(), id).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new DataCoreAccessError(409, "소식 상태가 변경되었습니다.");
  await audit(familyDb, context, "announcement.archive", id, notice.campusId, { status: "archived" });
  return { id, status: "archived" };
}

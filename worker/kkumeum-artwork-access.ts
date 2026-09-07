import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";

function hasCampusRole(
  context: DataCoreAccessContext,
  campusId: string,
  role: string,
): boolean {
  return context.memberships.some(
    (membership) => membership.campusId === campusId && membership.role === role,
  );
}

function normalizedId(value: unknown, field: string): string {
  const id = String(value ?? "").trim().slice(0, 120);
  if (!id) throw new DataCoreAccessError(400, `${field}가 필요합니다.`);
  return id;
}

export async function requireKkumeumArtworkManageAccess(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusIdInput: unknown,
  studentIdInput: unknown,
): Promise<void> {
  requireAuthenticatedAccess(context);
  const campusId = normalizedId(campusIdInput, "campusId");
  const studentId = normalizedId(studentIdInput, "studentId");
  if (context.isSuperAdmin) return;

  if (!context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스의 작품을 관리할 권한이 없습니다.");
  }

  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return;

  if (hasCampusRole(context, campusId, "TEACHER")) {
    if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
    await ensureKkumeumPhase1Schema(familyDb);
    const row = await familyDb
      .prepare(
        `SELECT a.id
         FROM family_students s
         JOIN family_classes c
           ON c.id = s.current_class_id
          AND c.campus_id = s.campus_id
         JOIN class_staff_assignments a
           ON a.class_id = c.id
         WHERE s.id = ?
           AND s.campus_id = ?
           AND c.campus_id = ?
           AND a.staff_user_id = ?
           AND a.ended_at IS NULL
           AND a.can_manage_artworks = 1
         LIMIT 1`,
      )
      .bind(studentId, campusId, campusId, context.user.internalUserId)
      .first<{ id: string }>();
    if (row) return;
    throw new DataCoreAccessError(403, "이 반의 학생작품 관리 권한이 없습니다.");
  }

  throw new DataCoreAccessError(403, "학생작품을 관리할 권한이 없습니다.");
}

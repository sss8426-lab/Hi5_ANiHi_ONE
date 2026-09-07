import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";

function hasCampusRole(
  context: DataCoreAccessContext,
  campusId: string,
  role: string,
): boolean {
  return context.memberships.some(
    (membership) => membership.campusId === campusId && membership.role === role,
  );
}

/**
 * Read access and edit access are intentionally different in 꿈이음.
 * A teacher may see an assigned student while report editing is disabled for
 * that assignment. Mutating/generating/sending reports must honor the
 * explicit can_edit_reports flag instead of relying on assignment existence.
 */
export async function requireKkumeumReportEditAccess(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
): Promise<void> {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;

  if (!context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스의 월간평가를 수정할 권한이 없습니다.");
  }

  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return;

  if (hasCampusRole(context, campusId, "TEACHER")) {
    if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
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
           AND a.can_edit_reports = 1
         LIMIT 1`,
      )
      .bind(studentId, campusId, campusId, context.user.internalUserId)
      .first<{ id: string }>();
    if (row) return;
    throw new DataCoreAccessError(403, "이 반의 월간평가 편집 권한이 없습니다.");
  }

  throw new DataCoreAccessError(403, "월간평가를 수정할 권한이 없습니다.");
}

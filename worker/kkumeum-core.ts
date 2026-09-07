import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
  requireCampusAccess,
} from "./data-core-access";

export type KkumeumBindings = {
  FAMILY_DB?: D1Database;
  FAMILY_FILES?: R2Bucket;
};

export type KkumeumBindingStatus = {
  ok: boolean;
  database: boolean;
  files: boolean;
  mode: "ready" | "setup-required";
};

export function kkumeumBindingStatus(
  context: DataCoreAccessContext,
  bindings: KkumeumBindings,
): KkumeumBindingStatus {
  requireAuthenticatedAccess(context);
  const database = Boolean(bindings.FAMILY_DB);
  const files = Boolean(bindings.FAMILY_FILES);
  return {
    ok: database && files,
    database,
    files,
    mode: database && files ? "ready" : "setup-required",
  };
}

export function requireFamilyDatabase(
  context: DataCoreAccessContext,
  familyDb?: D1Database,
): D1Database {
  requireAuthenticatedAccess(context);
  if (!familyDb) {
    throw new DataCoreAccessError(
      503,
      "꿈이음 FAMILY_DB가 아직 연결되지 않았습니다. 학생·보호자 데이터는 다른 DB에 대신 저장하지 않습니다.",
    );
  }
  return familyDb;
}

export function requireFamilyFiles(
  context: DataCoreAccessContext,
  familyFiles?: R2Bucket,
): R2Bucket {
  requireAuthenticatedAccess(context);
  if (!familyFiles) {
    throw new DataCoreAccessError(
      503,
      "꿈이음 FAMILY_FILES가 아직 연결되지 않았습니다. 학생 작품은 일반 DATA CORE R2에 대신 저장하지 않습니다.",
    );
  }
  return familyFiles;
}

export function requireKkumeumCampusAccess(
  context: DataCoreAccessContext,
  campusId: string | null | undefined,
): void {
  requireCampusAccess(context, campusId);
}

function hasCampusRole(
  context: DataCoreAccessContext,
  campusId: string,
  role: string,
): boolean {
  return context.memberships.some(
    (membership) => membership.campusId === campusId && membership.role === role,
  );
}

export async function requireKkumeumStudentAccess(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
): Promise<void> {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;

  if (!context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스의 꿈이음 데이터에 접근할 권한이 없습니다.");
  }

  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return;

  if (hasCampusRole(context, campusId, "TEACHER")) {
    if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
    const row = await familyDb
      .prepare(
        `SELECT s.id
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
         LIMIT 1`,
      )
      .bind(studentId, campusId, campusId, context.user.internalUserId)
      .first<{ id: string }>();
    if (row) return;
    throw new DataCoreAccessError(403, "배정된 반의 학생만 확인할 수 있습니다.");
  }

  throw new DataCoreAccessError(403, "학생 개인정보를 확인할 권한이 없습니다.");
}

export async function requireKkumeumClassAccess(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  classId: string,
): Promise<void> {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;

  if (!context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스의 꿈이음 데이터에 접근할 권한이 없습니다.");
  }

  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return;

  if (hasCampusRole(context, campusId, "TEACHER")) {
    if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
    const assignment = await familyDb
      .prepare(
        `SELECT a.id
         FROM class_staff_assignments a
         JOIN family_classes c
           ON c.id = a.class_id
         WHERE a.class_id = ?
           AND c.campus_id = ?
           AND a.staff_user_id = ?
           AND a.ended_at IS NULL
         LIMIT 1`,
      )
      .bind(classId, campusId, context.user.internalUserId)
      .first<{ id: string }>();
    if (assignment) return;
    throw new DataCoreAccessError(403, "배정된 반만 확인할 수 있습니다.");
  }

  throw new DataCoreAccessError(403, "반 학생 개인정보를 확인할 권한이 없습니다.");
}

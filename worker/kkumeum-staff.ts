import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import {
  requireKkumeumClassAccess,
  requireKkumeumStudentAccess,
} from "./kkumeum-core";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";

const STUDENT_STATUSES = new Set(["active", "leave", "moved", "graduated"]);

function cleanText(value: unknown, maxLength = 160): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanNullableText(value: unknown, maxLength = 160): string | null {
  const text = cleanText(value, maxLength);
  return text || null;
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
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

function requireCampusManager(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  if (hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) return;
  throw new DataCoreAccessError(403, "꿈이음 반·학생 기본정보를 관리할 권한이 없습니다.");
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: unknown = {},
): Promise<void> {
  await familyDb
    .prepare(
      `INSERT INTO family_audit_logs (
         id, campus_id, actor_type, actor_id, action,
         resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      campusId,
      context.user?.internalUserId || null,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata ?? {}),
      new Date().toISOString(),
    )
    .run();
}

async function requireClassInCampus(
  familyDb: D1Database,
  campusId: string,
  classId: string,
): Promise<void> {
  const row = await familyDb
    .prepare(
      `SELECT id FROM family_classes
       WHERE id = ? AND campus_id = ? AND active = 1
       LIMIT 1`,
    )
    .bind(classId, campusId)
    .first<{ id: string }>();
  if (!row) throw new DataCoreAccessError(400, "선택한 캠퍼스의 활성 반을 찾을 수 없습니다.");
}

export async function listKkumeumClasses(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumPhase1Schema(familyDb);

  if (context.isSuperAdmin || hasCampusRole(context, campusId, "CAMPUS_DIRECTOR") || hasCampusRole(context, campusId, "STAFF")) {
    const result = await familyDb
      .prepare(
        `SELECT id, campus_id, name, stage, sort_order, active, created_at, updated_at
         FROM family_classes
         WHERE campus_id = ?
         ORDER BY active DESC, sort_order ASC, name ASC`,
      )
      .bind(campusId)
      .all();
    return result.results || [];
  }

  if (hasCampusRole(context, campusId, "TEACHER")) {
    if (!context.user) throw new DataCoreAccessError(401, "로그인이 필요합니다.");
    const result = await familyDb
      .prepare(
        `SELECT DISTINCT c.id, c.campus_id, c.name, c.stage, c.sort_order, c.active, c.created_at, c.updated_at
         FROM family_classes c
         JOIN class_staff_assignments a ON a.class_id = c.id
         WHERE c.campus_id = ?
           AND c.active = 1
           AND a.staff_user_id = ?
           AND a.ended_at IS NULL
         ORDER BY c.sort_order ASC, c.name ASC`,
      )
      .bind(campusId, context.user.internalUserId)
      .all();
    return result.results || [];
  }

  throw new DataCoreAccessError(403, "꿈이음 반 목록을 볼 권한이 없습니다.");
}

export async function createKkumeumClass(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
) {
  await ensureKkumeumPhase1Schema(familyDb);
  const campusId = cleanText(input.campusId, 120);
  requireCampusManager(context, campusId);
  const name = cleanText(input.name, 120);
  if (!campusId || !name) throw new DataCoreAccessError(400, "캠퍼스와 반 이름이 필요합니다.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
  await familyDb
    .prepare(
      `INSERT INTO family_classes (
         id, campus_id, name, stage, sort_order, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, campusId, name, cleanNullableText(input.stage, 120), sortOrder, now, now)
    .run();
  await audit(familyDb, context, campusId, "class.create", "family_class", id, { name });
  return { id, campusId, name, stage: cleanNullableText(input.stage, 120), sortOrder, active: true, createdAt: now, updatedAt: now };
}

export async function updateKkumeumClass(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  classId: string,
  input: Record<string, unknown>,
) {
  await ensureKkumeumPhase1Schema(familyDb);
  const existing = await familyDb
    .prepare(`SELECT id, campus_id, name, stage, sort_order, active FROM family_classes WHERE id = ? LIMIT 1`)
    .bind(classId)
    .first<{ id: string; campus_id: string; name: string; stage: string | null; sort_order: number; active: number }>();
  if (!existing) throw new DataCoreAccessError(404, "반을 찾을 수 없습니다.");
  requireCampusManager(context, existing.campus_id);
  const name = input.name === undefined ? existing.name : cleanText(input.name, 120);
  if (!name) throw new DataCoreAccessError(400, "반 이름은 비워둘 수 없습니다.");
  const stage = input.stage === undefined ? existing.stage : cleanNullableText(input.stage, 120);
  const sortOrder = input.sortOrder === undefined ? existing.sort_order : Number(input.sortOrder) || 0;
  const active = input.active === undefined ? existing.active : input.active ? 1 : 0;
  const now = new Date().toISOString();
  await familyDb
    .prepare(`UPDATE family_classes SET name = ?, stage = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?`)
    .bind(name, stage, sortOrder, active, now, classId)
    .run();
  await audit(familyDb, context, existing.campus_id, "class.update", "family_class", classId, { name, active: Boolean(active) });
  return { id: classId, campusId: existing.campus_id, name, stage, sortOrder, active: Boolean(active), updatedAt: now };
}

export async function listKkumeumStudents(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  filters: { classId?: string; status?: string; q?: string } = {},
) {
  requireAuthenticatedAccess(context);
  await ensureKkumeumPhase1Schema(familyDb);
  const classId = cleanText(filters.classId, 120);
  const status = cleanText(filters.status, 40);
  const q = cleanText(filters.q, 120);
  if (status && !STUDENT_STATUSES.has(status)) throw new DataCoreAccessError(400, "학생 상태값이 올바르지 않습니다.");

  const conditions = ["s.campus_id = ?"];
  const bindings: unknown[] = [campusId];
  if (classId) {
    conditions.push("s.current_class_id = ?");
    bindings.push(classId);
  }
  if (status) {
    conditions.push("s.status = ?");
    bindings.push(status);
  }
  if (q) {
    conditions.push("(s.name LIKE ? OR s.display_name LIKE ? OR s.school_name LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    bindings.push(like, like, like);
  }

  let join = "LEFT JOIN family_classes c ON c.id = s.current_class_id AND c.campus_id = s.campus_id";
  if (!context.isSuperAdmin && !hasCampusRole(context, campusId, "CAMPUS_DIRECTOR")) {
    if (!hasCampusRole(context, campusId, "TEACHER") || !context.user) {
      throw new DataCoreAccessError(403, "학생 개인정보를 확인할 권한이 없습니다.");
    }
    join += " JOIN class_staff_assignments a ON a.class_id = c.id AND a.staff_user_id = ? AND a.ended_at IS NULL";
    bindings.unshift(context.user.internalUserId);
  }

  const result = await familyDb
    .prepare(
      `SELECT s.id, s.campus_id, s.name, s.display_name, s.birth_year, s.school_name,
              s.grade, s.status, s.current_class_id, c.name AS class_name,
              s.created_at, s.updated_at
       FROM family_students s
       ${join}
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.status = 'active' DESC, c.sort_order ASC, s.name ASC
       LIMIT 200`,
    )
    .bind(...bindings)
    .all();
  return result.results || [];
}

export async function getKkumeumStudent(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
) {
  await ensureKkumeumPhase1Schema(familyDb);
  await requireKkumeumStudentAccess(familyDb, context, campusId, studentId);
  const row = await familyDb
    .prepare(
      `SELECT s.id, s.campus_id, s.name, s.display_name, s.birth_year, s.school_name,
              s.grade, s.status, s.current_class_id, c.name AS class_name,
              s.created_at, s.updated_at
       FROM family_students s
       LEFT JOIN family_classes c ON c.id = s.current_class_id AND c.campus_id = s.campus_id
       WHERE s.id = ? AND s.campus_id = ?
       LIMIT 1`,
    )
    .bind(studentId, campusId)
    .first();
  if (!row) throw new DataCoreAccessError(404, "학생을 찾을 수 없습니다.");
  return row;
}

export async function createKkumeumStudent(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
) {
  await ensureKkumeumPhase1Schema(familyDb);
  const campusId = cleanText(input.campusId, 120);
  requireCampusManager(context, campusId);
  const name = cleanText(input.name, 100);
  if (!campusId || !name) throw new DataCoreAccessError(400, "캠퍼스와 학생 이름이 필요합니다.");
  const classId = cleanText(input.classId, 120) || null;
  if (classId) await requireClassInCampus(familyDb, campusId, classId);
  const status = cleanText(input.status || "active", 40);
  if (!STUDENT_STATUSES.has(status)) throw new DataCoreAccessError(400, "학생 상태값이 올바르지 않습니다.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const enrollmentId = classId ? crypto.randomUUID() : null;
  const studentStatement = familyDb
    .prepare(
      `INSERT INTO family_students (
         id, campus_id, name, display_name, birth_year, school_name, grade,
         status, current_class_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      campusId,
      name,
      cleanNullableText(input.displayName, 100),
      integerOrNull(input.birthYear),
      cleanNullableText(input.schoolName, 160),
      cleanNullableText(input.grade, 40),
      status,
      classId,
      now,
      now,
    );
  const statements = [studentStatement];
  if (classId && enrollmentId) {
    statements.push(
      familyDb
        .prepare(`INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(enrollmentId, id, classId, now, now),
    );
  }
  statements.push(
    familyDb
      .prepare(
        `INSERT INTO family_audit_logs (
           id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
         ) VALUES (?, ?, 'staff', ?, 'student.create', 'family_student', ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), campusId, context.user?.internalUserId || null, id, JSON.stringify({ classId }), now),
  );
  await familyDb.batch(statements);
  return { id, campusId, name, displayName: cleanNullableText(input.displayName, 100), schoolName: cleanNullableText(input.schoolName, 160), grade: cleanNullableText(input.grade, 40), status, currentClassId: classId, createdAt: now, updatedAt: now };
}

export async function updateKkumeumStudent(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  studentId: string,
  input: Record<string, unknown>,
) {
  await ensureKkumeumPhase1Schema(familyDb);
  const existing = await familyDb
    .prepare(`SELECT * FROM family_students WHERE id = ? LIMIT 1`)
    .bind(studentId)
    .first<Record<string, unknown>>();
  if (!existing) throw new DataCoreAccessError(404, "학생을 찾을 수 없습니다.");
  const campusId = String(existing.campus_id);
  requireCampusManager(context, campusId);
  const name = input.name === undefined ? String(existing.name) : cleanText(input.name, 100);
  if (!name) throw new DataCoreAccessError(400, "학생 이름은 비워둘 수 없습니다.");
  const status = input.status === undefined ? String(existing.status) : cleanText(input.status, 40);
  if (!STUDENT_STATUSES.has(status)) throw new DataCoreAccessError(400, "학생 상태값이 올바르지 않습니다.");
  const classId = input.classId === undefined ? (existing.current_class_id ? String(existing.current_class_id) : null) : (cleanText(input.classId, 120) || null);
  if (classId) await requireClassInCampus(familyDb, campusId, classId);
  const oldClassId = existing.current_class_id ? String(existing.current_class_id) : null;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    familyDb
      .prepare(
        `UPDATE family_students
         SET name = ?, display_name = ?, birth_year = ?, school_name = ?, grade = ?, status = ?, current_class_id = ?, updated_at = ?
         WHERE id = ? AND campus_id = ?`,
      )
      .bind(
        name,
        input.displayName === undefined ? existing.display_name ?? null : cleanNullableText(input.displayName, 100),
        input.birthYear === undefined ? existing.birth_year ?? null : integerOrNull(input.birthYear),
        input.schoolName === undefined ? existing.school_name ?? null : cleanNullableText(input.schoolName, 160),
        input.grade === undefined ? existing.grade ?? null : cleanNullableText(input.grade, 40),
        status,
        classId,
        now,
        studentId,
        campusId,
      ),
  ];
  if (classId !== oldClassId) {
    statements.push(
      familyDb
        .prepare(`UPDATE class_enrollments SET ended_at = ? WHERE student_id = ? AND ended_at IS NULL`)
        .bind(now, studentId),
    );
    if (classId) {
      statements.push(
        familyDb
          .prepare(`INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), studentId, classId, now, now),
      );
    }
  }
  statements.push(
    familyDb
      .prepare(
        `INSERT INTO family_audit_logs (
           id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
         ) VALUES (?, ?, 'staff', ?, 'student.update', 'family_student', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        campusId,
        context.user?.internalUserId || null,
        studentId,
        JSON.stringify({ oldClassId, classId, status }),
        now,
      ),
  );
  await familyDb.batch(statements);
  return { id: studentId, campusId, name, status, currentClassId: classId, updatedAt: now };
}

export async function requireKkumeumClassForRead(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  classId: string,
): Promise<void> {
  await ensureKkumeumPhase1Schema(familyDb);
  await requireKkumeumClassAccess(familyDb, context, campusId, classId);
}

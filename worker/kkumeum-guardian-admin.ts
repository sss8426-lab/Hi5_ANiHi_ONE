import { DataCoreAccessContext, DataCoreAccessError, requireAuthenticatedAccess } from "./data-core-access";
import { createKkumeumGuardianPasswordRecord, ensureKkumeumGuardianAuthSchema } from "./kkumeum-guardian-auth";

function text(value: unknown, maximum = 160): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function manager(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  if (context.memberships.some((membership) => membership.campusId === campusId && membership.role === "CAMPUS_DIRECTOR")) return;
  throw new DataCoreAccessError(403, "보호자 연결 정보는 최고관리자 또는 해당 캠퍼스 원장만 관리할 수 있습니다.");
}

async function studentInCampus(familyDb: D1Database, campusId: string, studentId: string): Promise<void> {
  const student = await familyDb.prepare(
    "SELECT id FROM family_students WHERE id = ? AND campus_id = ? LIMIT 1",
  ).bind(studentId, campusId).first<{ id: string }>();
  if (!student) throw new DataCoreAccessError(404, "해당 캠퍼스의 학생을 찾을 수 없습니다.");
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  action: string,
  guardianId: string,
  studentId: string,
): Promise<void> {
  await familyDb.prepare(
    `INSERT INTO family_audit_logs (
       id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
     ) VALUES (?, ?, 'staff', ?, ?, 'guardian', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), campusId, context.user?.internalUserId || null, action, guardianId,
    JSON.stringify({ studentId }), new Date().toISOString(),
  ).run();
}

function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[value % 56]).join("");
}

export async function listKkumeumGuardians(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  studentId: string,
) {
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  const result = await familyDb.prepare(
    `SELECT g.id, g.login_id, g.display_name, g.status, g.must_change_password,
            sg.relationship_label, sg.can_view_reports, sg.can_view_photos, sg.created_at
     FROM student_guardians sg
     JOIN family_guardians g ON g.id = sg.guardian_id
     WHERE sg.student_id = ?
     ORDER BY sg.created_at ASC`,
  ).bind(studentId).all();
  return (result.results || []).map((row) => ({
    id: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    relationshipLabel: row.relationship_label || "",
    canViewReports: Boolean(row.can_view_reports),
    canViewPhotos: Boolean(row.can_view_photos),
    linkedAt: row.created_at,
  }));
}

export async function createKkumeumGuardian(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  const displayName = text(input.displayName, 100);
  const loginId = text(input.loginId, 120).toLowerCase();
  if (!campusId || !studentId || !displayName || !loginId) throw new DataCoreAccessError(400, "캠퍼스, 학생, 보호자 표시 이름, 로그인 ID가 필요합니다.");
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(loginId)) throw new DataCoreAccessError(400, "로그인 ID는 영문 소문자, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.");
  const id = crypto.randomUUID();
  const password = temporaryPassword();
  const passwordRecord = await createKkumeumGuardianPasswordRecord(password);
  const now = new Date().toISOString();
  try {
    await familyDb.batch([
      familyDb.prepare(
        `INSERT INTO family_guardians (
           id, login_id, display_name, status, password_hash, password_salt, password_iterations,
           must_change_password, failed_login_count, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', ?, ?, ?, 1, 0, ?, ?)`,
      ).bind(id, loginId, displayName, passwordRecord.passwordHash, passwordRecord.passwordSalt, passwordRecord.passwordIterations, now, now),
      familyDb.prepare(
        `INSERT INTO student_guardians (
           id, student_id, guardian_id, relationship_label, can_view_reports, can_view_photos, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), studentId, id, text(input.relationshipLabel, 80) || null, input.canViewReports === false ? 0 : 1, input.canViewPhotos === false ? 0 : 1, now),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new DataCoreAccessError(409, "이미 사용 중인 보호자 로그인 ID이거나 연결입니다.");
    throw error;
  }
  await audit(familyDb, context, campusId, "guardian.create", id, studentId);
  return { guardian: { id, loginId, displayName, status: "active", mustChangePassword: true }, temporaryPassword: password };
}

export async function updateKkumeumGuardianLink(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  if (!campusId || !studentId) throw new DataCoreAccessError(400, "campusId와 studentId가 필요합니다.");
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  const link = await familyDb.prepare("SELECT guardian_id FROM student_guardians WHERE guardian_id = ? AND student_id = ?").bind(guardianId, studentId).first();
  if (!link) throw new DataCoreAccessError(404, "보호자 연결을 찾을 수 없습니다.");
  const status = input.status === undefined ? null : text(input.status, 20);
  if (status && !["active", "disabled"].includes(status)) throw new DataCoreAccessError(400, "보호자 상태값이 올바르지 않습니다.");
  const statements: D1PreparedStatement[] = [
    familyDb.prepare(
      `UPDATE student_guardians SET relationship_label = ?, can_view_reports = ?, can_view_photos = ?
       WHERE guardian_id = ? AND student_id = ?`,
    ).bind(text(input.relationshipLabel, 80) || null, input.canViewReports === false ? 0 : 1, input.canViewPhotos === false ? 0 : 1, guardianId, studentId),
  ];
  if (status) statements.push(familyDb.prepare("UPDATE family_guardians SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), guardianId));
  if (status === "disabled") {
    statements.push(
      familyDb.prepare("UPDATE guardian_sessions SET revoked_at = ? WHERE guardian_id = ? AND revoked_at IS NULL")
        .bind(new Date().toISOString(), guardianId),
    );
  }
  await familyDb.batch(statements);
  await audit(familyDb, context, campusId, status === "disabled" ? "guardian.disable" : "guardian.update", guardianId, studentId);
  return { id: guardianId, status: status || "unchanged" };
}

export async function resetKkumeumGuardianPassword(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  const linked = await familyDb.prepare("SELECT guardian_id FROM student_guardians WHERE guardian_id = ? AND student_id = ?").bind(guardianId, studentId).first();
  if (!linked) throw new DataCoreAccessError(404, "보호자 연결을 찾을 수 없습니다.");
  const password = temporaryPassword();
  const record = await createKkumeumGuardianPasswordRecord(password);
  await familyDb.batch([
    familyDb.prepare(
      `UPDATE family_guardians SET password_hash = ?, password_salt = ?, password_iterations = ?,
       must_change_password = 1, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
    ).bind(record.passwordHash, record.passwordSalt, record.passwordIterations, new Date().toISOString(), guardianId),
    familyDb.prepare("UPDATE guardian_sessions SET revoked_at = ? WHERE guardian_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), guardianId),
  ]);
  await audit(familyDb, context, campusId, "guardian.password_reset", guardianId, studentId);
  return { temporaryPassword: password };
}

export async function revokeKkumeumGuardianSessions(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  input: Record<string, unknown>,
) {
  const campusId = text(input.campusId, 120);
  const studentId = text(input.studentId, 120);
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  const linked = await familyDb.prepare("SELECT guardian_id FROM student_guardians WHERE guardian_id = ? AND student_id = ?").bind(guardianId, studentId).first();
  if (!linked) throw new DataCoreAccessError(404, "보호자 연결을 찾을 수 없습니다.");
  await familyDb.prepare("UPDATE guardian_sessions SET revoked_at = ? WHERE guardian_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), guardianId).run();
  await audit(familyDb, context, campusId, "guardian.sessions_revoke", guardianId, studentId);
  return { ok: true };
}

export async function unlinkKkumeumGuardian(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  guardianId: string,
  campusId: string,
  studentId: string,
) {
  manager(context, campusId);
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await studentInCampus(familyDb, campusId, studentId);
  const result = await familyDb.prepare("DELETE FROM student_guardians WHERE guardian_id = ? AND student_id = ?").bind(guardianId, studentId).run();
  if (!result.meta?.changes) throw new DataCoreAccessError(404, "보호자 연결을 찾을 수 없습니다.");
  await audit(familyDb, context, campusId, "guardian.unlink", guardianId, studentId);
  return { ok: true };
}

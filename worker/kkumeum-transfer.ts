import { DataCoreAccessError, requireAuthenticatedAccess, type DataCoreAccessContext } from './data-core-access';
import { CAMPUS_DIRECTORY, canonicalCampusId } from './campus-directory';
import { ensureKkumeumPhase2Schema } from './kkumeum-phase2-schema';
import { assertKkumeumPilotCampus } from './kkumeum-pilot';

export async function transferKkumeumStudent(db: D1Database, context: DataCoreAccessContext, studentId: string, input: Record<string, unknown>) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '캠퍼스 간 학생 이동은 마스터 관리자만 할 수 있습니다.');
  const from = canonicalCampusId(input.fromCampusId);
  const to = canonicalCampusId(input.toCampusId);
  if (!from || !to || from === to || !CAMPUS_DIRECTORY.some(c => c.id === to)) {
    throw new DataCoreAccessError(400, '서로 다른 출발·도착 캠퍼스를 선택해주세요.');
  }
  const expected = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt : '';
  if (!expected) throw new DataCoreAccessError(400, '학생 정보를 새로 확인한 뒤 이동해주세요.');
  await ensureKkumeumPhase2Schema(db);
  await assertKkumeumPilotCampus(db, from);
  await assertKkumeumPilotCampus(db, to);
  const student = await db.prepare('SELECT campus_id, current_class_id, updated_at FROM family_students WHERE id = ?')
    .bind(studentId).first<{campus_id: string; current_class_id: string | null; updated_at: string}>();
  if (!student) throw new DataCoreAccessError(404, '학생을 찾을 수 없습니다.');
  if (student.campus_id !== from || student.updated_at !== expected) throw new DataCoreAccessError(409, '학생 정보가 변경되었습니다. 새로고침 후 확인해주세요.');
  const classId = typeof input.classId === 'string' && input.classId ? input.classId : null;
  if (classId && !await db.prepare('SELECT id FROM family_classes WHERE id = ? AND campus_id = ? AND active = 1').bind(classId, to).first()) {
    throw new DataCoreAccessError(400, '도착 캠퍼스의 활성 반만 선택할 수 있습니다.');
  }
  const id = crypto.randomUUID(), now = new Date(Math.max(Date.now(), (Date.parse(expected) || 0) + 1)).toISOString();
  const guard = 'EXISTS (SELECT 1 FROM family_audit_logs WHERE id = ?)';
  // D1 batch is atomic. A stale confirmation creates no audit marker and changes no related rows.
  const statements = [
    db.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
      SELECT ?, ?, 'staff', ?, 'student.transfer', 'family_student', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM family_students WHERE id = ? AND campus_id = ? AND updated_at = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM family_classes WHERE id = ? AND campus_id = ? AND active = 1))`)
      .bind(id, to, context.user!.internalUserId, studentId, JSON.stringify({fromCampusId: from, toCampusId: to, previousClassId: student.current_class_id, classId}), now, studentId, from, expected, classId, classId, to),
    db.prepare(`UPDATE family_students SET campus_id = ?, current_class_id = ?, updated_at = ? WHERE id = ? AND ${guard}`).bind(to, classId, now, studentId, id),
    db.prepare(`UPDATE class_enrollments SET ended_at = ? WHERE student_id = ? AND ended_at IS NULL AND ${guard}`).bind(now, studentId, id),
    db.prepare(`UPDATE family_files SET campus_id = ? WHERE student_id = ? AND ${guard}`).bind(to, studentId, id),
    db.prepare(`UPDATE student_artworks SET campus_id = ? WHERE student_id = ? AND ${guard}`).bind(to, studentId, id),
    db.prepare(`UPDATE monthly_reports SET campus_id = ? WHERE student_id = ? AND ${guard}`).bind(to, studentId, id),
  ];
  if (classId) statements.push(db.prepare(`INSERT INTO class_enrollments (id, student_id, class_id, started_at, created_at)
    SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(crypto.randomUUID(), studentId, classId, now, now, id));
  const results = await db.batch(statements);
  if (!results[0]?.meta?.changes) throw new DataCoreAccessError(409, '학생 또는 도착 반이 변경되었습니다. 새로고침 후 확인해주세요.');
  return { studentId, fromCampusId: from, toCampusId: to, classId, transferredAt: now, transferId: id };
}

export async function listKkumeumTransfers(db: D1Database, context: DataCoreAccessContext, studentId: string) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, '전체 캠퍼스 이동 기록은 마스터 관리자만 확인할 수 있습니다.');
  await ensureKkumeumPhase2Schema(db);
  const result = await db.prepare(`SELECT id, metadata_json, created_at FROM family_audit_logs
    WHERE action = 'student.transfer' AND resource_id = ? ORDER BY created_at DESC, id LIMIT 20`).bind(studentId).all<{id:string; metadata_json:string; created_at:string}>();
  return (result.results || []).map(row => ({id:row.id, ...JSON.parse(row.metadata_json), transferredAt:row.created_at}));
}

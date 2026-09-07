import { DEFAULT_ORGANIZATION_ID, ensureDataCoreDatabase } from "./data-core";
import {
  DATA_CORE_ROLES,
  DataCoreAccessContext,
  DataCoreAccessError,
  DataCoreRole,
  ensureDefaultCampuses,
  requireAuthenticatedAccess,
} from "./data-core-access";

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requireSuperAdmin(context: DataCoreAccessContext) {
  requireAuthenticatedAccess(context);
  if (!context.isSuperAdmin) {
    throw new DataCoreAccessError(403, "마스터 관리자 권한이 필요합니다.");
  }
}

function normalizeRole(value: unknown): DataCoreRole {
  const role = cleanText(value, 40) as DataCoreRole;
  if (!DATA_CORE_ROLES.includes(role)) {
    throw new DataCoreAccessError(400, "지원하지 않는 역할입니다.");
  }
  return role;
}

async function audit(
  db: D1Database,
  context: DataCoreAccessContext,
  action: string,
  resourceId: string,
  campusId: string | null,
  metadata: unknown,
) {
  if (!context.user) return;
  await db
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, campus_id, actor_user_id,
         action, resource_type, resource_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, 'membership', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEFAULT_ORGANIZATION_ID,
      campusId,
      context.user.internalUserId,
      action,
      resourceId,
      JSON.stringify(metadata ?? {}),
      new Date().toISOString(),
    )
    .run();
}

export async function listDataCoreUsers(
  db: D1Database,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await ensureDataCoreDatabase(db);
  const result = await db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.display_name,
         u.status,
         u.created_at,
         u.updated_at,
         COUNT(m.id) AS membership_count
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id AND m.organization_id = ?
       GROUP BY u.id
       ORDER BY u.updated_at DESC`,
    )
    .bind(DEFAULT_ORGANIZATION_ID)
    .all<Record<string, unknown>>();
  return result.results || [];
}

export async function listDataCoreMemberships(
  db: D1Database,
  context: DataCoreAccessContext,
) {
  requireSuperAdmin(context);
  await ensureDefaultCampuses(db);
  const result = await db
    .prepare(
      `SELECT
         m.id,
         m.organization_id,
         m.campus_id,
         m.user_id,
         m.role,
         m.created_at,
         m.updated_at,
         u.email,
         u.display_name,
         c.name AS campus_name,
         c.code AS campus_code
       FROM memberships m
       INNER JOIN users u ON u.id = m.user_id
       LEFT JOIN campuses c ON c.id = m.campus_id
       WHERE m.organization_id = ?
       ORDER BY
         CASE m.role
           WHEN 'SUPER_ADMIN' THEN 0
           WHEN 'CAMPUS_DIRECTOR' THEN 1
           WHEN 'TEACHER' THEN 2
           ELSE 3
         END,
         c.name,
         u.display_name`,
    )
    .bind(DEFAULT_ORGANIZATION_ID)
    .all<Record<string, unknown>>();
  return result.results || [];
}

export async function upsertDataCoreMembership(
  db: D1Database,
  context: DataCoreAccessContext,
  input: Record<string, unknown>,
) {
  requireSuperAdmin(context);
  await ensureDefaultCampuses(db);

  const email = cleanText(input.email, 320).toLowerCase();
  const requestedUserId = cleanText(input.userId, 200);
  const role = normalizeRole(input.role);
  const campusId = role === "SUPER_ADMIN" ? null : cleanText(input.campusId, 120) || null;

  let user:
    | { id: string; email: string | null; display_name: string }
    | null = null;
  if (requestedUserId) {
    user = await db
      .prepare("SELECT id, email, display_name FROM users WHERE id = ? AND status = 'active'")
      .bind(requestedUserId)
      .first<{ id: string; email: string | null; display_name: string }>();
  } else if (email) {
    user = await db
      .prepare("SELECT id, email, display_name FROM users WHERE lower(email) = ? AND status = 'active'")
      .bind(email)
      .first<{ id: string; email: string | null; display_name: string }>();
  }

  if (!user) {
    throw new DataCoreAccessError(
      409,
      "해당 사용자를 찾을 수 없습니다. 사용자가 시스템에 한 번 로그인한 후 권한을 부여해 주세요.",
    );
  }

  if (campusId) {
    const campus = await db
      .prepare(
        "SELECT id FROM campuses WHERE id = ? AND organization_id = ? AND status = 'active'",
      )
      .bind(campusId, DEFAULT_ORGANIZATION_ID)
      .first<{ id: string }>();
    if (!campus) throw new DataCoreAccessError(400, "유효하지 않은 campusId입니다.");
  }

  const membershipId =
    role === "SUPER_ADMIN"
      ? `membership:${user.id}:super-admin`
      : `membership:${user.id}:${campusId}:${role.toLowerCase()}`;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO memberships (
         id, organization_id, campus_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         campus_id = excluded.campus_id,
         role = excluded.role,
         updated_at = excluded.updated_at`,
    )
    .bind(
      membershipId,
      DEFAULT_ORGANIZATION_ID,
      campusId,
      user.id,
      role,
      now,
      now,
    )
    .run();

  await audit(db, context, "grant", membershipId, campusId, {
    targetUserId: user.id,
    email: user.email,
    role,
  });

  return {
    id: membershipId,
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    campusId,
    role,
    updatedAt: now,
  };
}

export async function deleteDataCoreMembership(
  db: D1Database,
  context: DataCoreAccessContext,
  membershipId: string,
) {
  requireSuperAdmin(context);
  const existing = await db
    .prepare(
      `SELECT id, campus_id, user_id, role
       FROM memberships
       WHERE id = ? AND organization_id = ?`,
    )
    .bind(membershipId, DEFAULT_ORGANIZATION_ID)
    .first<{ id: string; campus_id: string | null; user_id: string; role: string }>();
  if (!existing) throw new DataCoreAccessError(404, "권한 정보를 찾을 수 없습니다.");

  if (
    context.user?.internalUserId === existing.user_id &&
    existing.role === "SUPER_ADMIN"
  ) {
    throw new DataCoreAccessError(400, "현재 로그인한 자신의 마스터 권한은 여기서 제거할 수 없습니다.");
  }

  await db.prepare("DELETE FROM memberships WHERE id = ?").bind(membershipId).run();
  await audit(
    db,
    context,
    "revoke",
    membershipId,
    existing.campus_id,
    { targetUserId: existing.user_id, role: existing.role },
  );
  return { ok: true, id: membershipId };
}

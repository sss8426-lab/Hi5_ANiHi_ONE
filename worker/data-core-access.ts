import {
  DEFAULT_ORGANIZATION_ID,
  ensureDataCoreDatabase,
  requestIdentity,
  syncRequestUser,
} from "./data-core";

export const DATA_CORE_ROLES = [
  "SUPER_ADMIN",
  "CAMPUS_DIRECTOR",
  "TEACHER",
  "STAFF",
] as const;

export type DataCoreRole = (typeof DATA_CORE_ROLES)[number];

export type DataCoreMembership = {
  id: string;
  organizationId: string;
  campusId: string | null;
  campusName: string | null;
  role: DataCoreRole;
};

export type DataCoreAccessContext = {
  authenticated: boolean;
  database: boolean;
  user?: {
    userId: string;
    internalUserId: string;
    email: string;
    displayName: string;
  };
  memberships: DataCoreMembership[];
  isSuperAdmin: boolean;
  campusIds: string[];
  canWrite: boolean;
  mustChangePassword?: boolean;
};

const DEFAULT_CAMPUSES = [
  ["campus-anihi-admission", "anihi-admission", "애니입시관"],
  ["campus-design-admission", "design-admission", "디자인입시관"],
  ["campus-wonjong", "wonjong", "원종"],
  ["campus-beombak", "beombak", "범박"],
  ["campus-jungdong", "jungdong", "중동"],
  ["campus-okgil", "okgil", "옥길"],
  ["campus-gwangjin", "gwangjin", "광진"],
  ["campus-paju", "paju", "파주"],
  ["campus-ansan", "ansan", "안산"],
  ["campus-ulsan", "ulsan", "울산"],
] as const;

export class DataCoreAccessError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function ensureDefaultCampuses(db: D1Database): Promise<void> {
  await ensureDataCoreDatabase(db);
  const now = new Date().toISOString();
  await db.batch(
    DEFAULT_CAMPUSES.map(([id, code, name]) =>
      db
        .prepare(
          `INSERT INTO campuses (
             id, organization_id, code, name, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             code = excluded.code,
             name = excluded.name,
             updated_at = excluded.updated_at`,
        )
        .bind(id, DEFAULT_ORGANIZATION_ID, code, name, now, now),
    ),
  );
}

function parseBootstrapAdminEmails(value?: string): Set<string> {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function ensureBootstrapSuperAdmin(
  db: D1Database,
  internalUserId: string,
  email: string,
  bootstrapAdminEmails?: string,
): Promise<void> {
  const allowed = parseBootstrapAdminEmails(bootstrapAdminEmails);
  if (!allowed.has(email.trim().toLowerCase())) return;
  const now = new Date().toISOString();
  const membershipId = `membership:${internalUserId}:super-admin`;
  await db
    .prepare(
      `INSERT INTO memberships (
         id, organization_id, campus_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, 'SUPER_ADMIN', ?, ?)
       ON CONFLICT(id) DO UPDATE SET role = 'SUPER_ADMIN', updated_at = excluded.updated_at`,
    )
    .bind(membershipId, DEFAULT_ORGANIZATION_ID, internalUserId, now, now)
    .run();
}

export async function resolveDataCoreAccess(
  request: Request,
  db?: D1Database,
  bootstrapAdminEmails?: string,
): Promise<DataCoreAccessContext> {
  const identity = requestIdentity(request);
  if (!identity && !db) {
    return {
      authenticated: false,
      database: Boolean(db),
      memberships: [],
      isSuperAdmin: false,
      campusIds: [],
      canWrite: false,
    };
  }

  if (identity && !db) {
    return {
      authenticated: true,
      database: false,
      user: {
        ...identity,
        internalUserId: `oai:${identity.userId}`,
      },
      memberships: [],
      isSuperAdmin: false,
      campusIds: [],
      canWrite: false,
    };
  }

  if (!db) {
    return {
      authenticated: false,
      database: false,
      memberships: [],
      isSuperAdmin: false,
      campusIds: [],
      canWrite: false,
    };
  }

  await ensureDefaultCampuses(db);
  let user: NonNullable<DataCoreAccessContext["user"]>;
  let mustChangePassword = false;
  if (identity) {
    const internalUserId = await syncRequestUser(db, identity);
    await ensureBootstrapSuperAdmin(db, internalUserId, identity.email, bootstrapAdminEmails);
    user = { ...identity, internalUserId };
  } else {
    // Dynamic import keeps the OAI access helper usable without a module cycle.
    const { ensureStandaloneAuthSchema, standaloneSessionIdentity } = await import("./data-core-auth");
    await ensureStandaloneAuthSchema(db);
    const sessionIdentity = await standaloneSessionIdentity(db, request);
    if (!sessionIdentity) {
      return {
        authenticated: false,
        database: true,
        memberships: [],
        isSuperAdmin: false,
        campusIds: [],
        canWrite: false,
      };
    }
    user = sessionIdentity;
    mustChangePassword = sessionIdentity.mustChangePassword;
  }

  const result = await db
    .prepare(
      `SELECT
         m.id,
         m.organization_id,
         m.campus_id,
         m.role,
         c.name AS campus_name
       FROM memberships m
       LEFT JOIN campuses c ON c.id = m.campus_id
       WHERE m.user_id = ? AND m.organization_id = ?
       ORDER BY
         CASE m.role
           WHEN 'SUPER_ADMIN' THEN 0
           WHEN 'CAMPUS_DIRECTOR' THEN 1
           WHEN 'TEACHER' THEN 2
           ELSE 3
         END,
         c.name`,
    )
    .bind(user.internalUserId, DEFAULT_ORGANIZATION_ID)
    .all<{
      id: string;
      organization_id: string;
      campus_id: string | null;
      campus_name: string | null;
      role: DataCoreRole;
    }>();

  const memberships: DataCoreMembership[] = (result.results || []).map((item) => ({
    id: item.id,
    organizationId: item.organization_id,
    campusId: item.campus_id,
    campusName: item.campus_name,
    role: item.role,
  }));
  const isSuperAdmin = memberships.some((item) => item.role === "SUPER_ADMIN");
  const campusIds = Array.from(
    new Set(memberships.map((item) => item.campusId).filter((value): value is string => Boolean(value))),
  );

  return {
    authenticated: true,
    database: true,
    user,
    memberships,
    isSuperAdmin,
    campusIds,
    canWrite: isSuperAdmin || memberships.length > 0,
    mustChangePassword,
  };
}

export function requireSignedInAccess(context: DataCoreAccessContext): void {
  if (!context.authenticated || !context.user) {
    throw new DataCoreAccessError(401, "로그인이 필요합니다.");
  }
  if (!context.database) {
    throw new DataCoreAccessError(503, "DATA CORE 데이터베이스가 연결되지 않았습니다.");
  }
}

export function requireAuthenticatedAccess(context: DataCoreAccessContext): void {
  requireSignedInAccess(context);
  if (context.mustChangePassword) {
    throw new DataCoreAccessError(403, "첫 로그인 비밀번호를 먼저 변경하세요.");
  }
}

export function requireWriteAccess(context: DataCoreAccessContext): void {
  requireAuthenticatedAccess(context);
  if (context.mustChangePassword) {
    throw new DataCoreAccessError(403, "첫 로그인 비밀번호를 먼저 변경하세요.");
  }
  if (!context.canWrite) {
    throw new DataCoreAccessError(403, "DATA CORE 사용 권한이 아직 부여되지 않았습니다.");
  }
}

export function requireCampusAccess(
  context: DataCoreAccessContext,
  campusId: string | null | undefined,
): void {
  requireWriteAccess(context);
  if (context.isSuperAdmin) return;
  if (!campusId || !context.campusIds.includes(campusId)) {
    throw new DataCoreAccessError(403, "해당 캠퍼스의 데이터에 접근할 권한이 없습니다.");
  }
}

export async function listAccessibleCampuses(
  db: D1Database,
  context: DataCoreAccessContext,
) {
  requireAuthenticatedAccess(context);
  await ensureDefaultCampuses(db);

  if (context.isSuperAdmin) {
    const result = await db
      .prepare(
        `SELECT id, code, name, status
         FROM campuses
         WHERE organization_id = ? AND status = 'active'
         ORDER BY name`,
      )
      .bind(DEFAULT_ORGANIZATION_ID)
      .all();
    return result.results || [];
  }

  if (!context.campusIds.length) return [];
  const placeholders = context.campusIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT id, code, name, status
       FROM campuses
       WHERE organization_id = ? AND status = 'active' AND id IN (${placeholders})
       ORDER BY name`,
    )
    .bind(DEFAULT_ORGANIZATION_ID, ...context.campusIds)
    .all();
  return result.results || [];
}

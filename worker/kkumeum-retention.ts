import {
  DataCoreAccessContext,
  DataCoreAccessError,
  requireAuthenticatedAccess,
} from "./data-core-access";
import { ensureKkumeumGuardianAuthSchema } from "./kkumeum-guardian-auth";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export type KkumeumRetentionPolicyInput = {
  campusId?: unknown;
  policyVersion?: unknown;
  leaveDays?: unknown;
  movedDays?: unknown;
  graduatedDays?: unknown;
  guardianDisabledDays?: unknown;
  softDeleteGraceDays?: unknown;
  destructivePurgeEnabled?: unknown;
};

type RetentionPolicyRow = {
  id: string;
  campus_id: string;
  policy_version: string;
  leave_days: number | null;
  moved_days: number | null;
  graduated_days: number | null;
  guardian_disabled_days: number | null;
  soft_delete_grace_days: number | null;
  destructive_purge_enabled: number;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown, max = 120): string {
  return String(value ?? "").trim().slice(0, max);
}

function policyVersion(value: unknown): string {
  const normalized = text(value, 40);
  if (!normalized || !VERSION_PATTERN.test(normalized)) {
    throw new DataCoreAccessError(400, "보존정책 버전 형식이 올바르지 않습니다.");
  }
  return normalized;
}

function optionalDays(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 3650) {
    throw new DataCoreAccessError(400, `${field}는 0~3650 사이 정수여야 합니다.`);
  }
  return number;
}

function requireReadAccess(context: DataCoreAccessContext, campusId: string): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  if (context.memberships.some((membership) => (
    membership.campusId === campusId && membership.role === "CAMPUS_DIRECTOR"
  ))) return;
  throw new DataCoreAccessError(403, "보존정책은 최고관리자 또는 해당 캠퍼스 원장만 확인할 수 있습니다.");
}

function requireWriteAccess(context: DataCoreAccessContext): void {
  requireAuthenticatedAccess(context);
  if (context.isSuperAdmin) return;
  throw new DataCoreAccessError(403, "보존정책 변경은 최고관리자만 할 수 있습니다.");
}

export async function ensureKkumeumRetentionSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumGuardianAuthSchema(familyDb);
  await familyDb.batch([
    familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_retention_policies (
      id TEXT PRIMARY KEY NOT NULL,
      campus_id TEXT NOT NULL UNIQUE,
      policy_version TEXT NOT NULL,
      leave_days INTEGER,
      moved_days INTEGER,
      graduated_days INTEGER,
      guardian_disabled_days INTEGER,
      soft_delete_grace_days INTEGER,
      destructive_purge_enabled INTEGER NOT NULL DEFAULT 0 CHECK (destructive_purge_enabled IN (0, 1)),
      updated_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    familyDb.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS family_retention_policies_campus_unique ON family_retention_policies(campus_id)",
    ),
  ]);
}

function response(row: RetentionPolicyRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    campusId: row.campus_id,
    policyVersion: row.policy_version,
    leaveDays: row.leave_days,
    movedDays: row.moved_days,
    graduatedDays: row.graduated_days,
    guardianDisabledDays: row.guardian_disabled_days,
    softDeleteGraceDays: row.soft_delete_grace_days,
    destructivePurgeEnabled: row.destructive_purge_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function audit(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
  policyId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await familyDb.prepare(
    `INSERT INTO family_audit_logs (
       id, campus_id, actor_type, actor_id, action,
       resource_type, resource_id, metadata_json, created_at
     ) VALUES (?, ?, 'staff', ?, 'retention.policy.upsert', 'retention_policy', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    campusId,
    context.user?.internalUserId || null,
    policyId,
    JSON.stringify(metadata),
    new Date().toISOString(),
  ).run();
}

export async function getKkumeumRetentionPolicy(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  campusId: string,
) {
  requireReadAccess(context, campusId);
  await ensureKkumeumRetentionSchema(familyDb);
  const row = await familyDb.prepare(
    `SELECT id, campus_id, policy_version, leave_days, moved_days, graduated_days,
            guardian_disabled_days, soft_delete_grace_days, destructive_purge_enabled,
            updated_by_user_id, created_at, updated_at
     FROM family_retention_policies WHERE campus_id = ? LIMIT 1`,
  ).bind(campusId).first<RetentionPolicyRow>();
  return response(row || null);
}

export async function upsertKkumeumRetentionPolicy(
  familyDb: D1Database,
  context: DataCoreAccessContext,
  input: KkumeumRetentionPolicyInput,
) {
  requireWriteAccess(context);
  const campusId = text(input.campusId, 120);
  if (!campusId) throw new DataCoreAccessError(400, "campusId가 필요합니다.");
  const version = policyVersion(input.policyVersion);

  if (
    input.destructivePurgeEnabled !== undefined &&
    input.destructivePurgeEnabled !== null &&
    input.destructivePurgeEnabled !== false &&
    input.destructivePurgeEnabled !== 0
  ) {
    throw new DataCoreAccessError(
      409,
      "실제 purge 실행은 아직 활성화되지 않았습니다. 이 단계에서는 보존정책만 저장할 수 있습니다.",
    );
  }

  const values = {
    leaveDays: optionalDays(input.leaveDays, "leaveDays"),
    movedDays: optionalDays(input.movedDays, "movedDays"),
    graduatedDays: optionalDays(input.graduatedDays, "graduatedDays"),
    guardianDisabledDays: optionalDays(input.guardianDisabledDays, "guardianDisabledDays"),
    softDeleteGraceDays: optionalDays(input.softDeleteGraceDays, "softDeleteGraceDays"),
  };

  await ensureKkumeumRetentionSchema(familyDb);
  const existing = await familyDb.prepare(
    "SELECT id, created_at FROM family_retention_policies WHERE campus_id = ? LIMIT 1",
  ).bind(campusId).first<{ id: string; created_at: string }>();
  const id = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const createdAt = existing?.created_at || now;

  await familyDb.prepare(
    `INSERT INTO family_retention_policies (
       id, campus_id, policy_version, leave_days, moved_days, graduated_days,
       guardian_disabled_days, soft_delete_grace_days, destructive_purge_enabled,
       updated_by_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(campus_id) DO UPDATE SET
       policy_version = excluded.policy_version,
       leave_days = excluded.leave_days,
       moved_days = excluded.moved_days,
       graduated_days = excluded.graduated_days,
       guardian_disabled_days = excluded.guardian_disabled_days,
       soft_delete_grace_days = excluded.soft_delete_grace_days,
       destructive_purge_enabled = 0,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    campusId,
    version,
    values.leaveDays,
    values.movedDays,
    values.graduatedDays,
    values.guardianDisabledDays,
    values.softDeleteGraceDays,
    context.user?.internalUserId || null,
    createdAt,
    now,
  ).run();

  await audit(familyDb, context, campusId, id, {
    policyVersion: version,
    ...values,
    destructivePurgeEnabled: false,
  });

  return {
    policy: await getKkumeumRetentionPolicy(familyDb, context, campusId),
    created: !existing,
  };
}

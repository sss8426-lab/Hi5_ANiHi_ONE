import { DataCoreAccessContext, DataCoreAccessError } from "./data-core-access";
import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";

const FAMILY_TABLES = [
  "family_classes", "family_students", "class_enrollments", "class_staff_assignments", "family_files",
  "monthly_reports", "monthly_report_revisions", "student_artworks", "family_guardians", "student_guardians",
  "announcements", "announcement_targets", "read_receipts", "family_retention_policies", "consents",
] as const;

export type FamilyBackupManifest = {
  id: string;
  schemaVersion: string;
  syntheticOnly: boolean;
  createdAt: string;
  tableCounts: Record<string, number>;
  files: Array<{ key: string; size: number; etag: string }>;
};

export async function ensureKkumeumBackupSchema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumPhase1Schema(familyDb);
  await familyDb.prepare(`CREATE TABLE IF NOT EXISTS family_backup_manifests (
    id TEXT PRIMARY KEY NOT NULL,
    schema_version TEXT NOT NULL,
    synthetic_only INTEGER NOT NULL DEFAULT 1,
    table_counts_json TEXT NOT NULL,
    file_inventory_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT
  )`).run();
}

async function tableCounts(familyDb: D1Database): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of FAMILY_TABLES) {
    const exists = await familyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<{ name: string }>();
    if (!exists) { result[table] = 0; continue; }
    const count = await familyDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    result[table] = Number(count?.count || 0);
  }
  return result;
}

async function fileInventory(files: R2Bucket): Promise<Array<{ key: string; size: number; etag: string }>> {
  const result: Array<{ key: string; size: number; etag: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await files.list({ cursor });
    result.push(...page.objects.map((item) => ({ key: item.key, size: item.size, etag: item.etag })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result.sort((left, right) => left.key.localeCompare(right.key));
}

export async function createKkumeumFamilyBackupManifest(
  familyDb: D1Database,
  familyFiles: R2Bucket,
  context: DataCoreAccessContext,
): Promise<FamilyBackupManifest> {
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "FAMILY 백업 매니페스트는 최고관리자만 생성할 수 있습니다.");
  await ensureKkumeumBackupSchema(familyDb);
  const manifest: FamilyBackupManifest = {
    id: crypto.randomUUID(), schemaVersion: "kkumeum-family-v1", syntheticOnly: true,
    createdAt: new Date().toISOString(), tableCounts: await tableCounts(familyDb), files: await fileInventory(familyFiles),
  };
  await familyDb.batch([
    familyDb.prepare(`INSERT INTO family_backup_manifests (id, schema_version, synthetic_only, table_counts_json, file_inventory_json, created_at, created_by)
      VALUES (?, ?, 1, ?, ?, ?, ?)`).bind(manifest.id, manifest.schemaVersion, JSON.stringify(manifest.tableCounts), JSON.stringify(manifest.files), manifest.createdAt, context.user?.internalUserId || null),
    familyDb.prepare(`INSERT INTO family_audit_logs (id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at)
      VALUES (?, NULL, 'staff', ?, 'family.backup.manifest_create', 'family_backup_manifest', ?, ?, ?)`).bind(
      crypto.randomUUID(), context.user?.internalUserId || null, manifest.id,
      JSON.stringify({ tableCount: Object.keys(manifest.tableCounts).length, fileCount: manifest.files.length, syntheticOnly: true }), manifest.createdAt,
    ),
  ]);
  return manifest;
}

export async function listKkumeumFamilyBackupManifests(familyDb: D1Database, context: DataCoreAccessContext) {
  if (!context.isSuperAdmin) throw new DataCoreAccessError(403, "FAMILY 백업 매니페스트는 최고관리자만 조회할 수 있습니다.");
  await ensureKkumeumBackupSchema(familyDb);
  const result = await familyDb.prepare("SELECT id, schema_version, synthetic_only, table_counts_json, file_inventory_json, created_at FROM family_backup_manifests ORDER BY created_at DESC").all<{
    id: string; schema_version: string; synthetic_only: number; table_counts_json: string; file_inventory_json: string; created_at: string;
  }>();
  return (result.results || []).map((row) => ({ id: row.id, schemaVersion: row.schema_version, syntheticOnly: Boolean(row.synthetic_only), tableCounts: JSON.parse(row.table_counts_json), files: JSON.parse(row.file_inventory_json), createdAt: row.created_at }));
}

// This is deliberately test-only: callers must pass an explicit synthetic marker and no production restore endpoint exists.
export function assertSyntheticRestoreTarget(target: { marker?: string; production?: boolean }): void {
  if (target.marker !== "KKUMEUM_SYNTHETIC_RESTORE_ONLY" || target.production) {
    throw new DataCoreAccessError(409, "FAMILY 복원은 명시적 synthetic/staging 대상에서만 검증할 수 있습니다.");
  }
}

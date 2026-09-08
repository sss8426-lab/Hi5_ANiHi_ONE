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
  fileCount: number;
  totalBytes: number;
  files: Array<{ key: string; size: number; etag: string }>;
};

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
  // Only ensure the canonical FAMILY schema needed for aggregate counts/audit.
  // The manifest itself is deliberately returned in-memory and is not persisted because it contains private R2 object keys.
  await ensureKkumeumPhase1Schema(familyDb);
  const files = await fileInventory(familyFiles);
  const manifest: FamilyBackupManifest = {
    id: crypto.randomUUID(),
    schemaVersion: "kkumeum-family-v1",
    syntheticOnly: true,
    createdAt: new Date().toISOString(),
    tableCounts: await tableCounts(familyDb),
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + Number(item.size || 0), 0),
    files,
  };
  await familyDb.prepare(`INSERT INTO family_audit_logs (
    id, campus_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json, created_at
  ) VALUES (?, NULL, 'staff', ?, 'family.backup.manifest_create', 'family_backup_manifest', ?, ?, ?)`).bind(
    crypto.randomUUID(),
    context.user?.internalUserId || null,
    manifest.id,
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      tableCount: Object.keys(manifest.tableCounts).length,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      syntheticOnly: true,
    }),
    manifest.createdAt,
  ).run();
  return manifest;
}

// This is deliberately test-only: callers must pass an explicit synthetic marker and no production restore endpoint exists.
export function assertSyntheticRestoreTarget(target: { marker?: string; production?: boolean }): void {
  if (target.marker !== "KKUMEUM_SYNTHETIC_RESTORE_ONLY" || target.production) {
    throw new DataCoreAccessError(409, "FAMILY 복원은 명시적 synthetic/staging 대상에서만 검증할 수 있습니다.");
  }
}

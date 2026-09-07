import { ensureDataCoreDatabase } from "./data-core";

let migrationsReady: Promise<void> | null = null;

export async function ensureDataCoreMigrations(db: D1Database): Promise<void> {
  if (!migrationsReady) {
    migrationsReady = runMigrations(db).catch((error) => {
      migrationsReady = null;
      throw error;
    });
  }
  return migrationsReady;
}

async function runMigrations(db: D1Database) {
  await ensureDataCoreDatabase(db);
  await ensureColumn(db, "data_records", "content_text", "TEXT");
  await ensureColumn(db, "file_objects", "source_app", "TEXT NOT NULL DEFAULT 'legacy'");
  await db.exec(
    "CREATE INDEX IF NOT EXISTS file_objects_source_app_idx ON file_objects(source_app)",
  );
  await ensureBackupTable(db);
}

async function ensureColumn(
  db: D1Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const result = await db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>();
  const exists = (result.results || []).some((column) => column.name === columnName);
  if (exists) return;
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

async function ensureBackupTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS data_backups (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        created_by_user_id TEXT,
        status TEXT NOT NULL,
        backup_type TEXT NOT NULL DEFAULT 'metadata-snapshot',
        r2_prefix TEXT NOT NULL,
        manifest_key TEXT,
        total_rows INTEGER NOT NULL DEFAULT 0,
        table_counts_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        verified_at TEXT,
        error_message TEXT,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    )
    .run();
  await db.exec(
    "CREATE INDEX IF NOT EXISTS data_backups_created_idx ON data_backups(created_at)",
  );
}

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

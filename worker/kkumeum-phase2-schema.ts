import { ensureKkumeumPhase1Schema } from "./kkumeum-schema";

const PHASE2_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS family_files (
    id TEXT PRIMARY KEY NOT NULL,
    campus_id TEXT NOT NULL,
    student_id TEXT,
    owner_user_id TEXT,
    purpose TEXT NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS family_files_student_idx
    ON family_files(student_id, deleted_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS family_files_campus_idx
    ON family_files(campus_id, deleted_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS monthly_reports (
    id TEXT PRIMARY KEY NOT NULL,
    student_id TEXT NOT NULL,
    campus_id TEXT NOT NULL,
    year_month TEXT NOT NULL,
    teacher_user_id TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    evaluation_text TEXT,
    teacher_note TEXT,
    growth_points_json TEXT NOT NULL DEFAULT '{}',
    next_month_focus TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
    UNIQUE(student_id, year_month)
  )`,
  `CREATE INDEX IF NOT EXISTS monthly_reports_campus_idx
    ON monthly_reports(campus_id, year_month, status)`,
  `CREATE INDEX IF NOT EXISTS monthly_reports_student_idx
    ON monthly_reports(student_id, year_month)`,
  `CREATE TABLE IF NOT EXISTS monthly_report_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL,
    editor_user_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS monthly_report_revisions_report_idx
    ON monthly_report_revisions(report_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS student_artworks (
    id TEXT PRIMARY KEY NOT NULL,
    student_id TEXT NOT NULL,
    campus_id TEXT NOT NULL,
    class_id TEXT,
    report_id TEXT,
    family_file_id TEXT NOT NULL,
    title TEXT,
    lesson_date TEXT,
    teacher_note TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE SET NULL,
    FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE SET NULL,
    FOREIGN KEY (family_file_id) REFERENCES family_files(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS student_artworks_student_idx
    ON student_artworks(student_id, lesson_date, sort_order)`,
  `CREATE INDEX IF NOT EXISTS student_artworks_report_idx
    ON student_artworks(report_id, sort_order)`,
] as const;

async function ensureTeacherNoteColumn(familyDb: D1Database): Promise<void> {
  const result = await familyDb
    .prepare("PRAGMA table_info(monthly_reports)")
    .all<{ name: string }>();
  if ((result.results || []).some((column) => column.name === "teacher_note")) return;
  await familyDb.exec("ALTER TABLE monthly_reports ADD COLUMN teacher_note TEXT");
}

export async function ensureKkumeumPhase2Schema(familyDb: D1Database): Promise<void> {
  await ensureKkumeumPhase1Schema(familyDb);
  await familyDb.batch(PHASE2_SCHEMA.map((sql) => familyDb.prepare(sql)));
  await ensureTeacherNoteColumn(familyDb);
}

export const KKUMEUM_PHASE2_TABLES = [
  "family_files",
  "monthly_reports",
  "monthly_report_revisions",
  "student_artworks",
] as const;

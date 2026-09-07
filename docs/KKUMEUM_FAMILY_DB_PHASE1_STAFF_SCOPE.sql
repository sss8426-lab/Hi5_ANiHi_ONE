PRAGMA foreign_keys = ON;

-- Phase 1 privacy patch for FAMILY_DB only.
-- Do NOT run against the generic DATA CORE DB.

CREATE TABLE IF NOT EXISTS class_staff_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TEACHER',
  can_edit_reports INTEGER NOT NULL DEFAULT 1,
  can_manage_artworks INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE CASCADE,
  UNIQUE(class_id, staff_user_id, started_at)
);

CREATE INDEX IF NOT EXISTS class_staff_assignments_staff_idx
  ON class_staff_assignments(staff_user_id, ended_at, class_id);
CREATE INDEX IF NOT EXISTS class_staff_assignments_class_idx
  ON class_staff_assignments(class_id, ended_at, staff_user_id);

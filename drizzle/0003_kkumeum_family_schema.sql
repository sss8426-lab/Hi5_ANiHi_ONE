CREATE TABLE IF NOT EXISTS family_classes (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT NOT NULL, name TEXT NOT NULL, stage TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS family_classes_campus_idx ON family_classes(campus_id, active, sort_order);

CREATE TABLE IF NOT EXISTS family_students (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT NOT NULL, name TEXT NOT NULL, display_name TEXT,
  birth_year INTEGER, school_name TEXT, grade TEXT, status TEXT NOT NULL DEFAULT 'active',
  current_class_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (current_class_id) REFERENCES family_classes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS family_students_campus_idx ON family_students(campus_id, status);
CREATE INDEX IF NOT EXISTS family_students_class_idx ON family_students(current_class_id, status);

CREATE TABLE IF NOT EXISTS class_enrollments (
  id TEXT PRIMARY KEY NOT NULL, student_id TEXT NOT NULL, class_id TEXT NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS class_enrollments_student_idx ON class_enrollments(student_id, started_at);
CREATE INDEX IF NOT EXISTS class_enrollments_class_idx ON class_enrollments(class_id, started_at);

CREATE TABLE IF NOT EXISTS class_staff_assignments (
  id TEXT PRIMARY KEY NOT NULL, class_id TEXT NOT NULL, staff_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TEACHER', can_edit_reports INTEGER NOT NULL DEFAULT 1,
  can_manage_artworks INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, ended_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE CASCADE,
  UNIQUE(class_id, staff_user_id, started_at)
);
CREATE INDEX IF NOT EXISTS class_staff_assignments_staff_idx ON class_staff_assignments(staff_user_id, ended_at, class_id);
CREATE INDEX IF NOT EXISTS class_staff_assignments_class_idx ON class_staff_assignments(class_id, ended_at, staff_user_id);

CREATE TABLE IF NOT EXISTS family_audit_logs (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS family_audit_created_idx ON family_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS family_audit_resource_idx ON family_audit_logs(resource_type, resource_id, created_at);

CREATE TABLE IF NOT EXISTS family_files (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT NOT NULL, student_id TEXT, owner_user_id TEXT,
  purpose TEXT NOT NULL, r2_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  deleted_at TEXT, FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS family_files_student_idx ON family_files(student_id, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS family_files_campus_idx ON family_files(campus_id, deleted_at, created_at);

CREATE TABLE IF NOT EXISTS monthly_reports (
  id TEXT PRIMARY KEY NOT NULL, student_id TEXT NOT NULL, campus_id TEXT NOT NULL,
  year_month TEXT NOT NULL, teacher_user_id TEXT NOT NULL, title TEXT, summary TEXT,
  evaluation_text TEXT, teacher_note TEXT, growth_points_json TEXT NOT NULL DEFAULT '{}',
  next_month_focus TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'sent')),
  sent_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
  UNIQUE(student_id, year_month)
);
CREATE INDEX IF NOT EXISTS monthly_reports_campus_idx ON monthly_reports(campus_id, year_month, status);
CREATE INDEX IF NOT EXISTS monthly_reports_student_idx ON monthly_reports(student_id, year_month);

CREATE TABLE IF NOT EXISTS monthly_report_revisions (
  id TEXT PRIMARY KEY NOT NULL, report_id TEXT NOT NULL, editor_user_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS monthly_report_revisions_report_idx ON monthly_report_revisions(report_id, created_at);

CREATE TABLE IF NOT EXISTS student_artworks (
  id TEXT PRIMARY KEY NOT NULL, student_id TEXT NOT NULL, campus_id TEXT NOT NULL, class_id TEXT,
  report_id TEXT, family_file_id TEXT NOT NULL, title TEXT, lesson_date TEXT, teacher_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES family_classes(id) ON DELETE SET NULL,
  FOREIGN KEY (report_id) REFERENCES monthly_reports(id) ON DELETE SET NULL,
  FOREIGN KEY (family_file_id) REFERENCES family_files(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS student_artworks_student_idx ON student_artworks(student_id, lesson_date, sort_order);
CREATE INDEX IF NOT EXISTS student_artworks_report_idx ON student_artworks(report_id, sort_order);

CREATE TABLE IF NOT EXISTS family_guardians (
  id TEXT PRIMARY KEY NOT NULL, login_id TEXT UNIQUE, phone TEXT, email TEXT,
  display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', password_hash TEXT,
  password_salt TEXT, password_iterations INTEGER, must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_login_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guardian_sessions (
  id TEXT PRIMARY KEY NOT NULL, guardian_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL,
  FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS student_guardians (
  id TEXT PRIMARY KEY NOT NULL, student_id TEXT NOT NULL, guardian_id TEXT NOT NULL,
  relationship_label TEXT, can_view_reports INTEGER NOT NULL DEFAULT 1,
  can_view_photos INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
  FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE,
  UNIQUE(student_id, guardian_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS family_guardians_phone_unique ON family_guardians(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS family_guardians_email_unique ON family_guardians(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS guardian_sessions_guardian_idx ON guardian_sessions(guardian_id, expires_at);
CREATE INDEX IF NOT EXISTS guardian_sessions_active_idx ON guardian_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS student_guardians_guardian_idx ON student_guardians(guardian_id, student_id);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT, author_user_id TEXT NOT NULL,
  announcement_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS announcements_campus_idx ON announcements(campus_id, status, published_at);
CREATE TABLE IF NOT EXISTS announcement_targets (
  id TEXT PRIMARY KEY NOT NULL, announcement_id TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS announcement_targets_lookup_idx ON announcement_targets(target_type, target_id, announcement_id);
CREATE TABLE IF NOT EXISTS read_receipts (
  id TEXT PRIMARY KEY NOT NULL, guardian_id TEXT NOT NULL, resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL, read_at TEXT NOT NULL,
  FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE,
  UNIQUE(guardian_id, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS read_receipts_guardian_idx ON read_receipts(guardian_id, resource_type, read_at);

CREATE TABLE IF NOT EXISTS family_staff_notice_permissions (
  id TEXT PRIMARY KEY NOT NULL, campus_id TEXT NOT NULL, staff_user_id TEXT NOT NULL,
  can_publish_campus INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(campus_id, staff_user_id)
);
CREATE INDEX IF NOT EXISTS family_staff_notice_permissions_staff_idx ON family_staff_notice_permissions(staff_user_id, campus_id);

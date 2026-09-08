CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL,
  guardian_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES family_students(id) ON DELETE CASCADE,
  FOREIGN KEY (guardian_id) REFERENCES family_guardians(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS consents_student_idx
  ON consents(student_id, consent_type, granted_at);

CREATE INDEX IF NOT EXISTS consents_guardian_idx
  ON consents(guardian_id, consent_type, granted_at);

CREATE UNIQUE INDEX IF NOT EXISTS consents_active_unique
  ON consents(student_id, guardian_id, consent_type, version)
  WHERE revoked_at IS NULL;

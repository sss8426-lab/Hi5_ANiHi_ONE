CREATE TABLE IF NOT EXISTS family_retention_policies (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS family_retention_policies_campus_unique
ON family_retention_policies(campus_id);

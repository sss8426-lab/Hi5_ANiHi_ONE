CREATE TABLE IF NOT EXISTS family_backup_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  synthetic_only INTEGER NOT NULL DEFAULT 1,
  table_counts_json TEXT NOT NULL,
  file_inventory_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS family_pilot_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pilot_campus_id TEXT,
  closed_beta_enabled INTEGER NOT NULL DEFAULT 0,
  internal_guardian_beta_enabled INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_internal_beta_guardians (
  guardian_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

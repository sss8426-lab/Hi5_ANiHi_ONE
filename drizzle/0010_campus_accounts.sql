-- Additive only. No existing campus IDs, credentials, files, or admissions rows change.
CREATE TABLE IF NOT EXISTS campus_admissions_state (
  campus_id TEXT PRIMARY KEY NOT NULL REFERENCES campuses(id),
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_presence_idx ON auth_sessions(user_id, revoked_at, expires_at, last_seen_at);
CREATE INDEX IF NOT EXISTS audit_auth_login_idx ON audit_logs(organization_id, resource_type, action, resource_id, created_at);

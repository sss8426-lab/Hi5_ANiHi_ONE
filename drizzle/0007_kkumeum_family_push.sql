-- Apply only to the isolated FAMILY_DB binding. Never run against DATA CORE DB.
ALTER TABLE push_subscriptions ADD COLUMN p256dh_encrypted TEXT;
ALTER TABLE push_subscriptions ADD COLUMN auth_encrypted TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_used_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN revoked_at TEXT;

CREATE INDEX IF NOT EXISTS push_subscriptions_guardian_active_idx
  ON push_subscriptions(guardian_id, active, revoked_at);

CREATE TABLE IF NOT EXISTS push_delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  announcement_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  guardian_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  UNIQUE(announcement_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_delivery_attempts_announcement_idx
  ON push_delivery_attempts(announcement_id, status, attempted_at);

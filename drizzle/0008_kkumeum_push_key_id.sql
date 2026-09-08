-- Apply only to the isolated FAMILY_DB binding. Never run against DATA CORE DB.
-- Stores only a short SHA-256-derived non-secret key identifier, never the encryption key.
ALTER TABLE push_subscriptions ADD COLUMN encryption_key_id TEXT;

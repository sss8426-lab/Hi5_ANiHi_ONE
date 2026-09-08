-- FAMILY_DB only. This migration never targets DATA CORE DB or FILES.
ALTER TABLE push_subscriptions ADD COLUMN encryption_key_id TEXT;

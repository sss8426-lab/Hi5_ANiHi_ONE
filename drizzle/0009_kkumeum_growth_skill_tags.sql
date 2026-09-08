-- FAMILY_DB only. Adds structured growth-skill fields without rebuilding legacy reports.
ALTER TABLE monthly_reports ADD COLUMN growth_skill_taxonomy_version TEXT;
ALTER TABLE monthly_reports ADD COLUMN growth_skill_codes_json TEXT;

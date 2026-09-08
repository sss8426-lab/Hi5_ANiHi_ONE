import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 production 바인딩은 기존 DATA CORE 리소스와 분리된다', async () => {
  const [vite, migration, docs] = await Promise.all([
    read('vite.config.ts'),
    read('drizzle/0003_kkumeum_family_schema.sql'),
    read('docs/KKUMEUM_FAMILY_PRODUCTION.md'),
  ]);

  assert.match(vite, /binding:\s*"FAMILY_DB"/);
  assert.match(vite, /database_name:\s*FAMILY_DATABASE_NAME/);
  assert.match(vite, /binding:\s*"FAMILY_FILES"/);
  assert.match(vite, /bucket_name:\s*FAMILY_R2_BUCKET_NAME/);
  assert.match(vite, /binding:\s*d1/);
  assert.match(vite, /binding:\s*r2/);
  assert.match(docs, /site-creator-d1/);
  assert.match(docs, /anihi-admissions-images/);

  for (const table of [
    'family_classes', 'family_students', 'class_enrollments', 'class_staff_assignments',
    'family_audit_logs', 'family_files', 'student_artworks', 'monthly_reports',
    'monthly_report_revisions', 'family_guardians', 'guardian_sessions', 'student_guardians',
    'announcements', 'announcement_targets', 'read_receipts', 'family_staff_notice_permissions',
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

  assert.doesNotMatch(migration, /INSERT\s+INTO/i);
});

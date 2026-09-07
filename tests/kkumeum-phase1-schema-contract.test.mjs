import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 Phase 1 schema is an explicit FAMILY_DB initializer with no generic DB fallback', async () => {
  const source = await read('worker/kkumeum-schema.ts');

  for (const table of [
    'family_classes',
    'family_students',
    'class_enrollments',
    'class_staff_assignments',
    'family_audit_logs',
  ]) {
    assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(source, /ensureKkumeumPhase1Schema\(familyDb: D1Database\)/);
  assert.match(source, /familyDb\.batch/);
  assert.doesNotMatch(source, /\benv\.DB\b/);
  assert.doesNotMatch(source, /familyDb\s*\|\|/);
});

test('teacher assignment relation is present before student CRUD is wired', async () => {
  const source = await read('worker/kkumeum-schema.ts');
  assert.match(source, /class_staff_assignments/);
  assert.match(source, /staff_user_id TEXT NOT NULL/);
  assert.match(source, /ended_at TEXT/);
  assert.match(source, /FOREIGN KEY \(class_id\) REFERENCES family_classes/);
});

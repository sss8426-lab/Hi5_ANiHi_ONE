import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 Phase 2 private report/artwork tables stay isolated in FAMILY_DB', async () => {
  const source = await read('worker/kkumeum-schema.ts');

  for (const table of [
    'family_files',
    'monthly_reports',
    'monthly_report_revisions',
    'student_artworks',
  ]) {
    assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(source, /ensureKkumeumPhase2Schema\(familyDb: D1Database\)/);
  assert.match(source, /await ensureKkumeumPhase1Schema\(familyDb\)/);
  assert.match(source, /CHECK \(status IN \('draft', 'ready', 'sent'\)\)/);
  assert.match(source, /UNIQUE\(student_id, year_month\)/);
  assert.match(source, /snapshot_json TEXT NOT NULL/);
  assert.match(source, /r2_key TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(source, /\benv\.DB\b/);
  assert.doesNotMatch(source, /\benv\.FILES\b/);
});

test('sent monthly reports are immutable and require a revision path', async () => {
  const state = await read('worker/kkumeum-report-state.ts');

  assert.match(state, /sent: \[\]/);
  assert.match(state, /status === "sent"/);
  assert.match(state, /revision/);
  assert.match(state, /DataCoreAccessError\(\s*409/);
  assert.doesNotMatch(state, /sent: \["draft"/);
  assert.doesNotMatch(state, /sent: \["ready"/);
});

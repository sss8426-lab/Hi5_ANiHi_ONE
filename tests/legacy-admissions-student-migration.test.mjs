import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/migrate-legacy-admissions-students.mjs', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'anihi-legacy-student-migration-'));
  const source = join(directory, 'source.json');
  const target = join(directory, 'target.json');
  const output = join(directory, 'merged.json');
  await writeFile(source, JSON.stringify({
    students: [
      { id: 1, grade: 'synthetic legacy conflicting grade', memo: 'synthetic legacy note' },
      { id: 2, grade: 'synthetic grade' },
      { memo: 'no stable id' },
      { id: 2, grade: 'duplicate source id' },
    ],
  }));
  await writeFile(target, JSON.stringify({
    students: [{ id: 1, grade: 'synthetic existing grade' }],
    universities: [{ id: 'university-1' }],
    cases: [{ id: 'case-1' }],
    awardFolders: [{ id: 'award-folder-1' }],
  }));
  return { source, target, output };
}

function run(...args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('legacy student migration is dry-run by default, skips every duplicate source ID, and never exposes student fields', async () => {
  const { source, target, output } = await fixture();
  const stdout = run('--source', source, '--target', target);
  const report = JSON.parse(stdout);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.sourceStudentCount, 4);
  assert.equal(report.added, 0);
  assert.equal(report.enriched, 1);
  assert.equal(report.ambiguous, 3);
  assert.equal(report.mergedStudentCount, 1);
  assert.deepEqual(report.preservedCollections, {
    universities: { before: 1, after: 1 },
    cases: { before: 1, after: 1 },
    awardFolders: { before: 1, after: 1 },
  });
  assert.ok(report.opaqueReportDigest);
  assert.equal(stdout.includes('synthetic legacy note'), false);
  assert.equal(stdout.includes('synthetic existing grade'), false);
  assert.equal(stdout.includes('synthetic legacy conflicting grade'), false);
  assert.equal(stdout.includes('synthetic grade'), false);
  assert.equal(stdout.includes('duplicate source id'), false);
  await assert.rejects(readFile(output));
});

test('apply enriches only missing fields, keeps duplicate source IDs out, preserves collections, and restore copies a verified private backup', async () => {
  const { source, target, output } = await fixture();
  const apply = JSON.parse(run('--source', source, '--target', target, '--out', output, '--apply'));
  const merged = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(apply.mode, 'apply');
  assert.equal(apply.added, 0);
  assert.equal(apply.ambiguous, 3);
  assert.equal(merged.students.length, 1);
  assert.equal(merged.students[0].id, 1);
  assert.equal(merged.students[0].grade, 'synthetic existing grade');
  assert.equal(merged.students[0].memo, 'synthetic legacy note');
  assert.equal(merged.universities.length, 1);
  assert.equal(merged.cases.length, 1);
  assert.equal(merged.awardFolders.length, 1);

  const restored = join((await fixture()).source, '..', 'restored.json');
  const restore = JSON.parse(run('--restore', '--backup', target, '--out', restored));
  assert.equal(restore.mode, 'restore');
  assert.deepEqual(JSON.parse(await readFile(restored, 'utf8')), JSON.parse(await readFile(target, 'utf8')));
});

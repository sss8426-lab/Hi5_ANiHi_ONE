import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function usage() {
  return 'Usage: node scripts/migrate-legacy-admissions-students.mjs --source <legacy.json> --target <current.json> [--out <merged.json> --apply] | --restore --backup <backup.json> --out <restore.json>';
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error(usage());
    const key = value.slice(2);
    if (key === 'apply' || key === 'restore') {
      args[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(usage());
    args[key] = next;
    index += 1;
  }
  return args;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function opaqueDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function stableStudentId(student) {
  if (!isRecord(student) || !hasValue(student.id)) return null;
  const id = String(student.id).trim();
  return id || null;
}

function mergeValue(current, incoming) {
  if (!hasValue(incoming)) return clone(current);
  if (!hasValue(current)) return clone(incoming);

  if (Array.isArray(current) && Array.isArray(incoming)) {
    const values = [...current];
    const seen = new Set(current.map(canonicalJson));
    for (const value of incoming) {
      const key = canonicalJson(value);
      if (!seen.has(key)) {
        values.push(clone(value));
        seen.add(key);
      }
    }
    return values;
  }

  if (isRecord(current) && isRecord(incoming)) {
    const merged = clone(current);
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = Object.hasOwn(merged, key) ? mergeValue(merged[key], value) : clone(value);
    }
    return merged;
  }

  // Existing non-empty scalar values are authoritative. The migration only fills gaps.
  return clone(current);
}

function collectionCount(data, key) {
  return Array.isArray(data?.[key]) ? data[key].length : 0;
}

function normalizeAdmissionsData(data) {
  if (!isRecord(data)) throw new Error('Admission data must be a JSON object.');
  return {
    ...clone(data),
    students: Array.isArray(data.students) ? clone(data.students) : [],
  };
}

function targetIndex(students) {
  const byId = new Map();
  const duplicates = new Set();
  for (const student of students) {
    const id = stableStudentId(student);
    if (!id) continue;
    if (byId.has(id)) duplicates.add(id);
    else byId.set(id, student);
  }
  return { byId, duplicates };
}

export function mergeLegacyStudents(sourceData, targetData) {
  const source = normalizeAdmissionsData(sourceData);
  const target = normalizeAdmissionsData(targetData);
  const merged = clone(target);
  const { byId, duplicates: targetDuplicates } = targetIndex(merged.students);
  const sourceIds = new Set();
  const report = {
    sourceStudentCount: source.students.length,
    targetStudentCount: target.students.length,
    added: 0,
    enriched: 0,
    unchanged: 0,
    ambiguous: 0,
    preservedCollections: {
      universities: { before: collectionCount(target, 'universities'), after: collectionCount(target, 'universities') },
      cases: { before: collectionCount(target, 'cases'), after: collectionCount(target, 'cases') },
      awardFolders: { before: collectionCount(target, 'awardFolders'), after: collectionCount(target, 'awardFolders') },
    },
  };

  for (const sourceStudent of source.students) {
    const id = stableStudentId(sourceStudent);
    if (!id || sourceIds.has(id) || targetDuplicates.has(id)) {
      report.ambiguous += 1;
      continue;
    }
    sourceIds.add(id);
    const current = byId.get(id);
    if (!current) {
      const added = clone(sourceStudent);
      merged.students.push(added);
      byId.set(id, added);
      report.added += 1;
      continue;
    }
    const candidate = mergeValue(current, sourceStudent);
    if (canonicalJson(candidate) === canonicalJson(current)) {
      report.unchanged += 1;
      continue;
    }
    const index = merged.students.indexOf(current);
    merged.students[index] = candidate;
    byId.set(id, candidate);
    report.enriched += 1;
  }

  report.mergedStudentCount = merged.students.length;
  report.opaqueReportDigest = opaqueDigest({
    sourceStudentCount: report.sourceStudentCount,
    targetStudentCount: report.targetStudentCount,
    mergedStudentCount: report.mergedStudentCount,
    added: report.added,
    enriched: report.enriched,
    unchanged: report.unchanged,
    ambiguous: report.ambiguous,
    studentIds: merged.students.map(stableStudentId).filter(Boolean).sort(),
  });
  return { merged, report };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.restore) {
    if (!args.backup || !args.out || args.source || args.target) throw new Error(usage());
    await copyFile(args.backup, args.out);
    const restored = normalizeAdmissionsData(await readJson(args.out));
    process.stdout.write(`${JSON.stringify({
      mode: 'restore',
      restoredStudentCount: restored.students.length,
      opaqueReportDigest: opaqueDigest(restored),
    })}\n`);
    return;
  }

  if (!args.source || !args.target || (args.apply && !args.out) || (!args.apply && args.out)) throw new Error(usage());
  const { merged, report } = mergeLegacyStudents(await readJson(args.source), await readJson(args.target));
  if (args.apply) await writeFile(args.out, `${JSON.stringify(merged)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...report })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

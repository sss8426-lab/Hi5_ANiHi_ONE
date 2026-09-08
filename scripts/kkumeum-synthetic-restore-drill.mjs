const MARKER = 'KKUMEUM_SYNTHETIC_RESTORE_ONLY';

function assertTarget(target) {
  if (target?.marker !== MARKER || target?.production === true) {
    throw new Error('Synthetic FAMILY restore requires an explicit isolated target marker.');
  }
}

// This script is intentionally Miniflare/test-only. It never receives Worker production bindings.
export async function runKkumeumSyntheticRestoreDrill({ sourceDb, sourceFiles, targetDb, targetFiles, target }) {
  assertTarget(target);
  await sourceDb.exec('CREATE TABLE synthetic_family_drill (kind TEXT PRIMARY KEY, parent_kind TEXT, payload TEXT NOT NULL);');
  await targetDb.exec('CREATE TABLE synthetic_family_drill (kind TEXT PRIMARY KEY, parent_kind TEXT, payload TEXT NOT NULL);');
  const fixture = [
    ['class', null, 'synthetic-class'], ['student', 'class', 'synthetic-student'],
    ['guardian-link', 'student', 'synthetic-guardian-link'], ['report-sent', 'student', 'synthetic-report'],
    ['artwork', 'student', 'synthetic-artwork'], ['announcement', 'class', 'synthetic-announcement'],
    ['consent', 'guardian-link', 'synthetic-consent-v1'], ['retention-policy', 'class', 'synthetic-policy-v1'],
  ];
  for (const row of fixture) await sourceDb.prepare('INSERT INTO synthetic_family_drill (kind, parent_kind, payload) VALUES (?, ?, ?)').bind(...row).run();
  await sourceFiles.put('synthetic-drill/artwork.txt', 'synthetic-artwork');
  const rows = await sourceDb.prepare('SELECT kind, parent_kind, payload FROM synthetic_family_drill ORDER BY kind').all();
  for (const row of rows.results || []) await targetDb.prepare('INSERT INTO synthetic_family_drill (kind, parent_kind, payload) VALUES (?, ?, ?)').bind(row.kind, row.parent_kind, row.payload).run();
  const sourceObject = await sourceFiles.get('synthetic-drill/artwork.txt');
  if (!sourceObject) throw new Error('Synthetic source object is missing.');
  await targetFiles.put('synthetic-drill/artwork.txt', await new Response(sourceObject.body).text());
  const restoredObject = await targetFiles.get('synthetic-drill/artwork.txt');
  if (!restoredObject || await new Response(restoredObject.body).text() !== 'synthetic-artwork') throw new Error('Synthetic file checksum check failed.');
  const restored = await targetDb.prepare('SELECT COUNT(*) AS count FROM synthetic_family_drill').first();
  await sourceFiles.delete('synthetic-drill/artwork.txt');
  await targetFiles.delete('synthetic-drill/artwork.txt');
  return { rows: Number(restored?.count || 0), filesCleaned: true };
}

// Run a schema-preparation step (CREATE TABLE IF NOT EXISTS …) once per database binding per worker
// instance instead of on every request. A failed run is forgotten so the next request tries again.
//
// 새 작업자 첫 요청 줄이기: once a deployment has prepared a step on a database, it is written down in
// core_schema_stamps under that deployment's version id. A fresh worker instance of the same deployment
// reads the stamps once (one D1 round trip) and skips every step already done, instead of re-running
// dozens of CREATE/ALTER statements. Every new deployment has a new id, so each step runs again once
// after each deploy. Without a version id (local runs, tests) every step simply runs, as before.
const prepared = new WeakMap<object, Map<string, Promise<void>>>();
const stampSets = new WeakMap<object, Promise<Set<string> | null>>();
let build: string | null = null;

export function setSchemaBuild(id: unknown) { if (typeof id === 'string' && id) build = id; }

function stampsFor(db: D1Database): Promise<Set<string> | null> {
  if (!build) return Promise.resolve(null);
  let stamps = stampSets.get(db);
  if (!stamps) {
    const id = build;
    stamps = db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS core_schema_stamps (build TEXT NOT NULL, key TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (build, key))'),
      db.prepare('SELECT key FROM core_schema_stamps WHERE build = ?').bind(id),
    ]).then(results => new Set(((results[1].results || []) as { key: string }[]).map(row => row.key)))
      .catch(() => null); // stamps are only a shortcut: without them every step runs
    stampSets.set(db, stamps);
  }
  return stamps;
}

export function schemaOnce(db: D1Database, key: string, run: () => Promise<void>): Promise<void> {
  let steps = prepared.get(db);
  if (!steps) { steps = new Map(); prepared.set(db, steps); }
  let step = steps.get(key);
  if (!step) {
    step = (async () => {
      const stamps = await stampsFor(db);
      if (stamps?.has(key)) return;
      await run();
      if (stamps && build) {
        stamps.add(key);
        // Old deployments' stamps are cleared as this one writes its own.
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO core_schema_stamps (build, key, applied_at) VALUES (?, ?, ?)').bind(build, key, new Date().toISOString()),
          db.prepare('DELETE FROM core_schema_stamps WHERE build <> ?').bind(build),
        ]).catch(() => {});
      }
    })().catch((error) => { steps!.delete(key); throw error; });
    steps.set(key, step);
  }
  return step;
}

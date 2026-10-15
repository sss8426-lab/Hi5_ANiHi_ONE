// Run a schema-preparation step (CREATE TABLE IF NOT EXISTS …) once per database binding per worker
// instance instead of on every request. A failed run is forgotten so the next request tries again.
const prepared = new WeakMap<object, Map<string, Promise<void>>>();

export function schemaOnce(db: D1Database, key: string, run: () => Promise<void>): Promise<void> {
  let steps = prepared.get(db);
  if (!steps) { steps = new Map(); prepared.set(db, steps); }
  let step = steps.get(key);
  if (!step) {
    step = run().catch((error) => { steps!.delete(key); throw error; });
    steps.set(key, step);
  }
  return step;
}

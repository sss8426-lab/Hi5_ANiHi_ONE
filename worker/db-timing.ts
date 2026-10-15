// 속도 측정: every API response carries `Server-Timing: db;dur=…;desc="N queries"`, so slow screens can be
// traced to the D1 round trips behind them (each round trip is ~35ms between HKG and ICN). The database
// object is wrapped once per binding — schemaOnce and other per-database memos keep working — and the
// counters live in AsyncLocalStorage, so concurrent requests in one worker never mix their numbers.
import { AsyncLocalStorage } from 'node:async_hooks';

type Meter = { count: number; ms: number; started: number };
const meters = new AsyncLocalStorage<Meter>();
const wrapped = new WeakMap<object, unknown>();
const RAW = Symbol('raw-statement');

async function timed<T>(run: () => Promise<T>, queries = 1): Promise<T> {
  const meter = meters.getStore();
  if (!meter) return run();
  const start = performance.now();
  try { return await run(); } finally { meter.count += queries; meter.ms += performance.now() - start; }
}

function statement(raw: D1PreparedStatement): D1PreparedStatement {
  return new Proxy(raw, {
    get(target, key) {
      if (key === RAW) return target;
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (key === 'bind') return (...args: unknown[]) => statement(value.apply(target, args));
      if (key === 'first' || key === 'all' || key === 'run' || key === 'raw') return (...args: unknown[]) => timed(() => value.apply(target, args));
      return value.bind(target);
    },
  });
}

export function timedDb<T extends D1Database | undefined>(db: T): T {
  if (!db) return db;
  const known = wrapped.get(db);
  if (known) return known as T;
  const proxy = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (key === 'prepare') return (sql: string) => statement(value.call(target, sql));
      if (key === 'batch') return (list: D1PreparedStatement[]) =>
        timed(() => value.call(target, list.map(s => (s as unknown as Record<symbol, D1PreparedStatement>)[RAW] || s)), list.length);
      return value.bind(target);
    },
  });
  wrapped.set(db, proxy);
  return proxy as T;
}

/** Runs one request with fresh counters and adds the Server-Timing header to API responses. */
export async function withDbTiming(request: Request, run: () => Promise<Response>): Promise<Response> {
  const meter: Meter = { count: 0, ms: 0, started: performance.now() };
  const response = await meters.run(meter, run);
  if (!new URL(request.url).pathname.startsWith('/api/')) return response;
  const value = `db;dur=${meter.ms.toFixed(1)};desc="${meter.count} queries", app;dur=${(performance.now() - meter.started).toFixed(1)}`;
  try { response.headers.append('server-timing', value); return response; } catch {
    const copy = new Response(response.body, response);
    copy.headers.append('server-timing', value);
    return copy;
  }
}

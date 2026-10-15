// 같은 요청 나눠 쓰기: several scripts on one page often ask the same API at almost the same time
// (꿈이음 asked /api/data-core/context 3번, campuses 3번, announcements 3번 …). Identical GET /api/ requests
// that are in flight or finished within the last 1.5 seconds share one answer. Any other method
// (저장·삭제) clears the shared answers first, so a read right after a change always goes to the server.
(() => {
  if (window.__coreFetchShare || typeof window.fetch !== 'function') return;
  window.__coreFetchShare = true;
  const original = window.fetch.bind(window);
  const shared = new Map();
  const KEEP_MS = 1500;
  window.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') { shared.clear(); return original(input, init); }
    const url = new URL(request ? request.url : String(input), location.href);
    // Only plain reads of our own API: no body, no abort signal, no custom request object.
    if (request || init.signal || init.body || url.origin !== location.origin || !url.pathname.startsWith('/api/') || method !== 'GET') return original(input, init);
    const key = `${url.href}|${init.cache || ''}|${init.credentials || ''}|${JSON.stringify(init.headers || {})}`;
    for (const [k, v] of shared) if (v.done && Date.now() - v.done >= KEEP_MS) shared.delete(k); // let old answers go
    const hit = shared.get(key);
    if (hit && (!hit.done || Date.now() - hit.done < KEEP_MS)) return hit.promise.then(response => response.clone());
    const entry = { done: 0, promise: original(input, init) };
    shared.set(key, entry);
    entry.promise.then(response => { if (!response.ok) shared.delete(key); else entry.done = Date.now(); }, () => shared.delete(key));
    return entry.promise.then(response => response.clone());
  };
})();

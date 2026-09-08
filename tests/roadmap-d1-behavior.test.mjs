import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';

test('roadmap D1 schema supports fresh and repeated reads without replacing existing knowledge', async () => {
  const mf = new Miniflare({ script: "export default { fetch() { return new Response('ok'); } }", modules: true, d1Databases: ['DB'], d1Persist: false });
  try {
    const { default: worker } = await import('../dist/server/index.js');
    const db = await mf.getD1Database('DB');
    const env = { DB: db, DATA_CORE_SUPER_ADMIN_EMAILS: 'roadmap-admin@example.test' };
    const headers = { 'oai-authenticated-user-id': 'synthetic-roadmap-admin', 'oai-authenticated-user-email': 'roadmap-admin@example.test', 'oai-authenticated-user-full-name': 'Synthetic Admin' };
    const request = (path, authenticated = true) => worker.fetch(new Request(`http://localhost${path}`, { headers: authenticated ? headers : {} }), env, { waitUntil() {}, passThroughOnException() {} });
    const unauthenticated = await request('/api/data-core/roadmap/goals', false);
    assert.equal(unauthenticated.status, 401);

    const first = await request('/api/data-core/roadmap/goals');
    assert.equal(first.status, 200, await first.clone().text());
    const { goals } = await first.json();
    assert.ok(goals.length > 0);
    const goal = goals.find(g => g.nodeType === 'career');
    assert.ok(goal);
    await db.prepare('UPDATE knowledge_nodes SET summary = ? WHERE id = ?').bind('Synthetic preservation marker', goal.id).run();
    const counts = async () => ({ nodes: await db.prepare('SELECT COUNT(*) AS count FROM knowledge_nodes').first('count'), edges: await db.prepare('SELECT COUNT(*) AS count FROM knowledge_edges').first('count') });
    const before = await counts();
    for (let i = 0; i < 2; i++) {
      const repeated = await request('/api/data-core/roadmap/goals');
      assert.equal(repeated.status, 200);
      assert.equal((await repeated.json()).goals.find(g => g.id === goal.id).summary, 'Synthetic preservation marker');
      const detail = await request(`/api/data-core/roadmap?goalId=${encodeURIComponent(goal.id)}`);
      assert.equal(detail.status, 200, await detail.clone().text());
      assert.ok(Array.isArray((await detail.json()).roadmap.universityPrograms));
    }
    assert.deepEqual(await counts(), before);
    assert.equal(await db.prepare('SELECT summary FROM knowledge_nodes WHERE id = ?').bind(goal.id).first('summary'), 'Synthetic preservation marker');
  } finally { await mf.dispose(); }
});

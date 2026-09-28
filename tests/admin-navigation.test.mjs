import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

const source = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
test('admin navigation has two entries and one permission implementation', async () => {
  const nav = await source('public/data-core/work-navigation.js');
  assert.match(nav, /\['operations','운영관리'/);
  assert.match(nav, /\['accounts','계정·권한 관리'/);
  assert.doesNotMatch(nav, /\['(?:readiness|admin)',/);
  const index = await source('public/data-core/index.html');
  assert.doesNotMatch(index, /처음으로|id="membershipForm"|id="view-admin"/);
  assert.match(index, /상담용 홈/);
  assert.doesNotMatch(await source('public/data-core/app.js'), /async function (?:grant|revoke|load)Membership/);
  const accounts = await source('public/data-core/accounts.html');
  for (const id of ['accountsTab', 'rolesTab', 'accountsPanel', 'rolesPanel', 'membershipForm', 'memberUser', 'memberCampus']) assert.match(accounts, new RegExp(`id="${id}"`));
  for (const page of ['accounts', 'operations']) {
    const header = (await source(`public/data-core/${page}.html`)).match(/<header[\s\S]*?<\/header>/)[0];
    assert.equal((header.match(/<a /g) || []).length, 1);
    assert.match(header, /href="\/data-core\/work"/);
  }
  assert.match(await source('public/data-core/design-system.css'), /mode-home-artwork-active :is\(\.sidebar, \.core-menu-toggle, \.core-nav-dialog\) \{ display: none; \}/);
});

test('legacy admin links redirect after existing authentication and master gates', async () => {
  const h = await libraryHarness();
  try {
    for (const path of ['/data-core/readiness', '/data-core/readiness/', '/data-core/readiness.html']) {
      const master = await h.request('GET', path);
      assert.equal(master.status, 302, path);
      assert.equal(master.headers.get('location'), '/data-core/operations#diagnosticPanel');
      assert.equal((await h.request('GET', path, users.campusAdmin)).status, 403);
    }
    const legacy = await h.request('GET', '/data-core/work?view=admin');
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), '/data-core/accounts?tab=roles');
    for (const actor of [users.campusAdmin, users.teacher, users.foreign]) {
      for (const path of ['/data-core/accounts?tab=roles', '/data-core/operations', '/api/data-core/admin/memberships', '/api/data-core/admin/users', '/api/auth/accounts']) {
        assert.equal((await h.request('GET', path, actor)).status, 403, path);
      }
    }
    assert.equal((await h.request('GET', '/api/data-core/admin/memberships', null)).status, 401);
  } finally { await h.mf.dispose(); }
});

test('moved roles tab retains userId grants, revocation and campus scope protection', async () => {
  const h = await libraryHarness();
  try {
    const payload = { userId: 'oai:' + users.outsider.id, campusId: B, role: 'TEACHER' };
    for (const actor of [users.campusAdmin, users.teacher, users.foreign]) {
      assert.equal((await h.request('POST', '/api/data-core/admin/memberships', actor, payload)).status, 403);
    }
    const grant = await h.request('POST', '/api/data-core/admin/memberships', users.admin, payload);
    assert.equal(grant.status, 201);
    assert.equal(grant.body.membership.campusId, B);
    const path = '/api/data-core/admin/memberships/' + encodeURIComponent(grant.body.membership.id);
    assert.equal((await h.request('DELETE', path, users.campusAdmin)).status, 403);
    assert.equal((await h.request('DELETE', path, users.admin)).status, 200);
    assert.equal((await h.request('POST', '/api/data-core/admin/memberships', users.admin, { ...payload, userId: 'oai:' + users.campusAdmin.id, campusId: B })).status, 409);
    const campuses = await h.request('GET', '/api/data-core/campuses', users.campusAdmin);
    assert.deepEqual(campuses.body.campuses.map(campus => campus.id), [A]);
  } finally { await h.mf.dispose(); }
});

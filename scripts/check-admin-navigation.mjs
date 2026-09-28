import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { libraryHarness, users, A } from '../tests/support/library-harness.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const worker = (await import('../dist/server/index.js')).default;
const h = await libraryHarness();
const root = resolve('public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
h.env.ASSETS = { fetch: async request => {
  const file = resolve(root, '.' + new URL(request.url).pathname);
  if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) return new Response(null, { status: 404 });
  try { return new Response(await readFile(file), { headers: { 'content-type': types[extname(file)] || 'application/octet-stream' } }); }
  catch { return new Response(null, { status: 404 }); }
} };
for (const [loginId, role, campusId] of [['nav-master', 'MASTER', null], ['nav-campus', 'CAMPUS_ADMIN', A]]) {
  const result = await h.request('POST', '/api/auth/accounts', users.admin, { loginId, displayName: loginId, role, campusId, temporaryPassword: 'Synthetic-Only-2026!' });
  assert.equal(result.status, 201);
}
await h.env.DB.prepare('UPDATE auth_accounts SET must_change_password=0').run();
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await worker.fetch(new Request(`http://localhost:${server.address().port}${req.url}`, {
      method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    }), h.env, { waitUntil() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://localhost:${server.address().port}`;
const out = resolve('outputs/admin-navigation'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [], checks = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const login = async (target, id) => {
    await target.goto(base + '/data-core/login');
    await target.locator('#loginId').fill(id);
    await target.locator('#password').fill('Synthetic-Only-2026!');
    await target.locator('#loginForm button[type=submit]').click();
    await target.waitForURL(base + '/data-core');
    await target.locator('#view-mode-home.active').waitFor();
  };
  await login(page, 'nav-master');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('.sidebar:visible, .core-menu-toggle:visible').count(), 0);
    assert.equal(await page.locator('[data-mode-card]:visible').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `mode overflow ${width}`);
    await page.screenshot({ path: `${out}/mode-${width}.png`, fullPage: true });
  }
  checks.push('login mode selection, no sidebar/menu, six widths');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-mode-card="work"]').click();
  await page.locator('#view-work-home.active').waitFor();
  await page.locator('[data-work-menu="accounts"]:visible').waitFor();
  assert.equal(await page.locator('[data-work-navigation="admin"] .nav-item').count(), 2);
  assert.equal(await page.getByText('처음으로', { exact: true }).count(), 0);
  await page.locator('[data-work-menu="accounts"]').click();
  await page.locator('#accountsBody tr').first().waitFor();
  await page.locator('#rolesTab').click();
  await page.locator('#memberUser option').nth(1).waitFor({ state: 'attached' });
  assert.equal(await page.locator('#rolesPanel').isVisible(), true);
  await page.locator('#rolesTab').press('ArrowLeft');
  assert.equal(await page.locator('#accountsTab').getAttribute('aria-selected'), 'true');
  await page.goBack();
  assert.equal(await page.locator('#rolesTab').getAttribute('aria-selected'), 'true');
  await page.locator('#memberUser').selectOption('oai:' + users.outsider.id);
  await page.locator('#memberCampus').selectOption(A);
  await page.locator('#memberRole').selectOption('STAFF');
  await page.locator('#grantMembershipBtn').click();
  const memberId = `membership:oai:${users.outsider.id}:${A}:staff`;
  const revoke = page.locator('[data-delete-membership]').filter({ visible: true });
  await page.locator(`[data-delete-membership="${memberId}"]`).waitFor();
  await page.reload();
  await page.locator(`[data-delete-membership="${memberId}"]`).waitFor();
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-delete-membership="${memberId}"]`).click();
  await page.locator(`[data-delete-membership="${memberId}"]`).waitFor({ state: 'detached' });
  assert.ok(await revoke.count() > 0);
  checks.push('role tab keyboard/history, real isolated API grant/reload/revoke');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `roles overflow ${width}`);
    await page.screenshot({ path: `${out}/roles-${width}.png`, fullPage: true });
    await page.locator('#accountsTab').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `accounts overflow ${width}`);
    await page.screenshot({ path: `${out}/accounts-${width}.png`, fullPage: true });
    await page.locator('#rolesTab').click();
  }
  checks.push('account/roles layout six widths');
  await page.goto(base + '/data-core/work?view=admin');
  await page.waitForURL('**/data-core/accounts?tab=roles');
  await page.locator('#rolesPanel:visible').waitFor();
  await page.goto(base + '/data-core/readiness');
  await page.waitForURL('**/data-core/operations#diagnosticPanel');
  await page.locator('#bindingStatus').filter({ hasText: 'D1 연결됨' }).waitFor();
  assert.equal(await page.locator('.ops-header-actions a').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#runDiagnosticsBtn').click();
  await page.locator('#diagnosticStatus').filter({ hasText: '정상' }).waitFor();
  checks.push('legacy routes, isolated D1/R2 system check');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/data-core/counseling');
  await page.locator('[data-view="counseling-home"]:visible').waitFor();
  assert.match(await page.locator('[data-view="counseling-home"]').innerText(), /상담용 홈/);
  await page.screenshot({ path: `${out}/counseling.png`, fullPage: true });
  const campus = await browser.newPage();
  campus.on('pageerror', error => errors.push(error.message));
  await login(campus, 'nav-campus');
  await campus.goto(base + '/data-core/work');
  await campus.locator('#view-work-home.active').waitFor();
  assert.equal(await campus.locator('[data-work-navigation="admin"]:visible').count(), 0);
  for (const path of ['/data-core/accounts?tab=roles', '/data-core/operations', '/data-core/readiness', '/api/data-core/admin/memberships', '/api/auth/accounts']) assert.equal((await campus.request.get(base + path)).status(), 403);
  checks.push('counseling home label, campus menu and server denials');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/result.json`, JSON.stringify({ checks, pageErrors: errors, syntheticOnly: true }, null, 2));
  console.log(JSON.stringify({ checks, pageErrors: errors, syntheticOnly: true }));
} finally {
  await browser.close(); await new Promise(done => server.close(done)); await h.mf.dispose();
}

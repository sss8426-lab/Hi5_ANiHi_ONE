// Real built Worker APIs, isolated D1/R2; optional deployed-asset verification only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { libraryHarness, users, ORG, A } from '../tests/support/library-harness.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv.includes('--preview') ? new URL(process.argv[process.argv.indexOf('--preview') + 1]).origin : null;
const out = resolve('outputs/campus-library' + (preview ? '-preview' : ''));
await mkdir(out, { recursive: true });
const h = await libraryHarness();
let user = users.admin;
const retired = 'campus-synthetic-acceptance-20260909';
await h.env.DB.prepare(`INSERT INTO campuses (id,organization_id,code,name,status,created_at,updated_at)
  VALUES (?,?,'synthetic-acceptance-20260909','SYNTHETIC TEST 20260909','active','2026-09-14','2026-09-14')`).bind(retired, ORG).run();
assert.equal((await h.request('POST', '/api/auth/accounts', users.admin, {
  displayName: 'Synthetic Retired', loginId: 'syntheticretired', campusId: retired, role: 'STAFF', temporaryPassword: 'Synthetic-only-2026!',
})).status, 201);
const created = await h.folder(`category:${A}:class-photo`, '수업 기록');
assert.equal(created.status, 201);
const child = await h.folder(created.body.folder.id, '장면 연출');
assert.equal(child.status, 201);
const expected = (await h.request('GET', '/api/data-core/campuses')).body.campuses;
assert.equal(expected.length, 10);
const checked = new Set(), errors = [];
const root = resolve('public');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (/^\/api\/data-core\/competition-sources\/[^/]+\/preview$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [], warnings: [] })); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const response = await h.raw(req.method, url.pathname + url.search, user, body);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer())); return;
    }
    const path = url.pathname === '/data-core/accounts' ? '/data-core/accounts.html' : /^\/data-core\/work\/(library|attendance)$/.test(url.pathname) ? '/data-core/index.html' :
      /^\/data-core\/content\/(blog|instagram)$/.test(url.pathname) ? '/data-core/content.html' : url.pathname;
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    if (preview && !checked.has(path)) {
      const response = await fetch(preview + path);
      assert.equal(response.status, 200, path);
      const hash = value => createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(path) ? value.toString('utf8').replace(/\r\n/g, '\n') : value).digest('hex');
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(bytes), 'deployed asset mismatch ' + path);
      checked.add(path);
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch (error) { errors.push(String(error)); res.writeHead(500).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const result = { preview, widths: [], campuses: expected.map(c => c.name) };
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  page.on('pageerror', error => errors.push(error.message));
  async function options(selector) {
    await page.waitForFunction(selector => document.querySelector(selector)?.options.length >= 10, selector);
    return page.locator(selector + ' option').evaluateAll(nodes => nodes.filter(n => n.value).map(n => ({ id: n.value, name: n.textContent })));
  }
  const expectedOptions = expected.map(c => ({ id: c.id, name: c.name }));
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/data-core/work/library');
    await page.waitForFunction(() => document.querySelectorAll('#libraryFolders [data-lb-folder]').length >= 14);
    const library = await page.locator('#libraryFolders .lb-folder-group').evaluateAll(nodes => nodes.map(n => ({
      group: n.querySelector('h3').textContent,
      folders: [...n.querySelectorAll('[data-lb-folder]')].map(a => [a.dataset.lbFolder, a.textContent.trim()]),
    })));
    assert.deepEqual(library.find(g => g.group === '캠퍼스').folders, expected.map(c => ['campus:' + c.id, c.name]));
    assert.equal(await page.getByText('SYNTHETIC TEST 20260909', { exact: true }).count(), 0);
    await page.screenshot({ path: resolve(out, `library-${width}.png`), fullPage: true });
    for (const channel of ['blog', 'instagram']) {
      await page.goto(origin + '/data-core/content/' + channel);
      assert.deepEqual(await options('#draftCampus'), expectedOptions);
      await page.waitForFunction(() => document.querySelectorAll('#photoFolders [data-folder]').length >= 14);
      const content = await page.locator('.photo-folder-group').evaluateAll(nodes => nodes.map(n => ({
        group: n.querySelector('h3').textContent,
        folders: [...n.querySelectorAll('[data-folder]')].map(a => [a.dataset.folder, a.textContent.trim()]),
      })));
      assert.deepEqual(content, library, channel + ' tree must exactly match library');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: resolve(out, `${channel}-${width}.png`), fullPage: true });
      await page.locator('#draftCampus').selectOption(A);
      await page.locator(`#photoFolders [data-folder="category:${A}:class-photo"]`).click();
      await page.locator(`#photoFolders [data-folder="${created.body.folder.id}"]`).click();
      await page.locator(`#photoFolders [data-folder="${child.body.folder.id}"]`).click();
      await page.waitForFunction(() => document.querySelector('#photoBreadcrumb').textContent.includes('장면 연출'));
      assert.match(await page.locator('#photoBreadcrumb').textContent(), /부천 애니 입시본원/);
      await page.locator('#photoBreadcrumb [data-folder="root"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#photoFolders [data-folder]').length >= 14);
      assert.equal(await page.locator('#draftCampus').inputValue(), '', 'root breadcrumb restores organization scope');
    }
    await page.goto(origin + '/data-core/work/attendance');
    assert.deepEqual(await options('#atCampus'), expectedOptions);
    assert.equal(await page.getByText('SYNTHETIC TEST 20260909', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(out, `attendance-${width}.png`), fullPage: true });
    result.widths.push(width);
  }
  await page.goto(origin + '/data-core/accounts');
  assert.deepEqual(await options('#campusId'), expectedOptions);
  await page.locator('#retiredAccountsFilter').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#accountsBody').getByText('Synthetic Retired').count(), 0);
  await page.locator('#showRetiredAccounts').check();
  assert.equal(await page.locator('#accountsBody').getByText('Synthetic Retired').count(), 1);
  await page.locator('#showRetiredAccounts').uncheck();
  assert.equal(await page.locator('#accountsBody').getByText('Synthetic Retired').count(), 0);
  user = users.teacher;
  for (const channel of ['blog', 'instagram']) {
    await page.goto(origin + '/data-core/content/' + channel);
    await page.waitForFunction(() => document.querySelector('#draftCampus')?.options.length === 1);
    assert.equal(await page.locator('#draftCampus').inputValue(), A);
    assert.equal(await page.locator('#draftCampus option').textContent(), '부천 애니 입시본원');
  }
  assert.deepEqual(errors, []);
  result.deployedAssetsChecked = checked.size;
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close(); await new Promise(done => server.close(done)); await h.mf.dispose();
}

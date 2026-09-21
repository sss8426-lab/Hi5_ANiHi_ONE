import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { libraryHarness, users, A } from '../tests/support/library-harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv.includes('--preview') ? new URL(process.argv[process.argv.indexOf('--preview') + 1]).origin : null;
const root = path.resolve('public'), out = path.resolve('outputs/calendar-browser');
await fs.mkdir(out, { recursive: true });
const h = await libraryHarness(), checked = new Set(), errors = [], writes = [], timings = [];
let role = users.campusAdmin, failWrite = false, releaseWrite, holdWrite = false, releaseRead, holdRead = false;
let reads = 0;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.includes('/competition-sources/')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [], pages: [] })); return;
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes.toString()) : undefined;
      const calendar = url.pathname.startsWith('/api/data-core/calendar');
      if (calendar && req.method !== 'GET') {
        writes.push({ method: req.method, body });
        if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; });
        if (failWrite) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'SYNTHETIC_RETRY' })); return; }
      }
      const result = await h.raw(req.method, url.pathname + url.search, role, body);
      const responseBytes = Buffer.from(await result.arrayBuffer());
      if (calendar && req.method === 'GET') {
        reads++;
        if (holdRead) { holdRead = false; await new Promise(resolve => { releaseRead = resolve; }); }
      }
      res.writeHead(result.status, Object.fromEntries(result.headers)).end(responseBytes); return;
    }
    const pathname = ['/data-core/work', '/data-core/counseling'].includes(url.pathname) ? '/data-core/index.html' : url.pathname;
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await fs.readFile(file);
    if (preview && !checked.has(pathname)) {
      const remote = await fetch(preview + pathname);
      const hash = value => createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(pathname) ? value.toString('utf8').replace(/\r\n/g, '\n') : value).digest('hex');
      assert.equal(remote.status, 200, pathname);
      assert.equal(hash(Buffer.from(await remote.arrayBuffer())), hash(bytes), pathname);
      checked.add(pathname);
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(error.message);
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    const NativeObserver = window.MutationObserver;
    window.calendarMetrics = { observers: 0, callbacks: 0 };
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        let calendar = false;
        super((records, observer) => { if (calendar) window.calendarMetrics.callbacks++; callback(records, observer); });
        const observe = this.observe.bind(this);
        this.observe = (target, options) => {
          if (target.hasAttribute?.('data-calendar-home') && !calendar) { calendar = true; window.calendarMetrics.observers++; }
          observe(target, options);
        };
      }
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const home = page.locator('#view-work-home');
  await page.goto(origin + '/data-core/work');
  await home.locator('[data-calendar-add]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#calendarCampus').options.length > 0);
  // Calendar redraws used to leave orphan observers and multiply callback work.
  for (let i = 0; i < 40; i++) await home.locator('[data-calendar-date]:not(.outside)').nth(i % 20).click();
  const metrics = await page.evaluate(() => window.calendarMetrics);
  assert.equal(metrics.observers, 2); assert.ok(metrics.callbacks < 100, JSON.stringify(metrics));
  const widths = [1920, 1440, 1280, 1024, 820, 768, 430, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await home.locator('[data-calendar-add]').click();
    assert.equal(await page.locator('#calendarCampus').inputValue(), A);
    assert.equal(await page.locator('#calendarCampus option').count(), 1);
    const start = performance.now();
    await page.locator('#calendarTitle').fill('SYNTHETIC_원종캠퍼스 전시회');
    await page.locator('#calendarSummary').fill('한글 입력과 수정 검증');
    timings.push({ width, inputMs: Math.round(performance.now() - start) });
    assert.equal(await page.locator('#calendarTitle').inputValue(), 'SYNTHETIC_원종캠퍼스 전시회');
    await page.locator('#calendarStartDate').fill('2026-10-24');
    await page.locator('#calendarEndDate').fill('2026-10-25');
    assert.ok(await page.locator('#calendarSubmitBtn').isEnabled());
    assert.equal(await page.evaluate(() => {
      const el = document.querySelector('#calendarModal .modal'), r = el.getBoundingClientRect();
      return r.left < 0 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1;
    }), false, `modal overflow ${width}`);
    await page.screenshot({ path: `${out}/calendar-${width}.png` });
    await page.locator('[data-close-modal="calendarModal"]').click();
  }
  await home.locator('[data-calendar-add]').click();
  await page.locator('#calendarTitle').fill('SYNTHETIC_원종캠퍼스 전시회');
  await page.locator('#calendarStartDate').fill('2026-10-24');
  await page.locator('#calendarEndDate').fill('2026-10-23');
  await page.locator('#calendarSubmitBtn').click();
  assert.equal(writes.length, 0);
  await page.locator('#calendarFormError').getByText('종료일은 시작일과 같거나 이후여야 합니다.').waitFor();
  await page.locator('#calendarEndDate').fill('2026-10-25');
  failWrite = true;
  await page.locator('#calendarSubmitBtn').click();
  await page.locator('#calendarFormError').getByText('SYNTHETIC_RETRY').waitFor();
  assert.equal(await page.locator('#calendarTitle').inputValue(), 'SYNTHETIC_원종캠퍼스 전시회');
  failWrite = false; holdWrite = true;
  const count = writes.length;
  await page.locator('#calendarSubmitBtn').click();
  await page.waitForFunction(() => document.querySelector('#calendarForm').getAttribute('aria-busy') === 'true');
  await page.locator('#calendarForm').dispatchEvent('submit');
  assert.ok(await page.locator('#calendarSubmitBtn').isDisabled());
  await page.locator('[data-close-modal="calendarModal"]').click();
  assert.ok(await page.locator('#calendarModal').isVisible());
  await new Promise(resolve => { const check = () => releaseWrite ? resolve() : setTimeout(check, 10); check(); });
  assert.equal(writes.length, count + 1);
  const changesMonth = !(await home.locator('[data-calendar-month]').textContent()).includes('2026년 10월');
  const refreshed = changesMonth ? page.waitForResponse(response => response.url().includes('/calendar?from=2026-10') && response.ok()) : Promise.resolve();
  holdWrite = false; releaseWrite();
  await page.locator('#calendarModal.hidden').waitFor({ state: 'attached' });
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_원종캠퍼스 전시회', { exact: true }).waitFor();
  await refreshed;
  const readsBeforeEdit = reads;
  await home.locator('[data-calendar-edit]').click();
  await page.locator('#calendarTitle').fill('SYNTHETIC_수정 완료');
  await page.locator('#calendarEndDate').fill('');
  await page.locator('#calendarSubmitBtn').click();
  await page.locator('#calendarModal.hidden').waitFor({ state: 'attached' });
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_수정 완료', { exact: true }).waitFor();
  assert.equal(reads, readsBeforeEdit, 'same-month save does not wait for a redundant GET');
  const listed = await h.request('GET', '/api/data-core/calendar?from=2026-10-01&to=2026-10-31', role);
  assert.equal(listed.body.events.length, 1);
  assert.equal(listed.body.events[0].metadata.endDate, undefined);
  // An older month request must never replace the newest navigation result.
  holdRead = true;
  await home.locator('[data-calendar-next]').click();
  await new Promise(resolve => { const check = () => releaseRead ? resolve() : setTimeout(check, 10); check(); });
  await home.locator('[data-calendar-prev]').click();
  releaseRead();
  await home.locator('[data-calendar-date="2026-10-24"]').click();
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_수정 완료', { exact: true }).waitFor();
  await page.reload();
  await home.locator('[data-calendar-add]').waitFor({ state: 'visible' });
  role = users.master;
  await page.goto(origin + '/data-core/counseling');
  const counseling = page.locator('#view-counseling-home');
  await counseling.locator('[data-calendar-add]').click();
  await page.waitForFunction(() => document.querySelector('#calendarCampus').options.length > 1);
  await page.locator('#calendarCampus').selectOption('');
  assert.equal(await page.locator('#calendarCampus option:checked').textContent(), '조직 공통');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ scope: 'real Worker + isolated synthetic D1/R2; no production writes', preview, checkedAssets: checked.size, widths, metrics, timings, writes: writes.length, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, metrics, timings, checkedAssets: checked.size }));
} finally {
  releaseRead?.(); releaseWrite?.();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await h.mf.dispose();
}

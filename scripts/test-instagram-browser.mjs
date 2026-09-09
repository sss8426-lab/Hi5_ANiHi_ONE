import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encode, decode } from 'fast-png';
import sharp from 'sharp';

// Entirely synthetic, loopback-only UI fixture. No production services or credentials.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const width = 320, height = 200, pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  pixels.set([Math.round(x / width * 255), Math.round(y / height * 255), 110, 255], i);
}
const png = encode({ width, height, channels: 4, depth: 8, data: pixels });
const images = {
  'synthetic-png': { mime: 'image/png', bytes: png },
  'synthetic-jpeg': { mime: 'image/jpeg', bytes: await sharp(png).jpeg().toBuffer() },
  'synthetic-webp': { mime: 'image/webp', bytes: await sharp(png).webp().toBuffer() },
};
let authenticated = true, deniedSource = false;
const files = Object.entries(images).map(([id, image]) => ({ id, mimeType: image.mime, fileName: `${id}.${image.mime.split('/')[1]}`, category: 'instagram-source', campusId: 'synthetic-campus', sourceApp: 'instagram' }));
files.push({ id: 'synthetic-pdf', mimeType: 'application/pdf', fileName: 'synthetic.pdf', category: 'document' });
const derivatives = [], drafts = [], errors = [];
const publicRoot = resolve('public');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (route === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (route === '/api/data-core/context') return json({ authenticated, canWrite: authenticated, isSuperAdmin: authenticated, user: { displayName: 'Synthetic' } });
    if (route === '/api/data-core/health') return json({ ok: true });
    if (route === '/api/data-core/campuses') return json({ campuses: [{ id: 'synthetic-campus', name: 'Synthetic campus' }] });
    if (route === '/api/data-core/files') return json({ files });
    if (route.startsWith('/api/data-core/files/')) {
      const id = decodeURIComponent(route.split('/').pop()), image = images[id];
      if (deniedSource || !image) return json({ error: 'Synthetic denied' }, 403);
      res.writeHead(200, { 'content-type': image.mime }); return res.end(image.bytes);
    }
    if (route === '/api/data-core/instagram/derivatives') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://localhost${route}`, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) });
      const form = await request.formData();
      const source = form.get('derivedFromFileId'), bytes = new Uint8Array(await form.get('file').arrayBuffer());
      assert.ok(images[source]); const decoded = decode(bytes);
      assert.equal(decoded.width, 2160); assert.equal(decoded.height, 2700);
      assert.equal(form.get('campusId'), null); assert.equal(form.get('ownerUserId'), null);
      const id = `synthetic-derived-${derivatives.length + 1}`;
      const file = { id, fileName: `${id}.png`, category: 'instagram-derived', sourceApp: 'instagram', mimeType: 'image/png', metadata: { derivedFromFileId: source }, downloadUrl: `/api/data-core/files/${id}` };
      derivatives.push(file); images[id] = { mime: 'image/png', bytes }; return json({ file }, 201);
    }
    if (route === '/api/data-core/content') {
      if (req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString()); drafts.push(payload); return json({ draft: payload }, 201);
      }
      return json({ drafts: [] });
    }
    const path = route.startsWith('/data-core/content/') ? '/data-core/content.html' : route;
    const file = resolve(publicRoot, `.${path}`);
    if (!file.startsWith(publicRoot + sep)) return json({}, 404);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end('Synthetic fixture error'); }
});
await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/data-core/content/instagram`);
  await page.locator('[data-pick-file="synthetic-pdf"]').click();
  assert.equal(await page.locator('#makeInstagramImage').isDisabled(), true);
  for (const id of ['synthetic-png', 'synthetic-jpeg', 'synthetic-webp']) {
    await page.locator(`[data-pick-file="${id}"]`).click();
    await page.locator('#derivativeSource').selectOption(id);
    await page.locator('#makeInstagramImage').click();
    await page.waitForFunction(() => !document.getElementById('saveDerivative').disabled);
    const before = await page.locator('#instagramCanvas').evaluate((el) => [...el.getContext('2d').getImageData(0, 0, 1, 1).data]);
    assert.equal(before[3], 255);
    await page.locator('#derivativeX').fill('0');
    const after = await page.locator('#instagramCanvas').evaluate((el) => [...el.getContext('2d').getImageData(0, 0, 1, 1).data]);
    assert.notDeepEqual(before, after);
    assert.equal(await page.locator('#derivativeY').isDisabled(), true);
    await page.locator('#saveDerivative').click();
    await page.getByText('인스타용 이미지가 저장되었습니다.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-remove-derived]').count(), derivatives.length);
  }
  await mkdir('outputs/instagram-derivative', { recursive: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['tablet', { width: 820, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    await page.locator('#instagramDerivative').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name} overflow`);
    const bounds = await page.locator('#instagramCanvas').boundingBox();
    assert.ok(Math.abs(bounds.width / bounds.height - 4 / 5) < 0.02);
    await page.locator('#instagramDerivative').screenshot({ path: `outputs/instagram-derivative/${name}.png` });
  }
  await page.locator('#draftTitle').fill('Synthetic derivative draft');
  await page.locator('#draftCta').fill('Synthetic CTA');
  await page.locator('#saveDraftBtn').click();
  await page.waitForFunction(() => document.getElementById('draftTitle').value === '');
  assert.equal(drafts[0].derivedFileIds.length, 3);
  assert.ok(drafts[0].relatedFileIds.includes('synthetic-png')); assert.equal(drafts[0].metadata.callToAction, 'Synthetic CTA');
  await page.locator('[data-source-tab="blog"]').click();
  assert.equal(await page.locator('#instagramDerivative').isVisible(), false);
  await page.locator('[data-pick-file="synthetic-png"]').click();
  await page.locator('#draftTitle').fill('Synthetic original reuse');
  await page.locator('#saveDraftBtn').click();
  await page.waitForFunction(() => document.getElementById('draftTitle').value === '');
  assert.deepEqual(drafts[1].derivedFileIds, []); assert.deepEqual(drafts[1].relatedFileIds, ['synthetic-png']);
  await page.locator('[data-source-tab="instagram"]').click();
  await page.locator('[data-pick-file="synthetic-png"]').click();
  deniedSource = true; await page.locator('#makeInstagramImage').click();
  await page.locator('#derivativeStatus').filter({ hasText: '원본 이미지를 읽을 수 없습니다.' }).waitFor();
  assert.equal(await page.locator('#saveDerivative').isDisabled(), true);
  authenticated = false; await page.reload();
  assert.equal(await page.locator('#makeInstagramImage').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: synthetic JPEG/PNG/WebP Canvas, crop pixels, 2160x2700, save/draft/CTA/blog reuse, denial, desktop/tablet/mobile, no JS errors.');
} finally {
  await browser.close(); await new Promise((done) => server.close(done));
}

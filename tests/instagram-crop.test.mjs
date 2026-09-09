import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../public/data-core/instagram-derivative.js', import.meta.url), 'utf8'), sandbox);
const { crop, eligible } = sandbox.window.HI5InstagramDerivative;

test('Instagram cover crop preserves aspect, centers, clamps and moves only the cropped axis', () => {
  for (const [width, height] of [[800, 1000], [2000, 1000], [500, 2000], [1, 1]]) {
    const center = crop(width, height);
    assert.ok(Math.abs(center.sw / center.sh - 4 / 5) < 1e-12);
    assert.equal(center.sx, (width - center.sw) / 2);
    assert.equal(center.sy, (height - center.sh) / 2);
    const start = crop(width, height, -100, -100), end = crop(width, height, 200, 200);
    assert.equal(start.sx, 0); assert.equal(start.sy, 0);
    assert.equal(end.sx + end.sw, width); assert.equal(end.sy + end.sh, height);
  }
  assert.throws(() => crop(0, 10));
});

test('Instagram source selection supports JPEG PNG WebP and rejects documents or derivatives', () => {
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(eligible({ mimeType }), true);
  for (const mimeType of ['application/pdf', 'text/plain', 'image/svg+xml', 'image/gif', '']) assert.equal(eligible({ mimeType }), false);
  assert.equal(eligible({ mimeType: 'image/png', category: 'instagram-derived' }), false);
  assert.equal(eligible(null), false);
});

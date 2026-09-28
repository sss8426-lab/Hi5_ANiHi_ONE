import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const asset = '/data-core/assets/hi5-data-core-approved-v1.png';

test('approved logo keeps the exact user-approved image bytes', () => {
  const image = readFileSync(`public${asset}`);
  assert.equal(createHash('sha256').update(image).digest('hex'),
    'f46030cfc85b9624e7235c4ede5870020e2fc6f3aa0a2315e63b696c034eaa4a');
});

for (const page of ['data-core/index.html', 'data-core/content.html',
  'data-core/roadmap.html', 'data-core/work/kkumeum.html', 'admissions-web/renderer/index.html']) {
  test(`${page} uses the shared accessible logo without legacy H5 text`, () => {
    const html = readFileSync(`public/${page}`, 'utf8');
    assert.equal(html.split(`src="${asset}"`).length - 1, 1);
    assert.match(html, /class="core-logo"[^>]+alt="Hi5·ANiHi DATA CORE"[^>]+width="48" height="48"/);
    assert.match(html, /design-system\.css\?v=20260928-approved-logo/);
    assert.doesNotMatch(html, />H5</);
  });
}

test('logo retains its complete proportions in a stable non-shrinking slot', () => {
  const css = readFileSync('public/data-core/design-system.css', 'utf8');
  assert.match(css, /\.core-logo\s*\{[^}]*flex: 0 0 48px;[^}]*object-fit: contain;/);
});

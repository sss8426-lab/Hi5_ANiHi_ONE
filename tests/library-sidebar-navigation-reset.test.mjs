import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('public/data-core/app.js', 'utf8');

test('자료보관함 사이드바/feature-card는 항상 root로 초기화되고, 다른 nav 항목은 그대로 유지된다', () => {
  // Every view-switching control opts in to resetQuery only when it targets the library view.
  assert.match(app,
    /button\.onclick = \(\) => switchView\(button\.dataset\.view, \{ resetQuery: button\.dataset\.view === 'library' \}\);/u,
    'the shared bindEvents() wiring must request resetQuery only for the library nav/feature-card entries');

  // switchView() must clear a stale ?folder=/q=/page= even when the pathname (library) is unchanged,
  // but only when the caller explicitly asked for it (options.resetQuery) — every other view keeps its
  // original "only push when the pathname differs" behavior untouched.
  assert.match(app,
    /if \(path && \(location\.pathname !== path \|\| \(options\.resetQuery && location\.search\)\)\) \{\s*\n\s*history\.pushState\(\{ view \}, '', path\);\s*\n\s*\}/u,
    'switchView must push a clean URL (no query) whenever resetQuery is set and a query string is present');

  // The path lookup for 'library' itself stays the clean root URL with no query string baked in;
  // navigate-to-a-folder is handled entirely inside hq-library.js's own navigate(), not here.
  assert.match(app, /library: '\/data-core\/work\/library',/u);
});

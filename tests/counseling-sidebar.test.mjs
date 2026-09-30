import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync('public/data-core/counseling-sidebar.css', 'utf8');

test('counseling pages hide the dark menu until the mouse reaches the left edge', () => {
  for (const file of ['public/data-core/index.html', 'public/admissions-web/renderer/index.html']) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /<div class="sidebar-peek" aria-hidden="true"><span><\/span><\/div>\s*<aside class="sidebar">/, file);
    assert.ok(html.indexOf('counseling-sidebar.css') < html.indexOf('design-tokens.css'), file);
  }
  // Only counseling views (body.counseling-header) and the admissions page, desktop widths only.
  assert.match(css, /@media \(min-width: 1101px\)/);
  assert.match(css, /counseling-header \.app-shell,[\s\S]*?grid-template-columns: 0px minmax\(0, 1fr\)/);
  assert.match(css, /:has\(\.sidebar-peek:hover, \.sidebar:hover, \.sidebar:focus-within\)\s*\{ grid-template-columns: 232px minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(css, /body\.data-core-layout(?!\.counseling-header|\.data-core-layout\.counseling-header)[^,{]*\.sidebar\s*\{/);
  const app = readFileSync('public/data-core/app.js', 'utf8');
  assert.match(app, /classList\.toggle\('counseling-header', state\.currentMode === 'counseling'\)/);
});

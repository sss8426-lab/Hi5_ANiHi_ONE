import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/data-core/index.html', 'utf8');
const app = fs.readFileSync('public/data-core/app.js', 'utf8');
const styles = fs.readFileSync('public/data-core/styles.css', 'utf8');

for (const [mode, href, asset] of [
  ['counseling', '/data-core/counseling', 'mode-counseling.webp'],
  ['work', '/data-core/work', 'mode-work.webp'],
]) {
  const card = new RegExp(`<a class="mode-card ${mode}" href="${href}" data-mode-card="${mode}">[\\s\\S]*?${asset}`, 'u');
  assert.match(html, card, `${mode} card keeps a real navigation link and its approved image asset`);
}

assert.match(styles, /body\.mode-home-artwork-active \.mode-card \{[\s\S]*?min-height:\s*540px[\s\S]*?border-radius:\s*20px/u);
assert.match(styles, /body\.mode-home-artwork-active \.mode-overlay \{[\s\S]*?background:\s*#fff/u);
assert.match(styles, /body\.mode-home-artwork-active \.mode-card::after \{ display: none; \}/u);
assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*?\.mode-grid \{ grid-template-columns: 1fr; \}/u);
assert.match(styles, /@media \(max-width: 680px\) \{[\s\S]*?\.mode-card \{ min-height: 430px/u);
assert.match(styles, /@media \(min-width: 681px\) and \(max-width: 980px\)[\s\S]*?\.connection-card div,\n  body\.mode-home-artwork-active \.back-link \{ display: block; \}/u);

assert.doesNotMatch(app, /event\.preventDefault\(\);\s*switchView\(card\.dataset\.modeCard/u);

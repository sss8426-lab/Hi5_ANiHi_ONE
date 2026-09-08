import assert from 'node:assert/strict';
import fs from 'node:fs';

const enhancement = fs.readFileSync('public/data-core/mode-home-artwork.js', 'utf8');
const nav = fs.readFileSync('public/data-core/work/kkumeum-nav.js', 'utf8');

assert.match(enhancement, /mode-counseling\.webp/);
assert.match(enhancement, /mode-work\.webp/);
assert.match(enhancement, /mode-sidebar\.svg/);
assert.match(enhancement, /\/data-core\/counseling/);
assert.match(enhancement, /\/data-core\/work/);
assert.match(enhancement, /mode-home-artwork-active/);
assert.match(enhancement, /mode-artwork-arrow/);
assert.match(nav, /mode-home-artwork\.js/);

for (const file of [
  'public/data-core/assets/mode-counseling.webp',
  'public/data-core/assets/mode-work.webp',
  'public/data-core/assets/mode-sidebar.svg',
]) {
  assert.ok(fs.existsSync(file), `${file} should exist`);
  assert.ok(fs.statSync(file).size > 100, `${file} should not be empty`);
}

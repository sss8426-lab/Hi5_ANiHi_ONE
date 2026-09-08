import assert from 'node:assert/strict';
import fs from 'node:fs';

const enhancement = fs.readFileSync('public/data-core/mode-home-artwork.js', 'utf8');
const nav = fs.readFileSync('public/data-core/work/kkumeum-nav.js', 'utf8');
const html = fs.readFileSync('public/data-core/index.html', 'utf8');
const app = fs.readFileSync('public/data-core/app.js', 'utf8');
const styles = fs.readFileSync('public/data-core/styles.css', 'utf8');

assert.match(enhancement, /mode-home-artwork-active/);
assert.match(enhancement, /\/data-core\/login\?next=/);
assert.match(enhancement, /DATA CORE 로그인 화면 열기/);
assert.match(enhancement, /addEventListener\('click'/);
assert.match(enhancement, /addEventListener\('keydown'/);
assert.match(enhancement, /login-chip-action/);
assert.match(nav, /mode-home-artwork\.js/);
assert.match(html, /mode-counseling\.webp\?v=20260908-mode-home/);
assert.match(html, /mode-work\.webp\?v=20260908-mode-home/);
assert.match(html, /href="\/data-core\/counseling" data-mode-card="counseling"/);
assert.match(html, /href="\/data-core\/work" data-mode-card="work"/);
assert.match(html, /mode-artwork-arrow/);
assert.match(html, /mode-home-artwork\.js\?v=20260908-mode-home/);
assert.doesNotMatch(app, /querySelectorAll\('\[data-mode-card\]'\)/);
assert.match(styles, /object-fit:\s*cover/);
assert.match(styles, /mode-sidebar\.svg\?v=20260908-mode-home/);
assert.match(styles, /grid-template-columns:\s*1fr/);

for (const file of [
  'public/data-core/assets/mode-counseling.webp',
  'public/data-core/assets/mode-work.webp',
  'public/data-core/assets/mode-sidebar.svg',
]) {
  assert.ok(fs.existsSync(file), `${file} should exist`);
  assert.ok(fs.statSync(file).size > 100, `${file} should not be empty`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contentHtml = await readFile(new URL('../public/data-core/content.html', import.meta.url), 'utf8');
const adminNavScript = await readFile(new URL('../public/data-core/content-admin-nav.js', import.meta.url), 'utf8');

test('work content sidebar stays work-only and hides admin links by default', () => {
  assert.doesNotMatch(contentHtml, /꿈·전공 로드맵/);
  assert.match(contentHtml, /href="\/data-core\/work\/library"/);
  assert.match(contentHtml, /href="\/data-core\/content\/blog"/);
  assert.match(contentHtml, /href="\/data-core\/content\/instagram"/);
  assert.match(contentHtml, /class="nav-item hidden" href="\/data-core\/operations" data-super-admin-nav/);
  assert.match(contentHtml, /class="nav-item hidden" href="\/data-core\/accounts" data-super-admin-nav/);
  assert.match(adminNavScript, /context\?\.authenticated && context\?\.isSuperAdmin/);
});

test('work content file picker uses the nine DATA CORE library categories', () => {
  const expected = [
    'class-photo',
    'student-artwork',
    'academy-photo',
    'competition-material',
    'admission-material',
    'counseling-material',
    'blog-source',
    'instagram-source',
    'promotion-material',
  ];
  const select = contentHtml.match(/<select id="fileCategoryFilter">([\s\S]*?)<\/select>/)?.[1] || '';
  const values = [...select.matchAll(/<option value="([^"]*)">/g)]
    .map((match) => match[1])
    .filter(Boolean);
  assert.deepEqual(values, expected);
});

test('Instagram work route keeps the fixed 2160x2700 4:5 specification', () => {
  assert.match(contentHtml, /2160 × 2700px · 4:5/);
});

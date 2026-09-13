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

test('work content picker uses actual library folders instead of duplicated category lists', () => {
  assert.ok(contentHtml.includes('/data-core/library-client.js'));
  assert.ok(contentHtml.includes('id="photoFolders"'));
  assert.ok(contentHtml.includes('id="photoBreadcrumb"'));
  assert.ok(!contentHtml.includes('fileCategoryFilter'));
  assert.ok(contentHtml.indexOf('id="photoHeading"') < contentHtml.indexOf('id="aiCommand"'));
  assert.ok(contentHtml.includes('지난 작업'));
});

test('Instagram work route keeps the fixed 2160x2700 4:5 specification', () => {
  assert.match(contentHtml, /width="2160" height="2700"/);
});

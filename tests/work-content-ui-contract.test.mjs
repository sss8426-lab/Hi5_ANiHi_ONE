import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contentHtml = await readFile(new URL('../public/data-core/content.html', import.meta.url), 'utf8');
const adminNavScript = await readFile(new URL('../public/data-core/content-admin-nav.js', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../public/data-core/work-navigation.js', import.meta.url), 'utf8');

test('work content sidebar stays work-only and hides admin links by default', () => {
  assert.doesNotMatch(contentHtml, /꿈·전공 로드맵/);
  assert.match(contentHtml, /data-work-navigation="work"/);
  assert.match(contentHtml, /class="[^"]*hidden[^"]*" data-work-navigation="admin"/);
  for (const path of ['/data-core/work/library', '/data-core/content/blog', '/data-core/content/instagram', '/data-core/operations', '/data-core/accounts']) assert.ok(navigation.includes(path));
  assert.match(navigation, /!context\?\.authenticated\|\|!context.isSuperAdmin/);
  assert.match(adminNavScript, /context\?\.authenticated && context\?\.isSuperAdmin/);
});

test('work content picker uses actual library folders instead of duplicated category lists', () => {
  assert.ok(contentHtml.includes('/data-core/library-client.js'));
  assert.ok(contentHtml.includes('id="photoFolders"'));
  assert.ok(contentHtml.includes('id="photoBreadcrumb"'));
  assert.ok(!contentHtml.includes('fileCategoryFilter'));
  assert.ok(contentHtml.indexOf('id="photoHeading"') < contentHtml.indexOf('id="aiCommand"'));
  // "지난 작업" was renamed to a top "저장한 글" button that opens a dialog listing saved drafts.
  assert.ok(contentHtml.includes('저장한 글'));
  assert.ok(contentHtml.includes('id="draftsDialog"'));
});

test('Instagram work route keeps the fixed 2160x2700 4:5 specification', () => {
  assert.match(contentHtml, /width="2160" height="2700"/);
});

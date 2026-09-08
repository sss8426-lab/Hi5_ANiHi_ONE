import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HQ shared library renders before campus groups with the four requested defaults', async () => {
  const source = await read('public/data-core/work/hq-library.js');
  const labels = ['수업그림', '원장전용', '자료', '제작물'];
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(`label: '${label}'`);
    assert.ok(next > cursor, `${label} must keep the requested order`);
    cursor = next;
  }
  assert.match(source, /host\.prepend\(section\)/);
  assert.match(source, /<h4>본원 작업물<\/h4>/);
});

test('HQ folder creation and upload stay master-only organization workflows', async () => {
  const source = await read('public/data-core/work/hq-library.js');
  assert.match(source, /if \(!isSuperAdmin\(\)\) return;/);
  assert.match(source, /campusId: null/);
  assert.match(source, /visibility: 'organization'/);
  assert.match(source, /recordType: RECORD_TYPE/);
  assert.match(source, /sourceApp: SOURCE_APP/);
  assert.match(source, /recordId', state\.selectedId/);
  assert.match(source, /campusId', ''/);
  assert.match(source, /api\(`\/api\/data-core\/files\?recordId=\$\{encodeURIComponent\(folderId\)\}&limit=100`\)/);
  assert.match(source, /isSuperAdmin\(\) \? '<button class="ghost-btn hq-library-add"/);
});

test('HQ library reuses current DATA CORE storage instead of creating a new backend', async () => {
  const source = await read('public/data-core/work/hq-library.js');
  const loader = await read('public/data-core/work/kkumeum-nav.js');
  assert.match(source, /\/api\/data-core\/records/);
  assert.match(source, /\/api\/data-core\/files/);
  assert.match(source, /const UPLOAD_CATEGORY = 'counseling-material'/);
  assert.doesNotMatch(source, /new R2|new D1|FAMILY_FILES/);
  assert.match(loader, /\/data-core\/work\/hq-library\.js/);
});

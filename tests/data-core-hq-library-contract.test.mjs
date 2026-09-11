import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HQ defaults retain stable keys and order in the shared server folder projection', async () => {
  const source = await read('worker/data-core-library-policy.ts');
  let cursor = -1;
  for (const [key, label] of [['class-artwork','수업그림'],['director-only','원장전용'],['resources','자료'],['production','제작물']]) {
    const next = source.indexOf(`['${key}', '${label}']`); assert.ok(next > cursor); cursor = next;
  }
  assert.match(source, /Legacy HQ visibility/);
  assert.match(source, /shareMode: shared \? 'organization' : 'restricted'/);
});
test('one browser reuses the upload queue and server-authorized controls without automatic default creation', async () => {
  const source = await read('public/data-core/work/hq-library.js');
  assert.match(source, /new DataCoreUploadQueue/);
  assert.match(source, /libraryScoped:true/);
  assert.match(source, /view\.folder\.canWrite/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /params\.get\('folder'\)/);
  assert.match(source, /aria-label="자료보관함 경로"/);
  assert.doesNotMatch(source, /ensureDefault|hq-library-add|\/api\/data-core\/records/);
  const queue = await read('public/data-core/upload-queue.js');
  assert.match(queue, /libraryScoped/);
  assert.match(queue, /\/api\/data-core\/library\/files/);
  assert.match(queue, /\/api\/data-core\/files/);
});
test('library routes wrap existing storage; soft folder deletion cannot cascade or migrate', async () => {
  const source = await read('worker/data-core-library.ts');
  assert.match(source, /uploadDataCoreFile/); assert.match(source, /deleteDataCoreFile/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM file_objects WHERE data_record_id = \?\)/);
  assert.doesNotMatch(source, /bucket\.(delete|put)|CREATE TABLE|DROP TABLE|DELETE FROM/);
  assert.match(await read('public/data-core/work/kkumeum-nav.js'), /\/data-core\/work\/hq-library\.js/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../worker/data-core-competition-sources.ts', import.meta.url));

async function sourceText() {
  return readFile(sourcePath, 'utf8');
}

test('competition source sync uses canonical contest list URLs and stable c_seq identity', async () => {
  const source = await sourceText();
  assert.match(source, /artmd:\s*\{\s*name:\s*"미대입시",\s*url:\s*"https:\/\/www\.artmd\.kr\/contest\/21001_contest_list\.php"/);
  assert.match(source, /mgood:\s*\{\s*name:\s*"엠굿",\s*url:\s*"https:\/\/www\.mgood\.co\.kr\/contest\/21001_contest_list\.php"/);
  assert.doesNotMatch(source, /mgood:\s*\{[^\n]*url:\s*"https:\/\/mgood\.co\.kr\/"/);
  assert.match(source, /searchParams\.get\("c_seq"\)/);
});

test('same source identity is compared for source-owned fact changes before unchanged classification', async () => {
  const source = await sourceText();
  assert.match(source, /function sourceOwnedFactsChanged\(/);
  assert.match(source, /fieldSources\[field\]\?\.source === source/);
  assert.match(source, /sourceOwnedFactsChanged\(item, bySourceId\[0\]\)[\s\S]*?kind:\s*"matched"[\s\S]*?kind:\s*"same"/);
  assert.match(source, /if \(!sourceValuePresent\(incoming\)\) return false/);
  assert.match(source, /updateValue\("applicationEnd", item\.applicationEnd\)/);
});

test('source refresh remains conservative and extracts list-row facts without retaining raw HTML', async () => {
  const source = await sourceText();
  assert.match(source, /function tableCellsAround\(/);
  assert.match(source, /const organizer = cells\.length >= 3/);
  assert.match(source, /!existing \|\| \(mayReplace\(field\) && sourceValuePresent\(value\)\)/);
  assert.match(source, /기존 대회 데이터는 변경되지 않았습니다/);
  assert.doesNotMatch(source, /html:\s*html/);
  assert.doesNotMatch(source, /rawHtml/);
});

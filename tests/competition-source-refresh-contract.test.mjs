import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../worker/data-core-competition-sources.ts', import.meta.url));

async function sourceText() {
  return readFile(sourcePath, 'utf8');
}

test('competition source sync uses the requested live source URLs', async () => {
  const source = await sourceText();
  assert.match(source, /name:\s*"아트앤디자인"[\s\S]*?https:\/\/artndesign\.com\/shop\/list\.php\?ca_id=20/);
  assert.match(source, /https:\/\/www\.mgood\.co\.kr\/contest\/21001_contest_list\.php\?state=main"/);
  assert.match(source, /https:\/\/www\.mgood\.co\.kr\/contest\/21001_contest_list\.php\?state=other/);
  assert.doesNotMatch(source, /https:\/\/www\.artmd\.kr\/contest\/21001_contest_list\.php/);
  assert.match(source, /searchParams\.get\("c_seq"\)/);
});

test('live source parser classifies active status and supports month-day dates without breaking legacy import fixtures', async () => {
  const source = await sourceText();
  assert.match(source, /function sourceStatusFrom\(/);
  assert.match(source, /normalized === '접수중'/);
  assert.match(source, /normalized === '예정'/);
  assert.match(source, /status:\s*"unknown",\s*label:\s*"상태 확인 필요"/);
  assert.doesNotMatch(source, /if \(!sourceStatus\) continue/);
  assert.match(source, /function datesFrom\(value: string, fetchedAt: string\)/);
  assert.match(source, /matchAll\(\/\(\\d\{1,2\}\)\\s\*\[\.\\-\/월\]/);
  assert.match(source, /sourceStatusLabel/);
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
  assert.match(source, /parseDocument\(html\)/);
  assert.match(source, /field\('wr-wr_15'\)/);
  assert.match(source, /!existing \|\| \(mayReplace\(field\) && sourceValuePresent\(value\)\)/);
  assert.match(source, /기존 대회 데이터는 변경되지 않았습니다/);
  assert.doesNotMatch(source, /html:\s*html/);
  assert.doesNotMatch(source, /rawHtml/);
});

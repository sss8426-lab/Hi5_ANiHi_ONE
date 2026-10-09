import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('public/data-core/content.js', 'utf8');

test('블로그·인스타 photo folders show the same 사진 totals as 자료보관함 without delaying the folder list', () => {
  // The first browse stays count-free so folders render at once.
  assert.match(content, /counts:false,skipEmptyRoot:true/);
  assert.match(content, /void fillFolderCounts\(view\.folder\.id, token, browseController\.signal\);/);
  assert.match(content, /api\(`\/api\/data-core\/library\/folders\?parentId=\$\{encodeURIComponent\(id\)\}`, \{ signal \}\)/);
  assert.match(content, /if \(token !== state\.browseGeneration\) return;\n {4}for \(const folder of view\.folders/);
  assert.match(content, /folder\.totalImages \? `사진 \$\{folder\.totalImages\}` : '사진 없음'/);
  assert.match(content, /<small data-folder-count><\/small>/);
  // The breadcrumb placeholder keeps the folder name only, not the count.
  assert.match(content, /crumb\.textContent=\(button\.querySelector\('strong'\)\|\|button\)\.textContent\.trim\(\)/);
  assert.match(fs.readFileSync('public/data-core/content.html', 'utf8'), /content\.js\?v=20261009-folder-counts/);
});

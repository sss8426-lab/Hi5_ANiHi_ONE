import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const js = readFileSync('public/data-core/curriculum.js', 'utf8');
const css = readFileSync('public/data-core/curriculum.css', 'utf8');

test('꿈을 향한 커리큘럼 starts with the elementary 꿈 그림의 시작 card, then academy works', () => {
  const order = ['start:', 'content:', 'design:'].map(key => js.indexOf(key));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2]);
  assert.match(js, /title: '꿈 그림의 시작'/);
  assert.match(js, /tag: '초등 · 첫걸음'/);
  for (const image of ['start-v1.webp', 'story-academy-work-v1.webp', 'design-academy-work-v1.webp']) {
    assert.match(js, new RegExp(`image: '${image.replace('.', '\\.')}'`));
    assert.ok(existsSync(`public/data-core/assets/work-visuals/${image}`));
  }
  assert.match(js, /curriculum\(\?:\\\/\(start\|content\|design\)/);
  assert.match(js, /Object\.hasOwn\(match\[1\] === 'start' \? startFolders : stages, match\[2\]\)/);
});

test('curriculum cards keep their colours on hover (only the border changes)', () => {
  const hover = css.split('\n').find(line => line.startsWith('.curriculum-card:hover'));
  assert.ok(hover);
  assert.doesNotMatch(hover, /background/);
  assert.match(css, /\.curriculum-cards \{ display: grid; grid-template-columns: repeat\(3,/);
});

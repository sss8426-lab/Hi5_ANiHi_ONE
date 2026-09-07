import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('work automation sidebar contains only work-domain navigation', async () => {
  const html = await read('public/data-core/content.html');
  assert.match(html, /자료보관함/);
  assert.match(html, /블로그 자동화/);
  assert.match(html, /인스타 자동화/);
  assert.doesNotMatch(html, /꿈·전공 로드맵/);
  assert.match(html, /업무용 홈으로 돌아가기/);
});

test('admissions shell is branded as 대학 합격 로드맵 without duplicate awards nav', async () => {
  const html = await read('public/admissions-web/renderer/index.html');
  assert.match(html, /<title>대학 합격 로드맵<\/title>/);
  assert.match(html, /<div class="brand">대학 합격 로드맵/);
  assert.doesNotMatch(html, /data-page="awards">공모전 및 실기대회 수상작/);
  // Keep the hidden legacy section temporarily so old renderer code cannot crash.
  assert.match(html, /id="awards"/);
});

test('dream-major roadmap uses icon catalog and required university metrics', async () => {
  const [html, js, catalog] = await Promise.all([
    read('public/data-core/roadmap.html'),
    read('public/data-core/roadmap.js'),
    read('public/data-core/dream-catalog.js'),
  ]);
  assert.match(html, /dream-catalog\.js/);
  assert.match(html, /아이콘을 눌러 관심 분야를 선택하세요/);
  for (const label of ['실기반영비', '성적반영비', '경쟁률', '합격평균성적', '최저성적']) {
    assert.match(js, new RegExp(label));
  }
  assert.match(js, /확인 필요/);
  for (const group of ['웹툰·만화', '애니메이션', '게임', '일러스트·캐릭터', '디자인']) {
    assert.match(catalog, new RegExp(group.replace(/[·]/g, '·')));
  }
  const cardCount = (catalog.match(/group:/g) || []).length;
  assert.ok(cardCount >= 20, `expected at least 20 dream cards, got ${cardCount}`);
});

test('public counseling roadmap keeps six-stage preparation flow', async () => {
  const catalog = await read('public/data-core/dream-catalog.js');
  for (const stage of ['미술 기초', '전공 탐색/기초', '전공 심화', '대학입시', '대학 전공교육', '취업·창작·데뷔']) {
    assert.match(catalog, new RegExp(stage.replace(/[·/]/g, (m) => `\\${m}`)));
  }
});

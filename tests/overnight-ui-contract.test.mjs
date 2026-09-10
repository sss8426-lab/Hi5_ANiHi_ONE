import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { careerStages, searchCareers } from '../public/data-core/roadmap-model.js';

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

test('dream-major roadmap uses the source-backed career catalog and safe admissions presentation', async () => {
  const [html, js, catalog] = await Promise.all([
    read('public/data-core/roadmap.html'),
    read('public/data-core/roadmap.js'),
    read('public/data-core/roadmap-content.js'),
  ]);
  assert.match(html, /roadmap-content\.js/);
  assert.match(html, /#family=story/);
  assert.match(html, /#family=design/);
  for (const fallback of ['확인 필요', '공식 모집요강 확인 필요', '최종 지원 전 공식 모집요강 확인']) {
    assert.match(js, new RegExp(fallback));
  }
  for (const group of ['웹툰·만화', '애니메이션', '게임', '일러스트·캐릭터', '디자인']) {
    assert.match(catalog, new RegExp(group.replace(/[·]/g, '·')));
  }
  const context = { window: {} };
  vm.runInNewContext(catalog, context);
  const careers = context.window.HI5_ROADMAP_CONTENT.careers;
  assert.equal(careers.length, 35);
  for (const dream of ['웹툰 작가', '만화가', '웹툰 PD', '스토리 작가', '애니메이터', '캐릭터 애니메이터', '콘티·연출가', '게임원화가', '캐릭터원화가', '배경원화가', '일러스트레이터', '캐릭터디자이너', '이모티콘작가', 'AI·융합 콘텐츠 디자이너']) {
    assert.ok(searchCareers(careers, dream).length, `${dream} remains searchable`);
  }
  assert.match(js, /loadConnectedPrograms/);
  assert.match(js, /programView/);
});

test('public counseling roadmap keeps six-stage preparation flow', async () => {
  const context = { window: {} };
  vm.runInNewContext(await read('public/data-core/roadmap-content.js'), context);
  for (const career of context.window.HI5_ROADMAP_CONTENT.careers) {
    const steps = careerStages(career);
    assert.deepEqual(steps.map(([name]) => name), ['미술 기초', '전공 기초', '전공 심화', '대학입시', '대학 전공교육', '취업·창작·데뷔']);
    assert.ok(steps[0][1].includes(career.foundation[0]));
    assert.ok(steps[5][1].includes(career.outcome));
  }
});

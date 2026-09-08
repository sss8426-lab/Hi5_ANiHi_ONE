import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/kkumeum-growth-skills.ts', import.meta.url), 'utf8');

test('runtime growth skill helper consumes the versioned canonical registry', () => {
  assert.match(source, /KKUMEUM_GROWTH_SKILL_TAXONOMY_V1\.json/);
  assert.match(source, /export const KKUMEUM_GROWTH_SKILL_TAXONOMY_VERSION/);
  assert.match(source, /export const KKUMEUM_GROWTH_SKILL_REGISTRY/);
  assert.match(source, /export function isKkumeumGrowthSkillCode/);
  assert.match(source, /export function normalizeKkumeumGrowthSkillCodes/);
  assert.match(source, /export function kkumeumGrowthSkillCatalog/);
});

test('runtime normalization is allowlist-only, deduplicated, and capped', () => {
  assert.match(source, /KKUMEUM_GROWTH_SKILL_CODES\.has\(value\)/);
  assert.match(source, /지원하지 않는 성장 영역 코드/);
  assert.match(source, /seen\.has\(code\)/);
  assert.match(source, /KKUMEUM_GROWTH_SKILL_MAX_SELECTIONS/);
  assert.match(source, /최대.*개까지 선택/);
});

test('runtime taxonomy contract does not define a score or ranking API', () => {
  assert.doesNotMatch(source, /growthSkillScore|skillRank|studentRank|teacherRank/);
});

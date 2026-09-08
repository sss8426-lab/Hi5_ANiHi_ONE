import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const taxonomy = JSON.parse(
  await readFile(new URL('../docs/KKUMEUM_GROWTH_SKILL_TAXONOMY_V1.json', import.meta.url), 'utf8'),
);

const categories = Array.isArray(taxonomy.categories) ? taxonomy.categories : [];
const skills = categories.flatMap((category) => Array.isArray(category.skills) ? category.skills : []);

test('꿈이음 growth skill taxonomy v1 has a stable non-ranking contract', () => {
  assert.equal(taxonomy.schemaVersion, 'kkumeum-growth-skill-v1');
  assert.equal(taxonomy.maxSelectionsPerReport, 5);
  assert.equal(taxonomy.semantics, 'observed_growth_area_not_score_or_rank');
  assert.ok(categories.length >= 5);
  assert.ok(skills.length >= 20);
});

test('category and skill codes are unique stable enums with Korean labels', () => {
  const categoryCodes = categories.map((category) => category.code);
  assert.equal(new Set(categoryCodes).size, categoryCodes.length);
  for (const category of categories) {
    assert.match(category.code, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(typeof category.labelKo, 'string');
    assert.ok(category.labelKo.trim().length > 0);
  }

  const skillCodes = skills.map((skill) => skill.code);
  assert.equal(new Set(skillCodes).size, skillCodes.length);
  for (const skill of skills) {
    assert.match(skill.code, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof skill.labelKo, 'string');
    assert.ok(skill.labelKo.trim().length > 0);
  }
});

test('taxonomy registry contains no score, rank, grade, student, or guardian payload fields', () => {
  const serialized = JSON.stringify(taxonomy);
  for (const forbiddenKey of ['score', 'rank', 'grade', 'studentId', 'studentName', 'guardianId', 'teacherId']) {
    assert.doesNotMatch(serialized, new RegExp(`"${forbiddenKey}"\\s*:`));
  }
});

test('v1 includes the core art-education domains needed by current 꿈이음 reports', () => {
  const codes = new Set(skills.map((skill) => skill.code));
  for (const required of [
    'form_observation',
    'figure_anatomy',
    'perspective_space',
    'composition_focus',
    'panel_storytelling',
    'color_harmony',
    'theme_interpretation',
    'revision_feedback',
  ]) {
    assert.ok(codes.has(required), `missing canonical growth skill: ${required}`);
  }
});

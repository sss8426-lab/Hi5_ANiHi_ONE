import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {careerProfiles} from '../public/data-core/career-profiles.js';

const context = {window:{}};
vm.runInNewContext(await fs.readFile('public/data-core/roadmap-content.js','utf8'), context);
const careers = context.window.HI5_ROADMAP_CONTENT.careers;
const ids = new Set(careers.map(c => c.id));

test('every roadmap career has a 직업 소개 profile with description, tasks and related jobs', () => {
  assert.deepEqual(Object.keys(careerProfiles).sort(), [...ids].sort());
  for (const [id, profile] of Object.entries(careerProfiles)) {
    assert.ok(profile.description.length >= 60, `${id} description`);
    assert.equal(profile.tasks.length, 4, `${id} tasks`);
    assert.ok(profile.tasks.every(task => / — /.test(task)), `${id} task format`);
    assert.ok(profile.related.length >= 4 && profile.related.length <= 5, `${id} related count`);
    assert.equal(new Set(profile.related.map(r => r.id)).size, profile.related.length, `${id} duplicate related`);
    for (const item of profile.related) {
      assert.ok(ids.has(item.id), `${id} → unknown ${item.id}`);
      assert.notEqual(item.id, id, `${id} relates to itself`);
      assert.ok(item.reason.length <= 18, `${id} → ${item.id} reason too long for one line`);
    }
  }
});

test('roadmap page renders the profile panel next to the job image', async () => {
  const html = await fs.readFile('public/data-core/roadmap.html','utf8');
  const js = await fs.readFile('public/data-core/roadmap.js','utf8');
  assert.match(html, /id="resultVisual"[\s\S]*id="resultPortrait"[\s\S]*<aside class="career-profile" id="careerProfile"/);
  assert.match(js, /import \{ careerProfiles \} from '\.\/career-profiles\.js\?v=/);
  assert.match(js, /renderCareerProfile\(career\)/);
});

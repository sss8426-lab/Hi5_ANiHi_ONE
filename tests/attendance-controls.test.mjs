import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('attendance exposes year/month before upload and retains template-dependent tools', async () => {
  const script = await readFile(new URL('../public/data-core/work/attendance.js', import.meta.url), 'utf8');
  assert.match(script, /<form id="atForm">/);
  assert.doesNotMatch(script, /\$\('atForm'\)\.hidden\s*=/);
  for (const id of ['atYear', 'atMonth']) assert.match(script, new RegExp(`<select id="${id}" required>`));
  for (const id of ['atPreviousMonth', 'atNextMonth', 'atThisMonth']) assert.match(script, new RegExp(`type="button" id="${id}"`));
  assert.match(script, /<fieldset id="atTemplateControls" disabled>/);
  for (const id of ['atReadRows', 'atAdd', 'atClosures', 'atClear', 'atConfirm', 'atGenerate', 'atDownload', 'atPrint']) {
    assert.match(script, new RegExp(`id="${id}"`));
  }
  assert.match(script, /학생 · 수업요일 · 보강일/);
  assert.match(script, /for\(const id of \['atFit','atActual','atDownload'\]\)\$\(id\)\.disabled=busy\|\|!result/);
  assert.match(script, /\.\/attendance-template\.js/);
});

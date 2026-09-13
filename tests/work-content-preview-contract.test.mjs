import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('work content automation keeps latest navigation filters and adds CTA preview safely', async () => {
  const [html, helper, api] = await Promise.all([
    read('public/data-core/content.html'),
    read('public/data-core/content-admin-nav.js'),
    read('worker/data-core-content.ts'),
  ]);

  assert.doesNotMatch(html, /꿈·전공 로드맵/);
  assert.match(html, /data-super-admin-nav/);

  assert.ok(html.includes('id="resultFooter"'));
  assert.ok(html.includes('id="aiResult"'));
  assert.ok(html.includes('id="photoFolders"'));
  assert.ok(html.includes('id="manualWork"'));

  assert.match(helper, /draftCta/);
  assert.match(helper, /renderDraftPreview/);
  assert.match(helper, /callToAction/);
  assert.match(helper, /2160\s*×\s*2700px/);
  assert.match(helper, /window\.draftPayload/);
  assert.match(helper, /window\.loadDraftIntoForm/);

  assert.match(api, /metadata\?: Record<string, unknown>/);
  assert.match(api, /const metadata = safeObject\(input\.metadata\)/);
});

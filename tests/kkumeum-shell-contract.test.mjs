import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 staff shell stays in protected work scope and keeps private storage boundary explicit', async () => {
  const [html, js, helper, router, architecture, schema] = await Promise.all([
    read('public/data-core/work/kkumeum.html'),
    read('public/data-core/work/kkumeum.js'),
    read('public/data-core/content-admin-nav.js'),
    read('worker/router.ts'),
    read('docs/KKUMEUM_ARCHITECTURE.md'),
    read('docs/KKUMEUM_FAMILY_DB_SCHEMA.sql'),
  ]);

  assert.match(html, /꿈이음/);
  assert.match(html, /FAMILY_DB/);
  assert.match(html, /FAMILY_FILES/);
  assert.match(html, /실데이터 연결 전/);
  assert.match(html, /입력 기능을 열지 않습니다/);
  assert.match(js, /\/api\/data-core\/context/);
  assert.match(helper, /dataCore\/work\/kkumeum\.html|\/data-core\/work\/kkumeum\.html/);

  // Existing protection rule covers every /data-core/work/* asset/page before static serving.
  assert.match(router, /pathname\.startsWith\("\/data-core\/work\/"\)/);

  assert.match(architecture, /FAMILY_DB/);
  assert.match(architecture, /FAMILY_FILES/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS family_students/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS family_guardians/);

  // The shell must not invent real student names or guardian contact data.
  assert.doesNotMatch(html, /010-\d{3,4}-\d{4}/);
  assert.doesNotMatch(html, /@(?:gmail|naver|daum)\./i);
});

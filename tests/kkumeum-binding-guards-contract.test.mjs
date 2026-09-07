import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 binding guards never fall back to generic DATA CORE storage', async () => {
  const core = await read('worker/kkumeum-core.ts');

  assert.match(core, /FAMILY_DB\?: D1Database/);
  assert.match(core, /FAMILY_FILES\?: R2Bucket/);
  assert.match(core, /requireFamilyDatabase/);
  assert.match(core, /requireFamilyFiles/);
  assert.match(core, /다른 DB에 대신 저장하지 않습니다/);
  assert.match(core, /일반 DATA CORE R2에 대신 저장하지 않습니다/);

  assert.doesNotMatch(core, /familyDb\s*\|\|\s*[^;]*\bDB\b/);
  assert.doesNotMatch(core, /familyFiles\s*\|\|\s*[^;]*\bFILES\b/);
});

test('꿈이음 teacher access requires active class assignment instead of campus membership alone', async () => {
  const core = await read('worker/kkumeum-core.ts');

  assert.match(core, /class_staff_assignments/);
  assert.match(core, /a\.ended_at IS NULL/);
  assert.match(core, /a\.staff_user_id = \?/);
  assert.match(core, /membership\.role === role/);
  assert.match(core, /CAMPUS_DIRECTOR/);
  assert.match(core, /TEACHER/);
  assert.match(core, /배정된 반의 학생만 확인할 수 있습니다/);
  assert.match(core, /학생 개인정보를 확인할 권한이 없습니다/);
});

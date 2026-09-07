import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 staff CRUD stays inside FAMILY_DB helpers and audits writes', async () => {
  const source = await read('worker/kkumeum-staff.ts');

  assert.match(source, /ensureKkumeumPhase1Schema\(familyDb\)/);
  assert.doesNotMatch(source, /env\.DB|env\.FILES|recordFileObject|data_records|file_objects/);
  assert.match(source, /family_audit_logs/);
  assert.match(source, /familyDb\.batch\(statements\)/);
  assert.match(source, /class_enrollments/);
});

test('teacher student listing is assignment scoped and campus bound', async () => {
  const source = await read('worker/kkumeum-staff.ts');

  assert.match(source, /JOIN class_staff_assignments a ON a\.class_id = c\.id AND a\.staff_user_id = \? AND a\.ended_at IS NULL/);
  assert.match(source, /LEFT JOIN family_classes c ON c\.id = s\.current_class_id AND c\.campus_id = s\.campus_id/);
  assert.match(source, /s\.campus_id = \?/);
  assert.match(source, /학생 개인정보를 확인할 권한이 없습니다/);
});

test('class/student mutations are restricted to super admin or campus director', async () => {
  const source = await read('worker/kkumeum-staff.ts');

  assert.match(source, /context\.isSuperAdmin/);
  assert.match(source, /CAMPUS_DIRECTOR/);
  assert.match(source, /꿈이음 반·학생 기본정보를 관리할 권한이 없습니다/);
});

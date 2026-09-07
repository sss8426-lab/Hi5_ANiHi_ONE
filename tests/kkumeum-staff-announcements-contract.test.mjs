import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 staff notice publisher stays isolated in FAMILY_DB and audits mutations', async () => {
  const source = await read('worker/kkumeum-staff-announcements.ts');

  assert.match(source, /ensureKkumeumAnnouncementSchema\(familyDb\)/);
  assert.match(source, /family_staff_notice_permissions/);
  assert.match(source, /family_audit_logs/);
  assert.match(source, /announcement\.create/);
  assert.match(source, /announcement\.update/);
  assert.match(source, /announcement\.publish/);
  assert.doesNotMatch(source, /env\.DB|env\.FILES|recordFileObject|data_records|file_objects/);
});

test('publisher enforces explicit STAFF campus permission and teacher assignment scope', async () => {
  const source = await read('worker/kkumeum-staff-announcements.ts');

  assert.match(source, /can_publish_campus/);
  assert.match(source, /hasCampusRole\(context, campusId, "STAFF"\)/);
  assert.match(source, /requireKkumeumClassAccess/);
  assert.match(source, /requireKkumeumStudentAccess/);
  assert.match(source, /class_staff_assignments/);
  assert.match(source, /a\.ended_at IS NULL/);
});

test('publisher validates targets again at publish and prevents unsafe target combinations', async () => {
  const source = await read('worker/kkumeum-staff-announcements.ts');

  assert.match(source, /assertTypeTargetCompatibility/);
  assert.match(source, /전체공지는 최고관리자만 발행할 수 있습니다/);
  assert.match(source, /다른 캠퍼스 전달 대상을 함께 선택할 수 없습니다/);
  assert.match(source, /await validateTargets\(\s*familyDb,\s*context,\s*existing\.campus_id/);
  assert.match(source, /row\.status !== "draft"/);
  assert.match(source, /본인이 작성한 소식만 수정하거나 발행할 수 있습니다/);
});

test('guardian direct targeting requires a real linked child in an allowed scope', async () => {
  const source = await read('worker/kkumeum-staff-announcements.ts');

  assert.match(source, /JOIN family_students s ON s\.id = sg\.student_id/);
  assert.match(source, /sg\.guardian_id = \?/);
  assert.match(source, /배정된 학생의 보호자만 선택할 수 있습니다/);
  assert.match(source, /해당 캠퍼스에 연결된 보호자만 선택할 수 있습니다/);
});

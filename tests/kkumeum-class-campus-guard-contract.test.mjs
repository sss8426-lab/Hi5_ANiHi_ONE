import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('꿈이음 teacher assignment lookup binds class and student to the requested campus', async () => {
  const core = await read('worker/kkumeum-core.ts');

  assert.match(core, /JOIN family_classes c/);
  assert.match(core, /c\.id = s\.current_class_id/);
  assert.match(core, /c\.campus_id = s\.campus_id/);
  assert.match(core, /c\.campus_id = \?/);
  assert.match(core, /JOIN family_classes c\s+ON c\.id = a\.class_id/);

  // Prevent authorization that checks only the assignment id without validating class campus.
  assert.doesNotMatch(
    core,
    /FROM class_staff_assignments\s+WHERE class_id = \?\s+AND staff_user_id = \?/,
  );
});

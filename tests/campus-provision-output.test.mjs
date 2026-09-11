import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWranglerResult } from '../scripts/provision-campus-accounts.mjs';

test('campus provisioning accepts JSON query results and import progress without rerunning inserts', () => {
  const result = [{ results: [{ probe: 1 }], success: true }];
  assert.deepEqual(parseWranglerResult(JSON.stringify(result)), result);
  assert.deepEqual(parseWranglerResult('Checking upload\nUpload complete\n' + JSON.stringify(result, null, 2) + '\n'), result);
});

test('campus provisioning rejects failed or malformed CLI output without echoing its content', () => {
  for (const output of ['synthetic-private-marker', '{"success":true}', '[{"success":false}]', '[null]', '[{}]', '[{"success":true}] trailing-private-marker']) {
    assert.throws(() => parseWranglerResult(output), error => !error.message.includes('private-marker'));
  }
});

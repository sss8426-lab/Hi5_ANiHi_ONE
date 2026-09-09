import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('public/data-core/accounts.js', 'utf8');

async function accountForm({ rejectCreate = false } = {}) {
  const elements = new Map();
  const calls = [];
  let completeCreate;
  const createResponse = new Promise((resolve) => { completeCreate = resolve; });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', resetCount: 0, listeners: {},
      classList: { toggle() {}, remove() {}, add() {} },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      reset() { this.resetCount++; },
    });
    return elements.get(id);
  }
  let accountLoads = 0;
  vm.runInNewContext(source, {
    document: { getElementById: element }, crypto: webcrypto,
    location: { assign() { throw new Error('Unexpected login redirect'); } },
    fetch: async (path, options = {}) => {
      calls.push({ path, method: options.method || 'GET' });
      if (options.method === 'POST') {
        await createResponse;
        return { ok: !rejectCreate, json: async () => rejectCreate ? { error: 'Synthetic create rejected' } : {} };
      }
      if (path === '/api/auth/accounts') accountLoads++;
      const body = path === '/api/auth/session' ? { isSuperAdmin: true }
        : path === '/api/data-core/campuses' ? { campuses: [{ id: 'synthetic-campus', name: 'Synthetic campus' }] }
        : { accounts: [] };
      return { ok: true, json: async () => body };
    },
  });
  await new Promise(setImmediate);
  element('displayName').value = 'Synthetic staff';
  element('loginId').value = 'synthetic-staff';
  element('role').value = 'STAFF';
  element('campusId').value = 'synthetic-campus';
  const form = element('createForm');
  const event = { currentTarget: form, preventDefault() {} };
  const pending = form.listeners.submit(event);
  // DOM dispatch clears currentTarget before an async listener resumes.
  event.currentTarget = null;
  completeCreate();
  await pending;
  return { element, calls, accountLoads };
}

test('account creation resets the form and refreshes the list after DOM dispatch ends', async () => {
  const { element, calls, accountLoads } = await accountForm();
  assert.equal(element('createForm').resetCount, 1);
  assert.equal(element('notice').textContent, '');
  assert.equal(accountLoads, 2);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(element('temporaryResult').textContent.length > 0);
});

test('rejected account creation preserves the form and shows the server error', async () => {
  const { element, calls, accountLoads } = await accountForm({ rejectCreate: true });
  assert.equal(element('createForm').resetCount, 0);
  assert.equal(element('loginId').value, 'synthetic-staff');
  assert.equal(element('notice').textContent, 'Synthetic create rejected');
  assert.equal(element('temporaryResult').textContent, '');
  assert.equal(accountLoads, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

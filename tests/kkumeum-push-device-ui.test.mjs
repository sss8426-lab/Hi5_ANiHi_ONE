import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('guardian push controls use this browser subscription instead of guardian-wide server aggregate', async () => {
  const source = await readFile(new URL('../public/family/family.js', import.meta.url), 'utf8');
  assert.match(source, /currentDevicePushSubscription/);
  assert.match(source, /navigator\.serviceWorker\.getRegistration\('\/family\/'\)/);
  assert.match(source, /currentDeviceSubscribed: Boolean\(existing\)/);
  assert.match(source, /status\.currentDeviceSubscribed \? '알림 끄기' : '알림 받기'/);
  assert.match(source, /const existing = await registration\.pushManager\.getSubscription\(\);[\s\S]*if \(existing\) \{/);
  assert.doesNotMatch(source, /status\.subscribed \? '알림 끄기' : '알림 받기'/);
  assert.doesNotMatch(source, /if \(status\.subscribed && existing\)/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/data-core/award-image-cache.js', 'utf8');
function harness(fetch) {
  const revoked = [], created = [];
  const scope = vm.createContext({ fetch, AbortController, URL: {
    createObjectURL(blob) { const url = `blob:synthetic-${created.length}`; created.push(blob); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  } });
  vm.runInContext(source, scope);
  return { cache: vm.runInContext('new AwardImageCache({maxBytes:8,maxEntries:2})', scope), revoked, created };
}
const response = () => new Response(new Blob(['1234'], {type:'image/png'}));
test('thumbnail/lightbox share one authenticated request and warm reopen uses memory only', async () => {
  const requests = [], h = harness(async (url, options) => { requests.push({url, options}); return response(); });
  const [thumbnail, lightbox] = await Promise.all([h.cache.get('one'), h.cache.get('one')]);
  assert.equal(thumbnail, lightbox);
  assert.equal(await h.cache.get('one'), thumbnail);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.cache, 'no-cache');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].url, '/api/data-core/files/one');
});
test('LRU evicts/revokes bounded bytes and folder/logout cleanup clears every URL', async () => {
  const h = harness(async () => response());
  await h.cache.get('one'); await h.cache.get('two'); await h.cache.get('three');
  assert.equal(h.cache.bytes, 8); assert.equal(h.cache.entries.size, 2);
  assert.equal(h.cache.peek('one'), ''); assert.equal(h.revoked.length, 1);
  h.cache.clear();
  assert.equal(h.cache.bytes, 0); assert.equal(h.revoked.length, 3);
});
test('authorization failure invalidates cache and stale requests cannot repopulate it', async () => {
  let resolve;
  const h = harness(async (url) => url.endsWith('bad') ? new Response('',{status:403}) : url.endsWith('late') ? new Promise(r=>{resolve=r;}) : response());
  await h.cache.get('one');
  const late = h.cache.get('late');
  await assert.rejects(h.cache.get('bad'));
  resolve(response()); await assert.rejects(late);
  assert.equal(h.cache.entries.size, 0); assert.equal(h.cache.pending.size, 0);
});

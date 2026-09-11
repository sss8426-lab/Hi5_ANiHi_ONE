import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/data-core/award-image-cache.js', 'utf8');
function harness(fetch, extra = {}) {
  const revoked = [], created = [];
  const scope = vm.createContext({ fetch, AbortController, DOMException, setTimeout, clearTimeout, URL: {
    createObjectURL(blob) { const url = `blob:synthetic-${created.length}`; created.push(blob); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  }, ...extra });
  vm.runInContext(source, scope);
  return { cache: vm.runInContext('new AwardImageCache({maxBytes:8,maxEntries:2})', scope), revoked, created };
}
const response = () => new Response(new Blob(['1234'], {type:'image/png'}));

test('stalled transfer becomes a retryable error, releases its slot and retry succeeds', async()=>{
  let attempts=0;
  const h=harness((_url,{signal})=>++attempts===1?new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')))):response());
  h.cache.timeoutMs=10;
  await assert.rejects(h.cache.get('slow'),error=>error.name!=='AbortError'&&/다시 시도/.test(error.message));
  assert.equal(h.cache.active,0);assert.equal(h.cache.pending.size,0);
  await h.cache.get('slow');assert.equal(attempts,2);
});
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

const previewRuntime = {
  createImageBitmap: async () => ({width:2400,height:1600,close(){}}),
  document: {createElement: () => ({getContext: () => ({drawImage(){}}),toBlob: done => done(new Blob(['p'],{type:'image/webp'}))})},
};
test('40 display previews survive original LRU eviction, stay small, and never refetch on warm preview', async () => {
  let requests=0;
  const h=harness(async()=>{requests++;return response();},previewRuntime), previews=[];
  for(let i=0;i<40;i++)previews.push(await h.cache.getThumbnail(String(i)));
  assert.equal(h.cache.entries.size,2);
  assert.equal(h.cache.previews.size,40);
  assert.equal(h.cache.previewBytes,40);
  assert.ok(previews.every(url=>!h.revoked.includes(url)));
  assert.equal(await h.cache.getThumbnail('0'),previews[0]);
  assert.equal(requests,40);
  h.cache.clear();
  assert.equal(h.cache.previewBytes,0);
  assert.ok(previews.every(url=>h.revoked.includes(url)));
});
test('clicked original bypasses gallery backlog using reserved slot without duplicate download', async () => {
  const started=[], release=new Map();
  const h=harness(url=>new Promise(resolve=>{started.push(url);release.set(url,resolve);}));
  const jobs=['a','b','c','d','e'].map(id=>h.cache.get(id));
  await new Promise(r=>setTimeout(r,0));
  assert.equal(started.length,3);
  const clicked=h.cache.get('e',{priority:true});
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(started.map(url=>url.split('/').pop()),['a','b','c','e']);
  release.get('/api/data-core/files/e')(response());await clicked;
  for(const id of ['a','b','c'])release.get('/api/data-core/files/'+id)(response());
  for(let attempt=0;!release.has('/api/data-core/files/d')&&attempt<100;attempt++)await new Promise(r=>setTimeout(r,5));
  release.get('/api/data-core/files/d')(response());await Promise.all(jobs);
  assert.equal(started.length,5);assert.equal(h.cache.active,0);
});
test('offscreen queued work cancels before network and can be requested again', async () => {
  const release=[], started=[];
  const h=harness(url=>new Promise(resolve=>{started.push(url);release.push(resolve);}));
  const jobs=['a','b','c'].map(id=>h.cache.get(id));
  const queued=h.cache.get('offscreen');
  h.cache.cancelQueued('offscreen');
  await assert.rejects(queued,{name:'AbortError'});
  assert.equal(started.length,3);
  for(const resolve of release)resolve(response());await Promise.all(jobs);
  const retry=h.cache.get('offscreen');await new Promise(r=>setTimeout(r,0));
  release.at(-1)(response());await retry;assert.equal(started.length,4);
});
test('403 clears displayed previews and blocks further reads until explicit reset', async () => {
  let denied=0, requests=0;
  const h=harness(async url=>{requests++;return url.endsWith('bad')?new Response('',{status:403}):response();},previewRuntime);
  h.cache.onDenied=()=>denied++;
  const preview=await h.cache.getThumbnail('one');
  await assert.rejects(h.cache.get('bad'));
  await assert.rejects(h.cache.getThumbnail('one'));
  await assert.rejects(h.cache.get('another'));
  assert.equal(requests,2);assert.equal(denied,1);assert.ok(h.revoked.includes(preview));
  h.cache.clear();await h.cache.get('allowed');assert.equal(requests,3);
});
test('late thumbnail encode cannot repopulate after folder change', async () => {
  let encode;
  const h=harness(async()=>response(),{...previewRuntime,document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:done=>{encode=done;}})}});
  const task=h.cache.getThumbnail('one');
  for(let attempt=0;!encode&&attempt<100;attempt++)await new Promise(r=>setTimeout(r,5));
  assert.equal(typeof encode,'function');
  h.cache.clear();encode(new Blob(['p'],{type:'image/webp'}));
  await assert.rejects(task,{name:'AbortError'});assert.equal(h.cache.previews.size,0);
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
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(h.cache.get('bad'));
  resolve(response()); await assert.rejects(late);
  assert.equal(h.cache.entries.size, 0); assert.equal(h.cache.pending.size, 0);
});

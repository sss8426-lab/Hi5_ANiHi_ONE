import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile('public/data-core/private-image-cache.js','utf8');
const path=id=>`/api/data-core/library/files/${id}`;
const response=()=>new Response('1234',{headers:{'content-type':'image/webp'}});
function harness(fetch,options={}) {
  const revoked=[];let created=0,unauthorized=0,now=0;
  const scope=vm.createContext({fetch,AbortController,DOMException,Blob,Date:{now:()=>now},URL:{createObjectURL:()=>`blob:${++created}`,revokeObjectURL:url=>revoked.push(url)}});
  vm.runInContext(source,scope);const cache=new scope.DataCorePrivateImageCache({maxBytes:8,maxEntries:2,...options,onUnauthorized:()=>unauthorized++});
  return {cache,revoked,unauthorized:()=>unauthorized,advance:ms=>{now+=ms;}};
}
test('staff cache deduplicates, enforces private API paths and conditional browser cache',async()=>{
  const requests=[];const h=harness(async(url,options)=>{requests.push({url,options});return response();});
  const first=h.cache.get(path('one'));assert.equal(h.cache.get(path('one')),first);const url=await first;
  assert.equal(await h.cache.get(path('one')),url);assert.equal(requests.length,1);
  assert.equal(requests[0].options.cache,'no-cache');assert.equal(requests[0].options.credentials,'same-origin');
  for(const denied of ['https://other.test/image','/api/family/files/one','/api/data-core/files/one'])await assert.rejects(h.cache.get(denied));
  h.cache.clear();assert.equal(h.cache.bytes,0);assert.equal(h.revoked.length,1);
});
test('staff cache bounded LRU/TTL releases every object URL',async()=>{
  const h=harness(async()=>response());await h.cache.get(path('one'));await h.cache.get(path('two'));await h.cache.get(path('one'));await h.cache.get(path('three'));
  assert.equal(h.cache.entries.size,2);assert.equal(h.cache.bytes,8);assert.ok(!h.cache.entries.has(path('two')));
  h.advance(300001);await h.cache.get(path('one'));assert.equal(h.cache.entries.size,1);assert.equal(h.revoked.length,3);
  h.cache.clear();assert.equal(h.revoked.length,4);
});
test('staff cache concurrency3 and abort remove pending work without stale repopulation',async()=>{
  let peak=0,active=0;const pending=[];
  const h=harness((url,options)=>new Promise((resolve,reject)=>{active++;peak=Math.max(peak,active);options.signal.addEventListener('abort',()=>{active--;reject(new DOMException('Cancelled','AbortError'));},{once:true});pending.push(()=>{active--;resolve(response());});}));
  const jobs=Array.from({length:8},(_,i)=>h.cache.get(path(String(i))));const results=Promise.allSettled(jobs);
  assert.equal(peak,3);assert.equal(h.cache.queue.length,5);h.cache.clear();await results;
  assert.equal(h.cache.active,0);assert.equal(h.cache.entries.size,0);assert.equal(h.cache.pending.size,0);
});

test('clicked library image gets a reserved transfer slot ahead of queued thumbnails',async()=>{
  const requests=[],release=new Map(),h=harness(url=>new Promise(resolve=>{requests.push(url);release.set(url,resolve);}));
  const jobs=['a','b','c','d','clicked'].map(id=>h.cache.get(path(id)));
  const clicked=h.cache.get(path('clicked'),{priority:true});
  assert.deepEqual(requests,[path('a'),path('b'),path('c'),path('clicked')]);
  release.get(path('clicked'))(response());await clicked;
  assert.equal(h.cache.peek(path('clicked')).startsWith('blob:'),true);
  for(const id of ['a','b','c'])release.get(path(id))(response());
  await new Promise(r=>setTimeout(r,0));release.get(path('d'))(response());await Promise.all(jobs);
  assert.equal(requests.length,5);h.cache.clear();
});
test('401/403 clear and block subsequent cache use; oversized images never allocate object URLs',async()=>{
  for(const status of [401,403]){
    const h=harness(async url=>url.endsWith('bad')?new Response('',{status}):response());await h.cache.get(path('good'));await assert.rejects(h.cache.get(path('bad')));
    assert.equal(h.cache.bytes,0);assert.equal(h.unauthorized(),1);assert.equal(h.revoked.length,1);await assert.rejects(h.cache.get(path('good')));
  }
  const h=harness(async()=>new Response('0123456789',{headers:{'content-type':'image/jpeg'}}));await assert.rejects(h.cache.get(path('large')));assert.equal(h.cache.entries.size,0);
});

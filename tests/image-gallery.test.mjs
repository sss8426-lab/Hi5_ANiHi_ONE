import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('all gallery consumers load the shared viewer and stylesheet before application code', async()=>{
  for(const [file,app] of [['data-core/index.html','/data-core/app.js'],['data-core/content.html','/data-core/content.js'],['admissions-web/renderer/index.html','src="app.js'],['data-core/work/kkumeum.html','/data-core/work/kkumeum.js'],['family/index.html','/family/family.js']]){
    const source=await readFile('public/'+file,'utf8');
    assert.ok(source.includes('/data-core/image-gallery.css'),file);
    assert.ok(source.indexOf('/data-core/image-gallery.js')>=0&&source.indexOf('/data-core/image-gallery.js')<source.indexOf(app),file);
  }
});

test('guardian child switches and logout discard stale artwork responses',async()=>{
  const source=await readFile('public/family/family.js','utf8'), pending=[], failures=[];
  const context=vm.createContext({window:{DataCoreImageGallery:{close(){}}},
    state:{children:[],selectedChildId:'',artworks:[],reports:[]},
    $:()=>null,renderChildSelector(){},renderCurrentChild(){},
    genericAccessMessage:e=>failures.push(e),api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  vm.runInContext('let childFeedRequest=0;'+source.slice(source.indexOf('function clearPrivateUi()'),source.indexOf('function urlBase64ToUint8Array'))+
    source.slice(source.indexOf('async function loadChildFeed('),source.indexOf('async function enterFamily(')),context);
  const first=vm.runInContext("loadChildFeed('synthetic-a')",context), second=vm.runInContext("loadChildFeed('synthetic-b')",context);
  pending[2].resolve({reports:[]});pending[3].resolve({artworks:[{id:'b-image'}]});await second;
  pending[0].resolve({reports:[]});pending[1].resolve({artworks:[{id:'a-image'}]});await first;
  assert.equal(context.state.artworks[0].id,'b-image');
  const third=vm.runInContext("loadChildFeed('synthetic-a')",context);
  vm.runInContext('clearPrivateUi()',context);
  pending[4].resolve({reports:[]});pending[5].resolve({artworks:[{id:'a-image'}]});await third;
  assert.equal(context.state.artworks.length,0);
  const fourth=vm.runInContext("loadChildFeed('synthetic-a')",context), fifth=vm.runInContext("loadChildFeed('synthetic-b')",context);
  pending[8].resolve({reports:[]});pending[9].resolve({artworks:[{id:'b-image'}]});await fifth;
  pending[6].reject(Error('stale denied response'));pending[7].resolve({artworks:[]});await fourth;
  assert.equal(failures.length,0);assert.equal(context.state.artworks[0].id,'b-image');
});

test('private image bytes are never cached by the family service worker',async()=>{
  const source=await readFile('public/family/sw.js','utf8');
  assert.ok(source.includes("'/data-core/image-gallery.js'"));
  assert.match(source,/url.pathname.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(source,/STATIC_SHELL\s*=\s*\[[^\]]*\/api\//s);
});

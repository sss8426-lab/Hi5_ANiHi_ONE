import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile('public/data-core/library-thumbnail.js','utf8');
const queueSource=await readFile('public/data-core/upload-queue.js','utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await turn();}assert.fail('Pipeline did not reach expected state');}
function harness({upload,fetch,decode,timeout}={}){
  const stats={decoded:0,peakDecode:0,closed:0,originals:[],previews:[],warnings:0};
  const context=vm.createContext({AbortController,FormData,Blob,console:{warn(){stats.warnings++;}},setTimeout:timeout||setTimeout,clearTimeout,
    createImageBitmap:async file=>{stats.decoded++;stats.peakDecode=Math.max(stats.peakDecode,stats.decoded);if(decode)await decode(file);return {width:2400,height:1600,close(){stats.decoded--;stats.closed++;}};},
    document:{createElement(){const canvas={width:0,height:0,getContext:()=>({drawImage(){}}),toBlob(callback){callback(new Blob(['synthetic preview'],{type:'image/webp'}));}};return canvas;}},
    fetch:async(url,options)=>{stats.previews.push({url,options});if(fetch)return fetch(url,options);return {ok:true,json:async()=>({file:{id:'preview'}})};},
  });
  vm.runInContext(queueSource,context);
  context.DataCoreUploadQueue.send=async(file,target,signal,progress)=>{
    stats.originals.push(file);if(upload)return upload(file,target,signal,progress);
    progress(file.size,file.size);return {file:{id:file.name}};
  };
  vm.runInContext(source,context);
  return {stats,api:context.DataCoreLibraryThumbnail,Queue:context.DataCoreUploadQueue};
}
const photo=i=>({name:`synthetic-${i}.jpg`,type:'image/jpeg',size:100});

test('eight originals retain bounded concurrency while slow preview saves no longer serialize decoding',async()=>{
  const saves=[],snapshots=[];
  const {stats,api,Queue}=harness({fetch:async()=>{const g=gate();saves.push(g);await g.promise;return {ok:true,json:async()=>({})};}});
  const files=Array.from({length:8},(_,i)=>photo(i));
  const queue=new Queue(files,{libraryScoped:true},p=>snapshots.push(p),api.send);
  const running=queue.run();
  await until(()=>saves.length===3);
  assert.equal(stats.closed,3,'all three decodes finish before any preview network response');
  assert.equal(stats.peakDecode,1,'never decode multiple full-size images together');
  assert.equal(stats.originals.length,3);assert.ok(queue.snapshot().percent<100);
  saves.slice().forEach(g=>g.resolve());await until(()=>saves.length===6);
  saves.slice(3).forEach(g=>g.resolve());await until(()=>saves.length===8);
  saves.slice(6).forEach(g=>g.resolve());await running;
  assert.equal(queue.snapshot().success,8);assert.equal(queue.snapshot().percent,100);
  assert.equal(stats.originals.length,8);assert.ok(files.every((f,i)=>f===stats.originals[i]),'unchanged original File objects');
  assert.ok(snapshots.some(p=>p.currentItems.some(i=>i.phase==='thumbnail')));
});

test('local preview preparation overlaps original transfer but never persists before original success',async()=>{
  const original=gate();const {api,stats}=harness({upload:()=>original.promise});
  const running=api.send(photo(1),{},new AbortController().signal,()=>{},{});
  await until(()=>stats.closed===1);assert.equal(stats.previews.length,0);
  original.resolve({file:{id:'saved-original'}});const result=await running;
  assert.equal(result.thumbnailCreated,true);assert.match(stats.previews[0].url,/saved-original\/thumbnail$/);
});

test('original failure never stores a preview and does not poison subsequent work',async()=>{
  let fail=true;const {api,stats}=harness({upload:async()=>{if(fail)throw Error('upload failed');return {file:{id:'next'}};}});
  await assert.rejects(api.send(photo(1),{},new AbortController().signal,()=>{},{}),/upload failed/);
  assert.equal(stats.previews.length,0);fail=false;
  assert.equal((await api.send(photo(2),{},new AbortController().signal,()=>{},{})).thumbnailCreated,true);
});

test('optional preview errors and bounded timeout preserve original success without retry',async()=>{
  for(const mode of ['failure','timeout']){
    let expire;
    const {api,stats}=harness({timeout:mode==='timeout'?(fn,ms)=>{assert.equal(ms,15000);expire=fn;return 0;}:undefined,
      fetch:mode==='failure'?async()=>({ok:false}):async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))});
    const running=api.send(photo(1),{},new AbortController().signal,()=>{},{});
    if(mode==='timeout'){await until(()=>Boolean(expire));expire();}
    const result=await running;assert.equal(result.file.id,'synthetic-1.jpg');assert.equal(result.thumbnailCreated,false);
    assert.equal(stats.originals.length,1);assert.equal(stats.warnings,1);
  }
});

test('cancel after saved original aborts only optional preview; design originals are not decoded',async()=>{
  const signal=new AbortController();
  const {api,stats}=harness({fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}))});
  const running=api.send(photo(1),{},signal.signal,()=>{},{});await until(()=>stats.previews.length===1);signal.abort();
  assert.equal((await running).file.id,'synthetic-1.jpg');assert.equal(stats.closed,1);
  for(const name of ['original.psd','original.ai','original.pdf'])await api.send({name,type:name.endsWith('.pdf')?'application/pdf':'image/jpeg',size:100},{},new AbortController().signal,()=>{},{});
  assert.equal(stats.closed,1);assert.equal(stats.previews.length,1);
});

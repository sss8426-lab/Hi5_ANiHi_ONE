import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({AbortController,FormData,console});
vm.runInContext(await readFile('public/data-core/upload-queue.js','utf8'),context);
const Queue=context.DataCoreUploadQueue;
for(const count of [1,10,30]) test(`real byte progress and bounded queue: ${count} files`,async()=>{
  let active=0,max=0;const snapshots=[];
  const target={recordId:'synthetic-folder'};
  const queue=new Queue(Array.from({length:count},(_,i)=>({name:`${i}.png`,size:100})),target,p=>snapshots.push(p),async(file,t,signal,progress)=>{
    assert.equal(t.recordId,'synthetic-folder');active++;max=Math.max(max,active);
    progress(50,120);await new Promise(r=>setTimeout(r,2));progress(120,120);
    assert.ok(queue.snapshot().percent<100,'response not received yet');active--;return {file:{id:file.name}};
  });
  target.recordId='changed';await queue.run();
  assert.ok(max<=3);assert.equal(queue.snapshot().success,count);assert.equal(queue.snapshot().percent,100);
  assert.equal(queue.snapshot().loaded,count*120);assert.equal(queue.snapshot().total,count*120);
  assert.ok(snapshots.some(p=>p.percent>0&&p.percent<100));
});
test('partial failure retries only failed items, preserving successful uploads',async()=>{
  let fail=true;const calls=[];
  const queue=new Queue([{name:'ok',size:10},{name:'bad',size:10}],{},()=>{},async(file,t,s,p)=>{
    calls.push(file.name);p(8,12);if(file.name==='bad'&&fail)throw Error('synthetic failure');return {file:{id:file.name}};
  });
  await queue.run();assert.equal(queue.snapshot().success,1);assert.equal(queue.snapshot().failed,1);assert.ok(queue.snapshot().percent<100);
  fail=false;await queue.run(true);assert.deepEqual(calls,['ok','bad','bad']);assert.equal(queue.snapshot().percent,100);
});
test('cancel aborts active requests, stops waiting items, and retains completed results',async()=>{
  let calls=0;
  const queue=new Queue(Array.from({length:30},(_,i)=>({name:String(i),size:20})),{},()=>{},async(file,t,signal,progress)=>{
    calls++;if(file.name==='0')return {file:{id:'saved'}};
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
  });
  const running=queue.run();await new Promise(r=>setTimeout(r,5));queue.cancel();await running;
  assert.ok(calls<=4);assert.equal(queue.snapshot().success,1);assert.equal(queue.items[0].result.file.id,'saved');
  assert.equal(queue.snapshot().cancelled,true);assert.ok(queue.snapshot().percent<100);
});

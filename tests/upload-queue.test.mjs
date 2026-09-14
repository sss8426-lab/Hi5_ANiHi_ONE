import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context=vm.createContext({AbortController,FormData,console});
vm.runInContext(await readFile('public/data-core/upload-queue.js','utf8'),context);
const Queue=context.DataCoreUploadQueue;
const MiB=1024*1024;

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
  const queue=new Queue(Array.from({length:30},(_,i)=>({name:String(i),size:20})),{},()=>{},async(file,t,signal)=>{
    calls++;if(file.name==='0')return {file:{id:'saved'}};
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
  });
  const running=queue.run();await new Promise(r=>setTimeout(r,5));queue.cancel();await running;
  assert.ok(calls<=4);assert.equal(queue.snapshot().success,1);assert.equal(queue.items[0].result.file.id,'saved');
  assert.equal(queue.snapshot().cancelled,true);assert.ok(queue.snapshot().percent<100);
});

test('library client preflight permits design binaries but rejects executables and files over 2GiB',()=>{
  assert.equal(Queue.preflight({name:'2608청강대시상식.ai',size:250*MiB}),'');
  assert.equal(Queue.preflight({name:'작업 원본.psd',size:110*MiB}),'');
  assert.equal(Queue.preflight({name:'작업 원본.psb',size:110*MiB}),'');
  assert.equal(Queue.preflight({name:'백업.zip',size:110*MiB}),'');
  assert.match(Queue.preflight({name:'danger.exe',size:51*MiB}),/실행 파일|스크립트/);
  assert.match(Queue.preflight({name:'too-large.ai',size:2*1024*1024*1024+1}),/2GB/);
});

test('library upload routes 1/49MiB to simple and 51/110/250MiB to R2 multipart',async()=>{
  const originalSimple=Queue.sendSimple,originalMultipart=Queue.sendMultipart;
  const calls=[];
  Queue.sendSimple=async file=>{calls.push(['simple',file.size]);return {file:{id:'simple'}};};
  Queue.sendMultipart=async file=>{calls.push(['multipart',file.size]);return {file:{id:'multipart'}};};
  try {
    for(const size of [1*MiB,49*MiB]) await Queue.send({name:'small.ai',size},{libraryScoped:true},new AbortController().signal,()=>{},{});
    for(const size of [51*MiB,110*MiB,250*MiB]) await Queue.send({name:'large.ai',size},{libraryScoped:true},new AbortController().signal,()=>{},{});
  } finally { Queue.sendSimple=originalSimple;Queue.sendMultipart=originalMultipart; }
  assert.deepEqual(calls.map(([kind])=>kind),['simple','simple','multipart','multipart','multipart']);
  assert.equal(Queue.SIMPLE_UPLOAD_MAX_BYTES,50*MiB);
  assert.equal(Queue.MULTIPART_CHUNK_BYTES,16*MiB);
  assert.equal(Queue.MULTIPART_CONCURRENCY,3);
});

test('library queue exposes active byte progress for the upload modal',async()=>{
  const snapshots=[];
  const queue=new Queue([{name:'대용량.ai',size:100}],{libraryScoped:true},p=>snapshots.push(p),async(file,t,s,p)=>{
    p(37,100);await new Promise(r=>setTimeout(r,1));return {file:{id:'ok'}};
  });
  await queue.run();
  assert.ok(snapshots.some(s=>s.currentItems?.[0]?.name==='대용량.ai'&&s.currentItems[0].loaded===37&&s.currentItems[0].total===100));
});

test('multipart retry resumes from the failed part in the same page',async()=>{
  const originalJson=Queue.json,originalUploadPart=Queue.uploadPart,originalConcurrency=Queue.MULTIPART_CONCURRENCY;
  let starts=0,completes=0,failedOnce=false;const calls=[];
  Queue.MULTIPART_CONCURRENCY=1;
  Queue.json=async(url,options)=>{
    if(url==='/api/data-core/library/uploads'){starts++;return {sessionId:'session-1',chunkSize:16*MiB,partCount:4};}
    if(url.endsWith('/complete')){completes++;return {file:{id:'complete'}};}
    throw new Error(`unexpected ${url} ${options?.method}`);
  };
  Queue.uploadPart=async(sessionId,partNumber,blob,signal,onProgress)=>{
    calls.push(partNumber);onProgress(blob.size);
    if(partNumber===2&&!failedOnce){failedOnce=true;throw new Error('synthetic part failure');}
    return {partNumber,etag:`etag-${partNumber}`};
  };
  const file={name:'retry.ai',size:51*MiB,type:'application/postscript',slice:(start,end)=>({size:end-start})};
  const item={};
  try {
    await assert.rejects(()=>Queue.sendMultipart(file,{recordId:'folder'},new AbortController().signal,()=>{},item),/synthetic part failure/);
    const result=await Queue.sendMultipart(file,{recordId:'folder'},new AbortController().signal,()=>{},item);
    assert.equal(result.file.id,'complete');
  } finally {
    Queue.json=originalJson;Queue.uploadPart=originalUploadPart;Queue.MULTIPART_CONCURRENCY=originalConcurrency;
  }
  assert.equal(starts,1,'retry should reuse the existing upload session');
  assert.equal(completes,1);
  assert.deepEqual(calls,[1,2,2,3,4],'only the failed and not-yet-uploaded parts should be sent again');
});

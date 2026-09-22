import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {libraryHarness,users,A,ORG} from './support/library-harness.mjs';

const account='a'.repeat(32), endpoint='/api/data-core/library/usage/';
const info={covered:true,subscriptions:[{id:'sub-1',billing_cycle_anchor_timestamp:'2026-01-17T00:00:00Z',start_timestamp:'2026-01-17T00:00:00Z'}]};
const cost=(amount=1)=>({BillingAccountId:account,ServiceFamilyName:'R2',ServiceName:'R2 Standard Storage',SubscriptionId:'sub-1',BillingCurrency:'USD',BillingPeriodStart:'2026-09-17T00:00:00Z',ChargePeriodStart:'2026-09-20T00:00:00Z',ChargePeriodEnd:'2026-09-21T00:00:00Z',ChargeCategory:'Usage',ChargeClass:null,ContractedCost:amount,CumulatedContractedCost:1000});
const expire=h=>h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.snapshot.attemptedAt','2000-01-01T00:00:00Z','$.nextAttempt',0,'$.leaseUntil',0) WHERE record_type='library-r2-usage'").run();

test('R2 usage: master-only, independent caches, latest snapshots, exact zero, duplicates, missing data and stale',async()=>{
  const h=await libraryHarness(),original=globalThis.fetch;let calls=0,mode='ok',rows=[cost(),cost(),{...cost(-.25),ChargeClass:'Correction'}, {...cost(500),ServiceFamilyName:'Workers'}];
  try{
    globalThis.fetch=async(url,options)=>{
      calls++;assert.ok(String(url).startsWith('https://api.cloudflare.com/client/v4/'));
      if(mode==='denied')return Response.json({},{status:403});
      if(String(url).endsWith('/info'))return Response.json({success:true,result:info});
      if(String(url).endsWith('/billable-usage'))return Response.json({success:true,result:rows});
      const query=JSON.parse(options.body);assert.equal(query.variables.account,account);assert.equal(query.variables.b0,'bucket-a');assert.equal(query.variables.b1,'bucket-b');assert.equal(query.variables.b2,undefined);
      const snapshot=(bytes,offset=0)=>({max:{payloadSize:bytes,metadataSize:7},dimensions:{datetime:new Date(Date.now()-1000-offset).toISOString()}});
      return Response.json({data:{viewer:{accounts:[{b0:[snapshot(mode==='zero'?0:2e9),snapshot(99e9,10000)],b1:mode==='partial'?[]:[snapshot(0)]}]}}});
    };
    for(const kind of ['storage','billing']){
      assert.equal((await h.request('GET',endpoint+kind,null)).status,401);
      for(const user of [users.teacher,users.staff,users.campusAdmin,users.director,users.outsider])assert.equal((await h.request('GET',endpoint+kind,user)).status,403);
      const setup=await h.request('GET',endpoint+kind,users.master);assert.equal(setup.body.state,'setup_required');assert.equal(setup.body.data,null);
    }
    assert.equal(calls,0);
    Object.assign(h.env,{CLOUDFLARE_USAGE_ACCOUNT_ID:account,CORE_R2_USAGE_BUCKETS:'bucket-b,bucket-a,bucket-a',CLOUDFLARE_USAGE_API_TOKEN:'synthetic-only'});
    let result=await h.request('GET',endpoint+'storage?accountId=evil&bucketName=evil',users.master);
    assert.equal(result.body.data.bytes,2e9);assert.equal(result.body.data.gb,2);assert.equal(result.body.data.gib,2e9/2**30);assert.equal(result.body.data.buckets.length,2);assert.equal(result.headers.get('cache-control'),'private, no-store');
    for(let i=0;i<30;i++)await h.request('GET',endpoint+'storage',users.master);
    assert.equal(calls,1);
    result=await h.request('GET',endpoint+'billing',users.admin);assert.equal(result.body.data.cost,.75);assert.equal(result.body.data.periods[0].items.length,2);assert.equal(result.body.data.periods[0].periodEnd,null);
    await expire(h);mode='zero';rows=[cost(0)];
    assert.equal((await h.request('GET',endpoint+'storage',users.master)).body.data.bytes,0);
    assert.equal((await h.request('GET',endpoint+'billing',users.master)).body.data.cost,0);
    await expire(h);mode='partial';rows=[];
    result=await h.request('GET',endpoint+'storage',users.master);assert.equal(result.body.state,'partial');assert.equal(result.body.data.bytes,null);assert.equal(result.body.data.knownBytes,2e9);
    result=await h.request('GET',endpoint+'billing',users.master);assert.equal(result.body.state,'no_data');assert.equal(result.body.data.cost,null);
    await expire(h);mode='ok';rows=[cost(2)];await h.request('GET',endpoint+'billing',users.master);
    await expire(h);mode='denied';result=await h.request('GET',endpoint+'billing',users.master);assert.equal(result.body.state,'stale');assert.equal(result.body.data.cost,2);assert.equal(result.body.reason,'permission_denied');
    const before=calls;await h.request('GET',endpoint+'billing',users.master);assert.equal(calls,before,'failures back off');
    const record=await h.env.DB.prepare("SELECT id FROM data_records WHERE record_type='library-r2-usage' LIMIT 1").first();
    assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(record.id),users.master,{title:'tamper'})).status,403);
    assert.equal((await h.request('GET','/api/data-core/records/'+encodeURIComponent(record.id),users.master)).status,403);
    assert.equal((await h.request('GET','/api/data-core/records?recordType=library-r2-usage',users.staff)).body.records.length,0);
    delete h.env.CLOUDFLARE_USAGE_API_TOKEN;result=await h.request('GET',endpoint+'billing',users.master);assert.equal(result.body.data,null);
    assert.equal(await (await h.env.FAMILY_FILES.get('synthetic-sentinel')).text(),'preserved');
  }finally{globalThis.fetch=original;await h.mf.dispose();}
});

test('HQ ancestry is hidden in shared navigation without changing file APIs, IDs or same-name campus folders',async()=>{
  const h=await libraryHarness();
  try{
    const parent=(await h.folder('hq','__synthetic_hq',users.master)).body.folder.id;
    const child=(await h.folder(parent,'__synthetic_child',users.master)).body.folder.id;
    const uploaded=await h.upload(child,users.master);assert.equal(uploaded.status,201);
    const file=uploaded.body.file || uploaded.body;
    assert.equal((await h.browse(child,users.master)).body.folder.navigationHidden,true);
    for(const title of ['수업그림','원장전용','자료','제작물']){
      const folder=(await h.folder(`category:${A}:admission-material`,title,users.staff)).body.folder;
      assert.equal(folder.navigationHidden,false);
    }
    const before=await h.file(file.id);assert.ok(before);
    const response=await h.raw('GET',`/api/data-core/library/files/${file.id}/download`,users.master);assert.equal(response.status,200);assert.equal(await response.text(),'synthetic library content');
    const window={};vm.runInNewContext(await fs.readFile('public/data-core/library-client.js','utf8'),{window,AbortController,DOMException});
    const result=await window.DataCoreLibraryClient.browse(async path=>{const r=await h.request('GET',path,users.master);if(r.status!==200)throw Error(JSON.stringify(r.body));return r.body;},{id:child});
    assert.equal(result.redirected,true);assert.equal(result.view.folder.id,'root');
    assert.equal(result.view.folders.some(f=>f.navigationHidden),false);
    assert.deepEqual(await h.file(file.id),before);
    assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM data_records WHERE id IN (?,?) AND organization_id=? AND deleted_at IS NULL').bind(parent,child,ORG).first()).n,2);
  }finally{await h.mf.dispose();}
});

test('R2 D1 lease coalesces different Worker binding identities without blocking library reads',async()=>{
  const h=await libraryHarness(),original=globalThis.fetch,db=h.env.DB;let release,started,requests=0;
  const entered=new Promise(r=>{started=r;});
  Object.assign(h.env,{CLOUDFLARE_USAGE_ACCOUNT_ID:account,CORE_R2_USAGE_BUCKETS:'bucket-a',CLOUDFLARE_USAGE_API_TOKEN:'synthetic-only'});
  try{
    globalThis.fetch=async()=>{requests++;started();await new Promise(r=>{release=r;});return Response.json({data:{viewer:{accounts:[{b0:[{max:{payloadSize:0,metadataSize:0},dimensions:{datetime:new Date(Date.now()-1000).toISOString()}}]}]}}});};
    const first=h.request('GET',endpoint+'storage',users.master);await entered;
    h.env.DB=new Proxy(db,{get(target,key){const v=target[key];return typeof v==='function'?v.bind(target):v;}});
    const second=await h.request('GET',endpoint+'storage',users.admin);assert.equal(second.body.state,'loading');
    assert.equal((await h.browse('root',users.master)).status,200);assert.equal(requests,1);
    release();assert.equal((await first).body.data.bytes,0);
    const cached=await h.request('GET',endpoint+'storage',users.master);assert.equal(cached.body.data.bytes,0);assert.equal(requests,1);
  }finally{release?.();globalThis.fetch=original;h.env.DB=db;await h.mf.dispose();}
});

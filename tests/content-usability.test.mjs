import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {libraryHarness,users,ORG} from './support/library-harness.mjs';
import {assembleCaption} from '../public/data-core/content-caption.js';
import {imageBox} from '../public/data-core/instagram-layout.js';

test('fixed caption text preserves newlines, appears once and deduplicates fixed tags first',()=>{
  const footer='전화 032-000-0000\n상담 안내\n';
  assert.equal(assembleCaption('소개\n'+footer,footer,'#미술 #학원 #미술',['학원','수업']),`소개\n\n${footer}\n\n#미술 #학원 #수업`);
  assert.equal(assembleCaption('소개','','',[]),'소개');
  assert.deepEqual(imageBox('real-photo','none'),{x:56,y:56,width:2048,height:2588,fit:'cover'});
  assert.equal(imageBox('student-artwork','none').fit,'contain');
});

test('shared folder requests deliver folders before slow files, coalesce and abort safely',async()=>{
  const window={};vm.runInNewContext(await fs.readFile('public/data-core/library-client.js','utf8'),{window,AbortController,DOMException,URLSearchParams});
  let calls=0,folderSeen=false,release;
  const api=async url=>{calls++;if(url.includes('/folders?'))return {folder:{id:'x'},folders:[]};return new Promise(resolve=>{release=resolve;});};
  const a=new AbortController(),b=new AbortController();
  const first=window.DataCoreLibraryClient.browse(api,{id:'x'},{signal:a.signal,onView:()=>{folderSeen=true;}});
  const rejected=assert.rejects(first,{name:'AbortError'});
  const second=window.DataCoreLibraryClient.browse(api,{id:'x'},{signal:b.signal});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(folderSeen,true);assert.equal(calls,2);
  a.abort();release({files:[]});await rejected;assert.equal((await second).listing.files.length,0);
  await assert.rejects(window.DataCoreLibraryClient.browse(async url=>{if(url.includes('/files?'))throw Error('files failed');return {};},{id:'x'},{onView:()=>{folderSeen=true;}}),/files failed/);
});

test('AI usage uses official project month data, exact zero, stale cache, safe budget fallback and ACL',async()=>{
  const h=await libraryHarness(),previous=globalThis.fetch;let calls=0,amount=12,fail=false;
  const endpoint='/api/data-core/content/ai-usage';
  const expire=()=>h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.attemptedAt','2000-01-01T00:00:00Z') WHERE record_type='content-ai-usage' AND id LIKE 'ai-usage:%'").run();
  try{
    globalThis.fetch=async(url)=>{calls++;assert.ok(String(url).startsWith('https://api.openai.com/v1/organization/'));if(fail)return Response.json({error:'synthetic'},{status:403});
      if(String(url).endsWith('/spend_limit'))return Response.json({object:'project.spend_limit',currency:'USD',interval:'month',threshold_amount:1000,enforcement:{status:'enforcing'}});
      const parsed=new URL(url);assert.equal(parsed.searchParams.get('project_ids[]'),'proj-synthetic');assert.equal(parsed.searchParams.get('group_by[]'),'project_id');
      return Response.json({has_more:false,data:[{results:[{object:'organization.costs.result',project_id:'proj-synthetic',amount:{currency:'usd',value:amount}}]}]});};
    let result=await h.request('GET',endpoint,users.staff);assert.equal(result.status,200);assert.equal(result.body.percent,null);assert.equal(result.body.cost,null);assert.equal(calls,0);
    assert.equal((await h.request('GET',endpoint,null)).status,401);
    assert.equal((await h.request('PUT','/api/data-core/content/ai-budget',users.staff,{amount:20})).status,403);
    for(const amount of [0,-1,'10',0.001])assert.equal((await h.request('PUT','/api/data-core/content/ai-budget',users.master,{amount})).status,400);
    assert.equal((await h.request('PUT','/api/data-core/content/ai-budget',users.master,{amount:20})).status,200);
    result=await h.request('GET',endpoint,users.staff);assert.equal(result.body.budget.amount,20);assert.equal(result.body.percent,null);
    h.env.OPENAI_ADMIN_KEY='synthetic-admin-not-real';h.env.OPENAI_PROJECT_ID='proj-synthetic';
    result=await h.request('GET',endpoint,users.staff);assert.equal(result.body.cost,12);assert.equal(result.body.percent,120);assert.equal(result.body.budget.policy,'hard');assert.equal(calls,2);
    await h.request('GET',endpoint,users.staff);assert.equal(calls,2,'cached metadata is not a paid probe');
    await expire();amount=0;result=await h.request('GET',endpoint,users.staff);assert.equal(result.body.percent,0);assert.equal(result.body.cost,0);
    await expire();fail=true;result=await h.request('GET',endpoint,users.staff);assert.equal(result.body.state,'permission_required');assert.equal(result.body.cost,0);assert.equal(result.body.budget.amount,10);assert.ok(result.body.updatedAt);
    delete h.env.OPENAI_ADMIN_KEY;result=await h.request('GET',endpoint,users.staff);assert.equal(result.body.cost,null,'removed credentials do not expose old cost');
    const record=await h.env.DB.prepare("SELECT id FROM data_records WHERE organization_id=? AND record_type='content-ai-usage' LIMIT 1").bind(ORG).first();
    assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(record.id),users.master,{title:'tamper'})).status,403);
    const list=await h.request('GET','/api/data-core/records?recordType=content-ai-usage',users.master);assert.ok(!JSON.stringify(list.body).includes('synthetic-admin'));
  }finally{globalThis.fetch=previous;await h.mf.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, users, A, B } from './support/library-harness.mjs';

test('outer worker routes service ingestion before session middleware and keeps it write-only', async () => {
  const h = await libraryHarness();
  const token = 'synthetic-marketing-service-only-not-real-123';
  h.env.MARKETING_INGEST_TOKEN = token;
  const bearer = { authorization: 'Bearer ' + token };
  const now = new Date();
  const date = new Date(now.getTime() + 9*3600*1000).toISOString().slice(0,10);
  const payload = { version:1,runId:'router-sample',runKind:'sample',campusId:A,reportDate:date,capturedAt:now.toISOString(),environment:{device:'desktop'},platforms:{naver:{status:'not_observed',keywords:[]}},channels:{},improvements:[],limitations:['Synthetic isolated test, no production writes.'] };
  try {
    const makeForm=()=>{const form=new FormData();form.set('payload',JSON.stringify(payload));return form;};
    const saved=await h.request('POST','/api/data-core/marketing/ingest',null,makeForm(),null,bearer);
    assert.equal(saved.status,201);assert.equal(saved.body.report.campusId,A);assert.equal(saved.body.report.status,'partial');
    const retry=await h.request('POST','/api/data-core/marketing/ingest',null,makeForm(),null,bearer);
    assert.equal(retry.status,200);assert.equal(retry.body.existing,true);assert.equal(retry.body.report.id,saved.body.report.id);
    assert.equal((await h.request('GET','/api/data-core/marketing/config',null,undefined,null,bearer)).status,401);
    assert.equal((await h.request('GET','/api/data-core/marketing/reports',null,undefined,null,bearer)).status,401);
    assert.equal((await h.request('POST','/api/data-core/records',null,{title:'disallowed'},null,bearer)).status,401);
    const recordPath='/api/data-core/records/'+encodeURIComponent(saved.body.report.id);
    assert.equal((await h.request('PATCH',recordPath,users.master,{title:'blocked mutation'})).status,403);
    assert.equal((await h.request('DELETE',recordPath,users.master)).status,403);
    const own=await h.request('GET','/api/data-core/marketing/reports',users.campusAdmin);
    assert.equal(own.status,200);assert.equal(own.body.reports.length,1);assert.equal(own.body.reports[0].campusId,A);
    assert.equal((await h.request('GET','/api/data-core/marketing/reports?campusId='+B,users.campusAdmin)).status,403);
    const config=await h.request('GET','/api/data-core/marketing/config',users.campusAdmin);
    assert.deepEqual(config.body.campuses.map(c=>c.id),[A]);assert.equal(config.body.capabilities.ingestConfigured,true);
    const master=await h.request('GET','/api/data-core/marketing/config',users.master);
    assert.equal(master.body.campuses.length,10);
    const count=await h.env.DB.prepare("SELECT COUNT(*) AS count FROM data_records WHERE record_type='marketing-report'").first();assert.equal(count.count,1);
  } finally { await h.mf.dispose(); }
});

test('marketing page aliases, encoded HTML and HEAD never bypass session guard', async()=>{
  const h=await libraryHarness();
  try {
    for(const url of ['/data-core/work/marketing','/data-core/work/marketing/','/data-core/marketing','/data-core/marketing.html','/data-core/%6Darketing.html']){
      const response=await h.raw('HEAD',url,null);
      assert.equal(response.status,401,url);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(await response.text(),'');
    }
  } finally { await h.mf.dispose(); }
});

import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import worker from '../dist/server/index.js';

// Real public feeds; the DATA CORE context/database are disposable local fixtures.
const mf=new Miniflare({script:"export default {fetch(){return new Response('ok')}}",modules:true,d1Databases:['DB'],d1Persist:false,r2Buckets:['FILES'],r2Persist:false});
try {
  const env={DB:await mf.getD1Database('DB'),FILES:await mf.getR2Bucket('FILES'),DATA_CORE_SUPER_ADMIN_EMAILS:'source-check@example.test'};
  const headers={'oai-authenticated-user-id':'synthetic-source-check','oai-authenticated-user-email':'source-check@example.test','oai-authenticated-user-full-name':'Synthetic source check'};
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  for(const source of ['artmd','mgood']) {
    const response=await worker.fetch(new Request(`http://localhost/api/data-core/competition-sources/${source}/preview`,{method:'POST',headers}),env,{waitUntil(){}});
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));
    console.log(JSON.stringify({source,status:response.status,pages:data.pages}));
    for(const item of data.items.filter(i=>(i.sourceStatus==='open'||(i.source==='mgood'&&i.sourceStatus==='upcoming'))&&(!i.applicationEnd||i.applicationEnd>=today))) {
      const detail=await fetch(item.sourceUrl,{signal:AbortSignal.timeout(20000)});
      await detail.body?.cancel();
      console.log(JSON.stringify({source,externalId:item.externalSourceId,detailStatus:detail.status}));
      assert.equal(detail.status,200);
    }
  }
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM data_records WHERE record_type='competition'").first()).n,0);
} finally {await mf.dispose();}

import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

await mkdir(resolve('.wrangler'),{recursive:true});
const temp=await mkdtemp(join(resolve('.wrangler'),'core-marketing-'));
const built=await build({entryPoints:[fileURLToPath(new URL('../worker/data-core-marketing.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
await writeFile(join(temp,'marketing.mjs'),built.outputFiles[0].contents);
const {handleMarketingApi,validateMarketingPayload,validateMarketingPng,MARKETING_KEYWORDS}=await import(pathToFileURL(join(temp,'marketing.mjs')));
const protectionBuild=await build({stdin:{contents:"export {assertMutableRecordType,canReadRegisteredFile} from './worker/data-core-derivative-policy'; export {canReadRow} from './worker/data-core-records'; export {uploadDataCoreFile,deleteDataCoreFile} from './worker/data-core-files';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
await writeFile(join(temp,'protection.mjs'),protectionBuild.outputFiles[0].contents);
const protection=await import(pathToFileURL(join(temp,'protection.mjs')));
const A='campus-anihi-admission',B='campus-design-admission',ORG='org-hi5-anihi';
const headers={ 'oai-authenticated-user-id':'marketing-master','oai-authenticated-user-email':'marketing-master@example.test'};
function payload(overrides={}) {const now=new Date();return {version:1,runId:'run-1',runKind:'sample',campusId:A,reportDate:new Date(now.getTime()+32400000).toISOString().slice(0,10),capturedAt:now.toISOString(),environment:{device:'desktop'},platforms:{naver:{status:'일부 확인',keywords:[{keyword:MARKETING_KEYWORDS[0],adStatus:'not_observed',adRank:null}]}},channels:{},improvements:[],limitations:[],...overrides};}
async function harness() {
 const mf=new Miniflare({script:"export default {fetch(){return new Response('ok')}}",modules:true,d1Databases:['DB'],r2Buckets:['FILES']});
 const env={DB:await mf.getD1Database('DB'),FILES:await mf.getR2Bucket('FILES'),DATA_CORE_SUPER_ADMIN_EMAILS:headers['oai-authenticated-user-email'],MARKETING_INGEST_TOKEN:'test-only-secret'};
 const call=async(path,init={},bindings=env)=>{const response=await handleMarketingApi(new Request('http://localhost/api/data-core/marketing'+path,init),bindings);return {status:response.status,body:await response.json()};};
 await call('/config',{headers});
 const ingest=(p,images=[],extra={})=>{const form=new FormData();form.append('payload',JSON.stringify(p));images.forEach(f=>form.append('images',f));return call('/ingest',{method:'POST',headers:{authorization:'Bearer test-only-secret',...extra},body:form});};
 return {mf,env,call,ingest};
}
test('payload null metrics, date, keyword and numeric validation',()=>{
 const p=validateMarketingPayload(payload());assert.equal(p.platforms.naver.keywords[0].adCount,null);assert.equal(p.platforms.naver.keywords[0].adRank,null);
 assert.throws(()=>validateMarketingPayload(payload({reportDate:'2026-02-31'})));
 const bad=payload();bad.platforms.naver.keywords[0].adRank=-1;assert.throws(()=>validateMarketingPayload(bad));
 bad.platforms.naver.keywords[0].adRank=2;bad.platforms.naver.keywords[0].keyword='fake';assert.throws(()=>validateMarketingPayload(bad));
 assert.throws(()=>validateMarketingPayload(payload({capturedAt:'2099-01-01T00:00:00Z'})));
 assert.throws(()=>validateMarketingPayload(payload({ownerUserId:'forged-owner'})));
 assert.throws(()=>validateMarketingPayload(payload({environment:{device:'desktop',headers:{authorization:'not-a-real-credential'}}})));
 const averages=payload({channels:{instagram:{dailyProfileVisits7:3.25}}});assert.equal(validateMarketingPayload(averages).channels.instagram.dailyProfileVisits7,3.25);
 assert.throws(()=>validateMarketingPayload(payload({channels:{instagram:{dailyProfileVisits7:'3.25'}}})));
 assert.throws(()=>validateMarketingPayload(payload({channels:{instagram:{latestPublishedAt:'2026-02-31'}}})));
 const inconsistent=payload();inconsistent.platforms.naver.keywords[0].officialDocuments=3;inconsistent.platforms.naver.keywords[0].inspectedResults=2;assert.throws(()=>validateMarketingPayload(inconsistent));
 const sameKstDate=payload({reportDate:'2026-10-13',capturedAt:'2026-10-13T01:00:00+09:00',channels:{instagram:{latestPublishedAt:'2026-10-13'}}});const normalized=validateMarketingPayload(sameKstDate,Date.parse(sameKstDate.capturedAt));assert.equal(normalized.channels.instagram.latestPublishedAt,'2026-10-13');assert.equal(normalized.capturedAt,'2026-10-12T16:00:00.000Z');
});
test('service scope, missing/invalid auth, interactive config',async()=>{const h=await harness();try{
 assert.equal((await h.call('/config')).status,401);
 assert.equal((await h.call('/config',{headers:{authorization:'Bearer test-only-secret'}})).status,401);
 assert.equal((await h.call('/ingest',{method:'POST',headers:{authorization:'Bearer bad'}})).status,401);
 assert.equal((await h.call('/ingest',{method:'POST',headers:{authorization:'Bearer bad'}},{...h.env,MARKETING_INGEST_TOKEN:undefined})).status,503);
 const c=await h.call('/config',{headers});assert.equal(c.status,200);assert.equal(c.body.campuses.length,10);assert.equal(c.body.keywords.length,13);
 assert.equal((await h.call('/ingest',{method:'POST',headers})).status,403);
}finally{await h.mf.dispose();}});
test('immutable idempotency, daily/sample, campus SQL filter before limit',async()=>{const h=await harness();try{
 const p=payload();const first=await h.ingest(p);assert.equal(first.status,201);assert.equal(first.body.report.status,'partial');assert.equal(first.body.report.platforms.naver.keywords[0].adCount,null);
 assert.equal((await h.ingest(p)).body.existing,true);assert.equal((await h.ingest({...p,limitations:['changed']})).status,409);
 assert.equal((await h.ingest({...p,runId:'daily-1',runKind:'daily'})).status,201);
 await h.ingest({...p,runId:'other-campus',campusId:B});
 const admin={'oai-authenticated-user-id':'campus-admin','oai-authenticated-user-email':'campus-admin@example.test'};
 await h.env.DB.prepare("INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES ('oai:campus-admin',?,'Admin','active',?,?)").bind(admin['oai-authenticated-user-email'],p.capturedAt,p.capturedAt).run();
 await h.env.DB.prepare("INSERT INTO memberships (id,organization_id,campus_id,user_id,role,created_at,updated_at) VALUES ('marketing-member',?,?,'oai:campus-admin','CAMPUS_ADMIN',?,?)").bind(ORG,A,p.capturedAt,p.capturedAt).run();
 const list=await h.call('/reports?limit=1',{headers:admin});assert.equal(list.status,200);assert.equal(list.body.reports.length,1);assert.equal(list.body.reports[0].campusId,A);assert.equal(list.body.coverage.latestDaily.length,1);assert.equal(list.body.coverage.latestSample.length,1);
 assert.equal((await h.call('/reports?campusId='+B,{headers:admin})).status,403);
 const other=await h.call('/reports?campusId='+B,{headers});assert.equal((await h.call('/reports/'+encodeURIComponent(other.body.reports[0].id),{headers:admin})).status,403);
 assert.equal((await h.call('/channels',{method:'PUT',headers:{...admin,origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({campusId:B,channels:{blog:'https://blog.naver.com/official'}})})).status,403);
 // 선생님도 자기 캠퍼스 보고서는 볼 수 있다. 다른 캠퍼스와 채널 변경은 막힌다.
 const teacher={'oai-authenticated-user-id':'campus-teacher','oai-authenticated-user-email':'campus-teacher@example.test'};
 await h.env.DB.prepare("INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES ('oai:campus-teacher',?,'Teacher','active',?,?)").bind(teacher['oai-authenticated-user-email'],p.capturedAt,p.capturedAt).run();
 await h.env.DB.prepare("INSERT INTO memberships (id,organization_id,campus_id,user_id,role,created_at,updated_at) VALUES ('marketing-teacher',?,?,'oai:campus-teacher','TEACHER',?,?)").bind(ORG,A,p.capturedAt,p.capturedAt).run();
 const tConfig=await h.call('/config',{headers:teacher});assert.equal(tConfig.status,200);assert.deepEqual(tConfig.body.campuses.map(c=>c.id),[A]);
 const tList=await h.call('/reports',{headers:teacher});assert.equal(tList.status,200);assert.ok(tList.body.reports.length>=1);assert.ok(tList.body.reports.every(r=>r.campusId===A));
 assert.equal((await h.call('/reports/'+encodeURIComponent(tList.body.reports[0].id),{headers:teacher})).status,200);
 assert.equal((await h.call('/reports?campusId='+B,{headers:teacher})).status,403);
 assert.equal((await h.call('/reports/'+encodeURIComponent(other.body.reports[0].id),{headers:teacher})).status,403);
 assert.equal((await h.call('/channels',{method:'PUT',headers:{...teacher,origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({campusId:A,channels:{blog:'https://blog.naver.com/official'}})})).status,403);
}finally{await h.mf.dispose();}});
test('PNG signature, image limit and original R2 linkage',async()=>{const h=await harness();try{
 const fake=new File(['not png'],'fake.png',{type:'image/png'});await assert.rejects(()=>validateMarketingPng(fake));assert.equal((await h.ingest(payload(),[fake])).status,415);
 const {encode}=await import('fast-png');const png=encode({width:1,height:1,data:new Uint8Array([255,0,0,255]),channels:4});
 const file=new File([png],'source.png',{type:'image/png'});assert.equal((await h.ingest(payload(),[file,file,file,file,file])).status,413);
 const res=await h.ingest(payload(),[file]);assert.equal(res.status,201);assert.equal(res.body.report.imageFiles.length,1);
 const row=await h.env.DB.prepare('SELECT * FROM file_objects WHERE id=?').bind(res.body.report.imageFiles[0].id).first();assert.equal(row.source_app,'marketing-monitoring');assert.equal(row.category,'marketing-report');assert.equal(row.visibility,'campus');assert.equal(row.data_record_id,res.body.report.id);
 const original=await h.env.FILES.get(row.r2_key);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),png);
}finally{await h.mf.dispose();}});
test('generic records/uploads protected; only own-campus staff can download marketing PNG',async()=>{const h=await harness();try{
 const ctx={authenticated:true,database:true,user:{internalUserId:'oai:marketing-master'},isSuperAdmin:true,canWrite:true,memberships:[],campusIds:[]};
 for(const type of ['marketing-report','marketing-channel-profile','marketing-internal-config']){assert.throws(()=>protection.assertMutableRecordType(type));assert.equal(protection.canReadRow(ctx,{record_type:type}),false);}
 for(const fields of [{sourceApp:'marketing-monitoring'},{sourceApp:' marketing-monitoring '},{category:' marketing-report '},{purpose:'marketing-report'}]){const form=new FormData();form.append('file',new File(['x'],'x.png',{type:'image/png'}));for(const [key,value] of Object.entries(fields))form.append(key,value);await assert.rejects(()=>protection.uploadDataCoreFile(new Request('http://localhost/api/upload',{method:'POST',body:form}),h.env.DB,h.env.FILES,ctx),e=>e.status===403);}
 const report=await h.ingest(payload());const row={organization_id:ORG,source_app:'marketing-monitoring',category:'marketing-report',campus_id:A,visibility:'campus',data_record_id:report.body.report.id};
 const own={...ctx,isSuperAdmin:false,memberships:[{organizationId:ORG,role:'CAMPUS_ADMIN',campusId:A}],campusIds:[A]};
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,own,row),true);
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,{...own,memberships:[{organizationId:'foreign-org',role:'CAMPUS_ADMIN',campusId:A}]},row),false);
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,ctx,{...row,organization_id:'foreign-org'}),false);
 const staff={...ctx,isSuperAdmin:false,memberships:[{role:'STAFF',campusId:A}],campusIds:[A]};
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,staff,{source_app:'marketing-monitoring',category:'marketing-report',campus_id:A,visibility:'campus'}),false);
 const teacher={...ctx,isSuperAdmin:false,memberships:[{organizationId:ORG,role:'TEACHER',campusId:A}],campusIds:[A]};
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,teacher,row),true);
 assert.equal(await protection.canReadRegisteredFile(h.env.DB,{...teacher,memberships:[{organizationId:ORG,role:'TEACHER',campusId:B}],campusIds:[B]},row),false);
}finally{await h.mf.dispose();}});
test('historical comparisons require a real earlier daily baseline in the same campus and scope',async()=>{const h=await harness();try{
 const currentTime=Date.now()-60000;
 const timestamp=offset=>new Date(currentTime-offset*86400000).toISOString();
 const date=offset=>new Date(currentTime-offset*86400000+32400000).toISOString().slice(0,10);
 const scope='desktop|naver-google|13-keywords|public-results|same-denominators';
 const baselinePayload=payload({runId:'comparison-baseline',runKind:'daily',reportDate:date(1),capturedAt:timestamp(1),environment:{device:'desktop',comparisonScope:scope}});
 const baseline=await h.ingest(baselinePayload);assert.equal(baseline.status,201);
 const comparison={status:'observed',baselineRunKind:'daily',baselineDate:date(1),baselineReportId:baseline.body.report.id,scopeComparable:true,summary:'동일 13개 키워드 중 확인된 광고 상태는 전일과 같습니다. 미관측 키워드는 비교에서 제외했습니다.',limitations:['부분 관측으로 전체 노출 변화는 확인할 수 없습니다.']};
 const current=payload({runId:'comparison-current',runKind:'daily',reportDate:date(0),capturedAt:timestamp(0),environment:{device:'desktop',comparisonScope:scope},comparison});
 const observed=await h.ingest(current);assert.equal(observed.status,201);assert.deepEqual(observed.body.report.comparison,comparison);
 assert.equal((await h.ingest(current)).body.existing,true);
 const attempt=(suffix,changes={})=>h.ingest({...current,runId:'comparison-'+suffix,...changes});
 assert.equal((await attempt('same-date',{comparison:{...comparison,baselineDate:date(0)}})).status,400);
 assert.equal((await attempt('wrong-date',{comparison:{...comparison,baselineDate:date(2)}})).status,400);
 assert.equal((await attempt('sample-current',{runKind:'sample'})).status,400);
 assert.equal((await attempt('empty-summary',{comparison:{...comparison,summary:' '}})).status,400);
 assert.equal((await attempt('long-summary',{comparison:{...comparison,summary:'x'.repeat(20001)}})).status,400);
 assert.equal((await attempt('missing-scope',{environment:{device:'desktop'}})).status,400);
 assert.equal((await attempt('scope-mismatch',{environment:{device:'desktop',comparisonScope:'mobile|different-denominator'}})).status,400);
 assert.equal((await attempt('not-comparable-observed',{comparison:{...comparison,scopeComparable:false}})).status,400);
 const foreign=await h.ingest({...baselinePayload,runId:'comparison-other-campus',campusId:B});assert.equal(foreign.status,201);
 assert.equal((await attempt('foreign-campus',{comparison:{...comparison,baselineReportId:foreign.body.report.id}})).status,400);
 const sample=await h.ingest({...baselinePayload,runId:'comparison-sample-baseline',runKind:'sample'});assert.equal(sample.status,201);
 assert.equal((await attempt('sample-baseline',{comparison:{...comparison,baselineReportId:sample.body.report.id}})).status,400);
 assert.equal((await attempt('missing-baseline',{comparison:{...comparison,baselineReportId:'marketing:'+'0'.repeat(64)}})).status,400);
 await h.env.DB.prepare('UPDATE data_records SET deleted_at=? WHERE id=?').bind(timestamp(0),baseline.body.report.id).run();
 assert.equal((await attempt('deleted-baseline')).status,400);
 assert.equal((await attempt('first-daily',{comparison:{status:'not_available',summary:'동일 조건의 이전 daily 기준 보고서가 없습니다.'}})).status,201);
 assert.equal((await attempt('sample-unavailable',{runKind:'sample',comparison:{status:'not_available'}})).status,201);
 assert.equal((await attempt('different-unit',{comparison:{status:'not_comparable',scopeComparable:false,summary:'집계 분모와 관찰 환경이 달라 변화량을 비교하지 않습니다.',limitations:['서로 다른 집계 기간']}})).status,201);
 assert.equal((await attempt('signed-delta',{comparison:{...comparison,delta:-1}})).status,400);
}finally{await h.mf.dispose();}});
test.after(async()=>{await rm(temp,{recursive:true,force:true});});
test('SerpApi Google results fill the google platform in a server-valid shape',async()=>{
 const {collectGoogle,mergeGoogleIntoPayload,officialMatchers,isOfficial,parseGoogleDays}=await import('../scripts/marketing-google-serp.mjs');
 const monday=new Date('2026-10-12T03:00:00Z'),tuesday=new Date('2026-10-13T03:00:00Z');
 const channels={blog:{url:'https://blog.naver.com/example_official'},website:{url:'https://example-academy.test/'}};
 const m=officialMatchers({channels});
 assert.ok(isOfficial('https://m.blog.naver.com/example_official/223000000001',m));
 assert.ok(isOfficial('https://blog.naver.com/PostView.naver?blogId=example_official&logNo=1',m));
 assert.ok(!isOfficial('https://blog.naver.com/someone_else/1',m));
 assert.ok(isOfficial('https://www.example-academy.test/notice',m));
 const seen=[];
 const fake=async url=>{const q=new URL(url).searchParams;seen.push(q.get('q'));assert.equal(q.get('location'),'Bucheon-si,Gyeonggi-do,South Korea');assert.equal(q.get('gl'),'kr');
  const first=q.get('q')===MARKETING_KEYWORDS[0];
  return new Response(JSON.stringify({ads:first?[{link:'https://other.test/'},{link:'https://example-academy.test/ad'}]:[],organic_results:[{link:'https://other.test/a'},{link:'https://other.test/b'},{link:'https://blog.naver.com/example_official/22300'},{link:'https://example-academy.test/'}],local_results:first?{places:[{position:1,title:'다른 학원'},{position:2,title:'예시 학원',links:{website:'https://example-academy.test/'}}]}:undefined}),{status:200});};
 const google=await collectGoogle({payload:{channels},apiKey:'k'.repeat(64),request:fake});
 assert.equal(seen.length,13);assert.equal(google.status,'observed');
 const k0=google.keywords[0];assert.deepEqual([k0.adCount,k0.adStatus,k0.adRank,k0.organicRank,k0.officialDocuments,k0.inspectedResults],[2,'observed',2,3,2,4]);
 assert.equal(google.keywords[1].adStatus,'not_observed');assert.equal(google.keywords[1].adRank,null);
 assert.deepEqual([google.maps.items[0].status,google.maps.items[0].rank],['observed',2]);assert.equal(google.maps.items[1].status,'not_observed');
 const valid=validateMarketingPayload(payload({channels,platforms:{naver:payload().platforms.naver,google}}));assert.equal(valid.platforms.google.keywords.length,13);
 const h=await harness();try{const res=await h.ingest(payload({runId:'google-serp',channels,platforms:{naver:payload().platforms.naver,google}}));assert.equal(res.status,201,JSON.stringify(res.body));assert.equal(res.body.report.platforms.google.keywords[0].adRank,2);}finally{await h.mf.dispose();}
 // merge: 결과를 보고서 JSON에 넣고, 이미 관찰된 Google은 다시 검색하지 않는다.
 const dir=await mkdtemp(join(resolve('.wrangler'),'google-merge-'));const file=join(dir,'report.json');
 await writeFile(file,JSON.stringify(payload({channels})));
 const merged=await mergeGoogleIntoPayload({payloadPath:file,apiKey:'k'.repeat(64),request:fake,now:monday});assert.equal(merged.merged,true);
 const again=await mergeGoogleIntoPayload({payloadPath:file,apiKey:'k'.repeat(64),request:()=>{throw new Error('must not search again');},now:monday});assert.equal(again.merged,false);
 // 월·수·금만 검색: 화요일 보고서는 검색 없이 '이번 회차 미수집'으로 남고 서버도 받는다.
 const offFile=join(dir,'tuesday.json');await writeFile(offFile,JSON.stringify(payload({channels})));
 const off=await mergeGoogleIntoPayload({payloadPath:offFile,apiKey:'k'.repeat(64),request:()=>{throw new Error('must not search on Tuesday');},now:tuesday});
 assert.deepEqual([off.merged,off.reason,off.days],[false,'not-scheduled','월·수·금']);
 const offPayload=JSON.parse(await readFile(offFile,'utf8'));assert.equal(offPayload.platforms.google.status,'not_scheduled');assert.match(offPayload.limitations.at(-1),/주 3회\(월·수·금\)/);
 assert.equal(validateMarketingPayload(offPayload).platforms.google.status,'not_scheduled');
 assert.deepEqual(parseGoogleDays('4,1,1'),[1,4]);assert.throws(()=>parseGoogleDays('7'));
 await rm(dir,{recursive:true,force:true});
 // 키 오류는 바로 멈춘다(13번 재시도하지 않음).
 let calls=0;await assert.rejects(()=>collectGoogle({payload:{channels},apiKey:'bad',request:async()=>{calls++;return new Response('{}',{status:401});}}),/키를 확인/);assert.equal(calls,1);
});
test('SerpApi key is read from a copied clipboard value only when it looks like a key',async()=>{
 const {readKeyFromClipboard}=await import('../scripts/marketing-google-serp.mjs');
 assert.equal(await readKeyFromClipboard(async()=>'a'.repeat(64)),'a'.repeat(64));
 for(const value of ['','not a key','https://serpapi.com/dashboard','a'.repeat(20)])assert.equal(await readKeyFromClipboard(async()=>value),'');
});

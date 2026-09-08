import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { occupationImageConcepts } from '../public/data-core/occupation-image-concepts.js';
import { careerMajorKeywords, matchesCareer, universityIdentity, indexUniversities, matchUniversity, explainUniversityMatch, mappingReasonLabels, projectUniversity, projectGuideline, decodePublicGuidelines, publicColumns, parseSimpleRatios, guidelineIdentity, preserveKnownValues, selectGuidelines } from '../public/data-core/admissions-model.js';

function packed(rows) {
  const c=[...new Set([...Object.values(publicColumns),'전년도 합격자 통계'])],p=[''];
  const r=rows.map((row)=>c.map((key)=>{const value=String(row[key] ?? '');let i=p.indexOf(value);if(i<0){i=p.length;p.push(value);}return i;}));
  return {c,p,r};
}
const fact=(extra={})=>({'학년도':'2027','대학':'합성대학교','모집단위':'웹툰콘텐츠학과','전형명':'실기우수','전형유형':'실기','모집인원':'0','전년도 경쟁률':'12.5','전형요소 반영비율':'학생부 30 + 실기 70','전년도 합격자 통계':'PRIVATE_SYNTHETIC_STATS',...extra});
const provenance={sourceName:'그리날다',sourceUrl:'https://grinalda.net/univ-info-susi/',sourceUpdatedAt:null,fetchedAt:'2026-09-09T00:00:00Z'};

test('public source redirect policy runs in workerd and never follows redirects',async()=>{
  const code=fs.readFileSync('worker/admissions-catalog.ts','utf8');
  assert.match(code,/redirect:'manual'/);
  let calls=0;
  const mf=new Miniflare({modules:true,script:`export default {async fetch(){const r=await fetch('https://synthetic.example/source',{redirect:'manual',signal:AbortSignal.timeout(20000)});return Response.json({status:r.status});}}`,outboundService:()=>{calls++;return new Response(null,{status:302,headers:{location:'https://synthetic.example/forbidden'}});}});
  try{const r=await mf.dispatchFetch('http://localhost');assert.deepEqual(await r.json(),{status:302});assert.equal(calls,1);}finally{await mf.dispose();}
});

test('every occupation has its own existing optimized WebP asset',()=>{
  const hashes=new Set();
  for(const concept of occupationImageConcepts){
    const bytes=fs.readFileSync(`public${concept.asset}`);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.ok(bytes.length<300000,'Career cards must stay lightweight');
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size,35);
});

test('workerd Cache API supports the temporary public preview response contract',async()=>{
  const mf=new Miniflare({modules:true,script:`export default {async fetch(){const key=new Request('https://synthetic.example/api/data-core/admin/admissions/guidelines/sync?preview-cache=synthetic');await caches.default.put(key,Response.json({rows:[],expiresAt:Date.now()+600000},{headers:{'cache-control':'max-age=600'}}));const saved=await caches.default.match(key);const body=await saved.json();return Response.json({status:saved.status,rows:body.rows.length,unexpired:body.expiresAt>Date.now()});}}`});
  try{assert.deepEqual(await(await mf.dispatchFetch('http://localhost')).json(),{status:200,rows:0,unexpired:true});}finally{await mf.dispose();}
});

test('edge-native synchronous SHA256 preserves existing WebCrypto identities and fingerprints',async()=>{
  const source=fs.readFileSync('worker/admissions-catalog.ts','utf8');assert.match(source,/createHash\('sha256'\)/);assert.doesNotMatch(source,/await digest/);
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:`import {createHash} from 'node:crypto'; export default {async fetch(){const value=JSON.stringify({university:'합성대',department:'웹툰',year:2027,quota:0});const old=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');return Response.json({identical:old===createHash('sha256').update(value).digest('hex')});}}`});
  try{assert.deepEqual(await(await mf.dispatchFetch('http://localhost')).json(),{identical:true});}finally{await mf.dispose();}
});
test('all catalog careers have unique complete image concepts and conservative department match rules',()=>{
  const ctx={window:{}};vm.runInNewContext(fs.readFileSync('public/data-core/roadmap-content.js','utf8'),ctx);
  assert.equal(occupationImageConcepts.length,35);
  assert.equal(new Set(occupationImageConcepts.map(c=>c.asset)).size,35);
  assert.equal(new Set(occupationImageConcepts.map(c=>c.concept)).size,35);
  for(const c of ctx.window.HI5_ROADMAP_CONTENT.careers){const concept=occupationImageConcepts.find(x=>x.occupationId===c.id);assert.ok(concept?.action && concept?.visualFocus && concept?.environment && concept?.tools.length);assert.ok(careerMajorKeywords[c.id]?.length);assert.ok(c.majors.some(m=>matchesCareer(m,c.id)));}
  assert.equal(matchesCareer('패션디자인학과','D001'),false);assert.equal(matchesCareer('웹툰학과','D030'),false);
});
test('university matching keeps campuses and ambiguous existing department IDs separate',()=>{
  assert.deepEqual(universityIdentity('경기대학교'),universityIdentity('경기대'));
  assert.notDeepEqual(universityIdentity('경기대(서울)'),universityIdentity('경기대(수원)'));
  const row={universityName:'합성대',department:'웹툰',academicYear:2027,admissionType:'실기'};
  const u={id:1,name:'합성대학교',major:'웹툰',year:2027,admission:'실기'};
  assert.equal(matchUniversity(row,[u]).universityId,'1');
  assert.equal(matchUniversity(row,[u,{...u,id:2}]).mappingStatus,'review');
  assert.equal(matchUniversity(row,[u,{...u,id:3,campus:'다른캠퍼스'}]).universityId,null);
  assert.equal(matchUniversity({...row,campus:'서울'},[u]).universityId,null);
});
test('public string-pool decoder excludes member-only statistics, retains zero, rejects malformed source',()=>{
  const [row]=decodePublicGuidelines(packed([fact()]),'susi',provenance);
  assert.equal(row.quota,0);assert.equal(row.gradeRatio,30);assert.equal(row.practicalRatio,70);assert.equal(row.sourceUpdatedAt,null);
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE_SYNTHETIC_STATS|합격자 통계/);
  assert.throws(()=>decodePublicGuidelines({c:[],p:[],r:[]},'susi',provenance));
  const bad=packed([fact()]);bad.r[0][0]=99999;assert.throws(()=>decodePublicGuidelines(bad,'susi',provenance));
  assert.throws(()=>decodePublicGuidelines(packed([fact({'학년도':''})]),'susi',provenance));
});

test('terminal admission label matching requires exact school campus department year and a unique candidate',()=>{
  const row={universityName:'합성대(서울)',campus:'서울',department:'웹툰학과',academicYear:'2027',admissionType:'실기우수자'};
  const u={id:'synthetic-1',name:'합성대학교',campus:'서울',major:'웹툰학과',year:2027,admission:'실기우수자전형'};
  assert.deepEqual(explainUniversityMatch(row,indexUniversities([u])),{universityId:'synthetic-1',mappingStatus:'matched',mappingReason:'matched-label'});
  assert.equal(explainUniversityMatch({...row,admissionType:'일반(교과)전형'},[{...u,admission:'일반(교과)'}]).mappingReason,'matched-label');
  for(const changed of [{name:'다른대학교'},{campus:'수원'},{major:'웹툰학부'},{year:2028},{year:null},{year:''},{admission:'실기우수자특별전형'},{admission:'실기전형우수자'},{id:null},{hiddenDuplicate:true}]){
    assert.equal(matchUniversity(row,[{...u,...changed}]).universityId,null,JSON.stringify(changed));
  }
  assert.equal(matchUniversity(row,[u,{...u,id:'synthetic-2'}]).universityId,null);
  assert.equal(explainUniversityMatch(row,[u,{...u,id:'synthetic-2'}]).mappingReason,'multiple-candidates');
  assert.equal(matchUniversity({...row,universityName:'합성대',campus:''},[{...u,campus:''},u]).universityId,null);
  assert.equal(matchUniversity({...row,academicYear:''},[u]).universityId,null);
  assert.equal(matchUniversity({...row,admissionType:'전형'},[{...u,admission:''}]).universityId,'synthetic-1','legacy exact behavior stays compatible');
  const exact={...u,admission:'실기우수자'};
  assert.equal(explainUniversityMatch(row,[exact]).mappingReason,'matched');
  assert.equal(matchUniversity(row,[exact]).universityId,'synthetic-1');
});

test('mapping review reasons and filters do not relax department campus year or duplicate safeguards',()=>{
  const r={universityName:'합성대',department:'웹툰',academicYear:2027,admissionType:'실기'};
  const u={id:1,name:'합성대학교',major:'웹툰',year:2027,admission:'실기'};
  const scenarios=[['university-missing',[]],['campus-mismatch',[{...u,campus:'서울'}]],['department-mismatch',[{...u,major:'웹툰학과'}]],['year-mismatch',[{...u,year:2028}]],['admission-mismatch',[{...u,admission:'학생부'}]],['multiple-candidates',[u,{...u,id:2}]],['campus-ambiguous',[u,{...u,campus:'서울',id:3}]]];
  for(const [reason,schools] of scenarios){const explained=explainUniversityMatch(r,schools);assert.equal(explained.mappingReason,reason);assert.equal(explained.universityId,null);assert.ok(mappingReasonLabels[reason]);}
  const rows=scenarios.map(([reason])=>({...r,mappingStatus:'review',mappingReason:reason}));
  assert.equal(selectGuidelines(rows,{mappingStatus:'matched'}).length,0);
  assert.equal(selectGuidelines(rows,{mappingStatus:'review',mappingReason:'campus-mismatch'}).length,1);
  assert.equal(selectGuidelines(rows,{mappingReason:'unknown'}).length,0);
});

test('indexed university matching preserves ambiguity rules without scanning unrelated schools for every guideline',()=>{
  let nameReads=0;
  const schools=Array.from({length:5000},(_,id)=>({id, get name(){nameReads++;return `합성${id}대학교`;},major:'웹툰',year:2027,admission:'실기'}));
  const index=indexUniversities(schools);
  for(let id=0;id<1000;id++)assert.equal(matchUniversity({universityName:`합성${id}대`,department:'웹툰',academicYear:2027,admissionType:'실기'},index).universityId,String(id));
  assert.ok(nameReads<10000,'Lookup must not repeat a full university scan per source row');
  const ambiguous=[{id:1,name:'합성대',major:'웹툰'},{id:2,name:'합성대',major:'웹툰',campus:'서울'}];
  const row={universityName:'합성대',department:'웹툰',academicYear:2027};
  assert.deepEqual(matchUniversity(row,indexUniversities(ambiguous)),matchUniversity(row,ambiguous));
  assert.equal(matchUniversity(row,indexUniversities(ambiguous)).universityId,null);
});
test('only simple complete percentage formulas become ratios; changed staged formula invalidates stale ratios',()=>{
  for(const f of ['1단계 학생부 100 / 2단계 실기 70','학생부 300점 + 실기 700점','학생부 60 + 실기 70','학생부 30 또는 실기 70','실기 80'])assert.equal(parseSimpleRatios(f).practicalRatio,null);
  assert.equal(parseSimpleRatios('수능 40% + 실기 60%').csatRatio,40);
  const previous={selectionFormula:'학생부 30 + 실기 70',gradeRatio:30,practicalRatio:70,quota:12,universityId:'known'};
  const merged=preserveKnownValues(previous,{quota:null,selectionFormula:'1단계 학생부 100 / 2단계 실기 70',mappingStatus:'review',universityId:null});
  assert.equal(merged.quota,12);assert.equal(merged.practicalRatio,null);assert.equal(merged.universityId,null);assert.equal(previous.practicalRatio,70);
});
test('identity, filtering, year, provenance and safe projections exclude arbitrary PII',()=>{
  const [r]=decodePublicGuidelines(packed([fact()]),'susi',provenance);
  assert.equal(guidelineIdentity(r),guidelineIdentity({...r,universityName:'합성대'}));
  assert.notEqual(guidelineIdentity(r),guidelineIdentity({...r,campus:'다른캠퍼스'}));
  assert.equal(selectGuidelines([r],{season:'susi',year:'2027',query:'합성 웹툰',practicalRatio:'50'}).length,1);
  assert.equal(selectGuidelines([r],{year:'2026'}).length,0);
  const privateValues={studentName:'PRIVATE_STUDENT',guardianPhone:'PRIVATE_PHONE',notes:'PRIVATE_NOTES',acceptedStats:{average:1,student:'PRIVATE_STATS'}};
  assert.doesNotMatch(JSON.stringify(projectUniversity({...privateValues,id:1,name:'합성대',major:'웹툰',gradeRatio:null,skillRatio:'',year:2027})),/PRIVATE_/);
  assert.equal(projectUniversity({gradeRatio:null}).metadata.gradeRatio,null);
  assert.doesNotMatch(JSON.stringify(projectGuideline({...r,...privateValues})),/PRIVATE_/);
  assert.equal(projectGuideline(r).gradeRatio,30);
});

test('D1/R2 behavior: authenticated university-only read and admin preview/apply preserve originals, prevent duplicates and reject unsafe writes',async()=>{
  const mf=new Miniflare({script:"export default {fetch(){return new Response('ok')}}",modules:true,d1Databases:['DB'],r2Buckets:['FILES'],d1Persist:false,r2Persist:false});
  const originalFetch=globalThis.fetch;
  const originalCaches=globalThis.caches;
  const mockSource=handler=>async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url || input.href);if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return originalFetch(input,init);return handler(input,init);};
  try{
    const {default:worker}=await import('../dist/server/index.js');
    const db=await mf.getD1Database('DB'),files=await mf.getR2Bucket('FILES');
    const previews=new Map();
    globalThis.caches={default:{async put(key,response){previews.set(key.url,response.clone());},async match(key){return previews.get(key.url)?.clone();},async delete(key){return previews.delete(key.url);}}};
    const originals={students:[{id:'synthetic-only',name:'PRIVATE_STUDENT'}],universities:[{id:1,name:'합성대학교',major:'웹툰콘텐츠학과',admission:'실기우수전형',year:2027,notes:'PRIVATE_NOTES'},{id:2,name:'합성대학교',major:'패션디자인학과',year:2027}],cases:[{private:'PRIVATE_CASE'}],awardFolders:[{id:'preserve'}],settings:{preserve:true}};
    const originalJson=JSON.stringify(originals);await files.put('state/admissions-data.json',originalJson);
    const admin={'oai-authenticated-user-id':'synthetic-catalog-admin','oai-authenticated-user-email':'catalog-admin@example.test'};
    const staff={'oai-authenticated-user-id':'synthetic-catalog-staff','oai-authenticated-user-email':'catalog-staff@example.test'};
    const env={DB:db,FILES:files,DATA_CORE_SUPER_ADMIN_EMAILS:'catalog-admin@example.test'};
    const call=(path,{headers=admin,body,origin='http://localhost'}={})=>worker.fetch(new Request('http://localhost'+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/json',origin}:{})},body:body?JSON.stringify(body):undefined}),env,{waitUntil(){},passThroughOnException(){}});
    const url='/api/data-core/roadmap/programs?careerId=D001',sync='/api/data-core/admin/admissions/guidelines/sync';
    assert.equal((await call(url,{headers:{}})).status,401);
    assert.equal((await call(url,{headers:staff})).status,403);
    const user=await db.prepare('SELECT id FROM users WHERE email=?').bind('catalog-staff@example.test').first('id');
    await db.prepare("INSERT INTO memberships (id,organization_id,user_id,role,created_at,updated_at) VALUES ('synthetic-membership','org-hi5-anihi',?,'STAFF','2026-01-01','2026-01-01')").bind(user).run();
    const response=await call(url,{headers:staff});assert.equal(response.status,200);const body=await response.text();assert.doesNotMatch(body,/PRIVATE_|패션디자인/);assert.equal(JSON.parse(body).programs.length,1);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal((await call(sync,{headers:{},body:{mode:'preview'}})).status,401);
    assert.equal((await call(sync,{headers:staff,body:{mode:'preview'}})).status,403);
    assert.equal((await call(sync,{body:{mode:'preview'},origin:'https://attacker.example'})).status,403);
    let fail=false,empty=false,conflict=false;
    globalThis.fetch=mockSource(async(input)=>{assert.match(String(input),/^https:\/\/grinalda.net\/wp-content\/uploads\/grinalda\/grinalda-(susi|jeongsi)-2027-data.json$/);if(fail)return new Response('{}',{status:503});return new Response(JSON.stringify(packed([fact(empty?{'모집인원':''}:{'모집인원':'12'}),...(conflict?[fact({'모집인원':'13'})]:[])])),{headers:{'content-type':'application/json','last-modified':'Tue, 25 Aug 2026 12:24:01 GMT'}});});
    let previewResponse=await call(sync,{body:{mode:'preview'}});assert.equal(previewResponse.status,200,await previewResponse.clone().text());let preview=await previewResponse.json();assert.equal(preview.total,2);assert.equal(preview.counts.susi.new,1);
    const cacheKey=token=>new Request(`http://localhost${sync}?preview-cache=${token}`);
    const cachedPlan=await(await globalThis.caches.default.match(cacheKey(preview.token))).json();
    assert.doesNotMatch(JSON.stringify(cachedPlan),/PRIVATE_|previous|merged|raw/);
    for(const r of cachedPlan.rows){const legacy=Object.fromEntries(Object.entries(r.data).filter(([k])=>!['fetchedAt','sourceFingerprint'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));assert.equal(r.data.sourceFingerprint,createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),'native key sorting preserves legacy fingerprints');}
    assert.equal((await call(sync+`?preview-cache=${preview.token}`,{headers:{}})).status,401,'cache key URL is not a public download route');
    assert.equal((await call(sync+`?preview-cache=${preview.token}`)).status,405);
    const tampered=structuredClone(cachedPlan);tampered.rows[0].data.quota=999;
    await globalThis.caches.default.put(cacheKey(preview.token),Response.json(tampered));
    assert.equal((await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).status,409,'tampered snapshot data cannot be applied');
    await globalThis.caches.default.put(cacheKey(preview.token),Response.json(cachedPlan));
    await files.put('state/admissions-data.json',JSON.stringify({...originals,universities:originals.universities.map(u=>({...u,campus:'changed-campus'}))}));
    assert.equal((await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).status,409,'changed campus mapping requires a new preview');
    await files.put('state/admissions-data.json',originalJson);
    const fetchBeforeApply=globalThis.fetch;globalThis.fetch=mockSource(async()=>{throw new Error('Apply must use the approved snapshot, not fetch the entire source');});
    assert.equal(await db.prepare("SELECT COUNT(*) FROM data_records WHERE source_app='admissions'").first('COUNT(*)'),0,'preview is read-only');
    assert.equal((await call(sync,{body:{mode:'apply',token:'wrong',offset:0}})).status,409);
    let applied=await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});assert.equal(applied.status,200);assert.equal((await applied.json()).applied,2);
    applied=await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});assert.equal((await applied.json()).applied,0);
    globalThis.fetch=fetchBeforeApply;
    await globalThis.caches.default.delete(cacheKey(preview.token));
    assert.equal((await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).status,409,'expired or evicted previews fail closed without re-fetching');
    await globalThis.caches.default.put(cacheKey(preview.token),Response.json({...cachedPlan,expiresAt:0}));
    assert.equal((await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).status,409,'expired preview timestamp is enforced');
    const list=await call('/api/data-core/admissions/guidelines?season=susi&year=2027&query=합성');const listed=await list.json();assert.equal(listed.total,1);assert.equal(listed.rows[0].quota,12);assert.doesNotMatch(JSON.stringify(listed),/PRIVATE_/);
    assert.equal(listed.rows[0].universityId,'1');assert.equal(listed.rows[0].mappingReason,'matched-label');
    assert.equal((await call('/api/data-core/admissions/guidelines?mappingStatus=review',{headers:{}})).status,401);
    const staffFiltered=await call('/api/data-core/admissions/guidelines?season=susi&mappingStatus=matched&mappingReason=matched-label',{headers:staff});
    assert.equal(staffFiltered.status,200);const safe=await staffFiltered.text();assert.doesNotMatch(safe,/PRIVATE_|notes|students|acceptedStats|guardian/);assert.equal(JSON.parse(safe).total,1);
    assert.equal((await(await call('/api/data-core/admissions/guidelines?mappingReason=campus-mismatch')).json()).total,0);
    await files.put('state/admissions-data.json','PRIVATE_INVALID_SYNTHETIC_SOURCE');
    const degraded=await call('/api/data-core/admissions/guidelines?season=susi');assert.equal(degraded.status,200);const degradedBody=await degraded.text();assert.doesNotMatch(degradedBody,/PRIVATE_/);assert.equal(JSON.parse(degradedBody).rows[0].mappingReason,'source-unavailable');
    await files.put('state/admissions-data.json',originalJson);
    const connected=await (await call(url)).json();assert.equal(connected.programs.length,3);
    empty=true;preview=await (await call(sync,{body:{mode:'preview'}})).json();await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});
    assert.equal((await (await call('/api/data-core/admissions/guidelines?season=susi')).json()).rows[0].quota,12);
    const before=await db.prepare("SELECT id,metadata_json FROM data_records WHERE source_app='admissions' ORDER BY id").all();
    const successfulFetch=globalThis.fetch;
    globalThis.fetch=mockSource(async()=>{throw new TypeError('PRIVATE_SOURCE_PAYLOAD must never escape');});
    const failedSource=await call(sync,{body:{mode:'preview'}});
    const diagnostic=await failedSource.json();
    assert.equal(failedSource.status,502);assert.equal(diagnostic.stage,'fetch-susi');assert.equal(diagnostic.kind,'TypeError');
    assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_SOURCE_PAYLOAD/);
    globalThis.fetch=successfulFetch;
    globalThis.fetch=mockSource(async()=>new Response(null,{status:302,headers:{location:'https://synthetic.example/forbidden'}}));
    assert.equal((await call(sync,{body:{mode:'preview'}})).status,502,'redirects are rejected, never followed');
    globalThis.fetch=successfulFetch;
    fail=true;assert.equal((await call(sync,{body:{mode:'preview'}})).status,502);
    assert.deepEqual((await db.prepare("SELECT id,metadata_json FROM data_records WHERE source_app='admissions' ORDER BY id").all()).results,before.results);
    fail=false;empty=false;conflict=true;preview=await (await call(sync,{body:{mode:'preview'}})).json();assert.equal(preview.counts.susi.review,1);assert.equal((await (await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).json()).applied,0);
    assert.equal(await (await files.get('state/admissions-data.json')).text(),originalJson,'all original domains and PII bytes preserved');
  }finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;await mf.dispose();}
});

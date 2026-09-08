import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { occupationImageConcepts } from '../public/data-core/occupation-image-concepts.js';
import { careerMajorKeywords, matchesCareer, universityIdentity, matchUniversity, projectUniversity, projectGuideline, decodePublicGuidelines, publicColumns, parseSimpleRatios, guidelineIdentity, preserveKnownValues, selectGuidelines } from '../public/data-core/admissions-model.js';

function packed(rows) {
  const c=[...new Set([...Object.values(publicColumns),'전년도 합격자 통계'])],p=[''];
  const r=rows.map((row)=>c.map((key)=>{const value=String(row[key] ?? '');let i=p.indexOf(value);if(i<0){i=p.length;p.push(value);}return i;}));
  return {c,p,r};
}
const fact=(extra={})=>({'학년도':'2027','대학':'합성대학교','모집단위':'웹툰콘텐츠학과','전형명':'실기우수','전형유형':'실기','모집인원':'0','전년도 경쟁률':'12.5','전형요소 반영비율':'학생부 30 + 실기 70','전년도 합격자 통계':'PRIVATE_SYNTHETIC_STATS',...extra});
const provenance={sourceName:'그리날다',sourceUrl:'https://grinalda.net/univ-info-susi/',sourceUpdatedAt:null,fetchedAt:'2026-09-09T00:00:00Z'};

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
  try{
    const {default:worker}=await import('../dist/server/index.js');
    const db=await mf.getD1Database('DB'),files=await mf.getR2Bucket('FILES');
    const originals={students:[{id:'synthetic-only',name:'PRIVATE_STUDENT'}],universities:[{id:1,name:'합성대학교',major:'웹툰콘텐츠학과',admission:'실기우수',year:2027,notes:'PRIVATE_NOTES'},{id:2,name:'합성대학교',major:'패션디자인학과',year:2027}],cases:[{private:'PRIVATE_CASE'}],awardFolders:[{id:'preserve'}],settings:{preserve:true}};
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
    globalThis.fetch=async(input)=>{assert.match(String(input),/^https:\/\/grinalda.net\/wp-content\/uploads\/grinalda\/grinalda-(susi|jeongsi)-2027-data.json$/);if(fail)return new Response('{}',{status:503});return new Response(JSON.stringify(packed([fact(empty?{'모집인원':''}:{'모집인원':'12'}),...(conflict?[fact({'모집인원':'13'})]:[])])),{headers:{'content-type':'application/json','last-modified':'Tue, 25 Aug 2026 12:24:01 GMT'}});};
    let previewResponse=await call(sync,{body:{mode:'preview'}});assert.equal(previewResponse.status,200);let preview=await previewResponse.json();assert.equal(preview.total,2);assert.equal(preview.counts.susi.new,1);
    assert.equal(await db.prepare("SELECT COUNT(*) FROM data_records WHERE source_app='admissions'").first('COUNT(*)'),0,'preview is read-only');
    assert.equal((await call(sync,{body:{mode:'apply',token:'wrong',offset:0}})).status,409);
    let applied=await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});assert.equal(applied.status,200);assert.equal((await applied.json()).applied,2);
    applied=await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});assert.equal((await applied.json()).applied,0);
    const list=await call('/api/data-core/admissions/guidelines?season=susi&year=2027&query=합성');const listed=await list.json();assert.equal(listed.total,1);assert.equal(listed.rows[0].quota,12);assert.doesNotMatch(JSON.stringify(listed),/PRIVATE_/);
    const connected=await (await call(url)).json();assert.equal(connected.programs.length,3);
    empty=true;preview=await (await call(sync,{body:{mode:'preview'}})).json();await call(sync,{body:{mode:'apply',token:preview.token,offset:0}});
    assert.equal((await (await call('/api/data-core/admissions/guidelines?season=susi')).json()).rows[0].quota,12);
    const before=await db.prepare("SELECT id,metadata_json FROM data_records WHERE source_app='admissions' ORDER BY id").all();
    fail=true;assert.equal((await call(sync,{body:{mode:'preview'}})).status,502);
    assert.deepEqual((await db.prepare("SELECT id,metadata_json FROM data_records WHERE source_app='admissions' ORDER BY id").all()).results,before.results);
    fail=false;empty=false;conflict=true;preview=await (await call(sync,{body:{mode:'preview'}})).json();assert.equal(preview.counts.susi.review,1);assert.equal((await (await call(sync,{body:{mode:'apply',token:preview.token,offset:0}})).json()).applied,0);
    assert.equal(await (await files.get('state/admissions-data.json')).text(),originalJson,'all original domains and PII bytes preserved');
  }finally{globalThis.fetch=originalFetch;await mf.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, users, ORG } from './support/library-harness.mjs';
import { SCOPE_RECORD_ID, SCOPE_RECORD_TYPE } from '../public/data-core/university-scope-model.js';
import { managementArchiveId, managementArchiveType } from '../public/data-core/university-management.js';
const endpoint='/api/admissions/university-scope';
const state={version:1,universities:[{id:1,name:'경남대학교',major:'디자인'},{id:2,name:'서울대학교',major:'회화'},{id:3,name:'한양대학교',major:'애니메이션'}],students:[],cases:[],awardFolders:[],changeLogs:[],admissionGradeRules:[],settings:{}};
async function setup(h){await h.env.FILES.put('state/admissions-data.json',JSON.stringify(state));}
const post=(h,body,user=users.master,origin)=>h.request('POST',endpoint,user,body,origin);

test('scope API is staff-readable and master-only/same-origin for every action',async()=>{
 const h=await libraryHarness();try{
  await setup(h);
  assert.equal((await h.request('GET',endpoint,null)).status,401);
  assert.equal((await h.request('GET',endpoint,users.outsider)).status,403);
  for(const user of [users.master,users.admin,users.campusAdmin,users.teacher,users.staff]){
   const result=await h.request('GET',endpoint,user);assert.equal(result.status,200,JSON.stringify(result.body));
   assert.equal(result.body.canManage,[users.master,users.admin].includes(user));
  }
  for(const action of ['preview','apply','restore','hide','reset']){
   for(const user of [users.teacher,users.campusAdmin,null])assert.equal((await post(h,{action,expectedRevision:0,ids:['1']},user)).status,user?403:401);
   assert.equal((await post(h,{action,expectedRevision:0},users.master,'https://evil.invalid')).status,403);
   assert.equal((await post(h,{action,expectedRevision:0},users.master,null)).status,403);
  }
  assert.equal((await h.request('DELETE',endpoint,users.master)).status,405);
 }finally{await h.mf.dispose();}
});

test('preview/apply/restore/hide/reset preserve source, override legacy fallback and audit atomically',async()=>{
 const h=await libraryHarness();try{
  await setup(h);const source=await(await h.env.FILES.get('state/admissions-data.json')).text();
  const now=new Date().toISOString();
  await h.env.DB.prepare("INSERT INTO data_records(id,organization_id,record_type,source_app,title,metadata_json,created_at,updated_at) VALUES(?,?,?,'admissions','legacy',?,?,?)").bind(managementArchiveId,ORG,managementArchiveType,JSON.stringify({version:1,archived:[{id:'1',name:'경남대학교'}]}),now,now).run();
  assert.deepEqual((await h.request('GET','/api/data')).body._universityManagementDeletedIds,['1']);
  assert.deepEqual((await h.request('GET','/api/data')).body._universityRecommendationExcludedIds,[]);
  const preview=await post(h,{action:'preview'});assert.equal(preview.status,200);assert.equal(preview.body.keptCount,1);assert.deepEqual(preview.body.excludedIds,['2','3']);
  assert.equal(await h.env.DB.prepare('SELECT id FROM data_records WHERE id=?').bind(SCOPE_RECORD_ID).first(),null);
  const applied=await post(h,{action:'apply',expectedRevision:0});assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.revision,1);assert.deepEqual(applied.body.excludedIds,['2','3']);
  assert.equal((await post(h,{action:'reset',expectedRevision:0})).status,409);
  const restored=await post(h,{action:'restore',ids:['2'],expectedRevision:1});assert.equal(restored.status,200);assert.deepEqual(restored.body.excludedIds,['3']);
  const hidden=await post(h,{action:'hide',ids:['1'],expectedRevision:2});assert.equal(hidden.status,200);assert.deepEqual(hidden.body.excluded,[{id:'3',name:'한양대학교'},{id:'1',name:'경남대학교'}]);
  const read=(await h.request('GET','/api/data',users.teacher)).body;assert.deepEqual(read.universities,state.universities);assert.deepEqual(read._universityManagementDeletedIds,['3','1']);assert.deepEqual(read._universityRecommendationExcludedIds,['3','1']);
  assert.equal(read._universityScope.canManage,false);
  assert.equal((await post(h,{action:'reset',expectedRevision:3})).status,200);
  const reset=(await h.request('GET','/api/data')).body;assert.deepEqual(reset._universityManagementDeletedIds,[]);assert.equal(reset._universityScope.active,false);assert.equal(reset._universityScope.revision,4);
  const counts=await h.env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE resource_type=?").bind(SCOPE_RECORD_TYPE).first();assert.equal(counts.n,4);
  assert.equal(await(await h.env.FILES.get('state/admissions-data.json')).text(),source);
  // Derived GET fields cannot be persisted through whole-document PUT.
  assert.equal((await h.request('PUT','/api/data',users.admin,{...reset,_universityScope:{active:true},_universityRecommendationExcludedIds:['1'],_universityManagementDeletedIds:['1']})).status,200);
  assert.deepEqual(await(await h.env.FILES.get('state/admissions-data.json')).json(),state);
  for(const user of [users.master,users.campusAdmin,users.teacher]){
   assert.equal((await h.request('POST','/api/data-core/records',user,{recordType:SCOPE_RECORD_TYPE,sourceApp:'admissions',title:'forged'})).status,403);
   assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(SCOPE_RECORD_ID),user,{title:'forged',recordType:'other'})).status,403);
   assert.equal((await h.request('DELETE','/api/data-core/records/'+encodeURIComponent(SCOPE_RECORD_ID),user)).status,403);
   assert.equal((await h.request('PUT','/api/data-core/records/'+encodeURIComponent(SCOPE_RECORD_ID)+'/content',user,{content:'forged'})).status,403);
  }
 }finally{await h.mf.dispose();}
});

test('rejects forged IDs and revisions, uses latest source and protects concurrent writes',async()=>{
 const h=await libraryHarness();try{
  await setup(h);
  for(const expectedRevision of [undefined,null,-1,1.5,'0',{},Number.MAX_SAFE_INTEGER+1])assert.equal((await post(h,{action:'apply',expectedRevision})).status,400);
  for(const ids of [['missing'],[1],[''],[' 1'],['1\n'],Array(5001).fill('1'),[],null])assert.equal((await post(h,{action:'hide',expectedRevision:0,ids})).status,400);
  assert.equal((await post(h,{action:'apply',expectedRevision:0,universities:[]})).status,400);
  assert.equal((await post(h,{action:'other',expectedRevision:0})).status,400);
  const races=await Promise.all([post(h,{action:'apply',expectedRevision:0}),post(h,{action:'reset',expectedRevision:0})]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  assert.equal((await h.env.DB.prepare('SELECT count(*) n FROM audit_logs WHERE resource_type=?').bind(SCOPE_RECORD_TYPE).first()).n,1);
  const before=(await h.request('GET',endpoint)).body;
  const changed={...state,universities:[...state.universities,{id:4,name:'미등록대학'}]};await h.env.FILES.put('state/admissions-data.json',JSON.stringify(changed));
  const result=await post(h,{action:'apply',expectedRevision:before.revision});assert.equal(result.status,200);assert.deepEqual(result.body.excludedIds,['2','3','4']);
  await h.env.FILES.put('state/admissions-data.json',JSON.stringify({...changed,universities:changed.universities.map(r=>r.id===2?{...r,name:'경남대학교'}:r)}));
  assert.deepEqual((await h.request('GET',endpoint)).body.excludedIds,['3','4'],'reused ID with changed name is not hidden');
 }finally{await h.mf.dispose();}
});

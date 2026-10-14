import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { libraryHarness, users } from './support/library-harness.mjs';
const endpoint='/api/admissions/university-evidence';
const recordId='admissions-official-evidence:current',recordType='admissions-official-evidence';
const catalog=()=>JSON.parse(fs.readFileSync(new URL('../public/data-core/official-admissions-evidence.json',import.meta.url),'utf8'));
const state={version:1,universities:[{id:1,name:'경남대학교',major:'디자인'},{id:2,name:'서울대학교',major:'회화'}],students:[],cases:[],awardFolders:[],changeLogs:[],admissionGradeRules:[],settings:{}};
const post=(h,body,user=users.master,origin)=>h.request('POST',endpoint,user,body,origin);
async function setup(h){await h.env.FILES.put('state/admissions-data.json',JSON.stringify(state));}

test('official evidence: authenticated staff GET, master-only same-origin POST and strict server-owned input',async()=>{
 const h=await libraryHarness();try{
  await setup(h);
  for(const user of [null,users.outsider]){
   assert.equal((await h.request('GET',endpoint,user)).status,user?403:401);
   assert.equal((await post(h,{action:'apply',expectedRevision:0},user)).status,user?403:401);
  }
  for(const user of [users.teacher,users.campusAdmin,users.director,users.staff,users.master,users.admin]){
   const result=await h.request('GET',endpoint,user);assert.equal(result.status,200);assert.equal(result.body.catalog,null);assert.equal(result.body.revision,0);assert.equal(result.body.canManage,[users.master,users.admin].includes(user));assert.match(result.headers.get('cache-control'),/private, no-store/);
  }
  for(const user of [users.teacher,users.campusAdmin,users.staff])assert.equal((await post(h,{action:'apply',expectedRevision:0},user)).status,403);
  for(const origin of [null,'https://attacker.invalid'])assert.equal((await post(h,{action:'apply',expectedRevision:0},users.master,origin)).status,403);
  for(const expectedRevision of [undefined,null,-1,1.5,'0',{},Number.MAX_SAFE_INTEGER])assert.equal((await post(h,{action:'apply',expectedRevision})).status,400);
  for(const extra of [{records:[]},{catalog:{}},{sources:[]},{universities:[]},{revision:0}])assert.equal((await post(h,{action:'apply',expectedRevision:0,...extra})).status,400);
  assert.equal((await post(h,{action:'delete',expectedRevision:0})).status,400);
  assert.equal((await h.request('DELETE',endpoint)).status,405);
  assert.equal(await h.env.DB.prepare('SELECT id FROM data_records WHERE id=?').bind(recordId).first(),null);
 }finally{await h.mf.dispose();}
});

test('official evidence: bundled vetted catalog persists separately, generic mutations blocked, source stays untouched',async()=>{
 const h=await libraryHarness();try{
  await setup(h);const original=await(await h.env.FILES.get('state/admissions-data.json')).text();
  assert.deepEqual((await h.request('GET','/api/data')).body._universityEvidence,{version:1,revision:0,catalog:null,canManage:true});
  const applied=await post(h,{action:'apply',expectedRevision:0});assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.revision,1);assert.deepEqual(applied.body.catalog,catalog());
  const persisted=JSON.parse((await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(recordId).first()).metadata_json);assert.deepEqual(persisted,{version:1,revision:1,catalog:catalog()});
  const read=await h.request('GET',endpoint,users.teacher);assert.equal(read.body.canManage,false);assert.deepEqual(read.body.catalog,catalog());
  const data=(await h.request('GET','/api/data',users.teacher)).body;assert.deepEqual(data.universities,state.universities);assert.deepEqual(data._universityEvidence.catalog,catalog());assert.equal(data._universityEvidence.canManage,false);
  assert.equal((await post(h,{action:'apply',expectedRevision:0})).status,409);
  assert.equal((await post(h,{action:'apply',expectedRevision:1})).body.revision,2);
  assert.equal(await(await h.env.FILES.get('state/admissions-data.json')).text(),original);
  assert.equal((await h.request('PUT','/api/data',users.admin,{...data,_universityEvidence:{version:1,revision:99,catalog:{records:['forged']}}})).status,200);
  assert.deepEqual(await(await h.env.FILES.get('state/admissions-data.json')).json(),state);
  for(const user of [users.master,users.admin,users.teacher,users.campusAdmin]){
   assert.equal((await h.request('POST','/api/data-core/records',user,{recordType,sourceApp:'admissions',title:'forged'})).status,403);
   assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(recordId),user,{recordType:'other',metadata:{catalog:{records:[]}}})).status,403);
   assert.equal((await h.request('DELETE','/api/data-core/records/'+encodeURIComponent(recordId),user)).status,403);
   assert.equal((await h.request('PUT','/api/data-core/records/'+encodeURIComponent(recordId)+'/content',user,{content:'forged'})).status,403);
  }
  const audit=await h.env.DB.prepare('SELECT count(*) n FROM audit_logs WHERE resource_type=?').bind(recordType).first();assert.equal(audit.n,2);
  assert.deepEqual((await h.request('GET',endpoint)).body.catalog,catalog());
 }finally{await h.mf.dispose();}
});

test('official evidence: competing initial and subsequent updates advance only one revision and one audit',async()=>{
 const h=await libraryHarness();try{
  await setup(h);
  for(const expectedRevision of [0,1]){
   const races=await Promise.all([post(h,{action:'apply',expectedRevision}),post(h,{action:'apply',expectedRevision})]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
   assert.equal((await h.request('GET',endpoint)).body.revision,expectedRevision+1);
   assert.equal((await h.env.DB.prepare('SELECT count(*) n FROM audit_logs WHERE resource_type=?').bind(recordType).first()).n,expectedRevision+1);
  }
  assert.deepEqual(await(await h.env.FILES.get('state/admissions-data.json')).json(),state);
 }finally{await h.mf.dispose();}
});

test('official evidence: audit failure rolls back catalog mutation in the same D1 batch',async()=>{
 const h=await libraryHarness();try{
  await setup(h);
  await h.env.DB.prepare("CREATE TRIGGER fail_evidence_audit BEFORE INSERT ON audit_logs WHEN NEW.resource_type='admissions-official-evidence' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END").run();
  assert.equal((await post(h,{action:'apply',expectedRevision:0})).status,503);
  assert.equal(await h.env.DB.prepare('SELECT id FROM data_records WHERE id=?').bind(recordId).first(),null);
  await h.env.DB.prepare('DROP TRIGGER fail_evidence_audit').run();
  assert.equal((await post(h,{action:'apply',expectedRevision:0})).status,200);
  assert.equal((await h.request('GET',endpoint)).body.revision,1);
 }finally{await h.mf.dispose();}
});

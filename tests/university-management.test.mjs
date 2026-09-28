import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { managementUniversities, managementUniversityName, managementArchiveId, managementArchiveType, managementRows } from '../public/data-core/university-management.js';
import { universityWebsiteUrl } from '../public/data-core/guideline-details.js';
import { libraryHarness, users, ORG, A } from './support/library-harness.mjs';

test('approved 74 schools retain campus aliases without confusing distinct schools',()=>{
  assert.equal(managementUniversities.length,74);assert.equal(new Set(managementUniversities).size,74);
  for(const name of managementUniversities)assert.equal(managementUniversityName(name),name);
  for(const [raw,wanted] of [['홍익대_세종','홍익대학교'],['동국대학교(WISE)','동국대학교'],['한양대_에리카','한양대학교'],
    ['한양여자대','한양여자대학교'],['동덕여대','동덕여자대학교'],['국립공주대','공주대학교'],['명지전문대','명지전문대학'],
    ['백석문화대','백석문화대학교'],['한국예술종합학교','한국예술종합학교'],['건국대학교 글로컬','건국대학교']])assert.equal(managementUniversityName(raw),wanted);
  for(const name of ['서울대학교','한양사이버대학교','SWA서울웹툰아카데미','인하공업전문대학','동양미래대',''])assert.equal(managementUniversityName(name),null);
  const data=JSON.parse(fs.readFileSync('public/admissions-web/data/default-data.json','utf8'));
  const kept=data.universities.filter(u=>managementUniversityName(u.name));
  assert.equal(new Set(kept.map(u=>managementUniversityName(u.name))).size,74);
  assert.equal(kept.length,2186);
});

test('management filtering is ID-specific and leaves original objects and all other views intact',()=>{
  const rows=[{id:1,name:'서울대'},{id:2,name:'홍익대_세종'}];const before=JSON.stringify(rows);
  assert.deepEqual(managementRows(rows,['1']),[rows[1]]);assert.deepEqual(managementRows(rows),rows);
  assert.equal(JSON.stringify(rows),before);
  const code=fs.readFileSync('public/admissions-web/renderer/app.js','utf8');
  assert.match(code,/function renderAdmin\(\)\{\s*const allUniversities = sortedUniversities\(\{management:true\}\)/);
  assert.match(code,/const universityOptions = editor \? sortedUniversities\(\)/);
});

test('homepage links allow only absolute HTTP(S), with no script or credentials',()=>{
  for(const value of ['http://admission.hongik.ac.kr','https://www.hongik.ac.kr/kr/admission/index.do'])assert.ok(universityWebsiteUrl(value));
  for(const value of ['javascript:alert(1)','data:text/html,x','//example.com','/relative','https://user:pass@example.com','https://example.com\n',null,''])assert.equal(universityWebsiteUrl(value),null);
});

test('persisted management archive preserves raw university and guideline records across campus reads and saves',async()=>{
  const h=await libraryHarness();
  try{
    const state={version:1,universities:[{id:1,name:'서울대',major:'회화'},{id:2,name:'홍익대_세종',major:'디자인'}],students:[],cases:[],awardFolders:[],changeLogs:[],admissionGradeRules:[],settings:{}};
    const bytes=JSON.stringify(state);await h.env.FILES.put('state/admissions-data.json',bytes);
    const now=new Date().toISOString();
    for(const [id,type,metadata]of [[managementArchiveId,managementArchiveType,{version:1,archived:[{id:'1',name:'서울대',deletedAt:now}]}],['test-guideline','university-admission-susi',{academicYear:'2027',universityName:'서울대',department:'회화',admissionSeason:'susi'}]]){
      await h.env.DB.prepare(`INSERT INTO data_records(id,organization_id,record_type,source_app,title,metadata_json,created_at,updated_at) VALUES(?,?,?,'admissions','Synthetic',?,?,?)`)
        .bind(id,ORG,type,JSON.stringify(metadata),now,now).run();
    }
    const get=await h.request('GET','/api/data');assert.equal(get.status,200);
    assert.deepEqual(get.body._universityManagementDeletedIds,['1']);assert.deepEqual(get.body.universities,state.universities);
    const campus=await h.request('GET',`/api/data?campusId=${A}`,users.teacher);assert.equal(campus.status,200);assert.deepEqual(campus.body._universityManagementDeletedIds,['1']);
    assert.equal((await h.request('GET','/api/data',null)).status,401);
    const forged={...get.body,_universityManagementDeletedIds:['2']};
    assert.equal((await h.request('PUT','/api/data',users.admin,forged)).status,200);
    const saved=await(await h.env.FILES.get('state/admissions-data.json')).json();
    assert.deepEqual(saved,state);assert.equal((await h.request('GET','/api/data')).body._universityManagementDeletedIds[0],'1');
    for(const user of [users.admin,users.teacher]){
      const post=await h.request('POST','/api/data-core/records',user,{recordType:managementArchiveType,sourceApp:'admissions',title:'Forged'});assert.equal(post.status,403);
      assert.equal((await h.request('DELETE',`/api/data-core/records/${managementArchiveId}`,user)).status,403);
    }
    const guideline=await h.env.DB.prepare("SELECT metadata_json FROM data_records WHERE id='test-guideline'").first();
    assert.equal(JSON.parse(guideline.metadata_json).universityName,'서울대');
    await h.env.FILES.put('state/admissions-data.json',JSON.stringify({...state,universities:[{...state.universities[0],name:'가천대'}]}));
    assert.deepEqual((await h.request('GET','/api/data')).body._universityManagementDeletedIds,[],'reused numeric ID does not hide a different school');
  }finally{await h.mf.dispose();}
});

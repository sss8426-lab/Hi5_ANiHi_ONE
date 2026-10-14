import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryHarness,users,ORG} from './support/library-harness.mjs';
import {managementArchiveId,managementArchiveType} from '../public/data-core/university-management.js';
test('first individual legacy archive restore preserves every other hidden item',async()=>{
 const h=await libraryHarness();try{
 const state={version:1,universities:[{id:1,name:'서울대'},{id:2,name:'가천대'},{id:3,name:'청강문화산업대학교'}],students:[],cases:[],awardFolders:[],changeLogs:[],admissionGradeRules:[],settings:{}};await h.env.FILES.put('state/admissions-data.json',JSON.stringify(state));const now=new Date().toISOString();
 await h.env.DB.prepare("INSERT INTO data_records(id,organization_id,record_type,source_app,title,metadata_json,created_at,updated_at) VALUES(?,?,?,'admissions','Legacy',?,?,?)").bind(managementArchiveId,ORG,managementArchiveType,JSON.stringify({version:1,archived:[{id:'1',name:'서울대'},{id:'2',name:'가천대'}]}),now,now).run();
 assert.deepEqual((await h.request('GET','/api/data')).body._universityManagementDeletedIds,['1','2']);
 const r=await h.request('POST','/api/admissions/university-scope',users.master,{action:'restore',expectedRevision:0,ids:['1']});assert.equal(r.status,200);assert.deepEqual(r.body.excludedIds,['2']);
 assert.deepEqual((await h.request('GET','/api/data')).body._universityManagementDeletedIds,['2']);assert.deepEqual(await(await h.env.FILES.get('state/admissions-data.json')).json(),state);
 }finally{await h.mf.dispose();}
});

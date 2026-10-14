import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryHarness,users} from './support/library-harness.mjs';
test('partial transcript changes invalidate previous completeness, explicit review may re-confirm',async()=>{
 const h=await libraryHarness();try{
 await h.env.FILES.put('state/admissions-data.json',JSON.stringify({version:1,universities:[],students:[],cases:[],awardFolders:[],changeLogs:[],admissionGradeRules:[],settings:{}}));
 const created=await h.request('POST','/api/admissions/students',users.master,{student:{name:'Synthetic profile review',studentType:'current',detailedTranscript:[{subjectName:'국어',grade:4}],admissionsProfile:{year:2027,season:'수시',scale:9,schoolStatus:'expected',complete:true}}});assert.equal(created.status,201);
 const id=created.body.students[0].id;
 const changed=await h.request('PATCH','/api/admissions/students/'+id,users.master,{student:{detailedTranscript:[{subjectName:'국어',grade:3}]}});assert.equal(changed.status,200);assert.equal(changed.body.student.admissionsProfile.complete,false);
 const confirmed=await h.request('PATCH','/api/admissions/students/'+id,users.master,{student:{admissionsProfile:{year:2027,season:'수시',scale:9,schoolStatus:'expected',complete:true}}});assert.equal(confirmed.status,200);assert.equal(confirmed.body.student.admissionsProfile.complete,true);
 }finally{await h.mf.dispose();}
});

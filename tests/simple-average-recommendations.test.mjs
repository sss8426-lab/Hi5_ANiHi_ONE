import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gradeNumber,studentAverage,criterionFor,compareSimpleAverage} from '../public/admissions-web/renderer/simple-average-recommendations.js';
const university=(id='1',extra={})=>({id,name:'서경대학교',major:'디자인학부',admission:'수시 실기',year:2027,acceptedStats:{worst:3.7},...extra});
const semester=values=>({gradeLevel:'고1',termGrades:{grade1:{semester1:values}}});

test('empty/zero/points/booleans are not rank grades',()=>{
 for(const v of ['',null,undefined,0,'0',false,true,NaN,10,100,'100점','-'])assert.equal(gradeNumber(v),null);
 assert.equal(gradeNumber('3.7'),3.7);
});
test('one first-year semester is enough and blank semesters are not zeros',()=>{
 const s=semester({korean:3.6,english:3.8,math:'',social:0,science:null});
 assert.equal(studentAverage(s).count,2);assert.equal(studentAverage(s).value,3.7);
 assert.equal(compareSimpleAverage(s,[university()]).matches.length,1);
});
test('3.7 minimum includes stronger/equal grades and excludes weaker grades',()=>{
 for(const value of [1,3,3.7])assert.equal(compareSimpleAverage(semester({korean:value}),[university()]).matches.length,1);
 for(const value of [3.7001,4,9])assert.equal(compareSimpleAverage(semester({korean:value}),[university()]).matches.length,0);
});
test('detailed ranks take priority and are not weighted by credits or double counted',()=>{
 const s={gpa:9,termGrades:{grade1:{semester1:{korean:1}}},detailedTranscript:[{grade:3,credits:1},{grade:4,credits:9},{grade:'',rawScore:100}]};
 assert.deepEqual(studentAverage(s),{value:3.5,count:2,source:'상세 학생부 단순평균'});
});
test('legacy saved mean can be used without a completed admissions profile',()=>{
 const s={gpa:3.7,admissionsProfile:{complete:false}};
 assert.equal(studentAverage(s).source,'저장된 평균등급');assert.equal(compareSimpleAverage(s,[university()]).schools.length,1);
});
test('missing grades do not create recommendations',()=>{
 for(const s of [{},{gpa:''},{gpa:0},{detailedTranscript:[{rawScore:80,grade:''}]}])assert.equal(compareSimpleAverage(s,[university()]).matches.length,0);
});
test('displayed official worst overrides original worst; worst overrides basic cutoff',()=>{
 assert.equal(criterionFor(university('1',{cutGpa:2})).value,3.7);
 assert.equal(criterionFor(university(),{worst:4.5}).value,4.5);
 const r=compareSimpleAverage({gpa:4},[university()],{officialStatsFor:()=>({worst:4.5})});assert.equal(r.matches.length,1);
});
test('same displayed official stats precedence as the university editor, including blank minimum',()=>{
 const app=fs.readFileSync(new URL('../public/admissions-web/renderer/app.js',import.meta.url),'utf8');assert.match(app,/const stats = officialStats \|\| current\.acceptedStats \|\| \{\}/);
 assert.equal(criterionFor(university(),{worst:null}),null);
 assert.equal(criterionFor(university('1',{cutGpa:4}),{worst:null}),null);
});
test('cutoff and mean never stand in for a missing minimum',()=>{
 assert.equal(criterionFor(university('1',{acceptedStats:{worst:null,avg:4.5},cutGpa:3.7})),null);
 assert.equal(criterionFor(university('1',{acceptedStats:{avg:4.5},cutGpa:''})),null);
});
test('hidden IDs and track filters are respected before reference lookup',()=>{
 const rows=[university(1),university(2),university(3,{major:'웹툰'})];
 const r=compareSimpleAverage({gpa:3},rows,{excludedIds:['1'],match:u=>u.major==='디자인학부'});
 assert.deepEqual(r.matches.map(x=>x.u.id),[2]);
});
test('school aliases group together but preserve individual program references',()=>{
 const r=compareSimpleAverage({gpa:3},[university('1',{name:'서경대'}),university('2')]);
 assert.equal(r.schools.length,1);assert.equal(r.schools[0].items.length,2);
});
test('campus-bound schools keep campus names in grouped results',()=>{
 const r=compareSimpleAverage({gpa:3},[university('1',{name:'상명대학교_천안',region:'충남'})]);
 assert.equal(r.schools[0].name,'상명대학교 (천안)');
});
test('calculations do not mutate student, profile, or university data',()=>{
 const s={gpa:3,admissionsProfile:{complete:false}},u=[university()];const before=JSON.stringify({s,u});compareSimpleAverage(s,u);assert.equal(JSON.stringify({s,u}),before);
});
const uiCode=fs.readFileSync(new URL('../public/admissions-web/renderer/student-recommendation-ui.js',import.meta.url),'utf8');
function ui(){const window={OfficialAdmissionEvidence:{statsFor:()=>null,candidates:()=>[]}};vm.runInNewContext(uiCode,{window,document:{addEventListener(){},getElementById(){return null;}}});return window.BenchmarkStudentUi;}
test('non-senior UI routes directly to simple average without official eligibility gate',()=>{
 const api=ui(),model={compareAdmissions(){throw new Error('senior gate must not run');}};
 const r=api.compare({universities:[university()]},{gpa:3},model,()=>true,{simple:true,simpleAverageModel:{compareSimpleAverage}});
 assert.equal(r.mode,'simple-average');assert.match(api.chips(r),/평균 기준 1개교/);assert.match(api.panel(r,model),/단순평균 참고/);assert.doesNotMatch(api.profile({},{simple:true}),/comparisonComplete/);
});
test('senior UI retains original official comparison and completion fields',()=>{
 const api=ui(),sentinel={above:[],near:[],below:[],pending:[],reference:[]};let called=false;
 assert.equal(api.compare({universities:[]},{}, {compareAdmissions(){called=true;return sentinel;}},()=>true,{simple:false}),sentinel);
 assert.equal(called,true);assert.match(api.profile({}),/comparisonComplete/);
});
test('names are escaped in simple result panels',()=>{
 const api=ui(),r=compareSimpleAverage({gpa:3},[university('1',{name:'<script>alert(1)</script>'})]);
 const html=api.panel(r,{});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('current high3 stays senior; high1/high2/middle/N-repeater use simple reference',()=>{
 const source=fs.readFileSync(new URL('../public/admissions-web/renderer/app.js',import.meta.url),'utf8');const body=/function usesSimpleAverage\(student\)\{([^}]+)\}/.exec(source)[1];
 const uses=vm.runInNewContext('(function(student){'+body+'})',{isCurrentStudent:s=>s.studentType!=='result',window:{AdmissionsStudentGrades:{gradeOf:s=>s.info}}});
 assert.equal(uses({info:{grade:3,graduated:false}}),false);
 for(const info of [{grade:1},{grade:2},{grade:null},{grade:3,graduated:true}])assert.equal(uses({info}),true);
 assert.equal(uses({studentType:'result',info:{grade:2}}),false);
});

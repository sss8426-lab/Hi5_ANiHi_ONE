import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/admissions-web/renderer/official-evidence-ui.js',import.meta.url),'utf8');
const context={window:{},URL};vm.runInNewContext(source,context);const ui=context.window.OfficialAdmissionEvidence;
const catalog=JSON.parse(fs.readFileSync(new URL('../public/data-core/official-admissions-evidence.json',import.meta.url)));
test('official mean candidates are bound to visible original university IDs, never hidden-only schools',()=>{
 const universities=[{id:1,name:'한국영상대학교',major:'애니메이션전공',admission:'수시1 실기'},{id:2,name:'한국영상대학교',major:'애니메이션전공',admission:'실기전형'}];const data={universities,_universityEvidence:{catalog},_universityRecommendationExcludedIds:['1','2']};
 assert.equal(ui.candidates(data).length,0);
 const candidates=ui.candidates({...data,_universityRecommendationExcludedIds:['1']});assert.ok(candidates.length>0);assert.ok(candidates.every(c=>c.id===2));for(const c of candidates)assert.deepEqual(Array.from(c.sourceUniversityIds),['2']);const eligible=candidates.filter(c=>c.admissionBenchmark.directRecommendationEligible);assert.equal(eligible.length,1);assert.equal(eligible[0].admissionBenchmark.value,4.5);
 assert.equal(ui.candidates({...data,universities:[]}).length,0);
});
test('SMU stats select exact final-registered program metrics, not initial admits or Seoul',()=>{
 const data={_universityEvidence:{catalog}};const u={name:'상명대_천안',region:'충남',major:'디지털만화영상전공',admission:'실기전형',year:2027};const stats=ui.statsFor(data,u);assert.equal(stats.average,3.3);assert.equal(stats.worst,4.62);assert.equal(stats.best,null);
 assert.equal(ui.statsFor(data,{...u,name:'상명대학교',region:'서울'}),null);assert.equal(ui.statsFor(data,{...u,year:2028}),null);assert.equal(ui.statsFor(data,{...u,major:'기타학과'}),null);assert.equal(ui.statsFor(data,{...u,admission:'학생부교과'}),null);
});

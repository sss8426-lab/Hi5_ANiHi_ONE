import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync('public/admissions-web/renderer/counseling-ux.js','utf8'),ctx);
const ux=ctx.window.AdmissionsCounselingUx;
const campus=(latitude,longitude=126.98)=>({campus:'합성캠퍼스',campusLocation:{campus:'합성캠퍼스',latitude,longitude,verificationStatus:'verified',sourceUrl:'https://synthetic.example/campus'}});
test('eligible candidates sort by verified program campus distance, never probability; unknown last and no mutation',()=>{
  const rows=[{u:{id:'unknown'},p:99},{u:{id:'far',...campus(35.1)},p:95},{u:{id:'near',...campus(37.567)},p:20}];
  const before=JSON.stringify(rows),sorted=ux.sortByDistance(rows);
  assert.deepEqual(Array.from(sorted,r=>r.u.id),['near','far','unknown']);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(sorted[2].distanceKm,null);
  assert.ok(sorted[0].distanceKm<1);assert.ok(sorted[1].distanceKm>200);
  assert.equal(ux.campusDistance({...campus(ux.origin.latitude,ux.origin.longitude)}),0);
});
test('missing, ambiguous, wrong-campus, unverified, malformed coordinates never infer a main campus',()=>{
  const valid=campus(37.5);
  for(const change of [{campus:''},{campus:'다른캠퍼스'},{campusLocation:null},...[
    {verificationStatus:'review'},{sourceUrl:''},{latitude:''},{latitude:null},{latitude:NaN},
    {latitude:91},{longitude:181},{longitude:'127'},{latitude:Infinity},
  ].map(p=>({campusLocation:{...valid.campusLocation,...p}}))])assert.equal(ux.campusDistance({...valid,...change}),null);
  const rows=[{u:{id:1},p:10},{u:{id:2},p:99}];
  assert.deepEqual(Array.from(ux.sortByDistance(rows),r=>r.u.id),[1,2]);
});
test('reserve formats sort numerically descending with missing last, without mistaking year or score for reserve',()=>{
  for(const text of ['예비 535번','예비535','535','예비번호 535'])assert.equal(ux.reserveNumber({resultNote:text}),535);
  for(const text of ['',null,'2026학년도 불합격','내신 3.5','-3','0'])assert.equal(ux.reserveNumber({resultNote:text}),null);
  const rows=[{resultNote:''},{resultNote:'예비 30번'},{resultNote:'예비535'},{reserveNumber:468},{originalResult:'예비 424번'},{resultNote:'예비 148번'}];
  const before=JSON.stringify(rows);
  assert.deepEqual(Array.from(ux.rejectedOrder(rows),ux.reserveNumber),[535,468,424,148,30,null]);
  assert.equal(JSON.stringify(rows),before);
});
test('independent case pages contain at most three records and clamp after filtering',()=>{
  const rows=Array.from({length:8},(_,i)=>i);
  assert.deepEqual(Array.from(ux.casePage(rows,2).rows),[3,4,5]);
  assert.deepEqual(Array.from(ux.casePage(rows,999).rows),[6,7]);
  assert.equal(ux.casePage([],5).page,1);
  assert.equal(ux.casePage(rows,-3).page,1);
  assert.equal(ux.casePage(rows,NaN).page,1);
});

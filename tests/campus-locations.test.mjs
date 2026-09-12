import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({window:{}});
for(const f of ['campus-locations','counseling-ux'])vm.runInContext(fs.readFileSync(`public/admissions-web/renderer/${f}.js`,'utf8'),ctx);
const {AdmissionsCampusLocations:locations,AdmissionsCounselingUx:ux}=ctx.window;
test('reviewed locations require exact program, campus and reviewed year, never mutate source',()=>{
  const u={name:'국민대',major:'시각디자인학과',year:2027};const before=JSON.stringify(u);
  const point=locations.resolve(u);assert.equal(point.verificationStatus,'verified');assert.ok(ux.campusDistance(u)>0);
  assert.equal(JSON.stringify(u),before);
  for(const change of [{major:'시각디자인학과(야)'},{campus:'다른캠퍼스'},{year:2028},{major:'자유전공'}]) {
    assert.equal(locations.resolve({...u,...change}).verificationStatus,'needs_review');assert.equal(ux.campusDistance({...u,...change}),null);
  }
  assert.equal(locations.resolve({...u,name:'합성대'}).verificationStatus,'unknown');
  assert.equal(ux.campusDistance({...u,campusLocation:{verificationStatus:'needs_review'}}),null);
  assert.equal(locations.resolve({name:'서울과학기술대',major:'산업디자인학과',year:2027}).verificationStatus,'needs_review');
});
test('official source metadata and stable distance order do not use probability',()=>{
  for(const row of locations.entries){assert.match(row.sourceUrl,/^https:\/\//);assert.ok(row.programSourceUrl);assert.equal(row.verifiedAt,'2026-09-12');}
  const u={name:'국민대',major:'시각디자인학과',year:2027};
  const rows=ux.sortByDistance([{u:{name:'합성대'},p:99,id:0},{u,p:10,id:1},{u,p:99,id:2}]);
  assert.deepEqual(Array.from(rows,r=>r.id),[1,2,0]);
});

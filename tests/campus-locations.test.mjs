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
  for(const row of locations.entries){assert.match(row.sourceUrl,/^https:\/\//);assert.ok(row.programSourceUrl);assert.match(row.verifiedAt,/^2026-09-(12|14)$/);}
  const u={name:'국민대',major:'시각디자인학과',year:2027};
  const rows=ux.sortByDistance([{u:{name:'합성대'},p:99,id:0},{u,p:10,id:1},{u,p:99,id:2}]);
  assert.deepEqual(Array.from(rows,r=>r.id),[1,2,0]);
});

test('KUMA 2027 exact programs use the official Sejong marker, without extending unreviewed identities',()=>{
  const entry=locations.entries.find(row=>row.schools.includes('한국영상대학교'));
  assert.equal(entry.programs.length,17);
  assert.deepEqual(Array.from(entry.years),[2027]);
  assert.equal(entry.verifiedAt,'2026-09-14');
  assert.equal(entry.latitude,36.462172912634);
  assert.equal(entry.longitude,127.21061593393193);
  assert.equal(new URL(entry.sourceUrl).hostname,'edu.pro.ac.kr');
  assert.equal(new URL(entry.programSourceUrl).hostname,'ipsi.pro.ac.kr');
  for(const name of entry.schools)for(const major of entry.programs){
    const row={name,major,year:2027};const before=JSON.stringify(row);
    assert.equal(locations.resolve(row),entry);
    assert.ok(ux.campusDistance(row)>100&&ux.campusDistance(row)<150);
    assert.equal(JSON.stringify(row),before);
  }
  const row={name:'한국영상대',major:'애니메이션전공',year:2027};
  for(const change of [{major:'애니메이션전공_야간'},{major:'애니메이션학과'},{major:'웹툰애니자율전공'},{major:'웹툰ㆍ웹소설 융복합계열'},{year:2026},{year:2028},{campus:'서울캠퍼스'}]){
    assert.equal(locations.resolve({...row,...change}).verificationStatus,'needs_review');
    assert.equal(ux.campusDistance({...row,...change}),null);
  }
  assert.equal(ux.campusDistance({...row,campusLocation:{verificationStatus:'needs_review'}}),null);
  assert.equal(locations.resolve({...row,campus:'세종'}),entry);
  for(const old of locations.entries.filter(item=>item!==entry)){
    assert.equal(old.verifiedAt,'2026-09-12');assert.deepEqual(Array.from(old.years),[2026,2027]);
  }
});

test('new locations preserve distance precedence and source order regardless of probability',()=>{
  const kuma={name:'한국영상대',major:'애니메이션전공',year:2027};
  const seoul={name:'국민대',major:'시각디자인학과',year:2027};
  const rows=ux.sortByDistance([{u:kuma,p:99,id:1},{u:{name:'미검증대'},p:99,id:2},{u:seoul,p:1,id:3},{u:kuma,p:1,id:4},{u:{...kuma,year:2028},p:100,id:5}]);
  assert.deepEqual(Array.from(rows,item=>item.id),[3,1,4,2,5]);
});

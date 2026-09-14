import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLocations,candidateFrequencies} from '../scripts/audit-campus-locations.mjs';

test('location coverage distinguishes stored aliases, verified institutions and unresolved programs',()=>{
  const rows=[
    {name:'한국영상대',major:'애니메이션전공',year:2027},
    {name:'한국영상대학교',major:'게임콘텐츠전공',year:2027},
    {name:'한국영상대',major:'애니메이션전공_야간',year:2027},
    {name:'SYNTHETIC unknown',major:'게임전공',year:2027},
  ];
  assert.deepEqual(summarizeLocations(rows),{programRows:4,schoolNameIdentities:3,verified:2,needs_review:1,unknown:1,
    schoolsWithVerifiedPrograms:2,verifiedInstitutions:1,schoolsWithReviewPrograms:1,schoolsWithUnknownPrograms:1});
});

test('candidate audit reuses dashboard latest/checked/track/type filters without private fields or mutation',()=>{
  const rows=[
    {name:'SYNTHETIC latest',major:'웹툰학과',practicalType:'칸만화',checkedComplete:true,latestAdmissionComplete:true,notes:'SYNTHETIC_DO_NOT_OUTPUT'},
    {name:'SYNTHETIC older',major:'웹툰학과',checkedComplete:true},
    {name:'SYNTHETIC hidden',major:'웹툰학과',checkedComplete:true,latestAdmissionComplete:true,hiddenDuplicate:true},
    {name:'SYNTHETIC unchecked',major:'웹툰학과',checkedComplete:false,latestAdmissionComplete:true},
  ];
  const before=JSON.stringify(rows),result=candidateFrequencies(rows);
  assert.equal(result.candidatePool,1);assert.equal(result.combinations,75);
  assert.equal(result.top.length,1);assert.equal(result.top[0].school,'SYNTHETIC latest');
  assert.equal(result.top[0].candidateAppearances,2);assert.equal(result.top[0].top30Appearances,2);
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_DO_NOT_OUTPUT|notes|hidden|unchecked|older/);
  assert.equal(JSON.stringify(rows),before);
  const fallback=candidateFrequencies(rows.map(row=>({...row,latestAdmissionComplete:false})));
  assert.equal(fallback.candidatePool,2);
});

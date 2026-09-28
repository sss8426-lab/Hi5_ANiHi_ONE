import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateVerified, calculateCandidates, joongbuPoints, PROGRAMS } from '../public/admissions-web/renderer/verified-grade-engine.js';
const profile = { year:2027, season:'수시', scale:9, schoolStatus:'expected', complete:true };
const row = (i, overrides={}) => ({ id:`row-${i}`, schoolYear:'1학년', semester:'1학기', subjectGroup:'KOREAN', subjectType:'COMMON', subjectName:`과목${i}`, grade:3, ...overrides });
const ten = Array.from({length:10},(_,i)=>row(i));

test('Joongbu official PDF p50 example: 3.6, practical 180 / record 820',()=>{
  const grades=[4,3,4,3,5,2,2,4,5,4];
  const rows=grades.map((grade,i)=>row(i,{grade}));
  rows[5]={...rows[5],subjectType:'CAREER',grade:'',achievement:'A'};
  rows[6]={...rows[6],subjectType:'CAREER',grade:'',achievement:'A'};
  rows[9]={...rows[9],subjectType:'CAREER',grade:'',achievement:'B'};
  const result=calculateVerified('jb-comic-practical',rows,profile);
  assert.equal(result.convertedGrade,3.6);assert.equal(result.score,180);
  assert.equal(result.benchmark.margin,-0.2);
  assert.equal(calculateVerified('jb-photo-record',rows,profile).score,820);
});
test('selects best ten, preserves input, excludes 3-2 and science experiment',()=>{
  const rows=[...ten,row(10,{grade:1}),row(11,{grade:1,schoolYear:'3학년',semester:'2학기'}),row(12,{subjectName:'과학탐구실험',subjectGroup:'SCIENCE',grade:1}),row(13,{subjectGroup:'ART',grade:1})];
  const copy=structuredClone(rows);const result=calculateVerified('jb-comic-practical',rows,profile);
  assert.equal(result.convertedGrade,2.8);assert.equal(result.selected.length,10);assert.equal(result.excluded.length,4);assert.deepEqual(rows,copy);
});
test('same subject different terms is allowed; duplicate same term blocks',()=>{
  assert.equal(calculateVerified('jb-comic-practical',[row(1),row(1,{semester:'2학기'})],profile).ok,true);
  assert.equal(calculateVerified('jb-comic-practical',[row(1),row(1)],profile).ok,false);
});
for (const [label,change] of Object.entries({year:{year:2028},season:{season:'정시'},scale:{scale:5},education:{schoolStatus:'other'},incomplete:{complete:false}})) {
  test(`blocks unsupported ${label} without fallback`,()=>assert.equal(calculateVerified('jb-comic-practical',ten,{...profile,...change}).ok,false));
}
for(const grade of ['',0,10,2.5,'3junk',null,NaN,Infinity]) test(`invalid rank ${String(grade)} cannot silently become grade9`,()=>{
  assert.equal(calculateVerified('jb-comic-practical',[row(1,{grade})],profile).ok,false);
});
test('empty/unknown/missing term and unsupported types fail closed',()=>{
  assert.equal(calculateVerified('jb-comic-practical',[],profile).ok,false);
  assert.equal(calculateVerified('unknown',ten,profile).ok,false);
  assert.equal(calculateVerified('jb-comic-practical',[row(1,{semester:''})],profile).ok,false);
  assert.equal(calculateVerified('jb-comic-practical',[row(1,{subjectType:'CONVERGENCE'})],profile).ok,false);
  assert.equal(calculateVerified('jb-comic-practical',[row(1,{subjectType:'CAREER',achievement:'D'})],profile).ok,false);
});
test('actual missing subjects padded only after completeness confirmation',()=>{
  const result=calculateVerified('jb-comic-practical',[row(1,{grade:1})],profile);
  assert.equal(result.paddedCount,9);assert.equal(result.convertedGrade,8.2);assert.equal(result.score,135);
  assert.equal(calculateVerified('jb-comic-practical',[row(1,{grade:1})],{...profile,complete:false}).ok,false);
});
test('200 point bands match all official boundaries',()=>{
  for(const [grade,score] of [[1,200],[1.9,200],[2,195],[2.4,195],[2.5,190],[3,185],[3.5,180],[4,175],[4.5,170],[5,165],[5.5,160],[6,155],[6.5,150],[7,145],[7.5,140],[8,135],[8.5,130],[8.9,130],[9,120]]) assert.equal(joongbuPoints(grade,200),score,`${grade}`);
});
test('1000 point table matches source bands, including 4.2 and 9',()=>{
  for(const [grade,score] of [[1,1000],[2,980],[2.2,960],[2.4,940],[2.6,920],[2.8,900],[3,880],[3.2,860],[3.4,840],[3.6,820],[3.8,800],[4,780],[4.2,760],[4.4,740],[4.6,720],[4.8,700],[5,680],[5.2,660],[5.4,640],[5.6,620],[5.8,600],[6,580],[6.2,560],[6.4,540],[6.6,520],[6.8,500],[7,480],[7.9,480],[8,460],[8.9,460],[9,440]]) assert.equal(joongbuPoints(grade,1000),score,`${grade}`);
});
const swRows = [row(1,{grade:1}),row(2,{grade:2}),row(3,{grade:3,subjectGroup:'MATH'}),row(4,{grade:4,subjectGroup:'MATH'}),row(5,{grade:1,subjectGroup:'ENGLISH'}),row(6,{grade:2,subjectGroup:'ENGLISH'}),row(7,{grade:3,subjectGroup:'SOCIAL'}),row(8,{grade:9,subjectGroup:'SCIENCE'})];
test('Seowon art is 8 subjects (NOT athletics 4); per-subject point average, 2-stage rounding',()=>{
  const result=calculateVerified('sw-comic-art',swRows,profile);
  assert.equal(result.selected.length,8);assert.equal(result.convertedGrade,3.13);
  assert.equal(result.score,175.6);assert.equal(result.benchmark,null);
  assert.equal(calculateVerified('sw-design-general',swRows,profile).score,878);
});
test('Seowon achievement and completed graduate term are school-specific',()=>{
  const rows=[...swRows,row(9,{subjectGroup:'SCIENCE',subjectType:'CAREER',achievement:'A',grade:''}),row(10,{grade:1,subjectGroup:'MATH',schoolYear:'3학년',semester:'2학기'})];
  const expected=calculateVerified('sw-design-art',rows,profile),graduate=calculateVerified('sw-design-art',rows,{...profile,schoolStatus:'graduate'});
  assert.equal(expected.selected.find(r=>r.id==='row-9').convertedGrade,3);
  assert.ok(graduate.convertedGrade < expected.convertedGrade);
});
test('ranking is same-basis historical margin, never probability or cross-school point percentage',()=>{
  const result=calculateCandidates(ten,profile);
  assert.equal(result.length,8);assert.equal(result[0].program.id,'jb-photo-practical');
  assert.ok(result.slice(0,4).every(r=>r.benchmark));assert.ok(result.slice(4).every(r=>!r.benchmark));
  assert.ok(result.every(r=>!('probability' in r)&&!('p' in r)));
  assert.deepEqual(calculateCandidates(ten,profile,'웹툰·애니').map(r=>r.program.id),['jb-comic-practical','sw-comic-art']);
});
test('supplied directory has exactly 74 distinct schools and safe unmodified URLs',()=>{
  const entries=JSON.parse(fs.readFileSync(new URL('../public/admissions-web/renderer/calculator-directory.json',import.meta.url)));
  assert.equal(entries.length,74);assert.equal(new Set(entries.map(r=>r.name)).size,74);
  assert.equal(entries[0].sourceYear,'2026');assert.match(entries[4].provider,/글로컬/);
  for(const row of entries) if(row.url) assert.ok(['http:','https:'].includes(new URL(row.url).protocol));
  assert.equal(new Set(PROGRAMS.map(p=>p.id)).size,8);
});

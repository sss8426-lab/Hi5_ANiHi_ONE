import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {selectionRatios} from '../public/data-core/selection-ratios.js';
import {programView,filterPrograms,admissionTrend} from '../public/data-core/roadmap-model.js';
import {projectGuideline} from '../public/data-core/admissions-model.js';
import {resolveUniversityLogo} from '../public/data-core/university-logos.js';
import {universityLogos} from '../public/data-core/university-logo-manifest.js';
import {foundationImages} from '../public/data-core/foundation-images.js';

test('case images retain their existing path instead of entering the student-only endpoint',()=>{
  const source=fs.readFileSync('public/admissions-web/renderer/app.js','utf8');
  const code=source.slice(source.indexOf('function studentArtworks('),source.indexOf('function studentArtworkImage('));
  const context=vm.createContext({location:{protocol:'https:'},imgSrc:value=>value});
  vm.runInContext(code,context);
  const record={id:'synthetic-case',artworks:[{path:'/fixture-case.png'}]};
  assert.equal(context.studentArtworks(record,false)[0].displayUrl,'/fixture-case.png');
  assert.match(context.studentArtworks(record)[0].displayUrl,/\/api\/admissions\/students\/synthetic-case\/artworks\/0$/);
  assert.equal(JSON.stringify(context.studentArtworks(record,false)),JSON.stringify(record.artworks));
});

test('legacy representative image aliases keep the richer artwork entry and its original array slot',()=>{
  const source=fs.readFileSync('public/admissions-web/renderer/app.js','utf8');
  const code=source.slice(source.indexOf('function studentArtworks('),source.indexOf('function studentArtworkImage('));
  const context=vm.createContext({location:{protocol:'https:'},imgSrc:value=>value});
  vm.runInContext(code,context);
  for(const field of ['path','filePath','imageUrl','url','downloadUrl']){
    const record={id:'synthetic',artworkImage:'/api/files/stale.png',artworks:[{[field]:'/api/files/stale.png',fileName:'original.png'}]};
    const before=JSON.stringify(record),images=context.studentArtworks(record);
    assert.equal(images.length,1,field);
    assert.equal(images[0].displayUrl,'/api/admissions/students/synthetic/artworks/0');
    assert.equal(images[0].fileName,'original.png');
    assert.equal(JSON.stringify(record),before);
  }
  for(const value of ['', '   ']){
    assert.equal(context.studentArtworks({id:'synthetic',artworkImage:value}).length,0);
    const images=context.studentArtworks({id:'synthetic',artworkImage:value,artworks:[{path:'/api/files/stale.png',fileName:'original.png'}]});
    assert.equal(images.length,1);
    assert.equal(images[0].displayUrl,'/api/admissions/students/synthetic/artworks/0');
  }
});

test('complete percentages preserve zeros, sum school record and CSAT, and keep non-academic factors separate',()=>{
  for(const [formula,academic,practical,other] of [['학생부20/실기80',20,80,0],['학생부 20 + 수능 30 + 실기 40 + 면접 10',50,40,10],['실기100',0,100,0],['학생부100',100,0,0],['수능100',100,0,0],['실기80/서류10/출결10',0,80,20],['수능33.3+학생부33.3+실기33.4',66.6,33.4,0]]){
    const r=selectionRatios(formula);assert.equal(r.ratioStatus,'simple',formula);assert.equal(r.academicRatio,academic);assert.equal(r.practicalRatio,practical);assert.equal(r.otherRatio,other);
  }
  for(const formula of ['1단계 학생부100, 2단계 실기80+면접20','학생부20+실기70','학생부20+교과20+실기60','실기100점','학생부20 또는 수능20 + 실기80','학생부20/실기80/','실기 100 가산점','서류 일괄합산','학생부-20+실기120']){
    const r=selectionRatios(formula);assert.equal(r.academicRatio,null,formula);assert.equal(r.practicalRatio,null,formula);
  }
  assert.equal(selectionRatios('1단계 학생부100, 2단계 면접100').ratioStatus,'staged');
});

test('stored public facts are readable without claiming official verification or relaxing canonical mapping',()=>{
  const base={guidelineId:'synthetic-guideline',verificationStatus:'public-source-unverified',sourceUrl:'https://grinalda.net/univ-info-jungsi/',year:2027,selectionFormula:'수능30/실기70',practicalType:'기초디자인',quota:0,competitionRate:0,admissionSeason:'jungsi'};
  const p=programView({metadata:base});assert.equal(p.grade,30);assert.equal(p.skill,70);assert.equal(p.verified,false);assert.equal(p.quota,0);assert.equal(p.practical,'기초디자인');
  assert.equal(admissionTrend([p]),null);assert.equal(filterPrograms([p],{season:'susi'}).length,0);
  assert.equal(programView({metadata:{...base,sourceUrl:'https://example.test'}}).grade,null);
  assert.equal(programView({metadata:{...base,guidelineId:''}}).grade,null);
  const row=projectGuideline({...base,gradeRatio:99,practicalRatio:99});assert.equal(row.academicRatio,30);assert.equal(row.practicalRatio,70);
  assert.equal(projectGuideline({...base,selectionFormula:'1단계 서류100/2단계 면접100',practicalRatio:70}).practicalRatio,null);
});

test('logos match exact identity only and hide missing or ambiguous campus candidates',()=>{
  const common={name:'합성대학교',campus:'',src:'common.webp'},a={...common,campus:'서울',src:'a.webp'},b={...common,campus:'부산',src:'b.webp'};
  assert.equal(resolveUniversityLogo('합성대','',[common]).src,'common.webp');
  assert.equal(resolveUniversityLogo('합성대(서울)','',[a,b]).src,'a.webp');
  assert.equal(resolveUniversityLogo('합성대_서울','',[a,b]).src,'a.webp');
  assert.equal(resolveUniversityLogo('합성대학교','',[a,b]),null);
  assert.equal(resolveUniversityLogo('합성예술대학교','',[common]),null);
  assert.equal(resolveUniversityLogo('합성대','서울',[a,{...a}]),null);
  assert.equal(resolveUniversityLogo('합성대','다른캠퍼스',[common,a]),null);
  assert.equal(universityLogos.length,49);
  for(const logo of universityLogos){assert.ok(fs.existsSync('public'+logo.src));assert.ok(logo.alt&&logo.title);}
});

test('six foundation subjects have distinct assets and preserved educational purpose',()=>{
  assert.equal(Object.keys(foundationImages).length,6);
  assert.equal(new Set(Object.values(foundationImages).map(v=>v.asset)).size,6);
  for(const entry of Object.values(foundationImages)){assert.ok(entry.alt&&entry.detail&&entry.points);assert.ok(fs.existsSync(`public/data-core/assets/foundation/${entry.asset}-v1.webp`));}
  const html=fs.readFileSync('public/data-core/roadmap.html','utf8');assert.match(html,/<section class="lesson-detail"/);assert.doesNotMatch(html,/<details class="lesson-detail"/);
});

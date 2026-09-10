import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {careerStages,searchCareers} from '../public/data-core/roadmap-model.js';
import {matchesCareer,matchUniversity} from '../public/data-core/admissions-model.js';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('public/data-core/roadmap-content.js','utf8'),ctx);
const data=JSON.parse(JSON.stringify(ctx.window.HI5_ROADMAP_CONTENT));
const review=JSON.parse(fs.readFileSync('scripts/roadmap-career-review.json','utf8'));

test('all 35 stable occupations have reviewed concrete outcomes and five distinct practical stages',()=>{
 assert.deepEqual(data.careers.map(c=>c.id),Array.from({length:35},(_,i)=>`D${String(i+1).padStart(3,'0')}`));
 assert.equal(data.version,review.version);
 for(const c of data.careers){
  for(const [key,value] of Object.entries(review.careers[c.id]))assert.deepEqual(c[key],value,`${c.id}.${key}`);
  const steps=careerStages(c);assert.equal(steps.length,5);assert.equal(new Set(steps.map(s=>s[1])).size,5);
  assert.notDeepEqual(c.specialization,c.advanced,c.id);
  assert.ok(c.majors.some(m=>matchesCareer(m,c.id)),c.id);
  assert.ok(c.summary.length<=65 && c.outcome && c.distinction && c.completionFocus,c.id);
  assert.match(steps[4][1],new RegExp(c.completionFocus));
  assert.doesNotMatch(steps.flat().join(' '),/3년|[123]년차|취업·창작·데뷔/);
  const image=occupationImageConcepts.find(x=>x.occupationId===c.id);assert.ok(image);
  assert.ok(c.name===image.title || c.aliases.includes(image.title));
 }
 assert.equal(new Set(data.careers.map(c=>c.outcome)).size,35);
 assert.equal(new Set(data.careers.map(c=>c.distinction)).size,35);
 for(const t of data.tracks)assert.doesNotMatch(t.structure,/년차|개월/);
});

test('renamed occupations remain searchable by the exact former name and keep IDs',()=>{
 for(const [id,name] of [['D010','캐릭터 컨셉 아티스트'],['D011','배경 컨셉 아티스트'],['D028','전시·VMD 디자이너'],['D031','텍스타일 디자이너']]){
  const career=data.careers.find(c=>c.id===id);assert.ok(career.aliases.includes(name));
  assert.ok(searchCareers(data.careers,name).some(c=>c.id===id));
 }
});

test('game arts suggestions exclude explicit engineering only and never force a canonical university match',()=>{
 for(const id of ['D009','D010','D011','D012']){
  for(const name of ['AI게임공학과','AI게임소프트웨어학과_야간','게임 소프트웨어 전공','컴퓨터공학과 게임콘텐츠전공'])assert.equal(matchesCareer(name,id),false,`${id} ${name}`);
  for(const name of ['게임그래픽전공','게임아트디자인과','게임학부 게임그래픽디자인전공(미술계)','게임공학·게임디자인학부'])assert.equal(matchesCareer(name,id),true,`${id} ${name}`);
 }
 const g={universityName:'합성대',department:'게임그래픽',academicYear:2027,admissionType:'실기'};
 const u={id:'synthetic',name:'합성대',major:'게임그래픽',year:2027,admission:'실기'};
 assert.equal(matchUniversity(g,[u,{...u,id:'other'}]).mappingStatus,'review');
 assert.equal(matchesCareer('공간디자인학과','D028'),true);
 assert.equal(matchesCareer('게임공학과','D001'),false);
});

test('skill roadmap heading and anchors preserve deep links without a duration or automatic student placement',()=>{
 const html=fs.readFileSync('public/data-core/roadmap.html','utf8');
 assert.match(html,/<h2>실기향상 로드맵<\/h2>/);
 assert.match(html,/현재 실기에서 목표 전공까지, 필요한 성장을 순서대로 확인해요\./);
 for(const id of ['majorSection','universitySection','trendSection','curriculumSection','preparationSection'])assert.ok(html.includes(`id="${id}"`)&&html.includes(`href="#${id}"`));
 assert.doesNotMatch(html,/3년 준비 로드맵|꿈을 이루는 과정/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {INSTITUTIONS,institutionFor,scopePlan,excludedIds} from '../public/data-core/university-scope-model.js';
test('67 requested institutions keep aliases distinct and reject wrong campuses',()=>{
 assert.equal(INSTITUTIONS.length,67);assert.equal(new Set(INSTITUTIONS.map(i=>i.name)).size,67);
 for(const i of INSTITUTIONS)assert.equal(institutionFor({name:i.name,campus:i.campus})?.name,i.name);
 for(const [name,region,major,wanted] of [['건국대_글로컬','충북','미디어콘텐츠','건국대학교'],['건국대','서울','디자인',null],['경기대','서울','애니메이션','경기대학교'],['경기대_수원','경기','디자인',null],['명지대_용인','경기','디자인','명지대학교'],['상명대_천안','충남','만화','상명대학교'],['동국대_경주','경북','디자인','동국대학교'],['동국대','서울','디자인',null],['중앙대_다빈치','경기','디자인','중앙대학교'],['계명대','대구','영상애니메이션과','계명대학교'],['계명대','대구','게임공학과',null],['국립경국대','경북','애니','경국대학교'],['안동대','경북','애니','경국대학교'],['서강대','서울','인문',null],['서강대학교 미래교육원','서울','멀티미디어','서강대학교 미래교육원'],['SWA 서울웹툰아카데미','서울','웹툰','SWA 서울웹툰아카데미']])assert.equal(institutionFor({name,region,major})?.name||null,wanted,name);
});
test('scope is non-mutating, and recycled IDs or renamed records never inherit an old exclusion',()=>{
 const rows=[{id:1,name:'가천대'},{id:2,name:'청강문화산업대학교'}];const before=JSON.stringify(rows);const p=scopePlan(rows);assert.equal(p.keptCount,1);assert.deepEqual(p.excluded,[{id:'1',name:'가천대'}]);assert.equal(JSON.stringify(rows),before);assert.deepEqual(excludedIds(rows,p.excluded),['1']);assert.deepEqual(excludedIds([{id:1,name:'백석대'}],p.excluded),[]);
});

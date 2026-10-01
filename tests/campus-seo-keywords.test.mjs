import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {libraryHarness,users,A,B} from './support/library-harness.mjs';
import {defaultCampusKeywords,postHashtags,titlePrefix,withTitlePrefix,stripTitlePrefix,titleKeywords,seoGuide,cleanCampusKeywords,CAMPUS_REGIONS} from '../public/data-core/campus-seo-keywords.js';

test('부천 입시본원 default fixed keywords: region + 학원 keywords, then the given and recommended keywords',()=>{
  assert.deepEqual(defaultCampusKeywords('campus-anihi-admission','anihi'),
    ['부천만화학원','부천웹툰학원','부천애니학원','부평만화학원','계양만화학원','삼산동만화학원','산곡동만화학원','웹툰학원','만화학원','애니학원','만화입시','애니입시','웹툰입시','애니메이션입시','만화애니과']);
  assert.deepEqual(defaultCampusKeywords('campus-design-admission','hi5'),
    ['부천미술학원','부천입시미술학원','부평미술학원','계양미술학원','삼산동미술학원','산곡동미술학원','입시미술학원','기초디자인','기초소양','미대입시','예고입시','예중예고','입시미술','디자인입시','미술입시','발상과표현','소묘']);
  // Every campus has its confirmed regions, and every default list fits the post with room to spare.
  assert.deepEqual(CAMPUS_REGIONS['campus-wonjong'],['원종','부천']);assert.deepEqual(CAMPUS_REGIONS['campus-ulsan'],['울산','송정']);
  for(const campusId of Object.keys(CAMPUS_REGIONS))for(const brand of ['hi5','anihi'])assert.ok(defaultCampusKeywords(campusId,brand).length<=20,campusId+brand);
  assert.deepEqual(defaultCampusKeywords('campus-gwangjin','anihi').slice(0,3),['광진만화학원','광진웹툰학원','광진애니학원']);
});

test('blog title prefix: [대표 지역 키워드,다음 지역 키워드_브랜드], the second one moving on with each post',()=>{
  const tags=defaultCampusKeywords('campus-anihi-admission','anihi');
  assert.deepEqual(titleKeywords(tags,'anihi'),['부천만화학원','부평만화학원','계양만화학원','삼산동만화학원','산곡동만화학원']);
  assert.equal(titlePrefix(tags,'anihi',[]),'[부천만화학원,부평만화학원_ANiHi]');
  assert.equal(titlePrefix(tags,'anihi',['[부천만화학원,부평만화학원_ANiHi]원근법','[부천만화학원,산곡동만화학원_ANiHi]예전 글']),'[부천만화학원,계양만화학원_ANiHi]');
  assert.equal(titlePrefix(tags,'anihi',['접두어 없는 글','[부천만화학원,산곡동만화학원_ANiHi]가장 최근 접두어 글']),'[부천만화학원,부평만화학원_ANiHi]','wraps around after the last one');
  const hi5=defaultCampusKeywords('campus-design-admission','hi5');
  assert.equal(titlePrefix(hi5,'hi5',[]),'[부천미술학원,부평미술학원_Hi5]','입시미술학원 is not a region keyword');
  assert.equal(titlePrefix(defaultCampusKeywords('campus-gwangjin','anihi'),'anihi',[]),'[광진만화학원_ANiHi]');
  const title=withTitlePrefix('부천 입시본원 입시미술 상향 평준화 -원근법-','[부천만화학원,부평만화학원_ANiHi]');
  assert.equal(title,'[부천만화학원,부평만화학원_ANiHi]부천 입시본원 입시미술 상향 평준화 -원근법-');
  assert.equal(withTitlePrefix(title,'[부천만화학원,계양만화학원_ANiHi]'),'[부천만화학원,계양만화학원_ANiHi]부천 입시본원 입시미술 상향 평준화 -원근법-','never stacks two prefixes');
  assert.equal(stripTitlePrefix(title),'부천 입시본원 입시미술 상향 평준화 -원근법-');
  assert.equal(titlePrefix([],'anihi',[]),'');
});

test('post hashtags: 고정 키워드 → 직접 입력 → AI 내용 태그 5개, no duplicates, never over 30',()=>{
  const keywords=defaultCampusKeywords('campus-anihi-admission','anihi');
  const tags=postHashtags(keywords,'#원근법 #부천만화학원',['투시도','배경드로잉','원근법','부평만화학원','소실점','구도연습','한점투시','여섯번째']);
  assert.deepEqual(tags.slice(0,15),keywords);
  assert.deepEqual(tags.slice(15),['원근법','투시도','배경드로잉','소실점','구도연습','한점투시'],'5 new AI tags after the fixed ones; repeats collapse');
  const many=Array.from({length:28},(_,i)=>'태그'+i);
  assert.equal(postHashtags(many,'',['a','b','c','d','e']).length,30,'AI tags are the ones dropped at the 30-tag limit');
  assert.deepEqual(seoGuide('campus-anihi-admission',keywords),{regions:['부천','부평','계양','삼산동','산곡동'],keywords:['웹툰학원','만화학원','애니학원','만화입시','애니입시','웹툰입시','애니메이션입시','만화애니과']});
  assert.throws(()=>cleanCampusKeywords(''),/하나 이상/);
  assert.throws(()=>cleanCampusKeywords(Array.from({length:26},(_,i)=>'#k'+i).join(' ')),/25개/);
});

test('고정키워드 수정: only people of that campus and the admins can change it; the change is shared by blog and Instagram',async()=>{
  const h=await libraryHarness();
  try{
    const url='/api/data-core/content/campus-keywords';
    const get=(user=users.staff,campusId=A)=>h.request('GET',`${url}?campusId=${campusId}`,user);
    let r=await get();assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(r.body.keywords.anihi,defaultCampusKeywords(A,'anihi'));assert.equal(r.body.customized.anihi,false);
    const put=(body,user=users.staff)=>h.request('PUT',url,user,{campusId:A,brand:'anihi',...body});
    r=await put({tags:'#부천만화학원 #부천웹툰학원 #역곡만화학원',revision:0});assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(r.body.keywords.anihi,['부천만화학원','부천웹툰학원','역곡만화학원']);assert.equal(r.body.customized.anihi,true);
    assert.deepEqual(r.body.keywords.hi5,defaultCampusKeywords(A,'hi5'),'the other brand keeps its own list');
    // A teacher of the same campus sees it; a stale revision is refused instead of overwriting.
    assert.deepEqual((await get(users.teacher)).body.keywords.anihi,['부천만화학원','부천웹툰학원','역곡만화학원']);
    assert.equal((await put({tags:'#다른키워드',revision:0},users.teacher)).status,409);
    // Staff of another campus and people with no campus cannot read or change it.
    assert.equal((await get(users.foreign)).status,403);
    assert.equal((await put({tags:'#침범',revision:1},users.foreign)).status,403);
    assert.equal((await put({tags:'#침범',revision:1},users.outsider)).status,403);
    // The admin can change any campus; reset brings the default list back.
    r=await put({tags:'#광진만화학원',revision:0,campusId:B},users.admin);assert.equal(r.status,200,JSON.stringify(r.body));
    r=await put({tags:'#부천만화학원',revision:1},users.master);assert.equal(r.status,200,'MASTER: '+JSON.stringify(r.body));
    r=await put({reset:true,revision:2},users.admin);assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(r.body.keywords.anihi,defaultCampusKeywords(A,'anihi'));assert.equal(r.body.customized.anihi,false);
    for(const bad of [{brand:'other',tags:'#a'},{tags:''},{tags:'#'+'가'.repeat(41)}])assert.equal((await put({revision:3,...bad})).status,400,JSON.stringify(bad));
  }finally{await h.mf.dispose();}
});

test('the screen and the AI use the keywords: chips + [고정키워드 수정], title prefix, 5 AI tags, SEO placement rule',()=>{
  const presets=fs.readFileSync('public/data-core/content-text-presets.js','utf8');
  // No separate chip area: the keywords sit at the start of the 고정 해시태그 box, and the red
  // [자동 고정 키워드] row at the top of 해시태그 전체 보기 opens their editor.
  assert.doesNotMatch(presets,/insertBefore\(keywordBox/);
  assert.match(presets,/return kind==='hashtags'\?\[hashtagText\(keywordsFor\(\)\),String\(text\|\|''\)\.trim\(\)\]/);
  assert.match(presets,/kind==='hashtags'\?typedTags\(input\.value\):input\.value/);
  assert.match(presets,/if\(kind==='hashtags'&&!deleted&&\$\('draftCampus'\)\.value&&'자동 고정 키워드'\.includes\(search\.value\)&&!category\.value\)rows\.unshift\(keywordRow\(\)\)/);
  assert.match(fs.readFileSync('public/data-core/content-text-presets.css','utf8'),/\.campus-keywords-item > button:first-child \{ background:#fdecec;border-color:#e5484d/);
  assert.match(presets,/hashtags:hashtagText\(postHashtags\(keywords,pick\('hashtags'\)\)\)/);
  assert.match(presets,/hashtags:current\.userHashtags/,'[설정 저장] stores only the typed tags; the keywords live in their own record');
  const content=fs.readFileSync('public/data-core/content.js','utf8');
  assert.match(content,/\$\('draftTitle'\)\.value = blogTitle\(kind\);/);
  assert.match(content,/state\.blogTitlePrefix = titlePrefix\(/);
  assert.match(content,/state\.blogAiTags = generated\.hashtags \|\| \[\];/);
  const ig=fs.readFileSync('public/data-core/instagram-carousel.js','utf8');
  assert.match(ig,/const all=postHashtags\(fixed\.hashtags,\[\],aiTags\)/);
  const provider=fs.readFileSync('worker/content-openai-provider.ts','utf8');
  assert.match(provider,/hashtags는 이 글의 수업 내용·주제에 맞는 태그 5개만/);
  assert.match(provider,/도입부\(lead\)에 캠퍼스명과 검색 키워드 하나를 자연스럽게 한 번 넣고/);
  assert.match(provider,/blogInstructions\(input\.brandContext, strategyMode, input\.campusName, input\.recentTitles \|\| \[\], input\.seo\)/);
  assert.match(fs.readFileSync('worker/data-core-content-generation.ts','utf8'),/seo: sourceApp === 'blog' \? await blogSeo\(db, campusId, input\.keywordBrand, input\.keywordTags\) : null/);
});

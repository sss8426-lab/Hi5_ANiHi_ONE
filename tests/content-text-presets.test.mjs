import assert from 'node:assert/strict';
import test from 'node:test';
import {libraryHarness,users,A,B,ORG} from './support/library-harness.mjs';
import {TAG_CATALOG,CLOSING_CATALOG,recommendedPresets,REGIONS,normalizeTags,substitute} from '../public/data-core/content-preset-catalog.js';
import {assembleCaption,replaceManagedTail,captionTail} from '../public/data-core/content-caption.js';
const url='/api/data-core/content/text-presets';
const scope={campusId:A,sourceApp:'blog'};
const read=(h,user=users.admin,s=scope)=>h.request('GET',url+'?'+new URLSearchParams(s),user);
const write=(h,body,user=users.admin,s=scope)=>h.request('POST',url,user,{...s,...body});

test('complete catalog, deterministic regional brands and channel-specific text without guessed contacts',()=>{
 assert.equal(TAG_CATALOG.length,33);assert.equal(CLOSING_CATALOG.length,20);
 const clean=item=>{assert.doesNotMatch(item.content,/\{\{|undefined|\bnull\b|##/);assert.ok(item.content.trim());assert.equal(item.unavailable,'','recommended sets are always usable');};
 // One brand chosen in 캠퍼스 추천 설정: exactly that brand's tags, never the other brand's.
 for(const [brand,other] of [['hi5',/#애니하이|만화학원|웹툰학원/],['anihi',/#하이파이브/]]){
  const profile={brands:[brand],names:{[brand]:'합성 학원'},courses:[]};
  for(const [campusId,region]of Object.entries(REGIONS))for(const app of ['blog','instagram']){
   const items=recommendedPresets(campusId,app,profile);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
   for(const item of items){clean(item);
    if(item.kind==='hashtags'){assert.equal(normalizeTags(item.content).length,app==='blog'?8:5);
     if(!item.name.includes('부평'))assert.ok(item.content.includes(region));
     assert.doesNotMatch(item.content,other);
    }
   }
   if(![A,'campus-design-admission'].includes(campusId))assert.ok(items.every(i=>!i.name.includes('부평')));
  }
 }
 // Both brands: common sets carry both brands' tags; brand-specific sets only their own.
 const both=recommendedPresets(B,'instagram',{brands:['hi5','anihi'],names:{},courses:[]});both.forEach(clean);
 assert.equal(new Set(both.map(i=>i.id)).size,both.length);
 const dream=both.find(i=>i.name==='꿈·진로'&&i.kind==='hashtags');assert.match(dream.content,/#하이파이브미술학원/);assert.match(dream.content,/#애니하이만화학원/);
 assert.doesNotMatch(both.find(i=>i.name==='기초디자인').content,/#애니하이/);
 // No brand chosen yet (most campuses' starting state): still every set usable — brand tags are simply
 // left out, never guessed, and an academy name falls back to "저희 학원".
 const unconfirmed=recommendedPresets(B,'blog');unconfirmed.forEach(clean);
 assert.ok(unconfirmed.every(i=>!/#하이파이브|#애니하이/.test(i.content)));
 assert.ok(unconfirmed.some(i=>i.name==='기초디자인')&&unconfirmed.some(i=>i.name==='꿈·진로'&&i.kind==='hashtags'));
 assert.match(unconfirmed.find(i=>i.name==='기본 상담'&&i.kind==='closing').content,/^저희 학원은 /u);
 // Course settings never block a set anymore.
 assert.equal(recommendedPresets(A,'blog',{brands:['anihi'],names:{},courses:[]}).find(i=>i.name==='게임·일러스트').unavailable,'');
 assert.equal(substitute('{{학원명}} {{unknown}}',{'학원명':'이름'}).content,'');
 assert.equal(substitute('{{toString}}',{}).content,'');
 assert.throws(()=>captionTail('{{학원명}}','#태그'));
 assert.deepEqual(normalizeTags('##가 #가 ＃나','다, #라'),['가','나','다','라']);
 const body='문장 안내를 보존합니다.\n\n안내 이후 정상 본문';
 assert.ok(assembleCaption(body,'안내','#가').startsWith(body));
 assert.equal(assembleCaption('본문\n\n안내','안내','#가'),'본문\n\n안내\n\n#가');
 assert.equal(replaceManagedTail('직접 고친 본문\n\n안내\n\n#가','안내\n\n#가','새 문구\n\n#나'),'직접 고친 본문\n\n새 문구\n\n#나');
 assert.throws(()=>replaceManagedTail('본문 변경','이전 꼬리','새 꼬리'));
 assert.throws(()=>captionTail('',Array.from({length:31},(_,i)=>'#t'+i).join(' ')));
});

test('catalog version changes preserve custom overrides and tombstones; contact snapshots never rewrite drafts',async()=>{
 const h=await libraryHarness();try{
  let r=await read(h);const original=r.body.presets.find(i=>i.name==='학원 소개'&&i.kind==='closing');
  r=await write(h,{action:'update',presetId:original.id,revision:0,name:'직접 수정한 추천',content:'사용자가 확정한 값'});assert.equal(r.status,200);
  let item=r.body.presets.find(i=>i.id===original.id);assert.equal(item.content,'사용자가 확정한 값');
  r=await write(h,{action:'delete',presetId:item.id,revision:item.revision});assert.equal(r.status,200);
  const id=`text-presets:${ORG}:blog:${A}`,row=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(id).first(),data=JSON.parse(row.metadata_json);
  data.items[item.id].catalogVersion='old-catalog-version';await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify(data),id).run();
  r=await read(h);item=r.body.presets.find(i=>i.id===item.id);assert.ok(item.deletedAt);assert.equal(item.name,'직접 수정한 추천');assert.equal(item.content,'사용자가 확정한 값');
  const profile={...r.body.profile,phone:'SYNTHETIC-PHONE',address:'SYNTHETIC-ADDRESS',link:'https://example.test/consult'};
  r=await write(h,{action:'profile',revision:r.body.revision,profile});assert.equal(r.body.contactBlock,'전화: SYNTHETIC-PHONE\n주소: SYNTHETIC-ADDRESS\nhttps://example.test/consult');
  const draft=await h.request('POST','/api/data-core/content',users.admin,{...scope,title:'합성 게시물',content:'본문',metadata:{footer:'확정 문구',contactBlock:r.body.contactBlock},tags:['확정']});assert.equal(draft.status,201);
  await write(h,{action:'profile',revision:r.body.revision,profile:{...profile,phone:'SYNTHETIC-CHANGED'}});
  const saved=await h.request('GET','/api/data-core/content/'+draft.body.draft.id);assert.equal(saved.body.draft.metadata.contactBlock,r.body.contactBlock);assert.equal(saved.body.draft.metadata.footer,'확정 문구');
  assert.equal((await read(h,users.admin,{campusId:'campus-design-admission',sourceApp:'blog'})).body.presets.some(i=>i.content==='사용자가 확정한 값'),false);
  const igScope={...scope,sourceApp:'instagram'},ig=await read(h,users.admin,igScope);
  const igUpdate=await write(h,{action:'profile',revision:ig.body.revision,profile},users.admin,igScope);assert.equal(igUpdate.body.contactBlock,'전화: SYNTHETIC-PHONE');
 }finally{await h.mf.dispose();}
});

test('persistent preset CRUD, isolation, revision conflict, favorites and defaults preservation',async()=>{
 const h=await libraryHarness();try{
  const before=await h.env.DB.prepare("SELECT count(*) n FROM data_records WHERE record_type='content-text-presets'").first();
  let r=await read(h);assert.equal(r.status,200);const built=r.body.presets.find(i=>i.name==='학생 작품'&&i.kind==='hashtags');
  assert.equal((await h.env.DB.prepare("SELECT count(*) n FROM data_records WHERE record_type='content-text-presets'").first()).n,before.n);
  const create={action:'create',kind:'closing',name:'합성 문구',content:'원본 내용',requestId:crypto.randomUUID()};
  r=await write(h,create,users.staff);assert.equal(r.status,200,JSON.stringify(r.body));let item=r.body.presets.find(i=>i.name===create.name);
  assert.equal((await write(h,create,users.staff)).body.presets.filter(i=>i.name===create.name).length,1);
  assert.equal((await write(h,{...create,requestId:crypto.randomUUID()},users.staff)).status,409);
  for(const patch of [{name:''},{content:''},{content:'{{전화번호}}'}])assert.equal((await write(h,{...create,...patch,requestId:crypto.randomUUID()},users.staff)).status,400);
  assert.equal((await write(h,{action:'update',presetId:item.id,revision:item.revision,name:'합성 수정',content:'수정 내용'},users.teacher)).status,404);
  const updated=await write(h,{action:'update',presetId:item.id,revision:item.revision,name:'합성 수정',content:'수정 내용',favorite:true},users.staff);assert.equal(updated.status,200);assert.equal(updated.body.presets.find(i=>i.id===item.id).favorite,true);
  assert.equal((await write(h,{action:'delete',presetId:item.id,revision:item.revision},users.staff)).status,409);
  item=updated.body.presets.find(i=>i.id===item.id);
  r=await write(h,{action:'delete',presetId:item.id,revision:item.revision},users.staff);assert.ok(r.body.presets.find(i=>i.id===item.id).deletedAt);
  r=await read(h,users.staff);item=r.body.presets.find(i=>i.id===item.id);assert.ok(item.deletedAt);
  assert.equal((await write(h,{action:'restore',presetId:item.id,revision:item.revision},users.staff)).body.presets.find(i=>i.id===item.id).deletedAt,null);
  assert.equal((await write(h,{action:'delete',presetId:built.id,revision:0},users.staff)).status,403);
  r=await write(h,{action:'favorite',presetId:built.id,revision:0,favorite:true},users.staff);assert.equal(r.body.presets.find(i=>i.id===built.id).favorite,true);
  assert.equal((await read(h,users.teacher)).body.presets.find(i=>i.id===built.id).favorite,false);
  r=await write(h,{action:'delete',presetId:built.id,revision:0},users.campusAdmin);assert.equal(r.status,200);
  for(let i=0;i<3;i++)assert.ok((await read(h)).body.presets.find(i=>i.id===built.id).deletedAt);
  assert.equal((await read(h,users.admin,{...scope,sourceApp:'instagram'})).body.presets.find(i=>i.id===built.id).deletedAt,null);
  assert.equal((await read(h,users.foreign)).status,403);assert.equal((await read(h,null)).status,401);
  assert.equal((await read(h,users.outsider)).status,403);
  assert.equal((await h.request('POST',url,users.admin,{...scope,...create},'https://evil.invalid')).status,403);
  await h.request('PUT','/api/data-core/content/defaults',users.staff,{...scope,hashtags:'#이전',footer:'기존 기본값'});
  await h.env.DB.prepare("UPDATE data_records SET metadata_json=json_set(metadata_json,'$.legacyPresets',json(?)) WHERE id=?").bind('[{"name":"기존 사용자 저장","content":"보존"}]',`content-defaults:blog:${A}`).run();
  await h.request('PUT','/api/data-core/content/defaults',users.staff,{...scope,hashtags:'#다음',footer:'변경 기본값'});
  const defaults=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(`content-defaults:blog:${A}`).first();assert.equal(JSON.parse(defaults.metadata_json).legacyPresets[0].content,'보존');
  assert.ok((await read(h)).body.presets.find(i=>i.id===built.id).deletedAt);
  const recordId=`text-presets:${ORG}:blog:${A}`;
  for(const method of ['PATCH','DELETE'])assert.equal((await h.request(method,'/api/data-core/records/'+encodeURIComponent(recordId),users.admin,method==='PATCH'?{metadata:{}}:undefined)).status,403);
  assert.equal((await h.request('POST','/api/data-core/records',users.admin,{recordType:'content-text-presets',title:'forged',campusId:A})).status,403);
  assert.equal((await h.request('GET','/api/data-core/records/'+encodeURIComponent(recordId),users.admin)).status,403);
  assert.equal((await h.env.FAMILY_DB.prepare('SELECT value FROM library_sentinel').first()).value,'preserved');
 }finally{await h.mf.dispose();}
});

test('concurrent same-name saves and approved profile/contact isolation',async()=>{
 const h=await libraryHarness();try{
  let r=await read(h);const profile={brands:['hi5','anihi'],names:{hi5:'합성 디자인',anihi:'합성 만화'},courses:['portfolio'],phone:'',address:'',link:''};
  assert.equal((await write(h,{action:'profile',revision:r.body.revision,profile},users.staff)).status,403);
  r=await write(h,{action:'profile',revision:r.body.revision,profile});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.contactBlock,'');
  const create={action:'create',kind:'hashtags',name:'동시 저장',content:'#합성',brandScope:'hi5'};
  const results=await Promise.all([1,2].map(()=>write(h,{...create,requestId:crypto.randomUUID()})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  r=await read(h);assert.equal(r.body.presets.filter(i=>i.name==='동시 저장').length,1);
  assert.equal((await read(h,users.admin,{...scope,sourceApp:'instagram'})).body.profile.brands.length,1);
  assert.equal((await write(h,{action:'profile',revision:r.body.revision,profile:{...profile,link:'javascript:alert(1)'}})).status,400);
  // Choosing just the brand (no academy name) is enough; sets stay usable and the name reads "저희 학원".
  r=await read(h);const brandOnly=await write(h,{action:'profile',revision:r.body.revision,profile:{brands:['hi5'],names:{},courses:[],phone:'',address:'',link:''}});
  assert.equal(brandOnly.status,200,JSON.stringify(brandOnly.body));
  assert.ok(brandOnly.body.presets.filter(i=>i.builtInKey).every(i=>!i.unavailable));
  assert.match(brandOnly.body.presets.find(i=>i.name==='꿈·진로'&&i.kind==='hashtags').content,/#하이파이브미술학원/);
 }finally{await h.mf.dispose();}
});

test('a 양식(template) save never touches the saved fixed 해시태그 / 마지막 문구',async()=>{
 const h=await libraryHarness();try{
  for(const sourceApp of ['instagram','blog']){
   const s={campusId:A,sourceApp};
   assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.admin,{...s,hashtags:'#고정태그',footer:'고정 문구'})).status,200);
   const settings=sourceApp==='instagram'?{instagramSettings:{logoType:'hi5',mode:'original'}}:{blogSettings:{strategyMode:'balanced',template:{templateId:'class',greeting:''}}};
   const saved=await h.request('PUT','/api/data-core/content/defaults',users.admin,{...s,...settings});
   assert.equal(saved.status,200,JSON.stringify(saved.body));
   assert.equal(saved.body.defaults.hashtags,'#고정태그');assert.equal(saved.body.defaults.footer,'고정 문구');
   assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.admin,s)).status,400,'an empty save is rejected, not stored as blanks');
  }
 }finally{await h.mf.dispose();}
});

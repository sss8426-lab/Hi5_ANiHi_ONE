import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {encode} from 'fast-png';
import {libraryHarness,users,A} from './support/library-harness.mjs';
import {assemblePost,managedTail,managedHead,replaceManaged,contactLines} from '../public/data-core/content-caption.js';
import {assembleBlocks,placeManaged,postText,exportHtml} from '../public/data-core/blog-post-model.js';

// Nine distinct values, one per output slot.
const V={greeting:'G-인사말\n둘째 줄',body:'B-메인글 첫 문단\n\nB-메인글 둘째 문단',trialLink:'https://trial.example.test/a',homeLink:'https://home.example.test/',instaLink:'https://insta.example.test/hi',phone:'032-000-0001',address:'A-합성 주소 1',closing:'C-마지막 문구\n두 줄',hashtags:'#태그하나 #태그둘 #태그하나'};
const contact={trialLink:V.trialLink,homeLink:V.homeLink,instaLink:V.instaLink,phone:V.phone,address:V.address};
const EXPECTED=['G-인사말','B-메인글 첫 문단','B-메인글 둘째 문단','체험수업: '+V.trialLink,'홈페이지: '+V.homeLink,'인스타그램: '+V.instaLink,'상담전화: '+V.phone,'주소: '+V.address,'C-마지막 문구','#태그하나 #태그둘'];
const inOrder=text=>{let at=-1;for(const part of EXPECTED){const i=text.indexOf(part);assert.ok(i>at,`${part} must come after the previous part in:\n${text}`);at=i;}};

test('one fixed output order: 인사말 → 메인글 → 체험수업 → 홈페이지 → 인스타 → 상담전화 → 주소 → 마지막 문구 → 해시태그',()=>{
  const text=assemblePost({greeting:V.greeting,body:V.body,contact,closing:V.closing,hashtags:V.hashtags});
  inOrder(text);
  assert.ok(text.startsWith(V.greeting),'인사말 is the first block, line breaks kept');
  assert.ok(text.endsWith('#태그하나 #태그둘'),'hashtags are always the very last line, deduplicated in the user order');
  assert.equal(contactLines(contact),`체험수업: ${V.trialLink}\n홈페이지: ${V.homeLink}\n인스타그램: ${V.instaLink}\n상담전화: ${V.phone}\n주소: ${V.address}`);
  // Empty parts are left out; nothing like "undefined", "미설정" or an empty link label appears.
  const sparse=assemblePost({body:'본문',contact:{homeLink:V.homeLink,address:V.address},closing:'',hashtags:'#끝'});
  assert.equal(sparse,`본문\n\n홈페이지: ${V.homeLink}\n주소: ${V.address}\n\n#끝`);
  assert.doesNotMatch(sparse,/undefined|미설정|체험수업:|인스타그램:|상담전화:/);
  // Re-assembling an already assembled text (or pasting it as the body) never stacks the fixed parts.
  const again=assemblePost({greeting:V.greeting,body:text.slice(0,text.indexOf('\n\n체험수업'))+'\n\n'+V.closing,contact,closing:V.closing,hashtags:V.hashtags});
  assert.equal(again,text);
  const head=managedHead(V.greeting),tail=managedTail({contact,closing:V.closing,hashtags:V.hashtags});
  assert.equal(replaceManaged(text,{previousHead:head,previousTail:tail,head,tail}),text,'re-applying the same settings changes nothing');
  const swapped=replaceManaged(text,{previousHead:head,previousTail:tail,head:'새 인사말',tail:managedTail({contact:{phone:'010-9999-0000'},closing:'새 문구',hashtags:'#새'})});
  assert.equal(swapped,'새 인사말\n\nB-메인글 첫 문단\n\nB-메인글 둘째 문단\n\n상담전화: 010-9999-0000\n\n새 문구\n\n#새','only the managed start and end change; the main text is kept');
  assert.throws(()=>assemblePost({body:'x',closing:'{{학원명}}'}),/치환값/);
});

test('blog blocks, copy text and HTML export follow the same order, whatever order the blocks were moved into',()=>{
  const photos=[{fileId:'p1',use:true,description:'사진 설명'}];
  const blocks=assembleBlocks({body:V.body,photos,greeting:V.greeting,footer:V.closing,contact:contactLines(contact),tags:['태그하나','태그둘']},(()=>{let n=0;return()=>'b'+(++n);})());
  const types=blocks.map(b=>b.type);
  assert.equal(types[0],'greeting');assert.deepEqual(types.slice(-3),['contact','closing','hashtags']);
  inOrder(postText({title:'제목',blocks}));
  // A user moved hashtags up and contact below closing: placement by role puts them back, ids kept.
  const shuffled=[blocks.at(-1),...blocks.slice(0,-3),blocks.at(-2),blocks.at(-3)];
  const fixed=placeManaged(shuffled);
  assert.deepEqual(fixed.map(b=>b.type),types);assert.deepEqual(fixed.map(b=>b.id),blocks.map(b=>b.id));
  const html=exportHtml({title:'제목',blocks:fixed,template:{}},new Map());
  const plain=html.replace(/<[^>]+>/g,'\n').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  inOrder(plain);
  // Settings changed after writing: only the managed blocks change, the main text blocks stay the same objects' text.
  const updated=placeManaged(fixed,{greeting:'',contact:'상담전화: 010',closing:'끝 문구',hashtags:'#새'});
  assert.ok(!updated.some(b=>b.type==='greeting'),'an emptied 인사말 disappears instead of leaving a blank block');
  assert.deepEqual(updated.slice(-3).map(b=>b.text),['상담전화: 010','끝 문구','#새']);
  assert.deepEqual(updated.filter(b=>['lead','paragraph'].includes(b.type)).map(b=>b.text),fixed.filter(b=>['lead','paragraph'].includes(b.type)).map(b=>b.text));
});

test('문구 설정 (brand per area, texts per brand, contact and links) saves per campus + channel and validates links',async()=>{
  const h=await libraryHarness();
  try{
    const url='/api/data-core/content/defaults';
    const settings={brands:{greeting:'hi5',hashtags:'anihi',closing:'hi5'},
      values:{greeting:{hi5:'Hi5 인사말\n줄바꿈',anihi:'ANiHi 인사말'},hashtags:{hi5:'#하이',anihi:'#애니'},closing:{hi5:'Hi5 마무리',anihi:''}},
      contact:{phone:'032-000-0000',address:'합성 주소',trialLink:'https://trial.example.test',homeLink:'',instaLink:'https://instagram.com/x'}};
    const save=(body,user=users.staff)=>h.request('PUT',url,user,{sourceApp:'blog',campusId:A,hashtags:'#애니',footer:'Hi5 마무리',textSettings:settings,...body});
    const saved=await save({});assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.deepEqual(saved.body.defaults.textSettings.values,settings.values);assert.deepEqual(saved.body.defaults.textSettings.brands,settings.brands);
    assert.equal(saved.body.defaults.textSettings.contact.instaLink,'https://instagram.com/x');
    // Reopen: the same values come back.
    const again=await h.request('GET',`${url}?sourceApp=blog&campusId=${A}`,users.staff);assert.deepEqual(again.body.defaults.textSettings.values,settings.values);
    // Other channel / other campus never see it.
    assert.equal((await h.request('GET',`${url}?sourceApp=instagram&campusId=${A}`,users.staff)).body.defaults.textSettings,undefined);
    assert.equal((await h.request('GET',`${url}?sourceApp=blog&campusId=campus-design-admission`,users.admin)).body.defaults.textSettings,undefined);
    // Links are only https; a brand must be one of the two; placeholders are refused; nothing half-saved.
    for(const bad of [{contact:{...settings.contact,homeLink:'http://plain.example.test'}},{contact:{...settings.contact,trialLink:'javascript:alert(1)'}},{brands:{...settings.brands,greeting:'other'}},{values:{...settings.values,closing:{hi5:'{{학원명}}',anihi:''}}}])
      assert.equal((await save({textSettings:{...settings,...bad}})).status,400,JSON.stringify(bad));
    assert.deepEqual((await h.request('GET',`${url}?sourceApp=blog&campusId=${A}`,users.staff)).body.defaults.textSettings.contact,settings.contact);
    // Two brands × three long Korean texts fit (past the old 16KB body limit).
    const long='가'.repeat(2900),tags=Array.from({length:30},(_,i)=>'#태그'+i).join(' ');
    const big=await save({hashtags:tags,footer:long,textSettings:{...settings,values:{greeting:{hi5:long,anihi:long},hashtags:{hi5:tags,anihi:tags},closing:{hi5:long,anihi:long}}}});
    assert.equal(big.status,200,JSON.stringify(big.body));
    assert.equal((await h.request('PUT',url,users.foreign,{sourceApp:'blog',campusId:A,textSettings:settings})).status,403);
  }finally{await h.mf.dispose();}
});

test('인사말 sets work like hashtag/closing sets, always tied to a brand; older brand-less sets are kept',async()=>{
  const h=await libraryHarness();
  try{
    const url='/api/data-core/content/text-presets',s={campusId:A,sourceApp:'instagram'};
    const write=body=>h.request('POST',url,users.staff,{...s,...body});
    assert.equal((await write({action:'create',kind:'greeting',name:'봄 인사',content:'안녕하세요',requestId:crypto.randomUUID()})).status,400,'a new set needs its area brand');
    let r=await write({action:'create',kind:'greeting',name:'봄 인사',content:'안녕하세요,\n봄입니다.',brandScope:'hi5',requestId:crypto.randomUUID()});
    assert.equal(r.status,200,JSON.stringify(r.body));
    let item=r.body.presets.find(i=>i.kind==='greeting'&&i.name==='봄 인사');assert.equal(item.brandScope,'hi5');assert.equal(item.content,'안녕하세요,\n봄입니다.');
    // The same name may exist once per brand.
    assert.equal((await write({action:'create',kind:'greeting',name:'봄 인사',content:'애니 인사',brandScope:'anihi',requestId:crypto.randomUUID()})).status,200);
    r=await write({action:'update',presetId:item.id,revision:item.revision,name:'봄 인사 수정',content:'수정한 인사'});item=r.body.presets.find(i=>i.id===item.id);
    assert.equal(item.content,'수정한 인사');assert.equal(item.brandScope,'hi5','editing keeps the brand');
    r=await write({action:'delete',presetId:item.id,revision:item.revision});item=r.body.presets.find(i=>i.id===item.id);assert.ok(item.deletedAt);
    r=await write({action:'restore',presetId:item.id,revision:item.revision});assert.equal(r.body.presets.find(i=>i.id===item.id).deletedAt,null);
    // Recommended sets carry a brand, and a user edit stored before sets were per-brand keeps the catalog brand.
    assert.ok(r.body.presets.filter(i=>i.builtInKey).every(i=>['hi5','anihi'].includes(i.brandScope)));
    const id=`text-presets:org-hi5-anihi:instagram:${A}`,row=await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(id).first(),data=JSON.parse(row.metadata_json);
    data.items['user:legacy:1']={id:'user:legacy:1',kind:'closing',name:'예전 문구',content:'브랜드 없던 시절',brandScope:'common',ownerUserId:null,revision:1,deletedAt:null,builtInKey:null};
    await h.env.DB.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify(data),id).run();
    const legacy=(await h.request('GET',url+'?'+new URLSearchParams(s),users.staff)).body.presets.find(i=>i.id==='user:legacy:1');
    assert.equal(legacy.content,'브랜드 없던 시절');assert.equal(legacy.brandScope,'common','shown under both brands on screen, content untouched');
  }finally{await h.mf.dispose();}
});

test('Instagram caption keeps its app-managed 인사말 (head) and tail so settings can be re-applied later',async()=>{
  const h=await libraryHarness();
  try{
    const png=(w,hh)=>encode({width:w,height:hh,channels:4,depth:8,data:new Uint8Array(w*hh*4).fill(180)});
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC head',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC.png',mime:'image/png',bytes:png(40,50)})).body.file;
    const draft=(await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'S',relatedFileIds:[file.id],metadata:{instagramDesign:{workflow:'carousel-v2',logoType:'none',materialKind:'student-artwork',usePermission:'allowed'}}})).body.draft;
    const fingerprint=(await h.request('GET',`/api/data-core/content/instagram/${draft.id}/review`,users.staff)).body.fingerprint;
    const form=new FormData();form.set('file',new Blob([png(2160,2700)],{type:'image/png'}),'m.png');form.set('fingerprint',fingerprint);
    const render=(await h.request('POST',`/api/data-core/content/instagram/${draft.id}/render`,users.staff,form)).body;
    const set=(await h.request('POST','/api/data-core/content/instagram-sets',users.staff,{requestId:crypto.randomUUID(),items:[{draftId:draft.id,renderId:render.renderId,fingerprint:render.fingerprint}]})).body;
    const resource='/api/data-core/content/instagram-sets/'+encodeURIComponent(set.id);
    const head='G 인사말',tail='상담전화: 032\n\n마무리\n\n#태그',caption=`${head}\n\n본문\n\n${tail}`;
    assert.equal((await h.request('PATCH',resource,users.staff,{caption,managedHead:head,managedTail:tail})).status,200);
    let got=(await h.request('GET',resource,users.staff)).body;assert.equal(got.managedHead,head);assert.equal(got.managedTail,tail);
    // A head that is no longer at the start is not kept as a boundary.
    await h.request('PATCH',resource,users.staff,{caption:'직접 바꾼 첫 줄\n\n본문\n\n'+tail,managedHead:head,managedTail:tail});
    got=(await h.request('GET',resource,users.staff)).body;assert.equal(got.managedHead,null);assert.equal(got.managedTail,tail);
  }finally{await h.mf.dispose();}
});

test('every element the content screens look up by id still exists after the layout change',()=>{
  // Regression (found in the browser): the Instagram module still labeled the old fixed-text fields and
  // stopped mounting ("자동화 작업실을 시작하지 못했습니다").
  const files=['content.js','blog-workflow.js','instagram-carousel.js','content-text-presets.js','blog-cover.js'].map(name=>fs.readFileSync('public/data-core/'+name,'utf8'));
  const defined=new Set();
  for(const source of [fs.readFileSync('public/data-core/content.html','utf8'),...files])for(const m of source.matchAll(/id="([A-Za-z][\w-]*)"|(?:command|btnHtml)\('(\w+)'/g))defined.add(m[1]||m[2]);
  const presets=files[3];for(const m of presets.matchAll(/'((?:default|setting)[A-Z]\w+)'/g))defined.add(m[1]);
  for(const m of presets.matchAll(/id:'(\w+)'/g))defined.add(m[1]);defined.add('saveDefaults');
  const missing=[];
  files.forEach((source,i)=>{for(const m of source.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g))if(!defined.has(m[1]))missing.push(`${['content.js','blog-workflow.js','instagram-carousel.js','content-text-presets.js','blog-cover.js'][i]}: ${m[1]}`);});
  assert.deepEqual([...new Set(missing)],[]);
  assert.doesNotMatch(files[2],/\$\('default(?:Hashtags|Footer)'\)\.closest\(/);
});

test('main screens show exactly the attached layout: no 양식/마무리 summary rows, brand dropdown or 추천 설정 panel',()=>{
  const html=fs.readFileSync('public/data-core/content.html','utf8'),blog=fs.readFileSync('public/data-core/blog-workflow.js','utf8');
  const ig=fs.readFileSync('public/data-core/instagram-carousel.js','utf8'),presets=fs.readFileSync('public/data-core/content-text-presets.js','utf8');
  // 요청 → 핵심 메시지·독자 → 문구 설정(3열 + 연락처 + 링크 + 설정 저장) → 사진 처리 안내 → 실행.
  const order=['id="aiCommand"','id="blogMessage"','id="blogReader"','id="textSettingsMount"','id="aiPrivacy"','id="generateAi"'].map(key=>html.indexOf(key));
  assert.ok(order.every((at,i)=>at>0&&(i===0||at>order[i-1])),String(order));
  assert.doesNotMatch(html,/defaults-grid|기본 문구 저장/);
  for(const source of [blog,ig])assert.doesNotMatch(source,/양식 수정'|마무리 수정'|blogOpenTemplate|igOpenTemplate|igOpenPresets|blogOpenPresets/);
  assert.doesNotMatch(blog,/<summary>추가 요청<\/summary>/);
  assert.doesNotMatch(presets,/캠퍼스 추천 설정|현재 결과에 적용|게시물 브랜드|editProfile/);
  for(const label of ["'인사말'","'고정 해시태그'","'고정 마지막 문구'","'Hi5'","'ANiHi'","'+ 새 저장'","'전체 보기'","'삭제한 세트'","'상담전화'","'주소'","'체험수업 링크 (https)'","'홈페이지 링크 (https)'","'인스타 링크 (https)'","'설정 저장'"])assert.ok(presets.includes(label),label);
  // Instagram: 로고 선택 → 나만의 로고 선택 [로고 올리기] → 제작 방식 → 이미지 만들기.
  const igOrder=['<h3>로고 선택</h3>','<h3>나만의 로고 선택</h3>','>로고 올리기</button>','id="igMode"','id="igGenerate"'].map(key=>ig.indexOf(key));
  assert.ok(igOrder.every((at,i)=>at>0&&(i===0||at>igOrder[i-1])),String(igOrder));
  // Switching a brand or loading a set never calls the AI; only the per-area value changes.
  assert.doesNotMatch(presets,/\/generate|image-edit/);
  assert.match(presets,/settings\.brands\[kind\]=brand;touched\.add\('brands\.'\+kind\);chosen\[kind\]=null;edited\(\);show\(kind\);/);
});

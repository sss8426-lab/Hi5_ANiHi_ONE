import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {libraryHarness,A,B,users} from './support/library-harness.mjs';
import {assembleBlocks,postText,exportHtml,placeTeacherComment,editedSentences,sentencesOf} from '../public/data-core/blog-post-model.js';

const ids=()=>{let n=0;return()=>'b'+(++n);};

test('plain copy for Naver: numbered photo places and dividers, no formatting',()=>{
  const photos=[{fileId:'p1',use:true,description:'첫 사진'},{fileId:'p2',use:true,description:''}];
  const blocks=assembleBlocks({body:'도입 문단입니다.\n\n## 소제목\n\n둘째 문단입니다.',photos,tags:['태그']},ids());
  blocks.splice(blocks.length-1,0,{id:'d',type:'divider',text:''});
  const text=postText({title:'제목',blocks});
  assert.match(text,/^제목\n\n도입 문단입니다\.\n\n소제목\n\n\[사진 1\]\n\n첫 사진\n\n둘째 문단입니다\.\n\n\[사진 2\]\n\n· · ·\n\n#태그$/);
  assert.doesNotMatch(text,/<|style|font/);
  const html=exportHtml({title:'제목',template:{},blocks:[{id:'q',type:'quote',text:'<b>인용</b>'},{id:'d',type:'divider',text:''}]});
  assert.match(html,/<blockquote>&lt;b&gt;인용&lt;\/b&gt;<\/blockquote><hr>/);
});

test('강사 코멘트 becomes one quote after the second written block, keeps photo+caption together, and goes away when emptied',()=>{
  const photos=[{fileId:'p1',use:true,description:'사진 설명'}];
  const blocks=assembleBlocks({body:'도입.\n\n첫 문단.\n\n둘째 문단.',photos,contact:'상담전화: 032',tags:['a']},ids());
  const placed=placeTeacherComment(blocks,'칸을 먼저 나누면 쉬워집니다.',()=>'teacher');
  const types=placed.map(b=>b.type);
  assert.deepEqual(types,['lead','paragraph','image','caption','quote','paragraph','contact','hashtags']);
  const quote=placed.find(b=>b.type==='quote');
  assert.equal(quote.text,'“칸을 먼저 나누면 쉬워집니다.”');assert.equal(quote.role,'teacher');
  const again=placeTeacherComment(placed,'"이미 따옴표"',()=>'new');
  assert.equal(again.filter(b=>b.type==='quote').length,1,'never stacks');
  assert.equal(again.find(b=>b.type==='quote').id,'teacher','keeps the block id');
  assert.equal(again.find(b=>b.type==='quote').text,'"이미 따옴표"');
  assert.deepEqual(placeTeacherComment(placed,'  ').map(b=>b.type),blocks.map(b=>b.type));
  // A user's own quote is not touched.
  const own=[...blocks.slice(0,2),{id:'mine',type:'quote',text:'내 인용'},...blocks.slice(2)];
  assert.ok(placeTeacherComment(own,'').some(b=>b.id==='mine'));
  assert.deepEqual(placeTeacherComment([],'x',()=>'t').map(b=>b.type),['quote']);
});

test('직접 고친 문장 counts written sentences that differ from what the AI wrote',()=>{
  const blocks=[{type:'lead',text:'원근법은 배경의 기본입니다. 이번 주에는 소실점을 잡았어요.'},{type:'caption',text:'사진 설명은 세지 않습니다.'}];
  const ai=blocks.filter(b=>b.type==='lead').flatMap(b=>sentencesOf(b.text));
  assert.equal(ai.length,2);assert.equal(editedSentences(blocks,ai),0);
  blocks[0].text='원근법은 배경의 기본입니다. 학생들이 복도 사진에서 소실점을 직접 찾았어요.';
  blocks.push({type:'paragraph',text:'새로 쓴 문장이 하나 더 있습니다.'});
  assert.equal(editedSentences(blocks,ai),2);
});

test('blog stats and overlap: campus scoped, numbers only, never another campus text',async()=>{
  const h=await libraryHarness();
  try{
    const save=async(user,campusId,title,body,{date,views,kind}={})=>{
      const post={schemaVersion:1,revision:0,title,privacyConfirmed:true,photos:[],blocks:assembleBlocks({body,photos:[]}),brief:{exclude:''},strategyMode:'balanced',
        generation:{selectedTitleKind:kind||null},template:{templateId:'class'},publication:date?{url:'',date,views,homefeedViews:null,asOf:date,source:'네이버 통계'}:{}};
      const r=await h.request('POST','/api/data-core/content/blog/save',user,{requestId:randomUUID(),campusId,publishStatus:'draft',post});
      assert.equal(r.status,200,JSON.stringify(r.body));return r.body.draft.id;
    };
    const shared='학생들은 한 점 투시로 복도를 그리며 소실점을 직접 찾아보는 연습을 했습니다. 처음에는 선이 자꾸 어긋났지만 금방 익숙해졌습니다.';
    await save(users.staff,A,'목록형 글','가 캠퍼스 본문 '+shared,{date:'2026-09-28',views:900,kind:'list'});
    await save(users.staff,A,'목록형 둘째','다른 내용의 글입니다. 칸만화 장면을 나누는 연습을 했어요.',{date:'2026-09-29',views:700,kind:'list'});
    await save(users.staff,A,'검색형 글','검색형 본문입니다. 겨울 특강 안내를 정리했습니다.',{date:'2026-09-30',views:200,kind:'search'});
    await save(users.staff,A,'측정 전 글','아직 조회수를 넣지 않은 글입니다.');
    const foreignId=await save(users.foreign,B,'다른 캠퍼스 비밀 제목','나 캠퍼스 본문 '+shared,{date:'2026-09-30',views:5000,kind:'curious'});

    const stats=await h.request('GET',`/api/data-core/content/blog/stats?campusId=${A}`,users.staff);
    assert.equal(stats.status,200,JSON.stringify(stats.body));
    assert.deepEqual([...stats.body.publishedDates].sort(),['2026-09-28','2026-09-29','2026-09-30']);
    assert.deepEqual(stats.body.top.map(t=>[t.title,t.views,t.titleKind]),[['목록형 글',900,'list'],['목록형 둘째',700,'list'],['검색형 글',200,'search']]);
    assert.deepEqual(stats.body.kinds,{list:{posts:2,avgViews:800},search:{posts:1,avgViews:200}});
    assert.doesNotMatch(JSON.stringify(stats.body),/다른 캠퍼스 비밀 제목/);
    assert.equal((await h.request('GET',`/api/data-core/content/blog/stats?campusId=${B}`,users.staff)).status,403);
    assert.equal((await h.request('GET','/api/data-core/content/blog/stats',null)).status,401);

    // The same sentences written at another campus show up as a percentage only.
    const overlap=await h.request('POST','/api/data-core/content/blog/overlap',users.staff,{campusId:A,text:'이번 글 '+shared});
    assert.equal(overlap.status,200,JSON.stringify(overlap.body));
    assert.ok(overlap.body.percent>=80,JSON.stringify(overlap.body));
    assert.deepEqual(Object.keys(overlap.body).sort(),['compared','otherCampus','percent']);
    assert.doesNotMatch(JSON.stringify(overlap.body),/나 캠퍼스|비밀/);
    const fresh=await h.request('POST','/api/data-core/content/blog/overlap',users.staff,{campusId:A,text:'오늘은 완전히 새로운 주제로 학생들의 색채 실험과 재료 탐색 과정을 기록했습니다. 물감 번짐을 관찰했어요.'});
    assert.ok(fresh.body.percent<20,JSON.stringify(fresh.body));
    // Its own saved copy is left out when the id is given.
    const self=await h.request('POST','/api/data-core/content/blog/overlap',users.foreign,{campusId:B,id:foreignId,text:'나 캠퍼스 본문 '+shared});
    assert.equal(self.body.otherCampus,true,'the remaining match is the other campus post');
    assert.equal((await h.request('POST','/api/data-core/content/blog/overlap',users.staff,{campusId:B,text:shared})).status,403);
    assert.equal((await h.request('POST','/api/data-core/content/blog/overlap',users.staff,{campusId:A,text:'가'.repeat(60001)})).status,400);
  }finally{await h.mf.dispose();}
});

test('Naver-style editor screen: toolbar, plain copy, side checks and title kinds are wired',()=>{
  const blog=fs.readFileSync('public/data-core/blog-workflow.js','utf8'),content=fs.readFileSync('public/data-core/content.js','utf8'),html=fs.readFileSync('public/data-core/content.html','utf8');
  for(const id of ['blogAddPhoto','blogAddQuote','blogAddDivider','blogAddHeading','blogAddParagraph','blogPolish','blogUndo'])assert.match(blog,new RegExp(`btnHtml\\('${id}'`));
  for(const id of ['blogSaveTemp','blogPhotosInOrder','blogCopyPlain','blogTeacherComment','blogChecks','blogStreak','blogTopPosts','blogTitleBox'])assert.match(blog,new RegExp(`id="${id}"`));
  assert.match(blog,/contentEditable='plaintext-only'/,'pasted formatting never enters the page');
  assert.match(blog,/서식 없이 복사/);
  assert.match(content,/const BLOG_TITLE_KINDS = \['homefeed', 'search', 'balanced', 'list', 'curious'\];/);
  assert.match(html,/blog-workflow\.css\?v=20261001-naver/);assert.match(html,/content\.js\?v=20261001-[a-z]+/);
});

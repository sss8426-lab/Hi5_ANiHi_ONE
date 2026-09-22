import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {libraryHarness,A,B,users} from './support/library-harness.mjs';
import {buildDownload} from '../public/data-core/blog-download.js';
import {unzipSync} from '../public/data-core/vendor/fflate-0.8.3.js';
import {assembleBlocks,inspectPost,exportHtml,synchronizePhotos,safeName} from '../public/data-core/blog-post-model.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('blog selected originals: exact bytes, ordered ZIPs, ACL, revisions, independent saved selection',async()=>{
  const h=await libraryHarness(),originalFetch=globalThis.fetch;
  try{
    const folder=(await h.folder('campus:'+A,'Synthetic blog')).body.folder.id;
    const ids=[],bytes=[],names=[];
    for(let i=0;i<10;i++){
      const png=i%2===0,name='같은 이름 '+(png?'작품.png':'수업.jpg');
      const source=sharp({create:{width:48+i,height:32,channels:3,background:{r:i*20,g:100,b:180}}});
      const data=await (png?source.png():source.jpeg()).toBuffer();
      const result=await h.upload(folder,users.admin,{bytes:data,name,mime:png?'image/png':'image/jpeg'});
      assert.equal(result.status,201,JSON.stringify(result.body));ids.push(result.body.file.id);bytes.push(data);names.push(name);
    }
    const requests=[];
    globalThis.fetch=async(path,options={})=>{requests.push(String(path));return h.raw(options.method||'GET',String(path),users.admin,typeof options.body==='string'?JSON.parse(options.body):options.body);};
    for(const n of [1,5,10]){
      const start=performance.now(),result=await buildDownload({ids:ids.slice(0,n),campusId:A,signal:new AbortController().signal});
      if(n===1){assert.equal(hash(Buffer.from(await result.blob.arrayBuffer())),hash(bytes[0]));assert.equal(result.name,names[0]);}
      else{const entries=unzipSync(new Uint8Array(await result.blob.arrayBuffer()));assert.equal(Object.keys(entries).length,n);Object.entries(entries).forEach(([name,value],i)=>{assert.equal(name,`${String(i+1).padStart(2,'0')}_${names[i]}`);assert.equal(hash(value),hash(bytes[i]));});}
      console.log(JSON.stringify({synthetic:true,photos:n,downloadPreparationMs:Math.round(performance.now()-start)}));
    }
    assert.ok(requests.every(p=>p==='/api/data-core/content/blog/files'||/\/library\/files\/[^/]+\/download$/.test(p)));
    await assert.rejects(buildDownload({ids:[ids[0]],campusId:A,expectedVersions:new Map([[ids[0],'old-version']])}),/버전/);
    const photos=synchronizePhotos(ids.slice(0,5));photos[0].description='<script>alert(1)</script>';
    const post={schemaVersion:1,revision:0,title:'격리 검증',privacyConfirmed:true,photos,blocks:assembleBlocks({body:'본문입니다.',photos,footer:'마지막 문구'}),brief:{exclude:''},strategyMode:'balanced'};
    const request={requestId:randomUUID(),campusId:A,post,publishStatus:'draft'};
    const saved=await h.request('POST','/api/data-core/content/blog/save',users.admin,request);assert.equal(saved.status,200,JSON.stringify(saved.body));
    const id=saved.body.draft.id;
    const retry=await h.request('POST','/api/data-core/content/blog/save',users.admin,request);assert.equal(retry.body.draft.id,id);assert.equal(retry.body.draft.metadata.blogPost.revision,1);
    const stale=await h.request('POST','/api/data-core/content/blog/save',users.admin,{...request,id,requestId:randomUUID()});assert.equal(stale.status,409);
    const reopened=await h.request('GET','/api/data-core/content/'+encodeURIComponent(id));assert.deepEqual(reopened.body.draft.metadata.relatedFileIds,ids.slice(0,5));
    const next={...request,id,requestId:randomUUID(),post:{...reopened.body.draft.metadata.blogPost,title:'수정'}};
    assert.equal((await h.request('POST','/api/data-core/content/blog/save',users.admin,next)).status,200);
    assert.equal((await h.request('POST','/api/data-core/content/blog/save',users.teacher,next)).status,403);
    assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(id),users.admin,{metadata:{}})).status,403);
    assert.equal((await h.request('POST','/api/data-core/content/blog/files',null,{campusId:A,fileIds:ids})).status,401);
    const forbidden=await h.request('POST','/api/data-core/content/blog/files',users.foreign,{campusId:B,fileIds:[ids[0]]});assert.equal(forbidden.body.items[0].status,403);
    const deleted=await h.request('DELETE',`/api/data-core/library/files/${ids[1]}`);assert.equal(deleted.status,200);
    const beforeMissing=await h.request('GET','/api/data-core/content/'+encodeURIComponent(id));
    const missingDraft={id,campusId:A,requestId:randomUUID(),post:beforeMissing.body.draft.metadata.blogPost,publishStatus:'draft'};
    const kept=await h.request('POST','/api/data-core/content/blog/save',users.admin,missingDraft);assert.equal(kept.status,200,JSON.stringify(kept.body));assert.ok(kept.body.draft.metadata.blogPost.fileIssues.length);
    assert.equal((await h.request('POST','/api/data-core/content/blog/save',users.admin,{...missingDraft,requestId:randomUUID(),post:kept.body.draft.metadata.blogPost,publishStatus:'ready'})).status,404);
    await assert.rejects(buildDownload({ids:ids.slice(0,5),campusId:A,signal:new AbortController().signal}),/삭제|존재/);
    const controller=new AbortController();controller.abort();await assert.rejects(buildDownload({ids:[ids[0],ids[2]],campusId:A,signal:controller.signal}),/abort/i);
    const html=exportHtml(post);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
    const settings={sourceApp:'blog',campusId:A,hashtags:'#기존',footer:'보존',blogSettings:{strategyMode:'homefeed',template:{templateId:'teacher',greeting:'인사',topFileId:'',bottomFileId:''}}};
    assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.admin,settings)).status,200);
    assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.admin,{...settings,blogSettings:{strategyMode:'homefeed',template:{templateId:'class',greeting:'다른 인사',align:'center',spacing:32,font:'serif',contactMode:'none'}}})).status,200);
    await h.request('PUT','/api/data-core/content/defaults',users.admin,{sourceApp:'blog',campusId:A,hashtags:'#새값',footer:'새문구'});
    const defaults=await h.request('GET',`/api/data-core/content/defaults?sourceApp=blog&campusId=${A}`);assert.equal(defaults.body.defaults.blogSettings.strategyMode,'homefeed');
    assert.equal(defaults.body.defaults.blogSettings.templates.teacher.greeting,'인사');assert.equal(defaults.body.defaults.blogSettings.templates.class.align,'center');
  }finally{globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('blog cover persists once, preserves source bytes, resolves provenance and follows source revocation',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('campus:'+A,'Synthetic cover')).body.folder.id;
    const bytes=await sharp({create:{width:64,height:48,channels:3,background:'#a12356'}}).jpeg().toBuffer();
    const uploaded=await h.upload(folder,users.admin,{bytes,name:'원본 사진.jpg',mime:'image/jpeg'});const id=uploaded.body.file.id;
    const resolved=await h.request('POST','/api/data-core/content/blog/files',users.admin,{campusId:A,fileIds:[id]});const source=resolved.body.items[0];
    const png=await sharp(bytes).resize(1200,900,{fit:'contain'}).png().toBuffer();
    const form=()=>{const f=new FormData();f.set('campusId',A);f.set('sourceFileId',id);f.set('sourceVersion',source.version);f.set('file',new File([png],'cover.png',{type:'image/png'}));return f;};
    const first=await h.request('POST','/api/data-core/content/blog/image',users.admin,form());assert.equal(first.status,200,JSON.stringify(first.body));
    const retry=await h.request('POST','/api/data-core/content/blog/image',users.admin,form());assert.equal(retry.body.file.id,first.body.file.id);
    const derivative=first.body.file.id;
    const original=await h.request('POST','/api/data-core/content/blog/files',users.admin,{campusId:A,fileIds:[derivative]});assert.equal(original.body.items[0].id,id);
    const originalResponse=await h.raw('GET',source.url);assert.equal(hash(Buffer.from(await originalResponse.arrayBuffer())),hash(bytes));
    const wrong=form();wrong.set('sourceVersion','old');assert.equal((await h.request('POST','/api/data-core/content/blog/image',users.admin,wrong)).status,409);
    const small=form();small.set('file',new File([await sharp(bytes).png().toBuffer()],'small.png',{type:'image/png'}));assert.equal((await h.request('POST','/api/data-core/content/blog/image',users.admin,small)).status,400);
    const metadata=await h.env.DB.prepare('SELECT r2_key FROM file_objects WHERE id=?').bind(id).first();await h.env.FILES.delete(metadata.r2_key);
    const missing=await h.request('POST','/api/data-core/content/blog/files',users.admin,{campusId:A,fileIds:[derivative],originals:false});assert.equal(missing.body.items[0].status,404);
    assert.equal((await h.raw('GET','/api/data-core/files/'+derivative)).status,404);
  }finally{await h.mf.dispose();}
});

test('block checks do not pretend semantic inspection; names and photos are stable',()=>{
  const p={title:'수업 안내',brief:{exclude:'금지'},privacyConfirmed:true,photos:[{fileId:'a',kind:'teacher'}],blocks:[{id:'p',type:'paragraph',text:'금지 3가지 예시'}]};
  assert.ok(inspectPost(p).some(v=>v.status==='unchecked'));assert.ok(inspectPost(p).some(v=>v.status==='human_required'));assert.ok(inspectPost(p).some(v=>v.message.includes('제외 표현')));
  const ordered=synchronizePhotos(['b','a'],[{fileId:'a',description:'keep'},{fileId:'b',description:'other'}]);assert.equal(ordered[1].description,'keep');
  assert.equal(safeName('CON.jpg'),'_CON.jpg');assert.equal(safeName('a/b:사진.png'),'a_b_사진.png');
});

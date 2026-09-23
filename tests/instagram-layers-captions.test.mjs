import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {encode} from 'fast-png';
import {libraryHarness,users,A,B} from './support/library-harness.mjs';
import {defaultLayerBox,drawLayers,MASTER} from '../public/data-core/instagram-layout.js';

const png=(w,h,fill=185)=>encode({width:w,height:h,channels:4,depth:8,data:new Uint8Array(w*h*4).fill(fill)});
const material={workflow:'carousel-v2',logoType:'horizontal',materialKind:'student-artwork',usePermission:'allowed'};

async function logo(h,user,campusId,name='SYNTHETIC 말풍선'){
  const form=new FormData();form.set('campusId',campusId);form.set('name',name);form.set('file',new File([png(40,20)],'bubble.png',{type:'image/png'}));
  const created=await h.request('POST','/api/data-core/content/instagram-logos',user,form);
  assert.equal(created.status,201,JSON.stringify(created.body));return created.body.logo;
}
async function photoDraft(h,folder,i){
  const file=(await h.upload(folder.id,users.staff,{name:`SYNTHETIC-${i}.png`,mime:'image/png',bytes:png(40,50)})).body.file;
  const draft=(await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC',summary:'SYNTHETIC 수업 소개',relatedFileIds:[file.id],metadata:{instagramDesign:material}})).body.draft;
  const fingerprint=(await h.request('GET',`/api/data-core/content/instagram/${draft.id}/review`,users.staff)).body.fingerprint;
  return {file,draftId:draft.id,fingerprint};
}
function render(h,d,layers,{user=users.staff,fill=185}={}){
  const form=new FormData();form.set('file',new Blob([png(2160,2700,fill)],{type:'image/png'}),'master.png');form.set('fingerprint',d.fingerprint);
  if(layers!==undefined)form.set('layers',typeof layers==='string'?layers:JSON.stringify(layers));
  return h.request('POST',`/api/data-core/content/instagram/${d.draftId}/render`,user,form);
}
const layer=(assetId,extra={})=>({id:crypto.randomUUID(),assetId,x:1500,y:2300,w:420,h:210,z:0,...extra});

test('user layers are saved with each render, restored on reopen, and only live same-campus uploads are accepted',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC layers',users.staff)).body.folder;
    const bubble=await logo(h,users.staff,A),foreignAsset=await logo(h,users.master,B,'SYNTHETIC 다른 캠퍼스');
    const d=await photoDraft(h,folder,0);

    // Rejected before anything is stored: another campus's image, a made-up id, malformed and oversized lists.
    assert.equal((await render(h,d,[layer(foreignAsset.id)])).status,403,'an image uploaded under another campus cannot be placed');
    assert.equal((await render(h,d,[layer('00000000-0000-0000-0000-000000000000')])).status,403);
    assert.equal((await render(h,d,'{not json')).status,400);
    assert.equal((await render(h,d,[layer(bubble.id,{x:10.5})])).status,400,'coordinates are whole master pixels');
    assert.equal((await render(h,d,[layer(bubble.id,{x:5000})])).status,400,'a layer entirely outside the canvas is refused');
    assert.equal((await render(h,d,Array.from({length:21},()=>layer(bubble.id)))).status,400,'at most 20 per photo');

    const first=await render(h,d,[layer(bubble.id,{z:1}),layer(bubble.id,{x:100,y:2400,z:0})]);
    assert.equal(first.status,201,JSON.stringify(first.body));
    const review=(await h.request('GET',`/api/data-core/content/instagram/${d.draftId}/review?renderId=${first.body.renderId}`,users.staff)).body;
    assert.equal(review.layers.length,2);assert.deepEqual(review.layers.map(v=>v.z),[0,1],'stored in drawing order');
    assert.equal(review.layers[0].assetName,'SYNTHETIC 말풍선');assert.ok(review.layers[0].assetVersion);
    assert.equal(review.sourceFileId,d.file.id);assert.equal(review.backgroundFileId,d.file.id);

    // The set exposes everything needed to reopen and re-composite only the layers.
    const set=(await h.request('POST','/api/data-core/content/instagram-sets',users.staff,{requestId:crypto.randomUUID(),items:[{draftId:d.draftId,renderId:first.body.renderId,fingerprint:first.body.fingerprint}]})).body;
    assert.equal(set.version,1);
    const item=set.items[0];
    assert.equal(item.sourceId,d.file.id);assert.equal(item.backgroundFileId,d.file.id);assert.equal(item.layers.length,2);
    assert.equal(item.design.logoType,'horizontal');assert.equal(item.direction,'SYNTHETIC 수업 소개');

    // Deleting the image from the list keeps the finished composite; it just can't be placed again.
    assert.equal((await h.request('DELETE','/api/data-core/content/instagram-logos/'+bubble.id,users.staff)).status,200);
    assert.equal((await h.request('GET','/api/data-core/content/instagram-sets/'+encodeURIComponent(set.id),users.staff)).body.items[0].layers.length,2);
    assert.equal((await h.raw('POST',`/api/data-core/content/instagram/${d.draftId}/export`,users.staff,{renderId:first.body.renderId,fingerprint:first.body.fingerprint})).status,200,'past composites still download');
    assert.equal((await render(h,d,[layer(bubble.id)])).status,403,'a deleted image is reported, never silently dropped');
    // No layers at all is still an ordinary render (로고 없음 / no user images).
    assert.equal((await render(h,d,[])).status,201);
  }finally{await h.mf.dispose();}
});

test('a saved set is updated in place when retried photos join or layers are re-composited, with version checks and fresh exports',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC set update',users.staff)).body.folder;
    const bubble=await logo(h,users.staff,A);
    const drafts=[];for(let i=0;i<3;i++)drafts.push(await photoDraft(h,folder,i));
    const items=[];for(const d of drafts.slice(0,2)){const r=(await render(h,d,[])).body;items.push({draftId:d.draftId,renderId:r.renderId,fingerprint:r.fingerprint});}
    // Partial batch: 2 of 3 finished — saved (and later captioned) without waiting for the third.
    const set=(await h.request('POST','/api/data-core/content/instagram-sets',users.staff,{requestId:crypto.randomUUID(),items})).body;
    const resource='/api/data-core/content/instagram-sets/'+encodeURIComponent(set.id);
    assert.equal(set.items.length,2);assert.equal(set.version,1);
    const caption=await h.request('PATCH',resource,users.staff,{caption:'SYNTHETIC 본문',sources:set.items.map(v=>v.sourceId)});
    assert.equal(caption.status,200);

    // The retried third photo joins the same set.
    const third=(await render(h,drafts[2],[])).body;
    const grown=[...items,{draftId:drafts[2].draftId,renderId:third.renderId,fingerprint:third.fingerprint}];
    assert.equal((await h.request('PATCH',resource,users.foreign,{items:grown,version:1})).status,403);
    assert.equal((await h.request('PATCH',resource,users.staff,{items:grown,version:7})).status,409,'a stale screen cannot overwrite a newer arrangement');
    const updated=await h.request('PATCH',resource,users.staff,{items:grown,version:1});
    assert.equal(updated.status,200,JSON.stringify(updated.body));
    assert.equal(updated.body.version,2);assert.equal(updated.body.items.length,3);assert.equal(updated.body.title,'인스타 이미지 3장');
    assert.equal(updated.body.caption,'SYNTHETIC 본문','images changing never touches the caption');
    assert.equal(updated.body.captionSources.length,2,'reopening can tell the text was written for fewer photos');

    // Layer edit on photo 1: a new render of the same draft replaces it; the export is new, not the cached old one.
    const oldExport=await h.raw('POST',`/api/data-core/content/instagram/${items[0].draftId}/export`,users.staff,items[0]);assert.equal(oldExport.status,200);
    const oldBytes=new Uint8Array(await oldExport.arrayBuffer());
    const edited=(await render(h,drafts[0],[layer(bubble.id)],{fill:40})).body;
    const next=[{draftId:items[0].draftId,renderId:edited.renderId,fingerprint:edited.fingerprint},...grown.slice(1)];
    const relayered=await h.request('PATCH',resource,users.staff,{items:next,version:2});
    assert.equal(relayered.status,200,JSON.stringify(relayered.body));assert.equal(relayered.body.version,3);
    assert.equal(relayered.body.items[0].renderId,edited.renderId);assert.equal(relayered.body.items[0].layers.length,1);
    const newExport=await h.raw('POST',`/api/data-core/content/instagram/${items[0].draftId}/export`,users.staff,next[0]);
    assert.equal(newExport.status,200);assert.match(newExport.headers.get('server-timing'),/reuse;desc="0"/,'a new version is converted fresh');
    assert.notDeepEqual(new Uint8Array(await newExport.arrayBuffer()),oldBytes,'the download reflects the new composite');

    // A set can't absorb another campus's photo or a duplicate source.
    assert.equal((await h.request('PATCH',resource,users.staff,{items:[...next,next[0]],version:3})).status,400);
    const audit=await h.env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='instagram.update-set'").first();assert.equal(audit.n,2);
  }finally{await h.mf.dispose();}
});

test('captions: conditional save never overwrites newer text, remembers its photos, and long Korean text fits',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC caption',users.staff)).body.folder;
    const d=await photoDraft(h,folder,0),r=(await render(h,d,[])).body;
    const set=(await h.request('POST','/api/data-core/content/instagram-sets',users.staff,{requestId:crypto.randomUUID(),items:[{draftId:d.draftId,renderId:r.renderId,fingerprint:r.fingerprint}]})).body;
    const resource='/api/data-core/content/instagram-sets/'+encodeURIComponent(set.id);
    assert.equal(set.caption,'');assert.equal(set.captionSources,null);
    // The automatic caption only lands on an empty set…
    assert.equal((await h.request('PATCH',resource,users.staff,{caption:'AI 본문',previousCaption:'',sources:[d.file.id,'not-in-set']})).status,200);
    const saved=(await h.request('GET',resource,users.staff)).body;
    assert.equal(saved.caption,'AI 본문');assert.deepEqual(saved.captionSources,[d.file.id],'only photos of this set are recorded');
    // …so a late second answer (or another tab) can't replace what is there now.
    const late=await h.request('PATCH',resource,users.staff,{caption:'늦게 온 글',previousCaption:''});
    assert.equal(late.status,409);assert.equal((await h.request('GET',resource,users.staff)).body.caption,'AI 본문');
    // A plain save (the 문구 저장 button) still writes; a 12,000-character Korean caption is ~36KB.
    const long='가'.repeat(12000);
    assert.equal((await h.request('PATCH',resource,users.staff,{caption:long})).status,200);
    assert.equal((await h.request('GET',resource,users.staff)).body.caption.length,12000);
    assert.equal((await h.request('PATCH',resource,users.foreign,{caption:'x'})).status,403);
  }finally{await h.mf.dispose();}
});

test('나만의 로고 list: rename, name search (wildcards literal), campus-scoped',async()=>{
  const h=await libraryHarness();
  try{
    const a=await logo(h,users.campusAdmin,A,'말풍선 봄'),b=await logo(h,users.campusAdmin,A,'100%_문구');await logo(h,users.campusAdmin,A,'로고');
    const list=q=>h.request('GET',`/api/data-core/content/instagram-logos?campusId=${A}&q=${encodeURIComponent(q)}`,users.campusAdmin);
    assert.deepEqual((await list('말풍선')).body.logos.map(v=>v.id),[a.id]);
    assert.deepEqual((await list('%_')).body.logos.map(v=>v.id),[b.id],'% and _ match literally');
    assert.equal((await list('')).body.logos.length,3);
    const path='/api/data-core/content/instagram-logos/'+a.id;
    assert.equal((await h.request('PATCH',path,users.foreign,{name:'침범'})).status,403);
    assert.equal((await h.request('PATCH',path,users.campusAdmin,{name:'   '})).status,400);
    const renamed=await h.request('PATCH',path,users.campusAdmin,{name:'  여름 말풍선  '});
    assert.equal(renamed.status,200);assert.equal(renamed.body.logo.name,'여름 말풍선');
    assert.deepEqual((await list('여름')).body.logos.map(v=>v.id),[a.id]);
    await h.request('DELETE',path,users.campusAdmin);
    assert.equal((await h.request('PATCH',path,users.campusAdmin,{name:'다시'})).status,404,'a deleted image is gone from the list');
  }finally{await h.mf.dispose();}
});

test('layer compositing: exact pixels in z order, default placement leaves the artwork uncovered',()=>{
  const calls=[],ctx={drawImage:(image,x,y,w,h)=>calls.push([image.name,x,y,w,h])};
  const assets=new Map([['a',{name:'bubble'}],['b',{name:'text'}]]);
  drawLayers(ctx,[{assetId:'a',x:10,y:20,w:300,h:150,z:1},{assetId:'b',x:0,y:0,w:100,h:50,z:0}],assets,0.5);
  assert.deepEqual(calls,[['text',0,0,50,25],['bubble',5,10,150,75]],'back-to-front, scaled only for the preview');
  assert.throws(()=>drawLayers(ctx,[{assetId:'gone',assetName:'삭제된 말풍선',x:0,y:0,w:10,h:10,z:0}],assets),/삭제된 말풍선/,'a missing image is reported by name');

  // A landscape artwork contained in the frame leaves a band below it: the image goes there, not on the work.
  const artwork={x:56,y:792,w:2048,h:1400,top:340,bottom:2644};
  const box=defaultLayerBox({width:400,height:200},artwork,0);
  assert.ok(box.y>=artwork.y+artwork.h,'placed below the artwork');assert.ok(box.x+box.w<=MASTER.width&&box.y+box.h<=artwork.bottom);
  assert.equal(Math.round(box.w/box.h),2,'aspect ratio kept');
  const second=defaultLayerBox({width:200,height:200},artwork,1,MASTER.width-56-box.x+24);
  assert.ok(second.x+second.w<=box.x,'several images line up without overlapping');
  // A full-bleed photo has no free band (the logo band above is not free): a small corner placement instead.
  const corner=defaultLayerBox({width:300,height:300},{x:56,y:340,w:2048,h:2304,top:340,bottom:2644},0);
  assert.ok(corner.w<=560&&corner.x+corner.w===MASTER.width-56&&corner.y+corner.h===MASTER.height-56);
});

test('client: captions follow saved results (partial too), once, with visible states; user images are layers composited into the saved PNG',()=>{
  const carousel=fs.readFileSync('public/data-core/instagram-carousel.js','utf8');
  // Root cause: the caption only ran after a full-selection save, so any failed photo meant no caption at all.
  assert.doesNotMatch(carousel,/items\.length!==state\.selectedFileIds\.length/u);
  assert.match(carousel,/if\(finished\)await autoFinish\(epoch\);/u,'a finished batch saves and captions automatically');
  assert.equal((carousel.match(/if\(finished\)await autoFinish\(epoch\);/gu)||[]).length,2,'after the first batch and after a retry');
  assert.match(carousel,/if\(!currentSet\.caption&&!autoCaptioned\.has\(currentSet\.id\)\)\{autoCaptioned\.add\(currentSet\.id\);await caption\(\{auto:true\}\);\}/u,'one automatic attempt per set');
  assert.match(carousel,/const CAPTION_LABELS=\{none:'작성 전',writing:'작성 중',done:'작성 완료',failed:'작성 실패',dirty:'변경사항 미저장'\};/u);
  assert.match(carousel,/'홍보글 작성':'홍보글 다시 작성'/u);
  assert.match(carousel,/autoCaptioned\.add\(saved\.id\);currentSet=saved;/u,'opening an old set never writes by itself');
  assert.match(carousel,/if\(!part\)throw Error\('AI가 빈 글을 돌려주었습니다\.'\);/u,'an empty answer is a failure, never "완료"');
  assert.match(carousel,/previousCaption,signal:abort\.signal\}\);/u,'the automatic text only lands on an empty set');
  // Caption calls never go through api(), whose 401/403 handling would wipe the finished images.
  const captionBody=carousel.slice(carousel.indexOf('async function caption('),carousel.indexOf('function adoptSet'));
  assert.doesNotMatch(captionBody,/\bapi\(|\bpost\(/u);
  assert.match(captionBody,/const ids=setSources\(target\)/u,'the text covers the finished photos of the set, not the raw selection');

  // 나만의 로고 are layers: they never replace the official logo choice.
  assert.doesNotMatch(carousel,/logoType=value;clear\(true\)/u);
  assert.match(carousel,/overlays:overlayChoices\.map/u);
  assert.match(carousel,/composeInstagram\('\/api\/data-core\/files\/'\+encodeURIComponent\(backgroundId\),itemDesign,policyValue\.campusLogoLabel,signal,\{place:overlays\}\)/u);
  assert.match(carousel,/form\.set\('layers',JSON\.stringify\(layers\.map/u,'the saved render records its layers');
  // Editing re-composites from the layer-free base, saves a new render and never calls the AI.
  const apply=carousel.slice(carousel.indexOf("$('igLayerApply').onclick"),carousel.indexOf('updateTemplateSummary();updatePresetsSummary();'));
  assert.match(apply,/composeInstagram\('\/api\/data-core\/files\/'\+encodeURIComponent\(background\),item\.design,label,undefined,\{layers:own,assets\}\)/u);
  assert.match(apply,/await saveRender\(item\.draftId,item\.fingerprint,background,blob,placed\)/u);
  assert.doesNotMatch(apply,/generate|image-edit|caption\(/u);
  assert.match(apply,/불러올 수 없는 이미지/u,'a missing image blocks applying instead of being dropped');
});

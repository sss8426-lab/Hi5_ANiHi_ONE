import test from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from 'fast-png';
import {libraryHarness,users,A} from './support/library-harness.mjs';
import {imageBox} from '../public/data-core/instagram-layout.js';
import {LOGOS,normalizeDesign} from '../public/data-core/instagram-brand-policy.js';
import {instagramImageMime} from '../public/data-core/instagram-image-formats.js';

const png=(w,h)=>encode({width:w,height:h,channels:4,depth:8,data:new Uint8Array(w*h*4).fill(185)});
const material={workflow:'carousel-v2',logoType:'horizontal',materialKind:'student-artwork',usePermission:'allowed'};

test('raster formats and legacy JPEG aliases are supported without accepting active documents',()=>{
  for(const [mime,name,expected] of [['image/png','a.png','image/png'],['image/jpg','a.jpg','image/jpeg'],['IMAGE/JPEG','a.jpeg','image/jpeg'],
    ['application/octet-stream','a.JPEG','image/jpeg'],['','a.webp','image/webp'],['image/gif','a.gif','image/gif'],['image/avif','a.avif','image/avif'],['image/x-ms-bmp','a.bmp','image/bmp']]){
    assert.equal(instagramImageMime(mime,name),expected);
  }
  assert.equal(instagramImageMime('image/svg+xml','fake.png'),'');
  assert.equal(instagramImageMime('text/html','fake.jpg'),'');
  assert.equal(instagramImageMime('','fake.svg'),'');
});
test('five official logos plus no-logo, artwork contained and photos fill the same master frame',()=>{
  assert.equal(Object.keys(LOGOS).length,6);
  assert.equal(imageBox('student-artwork').fit,'contain');
  assert.equal(imageBox('real-photo').fit,'cover');
  assert.equal(normalizeDesign(material).workflow,'carousel-v2');
});

test('carousel saves 1/5/10 images, rejects 11, preserves originals, access and version-bound exports',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC carousel',users.staff)).body.folder;
    const master=png(2160,2700),items=[],originals=[];
    for(let i=0;i<10;i++){
      const file=(await h.upload(folder.id,users.staff,{name:`SYNTHETIC-${i}.png`,mime:'image/png',bytes:png(40,50)})).body.file;
      originals.push(await h.file(file.id));
      const draft=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC',relatedFileIds:[file.id],metadata:{instagramDesign:material}});
      assert.equal(draft.status,201,JSON.stringify(draft.body));
      const draftId=draft.body.draft.id,base='/api/data-core/content/instagram/'+draftId;
      const review=await h.request('GET',base+'/review',users.staff);
      const form=new FormData();form.set('file',new Blob([master],{type:'image/png'}),'master.png');form.set('fingerprint',review.body.fingerprint);
      const render=await h.request('POST',base+'/render',users.staff,form);
      assert.equal(render.status,201,JSON.stringify(render.body));
      items.push({draftId,renderId:render.body.renderId,fingerprint:render.body.fingerprint});
    }
    const endpoint='/api/data-core/content/instagram-sets',payload={items,requestId:crypto.randomUUID()};
    const bucket=h.env.FILES;let gets=0,puts=0;
    h.env.FILES=new Proxy(bucket,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return(...args)=>{if(key==='get')gets++;if(key==='put')puts++;return value.apply(target,args);};}});
    assert.equal((await h.request('POST',endpoint,users.foreign,payload)).status,403);
    assert.equal((await h.request('POST',endpoint,null,payload)).status,401);
    assert.equal((await h.request('POST',endpoint,users.staff,payload,'https://attacker.test')).status,403);
    for(const count of [1,5,10]){
      const input={items:items.slice(0,count),requestId:crypto.randomUUID()};
      const saved=await h.request('POST',endpoint,users.staff,input);
      assert.equal(saved.status,201,JSON.stringify(saved.body));assert.equal(saved.body.items.length,count);
      const again=await h.request('POST',endpoint,users.staff,input);assert.equal(again.body.id,saved.body.id);
      const resource=endpoint+'/'+encodeURIComponent(saved.body.id);
      assert.equal((await h.request('GET',resource,users.staff)).status,200);
      assert.equal((await h.request('GET',resource,users.foreign)).status,403);
      assert.equal((await h.request('PATCH',resource,users.staff,{caption:'SYNTHETIC 문구'})).status,200);
      assert.equal((await h.request('GET',resource,users.staff)).body.caption,'SYNTHETIC 문구');
      assert.equal((await h.request('PATCH','/api/data-core/records/'+encodeURIComponent(saved.body.id),users.admin,{metadata:{items:[]}})).status,403);
    }
    assert.equal((await h.request('POST',endpoint,users.staff,{items:[...items,items[0]],requestId:crypto.randomUUID()})).status,400);
    assert.equal((await h.request('POST',endpoint,users.staff,{items:[items[0],items[0]],requestId:crypto.randomUUID()})).status,400);
    assert.equal((await h.request('GET',endpoint+'?campusId='+A,users.staff)).body.sets.length,3);
    assert.equal(puts,0,'completion and caption saves never reupload a master');assert.equal(gets,0,'completion never rereads image bytes');
    const result=await h.raw('POST','/api/data-core/content/instagram/'+items[0].draftId+'/export',users.staff,items[0]);
    assert.equal(result.status,200);const decoded=decode(new Uint8Array(await result.arrayBuffer()));assert.deepEqual([decoded.width,decoded.height],[1080,1350]);
    const repeat=await h.raw('POST','/api/data-core/content/instagram/'+items[0].draftId+'/export',users.staff,items[0]);
    assert.equal(repeat.status,200);assert.match(repeat.headers.get('server-timing'),/encode;desc="0"/);assert.match(repeat.headers.get('server-timing'),/reuse;desc="1"/);
    assert.deepEqual(decode(new Uint8Array(await repeat.arrayBuffer())).data,decoded.data);assert.equal(puts,1,'cached publish is streamed without another write');
    const parallel=await Promise.all([1,2].map(()=>h.raw('POST','/api/data-core/content/instagram/'+items[1].draftId+'/export',users.staff,items[1])));
    assert.ok(parallel.every(r=>r.status===200));
    assert.equal(parallel.filter(r=>/encode;desc="1"/.test(r.headers.get('server-timing'))).length,1,'D1 lease permits exactly one conversion');
    await Promise.all(parallel.map(r=>r.arrayBuffer()));assert.equal(puts,2);
    assert.equal((await h.raw('POST','/api/data-core/content/instagram/'+items[1].draftId+'/export',users.foreign,items[1])).status,403);
    const foreignOwner=await h.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(users.foreign.email).first();
    await h.env.DB.prepare("UPDATE file_objects SET visibility='private',owner_user_id=? WHERE id=?").bind(foreignOwner.id,originals[1].id).run();
    const readsBeforeRevocation=gets;
    assert.equal((await h.raw('POST','/api/data-core/content/instagram/'+items[1].draftId+'/export',users.staff,items[1])).status,403,'cached export cannot bypass newly private source ownership');
    assert.equal(gets,readsBeforeRevocation,'revoked source is rejected before cached R2 bytes are read');
    await h.env.DB.prepare('UPDATE file_objects SET visibility=?,owner_user_id=? WHERE id=?').bind(originals[1].visibility,originals[1].owner_user_id,originals[1].id).run();
    // Change the draft between validation and the batch; the guarded batch rolls back.
    const db=h.env.DB;let raced=false;
    h.env.DB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{if(!raced){raced=true;await db.prepare("UPDATE data_records SET updated_at='2099-01-01',summary='SYNTHETIC race' WHERE id=?").bind(items[2].draftId).run();}return target.batch(statements);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const conflict=await h.request('POST',endpoint,users.staff,{requestId:crypto.randomUUID(),items:[items[2]]});assert.equal(conflict.status,409,JSON.stringify(conflict.body));
    h.env.DB=db;
    for(const original of originals){assert.deepEqual(await h.file(original.id),original);assert.deepEqual(new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer()),png(40,50));}
    await h.request('PATCH','/api/data-core/content/'+items[0].draftId,users.staff,{summary:'Changed'});
    assert.equal((await h.raw('POST','/api/data-core/content/instagram/'+items[0].draftId+'/export',users.staff,items[0])).status,409);
    const audit=await h.env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='instagram.complete-set'").first();assert.equal(audit.n,3);
  }finally{await h.mf.dispose();}
});

test('a carousel-v2 render is individually exportable the moment it saves — partial batches never need the full set finished, but the older single-image workflow still requires its own explicit approve',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC partial-export',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC-partial.png',mime:'image/png',bytes:png(40,50)})).body.file;
    const draft=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC',relatedFileIds:[file.id],metadata:{instagramDesign:material}});
    assert.equal(draft.status,201,JSON.stringify(draft.body));
    const draftId=draft.body.draft.id,base='/api/data-core/content/instagram/'+draftId;
    const review=await h.request('GET',base+'/review',users.staff);
    const form=new FormData();form.set('file',new Blob([png(2160,2700)],{type:'image/png'}),'master.png');form.set('fingerprint',review.body.fingerprint);
    const render=await h.request('POST',base+'/render',users.staff,form);assert.equal(render.status,201,JSON.stringify(render.body));
    const item={draftId,renderId:render.body.renderId,fingerprint:render.body.fingerprint};
    // No POST to /instagram-sets (the full-set "완료 및 저장") happened at all — this is exactly the
    // one-of-N-succeeded scenario a partial batch produces, and it must already be downloadable.
    const exported=await h.raw('POST',base+'/export',users.staff,item);
    assert.equal(exported.status,200,'a single completed carousel-v2 photo must be exportable without waiting for the rest of the batch');
    const decoded=decode(new Uint8Array(await exported.arrayBuffer()));assert.deepEqual([decoded.width,decoded.height],[1080,1350]);
    assert.equal((await h.raw('POST',base+'/export',users.foreign,item)).status,403,'campus access is still enforced on the immediate export');
    await h.request('PATCH','/api/data-core/content/'+draftId,users.staff,{summary:'Changed'});
    assert.equal((await h.request('POST',base+'/export',users.staff,item)).status,409,'a stale fingerprint is still rejected, auto-approval is not a bypass of version-binding');

    // The older single-image production workflow (instagram-production.js) never sets workflow:'carousel-v2'
    // and must keep requiring its own real approve+checklist step — the auto-approval above is scoped to
    // carousel-v2 only and must not leak into this still-manually-reviewed flow.
    const legacyDesign={templateId:'artwork',logoType:'anihi',materialKind:'student-artwork',usePermission:'allowed',headline:'SYNTHETIC',contact:'DM 문의',factsVerified:true};
    const legacyFile=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC-legacy.png',mime:'image/png',bytes:png(40,50)})).body.file;
    const legacyDraft=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC legacy',relatedFileIds:[legacyFile.id],metadata:{instagramDesign:legacyDesign}});
    const legacyBase='/api/data-core/content/instagram/'+legacyDraft.body.draft.id;
    const legacyReview=await h.request('GET',legacyBase+'/review',users.staff);
    const legacyForm=new FormData();legacyForm.set('file',new Blob([png(2160,2700)],{type:'image/png'}),'master.png');legacyForm.set('fingerprint',legacyReview.body.fingerprint);
    const legacyRender=await h.request('POST',legacyBase+'/render',users.staff,legacyForm);assert.equal(legacyRender.status,201);
    const legacyItem={renderId:legacyRender.body.renderId,fingerprint:legacyRender.body.fingerprint};
    assert.equal((await h.request('POST',legacyBase+'/export',users.staff,legacyItem)).status,409,'the legacy single-image workflow must still require an explicit human approve before export');
  }finally{await h.mf.dispose();}
});

test('batch info written on each draft survives, is found by batch id, and stays campus-scoped (이어서 하기 contract)',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC resume',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC-resume.png',mime:'image/png',bytes:png(40,50)})).body.file;
    const batchId=crypto.randomUUID();
    const instagramBatch={id:batchId,slot:0,sources:[{id:file.id,folderId:folder.id}],command:'SYNTHETIC',mode:'original',logoType:'horizontal',backgroundFileId:null};
    const created=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'인스타 이미지 1',relatedFileIds:[file.id],metadata:{instagramDesign:material,instagramBatch}});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const other=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'unrelated',relatedFileIds:[file.id],metadata:{instagramDesign:material}});
    assert.equal(other.status,201);
    const found=await h.request('GET',`/api/data-core/content?sourceApp=instagram&campusId=${A}&limit=40&q=${batchId}`,users.staff);
    assert.equal(found.status,200);
    assert.deepEqual(found.body.drafts.map(d=>d.id),[created.body.draft.id],'the batch-id search returns exactly that batch');
    const draft=found.body.drafts[0];
    assert.deepEqual(draft.metadata.instagramBatch,instagramBatch,'batch info round-trips unchanged');
    assert.equal(draft.createdByUserId,created.body.draft.createdByUserId);
    assert.ok(draft.createdByUserId,'creator is exposed so a user only resumes their own batch');
    // The review a resumed slot relies on still works on this draft, and a foreign campus cannot see it.
    assert.equal((await h.request('GET','/api/data-core/content/instagram/'+draft.id+'/review',users.staff)).status,200);
    const foreign=await h.request('GET',`/api/data-core/content?sourceApp=instagram&campusId=${A}&q=${batchId}`,users.foreign);
    assert.ok(foreign.status===403||!(foreign.body.drafts||[]).length,'another campus never sees the batch');
    // Unsaved batch → the deterministic set id is a 404, which is what makes it resumable.
    const setId=`instagram-set:${draft.createdByUserId}:${batchId}`;
    assert.equal((await h.request('GET','/api/data-core/content/instagram-sets/'+encodeURIComponent(setId),users.staff)).status,404);
  }finally{await h.mf.dispose();}
});

test('text-only captions never transmit artwork and verify campus before provider access',async()=>{
  const h=await libraryHarness(),previous=globalThis.fetch;let calls=0;
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC privacy',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC.png',mime:'image/png',bytes:png(20,20)})).body.file;
    h.env.OPENAI_API_KEY='synthetic-only';
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;
      const body=JSON.parse(options.body);assert.equal(body.input[0].content.filter(part=>part.type==='input_image').length,0);
      assert.ok(!options.body.includes(file.id));
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'합성 제목',body:'입력한 내용을 소개합니다. 차분하게 살펴보세요. 함께 이야기해요.',hashtags:['미술'],cta:'DM 문의'})}]}]});
    };
    const input={sourceApp:'instagram',campusId:A,selectedFileIds:[file.id],textOnly:true,material,notes:'합성 사진 소개',requestId:crypto.randomUUID()};
    const result=await h.request('POST','/api/data-core/content/generate',users.staff,input);
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(calls,1);
    const usage=await h.request('GET','/api/data-core/content/ai-usage',users.staff);assert.equal(usage.body.calls.attempts,1);assert.equal(usage.body.calls.confirmed,1);
    await h.request('POST','/api/data-core/content/generate',users.staff,input);
    assert.equal((await h.request('GET','/api/data-core/content/ai-usage',users.staff)).body.calls.attempts,1,'idempotent response does not duplicate provider ledger');
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.foreign,{...input,requestId:crypto.randomUUID()})).status,403);
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,{...input,textOnly:false,requestId:crypto.randomUUID()})).status,403);
    assert.equal(calls,1);
  }finally{globalThis.fetch=previous;await h.mf.dispose();}
});

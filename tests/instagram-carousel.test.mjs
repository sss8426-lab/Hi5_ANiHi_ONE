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
    const result=await h.raw('POST','/api/data-core/content/instagram/'+items[0].draftId+'/export',users.staff,items[0]);
    assert.equal(result.status,200);const decoded=decode(new Uint8Array(await result.arrayBuffer()));assert.deepEqual([decoded.width,decoded.height],[1080,1350]);
    for(const original of originals){assert.deepEqual(await h.file(original.id),original);assert.deepEqual(new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer()),png(40,50));}
    await h.request('PATCH','/api/data-core/content/'+items[0].draftId,users.staff,{summary:'Changed'});
    assert.equal((await h.raw('POST','/api/data-core/content/instagram/'+items[0].draftId+'/export',users.staff,items[0])).status,409);
    const audit=await h.env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='instagram.complete-set'").first();assert.equal(audit.n,3);
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

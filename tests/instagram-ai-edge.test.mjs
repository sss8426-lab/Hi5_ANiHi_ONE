import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {encode,decode} from 'fast-png';

test('built Worker preserves detailed AI intermediates without redundant master upscaling',async()=>{
  const width=1024,height=1536,data=new Uint8Array(width*height*3);
  let seed=42;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed>>>24;}
  // Before the fix this 4.5MiB result became a 19MiB master and failed the 8MiB cap.
  const detailed=encode({width,height,channels:3,depth:8,data});
  const simple=encode({width:64,height:80,channels:3,depth:8,data:new Uint8Array(64*80*3).fill(130)});
  let output=detailed,calls=0;
  const names=['index.js',...(await readdir('dist/server',{recursive:true})).filter(n=>n.endsWith('.js')&&n!=='index.js')];
  const mf=new Miniflare({modules:names.map(n=>({type:'ESModule',path:path.resolve('dist/server',n)})),modulesRoot:path.resolve('dist/server'),
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB','FAMILY_DB'],r2Buckets:['FILES','FAMILY_FILES'],
    bindings:{DATA_CORE_SUPER_ADMIN_EMAILS:'edge@example.test',OPENAI_API_KEY:'synthetic-only'},outboundService:async request=>{
      assert.equal(request.url,'https://api.openai.com/v1/images/edits');
      const form=await request.formData();
      assert.equal(form.get('output_format'),'png');assert.equal(form.get('n'),'1');
      assert.deepEqual(new Uint8Array(await form.get('image[]').arrayBuffer()),simple);
      calls++;
      return Response.json({data:[{b64_json:Buffer.from(output).toString('base64')}]});
    }});
  try{
    const headers={'oai-authenticated-user-id':'synthetic-ai-edge','oai-authenticated-user-email':'edge@example.test','oai-authenticated-user-full-name':'Synthetic',origin:'http://localhost'};
    async function request(url,body){
      const h={...headers};let encoded=body;
      if(body instanceof FormData){const r=new Request('http://localhost',{method:'POST',body});h['content-type']=r.headers.get('content-type');encoded=new Uint8Array(await r.arrayBuffer());}
      else if(body){h['content-type']='application/json';encoded=JSON.stringify(body);}
      const r=await mf.dispatchFetch('http://localhost'+url,{method:body?'POST':'GET',headers:h,body:encoded});
      return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};
    }
    await request('/api/data-core/context');
    const campusId='campus-anihi-admission';
    const folder=await request('/api/data-core/library/folders',{parentFolderId:'category:'+campusId+':academy-photo',title:'SYNTHETIC AI'});
    assert.equal(folder.status,201,JSON.stringify(folder));
    const form=new FormData();form.set('recordId',folder.body.folder.id);form.set('file',new Blob([simple],{type:'image/png'}),'synthetic.png');
    const file=await request('/api/data-core/library/files',form);assert.equal(file.status,201,JSON.stringify(file));
    const input={sourceApp:'instagram',campusId,sourceFileId:file.body.file.id,direction:'Brighten this synthetic image',material:{workflow:'carousel-v2',materialKind:'real-photo',usePermission:'allowed',externalAiConsent:true}};
    const edit=()=>request('/api/data-core/content/image-edit',{...input,requestId:crypto.randomUUID()});
    const result=await edit();assert.equal(result.status,201,JSON.stringify(result));
    const derived=result.body.file;
    assert.equal(derived.metadata.derivedFromFileId,file.body.file.id);
    assert.deepEqual([derived.metadata.width,derived.metadata.height],[width,height]);
    assert.equal(derived.sizeBytes,detailed.length);
    const downloaded=await request('/api/data-core/files/'+derived.id);assert.equal(downloaded.status,200);
    assert.deepEqual(decode(downloaded.body).data,data,'all source edges/pixels retained for final composition');
    assert.deepEqual((await request('/api/data-core/files/'+file.body.file.id)).body,simple,'R2 original remains byte-identical');
    // CRC, pixel/byte limits, consent and legacy contracts remain enforced.
    output=detailed.slice();output[output.length-1]^=1;
    const corrupt=await edit();assert.equal(corrupt.status,502);assert.equal(corrupt.body.code,'image_normalization_failed');
    output=new Uint8Array(8*1024*1024+3);
    const oversized=await edit();assert.equal(oversized.status,502);assert.equal(oversized.body.code,'invalid_image_response');
    output=simple;
    const legacy=await request('/api/data-core/content/image-edit',{...input,requestId:crypto.randomUUID(),material:{materialKind:'ai-support',usePermission:'allowed',externalAiConsent:true}});
    assert.equal(legacy.status,201,JSON.stringify(legacy));assert.deepEqual([legacy.body.file.metadata.width,legacy.body.file.metadata.height],[2160,2700]);
    const denied=await request('/api/data-core/content/image-edit',{...input,requestId:crypto.randomUUID(),material:{...input.material,externalAiConsent:false}});
    assert.equal(denied.status,403);assert.equal(calls,4);
    const db=await mf.getD1Database('DB');
    const rows=await db.prepare("SELECT COUNT(*) n FROM file_objects WHERE category='instagram-derived'").first();
    assert.equal(rows.n,2,'failed responses never persist derivatives');
    const recordId=(await db.prepare('SELECT data_record_id id FROM file_objects WHERE id=?').bind(derived.id).first()).id;
    const originalMetadata=(await db.prepare('SELECT metadata_json value FROM data_records WHERE id=?').bind(recordId).first()).value;
    for(const patch of [{width:999999},{derivativeType:'instagram-layout'},{provider:'other'},{aspectRatio:'4:5'}]){
      await db.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(JSON.stringify({...JSON.parse(originalMetadata),...patch}),recordId).run();
      assert.equal((await request('/api/data-core/files/'+derived.id)).status,403,'invalid intermediate cannot bypass provenance');
    }
    await db.prepare('UPDATE data_records SET metadata_json=? WHERE id=?').bind(originalMetadata,recordId).run();
    await db.prepare('UPDATE file_objects SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),file.body.file.id).run();
    assert.equal((await request('/api/data-core/files/'+derived.id)).status,403,'deleted source remains inaccessible through intermediate');
  }finally{await mf.dispose();}
});

test('client-optimized upload bypasses the R2 original size cap, still enforces ownership/permission',async()=>{
  const width=64,height=80,simple=encode({width,height,channels:3,depth:8,data:new Uint8Array(width*height*3).fill(130)});
  const oversizedOriginal=new Uint8Array(8*1024*1024+1024); // > AI_IMAGE_BYTES; only ever stored in R2, never optimized/read here
  let calls=0;
  const names=['index.js',...(await readdir('dist/server',{recursive:true})).filter(n=>n.endsWith('.js')&&n!=='index.js')];
  const mf=new Miniflare({modules:names.map(n=>({type:'ESModule',path:path.resolve('dist/server',n)})),modulesRoot:path.resolve('dist/server'),
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB','FAMILY_DB'],r2Buckets:['FILES','FAMILY_FILES'],
    bindings:{DATA_CORE_SUPER_ADMIN_EMAILS:'edge2@example.test',OPENAI_API_KEY:'synthetic-only'},outboundService:async request=>{
      calls++;
      const form=await request.formData();
      assert.deepEqual(new Uint8Array(await form.get('image[]').arrayBuffer()),simple,'server must send the CLIENT-optimized bytes to OpenAI, not the raw oversized original');
      return Response.json({data:[{b64_json:Buffer.from(simple).toString('base64')}]});
    }});
  try{
    const headers={'oai-authenticated-user-id':'synthetic-ai-edge-2','oai-authenticated-user-email':'edge2@example.test','oai-authenticated-user-full-name':'Synthetic',origin:'http://localhost'};
    async function request(url,body){
      const h={...headers};let encoded=body;
      if(body instanceof FormData){const r=new Request('http://localhost',{method:'POST',body});h['content-type']=r.headers.get('content-type');encoded=new Uint8Array(await r.arrayBuffer());}
      else if(body){h['content-type']='application/json';encoded=JSON.stringify(body);}
      const r=await mf.dispatchFetch('http://localhost'+url,{method:body?'POST':'GET',headers:h,body:encoded});
      return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};
    }
    await request('/api/data-core/context');
    const campusId='campus-anihi-admission';
    const folder=await request('/api/data-core/library/folders',{parentFolderId:'category:'+campusId+':academy-photo',title:'SYNTHETIC LARGE'});
    assert.equal(folder.status,201,JSON.stringify(folder));
    const uploadForm=new FormData();uploadForm.set('recordId',folder.body.folder.id);uploadForm.set('file',new Blob([oversizedOriginal],{type:'image/png'}),'large-original.png');
    const file=await request('/api/data-core/library/files',uploadForm);
    assert.equal(file.status,201,JSON.stringify(file));
    const input={sourceApp:'instagram',campusId,sourceFileId:file.body.file.id,direction:'Brighten this synthetic image',material:{workflow:'carousel-v2',materialKind:'real-photo',usePermission:'allowed',externalAiConsent:true}};
    // Without a client-optimized copy, the oversized R2 original is rejected outright (existing hard cap, unchanged).
    const plain=await request('/api/data-core/content/image-edit',{...input,requestId:crypto.randomUUID()});
    assert.equal(plain.status,413,JSON.stringify(plain));
    assert.equal(calls,0,'must not call OpenAI for a rejected oversized original');
    // With a client-optimized working copy attached, the SAME oversized original now succeeds — the
    // R2 file itself is never read or resized in place, only the uploaded copy is used for the edit.
    const editForm=new FormData();editForm.set('input',JSON.stringify({...input,requestId:crypto.randomUUID()}));
    editForm.set('photo:'+file.body.file.id,new Blob([simple],{type:'image/png'}),file.body.file.id+'.jpg');
    const optimized=await request('/api/data-core/content/image-edit',editForm);
    assert.equal(optimized.status,201,JSON.stringify(optimized));
    assert.equal(calls,1);
    assert.deepEqual((await request('/api/data-core/files/'+file.body.file.id)).body,oversizedOriginal,'R2 original remains untouched and unresized');
    // Ownership/permission checks still apply on the client-optimized path: a mismatched campusId
    // must still be rejected, even though the oversized-original size check is skipped.
    const wrongCampusForm=new FormData();wrongCampusForm.set('input',JSON.stringify({...input,campusId:'campus-design-admission',requestId:crypto.randomUUID()}));
    wrongCampusForm.set('photo:'+file.body.file.id,new Blob([simple],{type:'image/png'}),file.body.file.id+'.jpg');
    const wrongCampus=await request('/api/data-core/content/image-edit',wrongCampusForm);
    assert.equal(wrongCampus.status,403,JSON.stringify(wrongCampus));
    assert.equal(calls,1,'must not call OpenAI when ownership check fails');
  }finally{await mf.dispose();}
});

test('instagram caption sends client-optimized copies too — an oversized original no longer 413s the caption',async()=>{
  const width=64,height=80,simple=encode({width,height,channels:3,depth:8,data:new Uint8Array(width*height*3).fill(90)});
  const oversizedOriginal=new Uint8Array(8*1024*1024+1024);
  let calls=0,sentImages=[],upstreamStatus=200;
  const names=['index.js',...(await readdir('dist/server',{recursive:true})).filter(n=>n.endsWith('.js')&&n!=='index.js')];
  const mf=new Miniflare({modules:names.map(n=>({type:'ESModule',path:path.resolve('dist/server',n)})),modulesRoot:path.resolve('dist/server'),
    compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB','FAMILY_DB'],r2Buckets:['FILES','FAMILY_FILES'],
    bindings:{DATA_CORE_SUPER_ADMIN_EMAILS:'edge3@example.test',OPENAI_API_KEY:'synthetic-only'},outboundService:async request=>{
      assert.equal(request.url,'https://api.openai.com/v1/responses');
      calls++;
      if(upstreamStatus!==200)return new Response('upstream failure',{status:upstreamStatus});
      const body=await request.json();
      sentImages=body.input[0].content.filter(c=>c.type==='input_image').map(c=>Buffer.from(c.image_url.split(',')[1],'base64'));
      return Response.json({status:'completed',usage:{},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'SYNTHETIC',body:'SYNTHETIC 본문',hashtags:['합성'],cta:'문의'})}]}]});
    }});
  try{
    const headers={'oai-authenticated-user-id':'synthetic-ai-edge-3','oai-authenticated-user-email':'edge3@example.test','oai-authenticated-user-full-name':'Synthetic',origin:'http://localhost'};
    async function request(url,body){
      const h={...headers};let encoded=body;
      if(body instanceof FormData){const r=new Request('http://localhost',{method:'POST',body});h['content-type']=r.headers.get('content-type');encoded=new Uint8Array(await r.arrayBuffer());}
      else if(body){h['content-type']='application/json';encoded=JSON.stringify(body);}
      const r=await mf.dispatchFetch('http://localhost'+url,{method:body?'POST':'GET',headers:h,body:encoded});
      return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};
    }
    await request('/api/data-core/context');
    const campusId='campus-anihi-admission';
    const folder=await request('/api/data-core/library/folders',{parentFolderId:'category:'+campusId+':academy-photo',title:'SYNTHETIC CAPTION'});
    const uploadForm=new FormData();uploadForm.set('recordId',folder.body.folder.id);uploadForm.set('file',new Blob([oversizedOriginal],{type:'image/png'}),'large-original.png');
    const file=await request('/api/data-core/library/files',uploadForm);assert.equal(file.status,201,JSON.stringify(file));
    const id=file.body.file.id;
    const input={sourceApp:'instagram',campusId,selectedFileIds:[id],textOnly:false,notes:'SYNTHETIC',material:{workflow:'carousel-v2',materialKind:'real-photo',usePermission:'allowed',externalAiConsent:true}};
    // The old JSON-only caption reads the R2 original and hits the 8MB cap — that is the reported bug.
    assert.equal((await request('/api/data-core/content/generate',{...input,requestId:crypto.randomUUID()})).status,413);
    assert.equal(calls,0);
    const form=new FormData();form.set('input',JSON.stringify({...input,requestId:crypto.randomUUID()}));form.set('photo:'+id,new Blob([simple],{type:'image/png'}),id+'.jpg');
    const captioned=await request('/api/data-core/content/generate',form);
    assert.equal(captioned.status,200,JSON.stringify(captioned));
    assert.equal(captioned.body.generated.title,'SYNTHETIC');
    assert.equal(calls,1);assert.equal(sentImages.length,1);
    assert.deepEqual([decode(new Uint8Array(sentImages[0])).width,decode(new Uint8Array(sentImages[0])).height],[width,height],'the AI got the small optimized copy, never the 8MB original');
    // Text-only captions must never carry image bytes, even if a client attaches some.
    const textOnlyForm=new FormData();textOnlyForm.set('input',JSON.stringify({...input,textOnly:true,requestId:crypto.randomUUID()}));textOnlyForm.set('photo:'+id,new Blob([simple],{type:'image/png'}),id+'.jpg');
    const textOnlyRes=await request('/api/data-core/content/generate',textOnlyForm);assert.equal(textOnlyRes.status,400,JSON.stringify(textOnlyRes.body));
    // Consent and campus scope still apply on the optimized path.
    const noConsent=new FormData();noConsent.set('input',JSON.stringify({...input,material:{...input.material,externalAiConsent:false},requestId:crypto.randomUUID()}));noConsent.set('photo:'+id,new Blob([simple],{type:'image/png'}),id+'.jpg');
    const noConsentRes=await request('/api/data-core/content/generate',noConsent);assert.equal(noConsentRes.status,403,JSON.stringify(noConsentRes.body));
    const wrongCampus=new FormData();wrongCampus.set('input',JSON.stringify({...input,campusId:'campus-design-admission',requestId:crypto.randomUUID()}));wrongCampus.set('photo:'+id,new Blob([simple],{type:'image/png'}),id+'.jpg');
    const wrongCampusRes=await request('/api/data-core/content/generate',wrongCampus);// Rejected by the existing same-campus rule before any permission or AI work.
    assert.equal(wrongCampusRes.status,400,JSON.stringify(wrongCampusRes.body));
    assert.equal(calls,1,'rejected requests never reach OpenAI');
    // An AI-server failure says which step failed instead of one generic message.
    upstreamStatus=500;
    const failedForm=new FormData();failedForm.set('input',JSON.stringify({...input,requestId:crypto.randomUUID()}));failedForm.set('photo:'+id,new Blob([simple],{type:'image/png'}),id+'.jpg');
    const failed=await request('/api/data-core/content/generate',failedForm);
    assert.equal(failed.status,502,JSON.stringify(failed.body));assert.equal(failed.body.code,'provider_error');
    assert.match(failed.body.error,/AI 서버 응답 500/u);
  }finally{await mf.dispose();}
});

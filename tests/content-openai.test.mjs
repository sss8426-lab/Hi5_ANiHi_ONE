import assert from 'node:assert/strict';
import test from 'node:test';
import { encode, decode } from 'fast-png';
import sharp from 'sharp';
import { libraryHarness, users, A, B, ORG } from './support/library-harness.mjs';

const png = () => encode({width:64,height:80,channels:4,depth:8,data:new Uint8Array(64*80*4).fill(180)});
// Blog structured-output shape (strategy + 3 title candidates + lead/body). Every test in this file
// that posts sourceApp:'blog' (the default from input()) mocks the provider with this object.
const generated = {
  strategy: {primaryTopic:'합성 수업 기록',searchIntent:'합성 수업 정보',nextQuestion:'다음엔 무엇을 배울까요',readerProblem:'그림이 늘지 않음'},
  titles: {search:'합성 학원 그림 수업',homefeed:'그림이 늘지 않는 이유',balanced:'합성 수업 기록, 그림이 늘지 않는 이유'},
  selectedTitleKind: 'balanced',
  lead: '그림을 많이 그려도 늘지 않는 학생은 장면을 먼저 생각하지 않는 경우가 많습니다. 합성 수업에서는 선과 색을 함께 살펴봅니다.',
  body: '선택한 그림의 선과 색을 함께 살펴봅니다.',
  hashtags: ['그림','성장'],
  cta: '수업 문의',
  nextTopics: ['합성 다음 주제 1','합성 다음 주제 2','합성 다음 주제 3'],
};
const textResponse = value => Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function fixture(h, user=users.staff, mime='image/png', bytes=png()) {
  const folder = await h.folder('category:'+user.campus+':class-photo','__synthetic_ai_'+crypto.randomUUID(),user);
  assert.equal(folder.status,201);
  const uploaded = await h.upload(folder.body.folder.id,user,{bytes,mime,name:'SYNTHETIC_PRIVATE_FILENAME.png'});
  assert.equal(uploaded.status,201);
  return uploaded.body.file;
}
function input(id, extra={}) { return {sourceApp:'blog',campusId:A,selectedFileIds:[id],notes:'합성 그림 설명',requestId:crypto.randomUUID(),...extra}; }

test('Responses adapter sends selected sanitized pixels, structured output; defaults and draft retain campus scope', async()=>{
  const h=await libraryHarness(), originalFetch=globalThis.fetch;
  try {
    const file=await fixture(h), original=await h.file(file.id);
    h.env.OPENAI_API_KEY='synthetic-test-only';
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
      calls++; assert.equal(String(url),'https://api.openai.com/v1/responses');
      const body=JSON.parse(options.body);
      assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);
      assert.equal(body.model,'gpt-5.6-luna');assert.equal(body.input[0].content.filter(item=>item.type==='input_image').length,1);
      const encoded=body.input[0].content[1].image_url.split(',')[1];
      assert.deepEqual(new Uint8Array(Buffer.from(encoded,'base64')),png());
      for(const forbidden of [file.id,original.r2_key,'SYNTHETIC_PRIVATE_FILENAME','synthetic-test-only',A])assert.ok(!options.body.includes(forbidden));
      return textResponse(generated);
    };
    const request=input(file.id), result=await h.request('POST','/api/data-core/content/generate',users.staff,request);
    assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body.generated.hashtags,generated.hashtags);
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,request)).status,409);assert.equal(calls,1);
    const defaults=await h.request('PUT','/api/data-core/content/defaults',users.staff,{sourceApp:'blog',campusId:A,hashtags:'#합성',footer:'합성 문의'});
    assert.equal(defaults.status,200);
    assert.equal((await h.request('GET','/api/data-core/content/defaults?sourceApp=blog&campusId='+A,users.staff)).body.defaults.footer,'합성 문의');
    for(const footer of ['전화 문의\n032-000-0000\n','']){
      assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.staff,{sourceApp:'blog',campusId:A,hashtags:'',footer})).status,200);
      assert.equal((await h.request('GET','/api/data-core/content/defaults?sourceApp=blog&campusId='+A,users.staff)).body.defaults.footer,footer);
    }
    assert.equal((await h.request('GET','/api/data-core/content/defaults?sourceApp=instagram&campusId='+A,users.staff)).body.defaults.footer,'');
    assert.equal((await h.request('GET','/api/data-core/content/defaults?sourceApp=blog&campusId='+A,users.foreign)).status,403);
    assert.equal((await h.request('PUT','/api/data-core/content/defaults',users.staff,{sourceApp:'blog',campusId:B,hashtags:'',footer:''})).status,403);
    const draft=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'blog',campusId:A,title:generated.titles[generated.selectedTitleKind],content:generated.body,relatedFileIds:[file.id],metadata:{footer:'합성 문의'}});
    assert.equal(draft.status,201,JSON.stringify(draft.body));
    assert.equal((await h.request('DELETE','/api/data-core/content/'+draft.body.draft.id,users.staff)).status,200);
    assert.deepEqual(await h.file(file.id),original);
  }finally{globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('Image Edit adapter normalizes, stores provenance, protects original and permits authenticated download/soft trash',async()=>{
  const h=await libraryHarness(), originalFetch=globalThis.fetch;
  try {
    const file=await fixture(h), original=await h.file(file.id), originalBytes=new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer());
    h.env.OPENAI_API_KEY='synthetic-test-only';
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
      calls++;assert.equal(String(url),'https://api.openai.com/v1/images/edits');
      assert.ok(options.body instanceof FormData);assert.equal(options.body.get('model'),'gpt-image-2.5-flare');
      assert.equal(options.body.get('output_format'),'png');assert.equal(options.body.get('n'),'1');
      const image=options.body.get('image[]');assert.equal(image.name,'selected-image.png');
      assert.deepEqual(new Uint8Array(await image.arrayBuffer()),originalBytes);
      assert.ok(!options.body.get('prompt').includes(file.id));
      return Response.json({data:[{b64_json:Buffer.from(png()).toString('base64')}]});
    };
    const body={sourceApp:'instagram',campusId:A,sourceFileId:file.id,direction:'밝게 보정',material:{materialKind:'ai-support',usePermission:'allowed',externalAiConsent:true},requestId:crypto.randomUUID()};
    const result=await h.request('POST','/api/data-core/content/image-edit',users.staff,body);
    assert.equal(result.status,201,JSON.stringify(result.body));
    const output=result.body.file;
    assert.notEqual(output.id,file.id);assert.equal(output.metadata.derivedFromFileId,file.id);
    assert.equal(output.metadata.derivativeType,'instagram-ai-edit');assert.equal(output.metadata.aiEdited,true);
    assert.equal(output.sourceApp,'instagram');assert.equal(output.category,'instagram-derived');
    const response=await h.raw('GET','/api/data-core/files/'+output.id,users.staff);
    assert.equal(response.status,200);const pixels=decode(new Uint8Array(await response.arrayBuffer()));
    assert.equal(pixels.width,2160);assert.equal(pixels.height,2700);
    assert.equal((await h.request('GET','/api/data-core/files/'+output.id,users.foreign)).status,403);
    const draft=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'합성 인스타',relatedFileIds:[file.id],derivedFileIds:[output.id]});
    assert.equal(draft.status,201,JSON.stringify(draft.body));
    assert.equal((await h.request('POST','/api/data-core/content/image-edit',users.staff,body)).status,409);assert.equal(calls,1);
    assert.deepEqual(await h.file(file.id),original);
    assert.deepEqual(new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer()),originalBytes);
    await h.request('DELETE','/api/data-core/content/'+draft.body.draft.id,users.staff);
    assert.equal((await h.request('DELETE','/api/data-core/files/'+output.id,users.staff)).status,200);
    const row=await h.file(output.id);assert.ok(row.deleted_at);assert.ok(await h.env.FILES.head(row.r2_key));
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT value FROM library_sentinel').first()).value,'preserved');
  }finally{globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('AI rejects unauthorized, non-image, private, cross-campus, forged provenance and excess selections without provider traffic',async()=>{
  const h=await libraryHarness(), originalFetch=globalThis.fetch;
  try {
    const file=await fixture(h), foreign=await fixture(h,users.foreign), doc=await fixture(h,users.staff,'text/plain',new TextEncoder().encode('synthetic'));
    const privateFile=await fixture(h,users.teacher);
    await h.env.DB.prepare("UPDATE file_objects SET visibility='private' WHERE id=?").bind(privateFile.id).run();
    h.env.OPENAI_API_KEY='synthetic-test-only';let calls=0;
    globalThis.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);calls++;throw Error('No external call allowed');};
    const endpoint='/api/data-core/content/generate';
    for(const [user,body,status] of [[null,input(file.id),401],[users.foreign,input(file.id),403],[users.staff,input(foreign.id),403],[users.staff,input(privateFile.id),403],[users.staff,input(doc.id),415],[users.staff,input(file.id,{selectedFileIds:Array.from({length:7},()=>crypto.randomUUID())}),400]]) {
      const r=await h.request('POST',endpoint,user,body);assert.equal(r.status,status,JSON.stringify(r.body));
    }
    assert.equal((await h.request('POST',endpoint,users.staff,input(file.id),'https://attacker.test')).status,403);
    assert.equal((await h.request('GET','/api/data-core/content/ai-status',users.staff)).status,403);
    const status=await h.request('GET','/api/data-core/content/ai-status',users.admin);assert.equal(status.body.configured,true);assert.ok(!JSON.stringify(status).includes('synthetic-test-only'));
    const record=await h.request('POST','/api/data-core/records',users.admin,{recordType:'content-ai-request',sourceApp:'data-core',title:'forged'});
    assert.equal(record.status,403);
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('sanitized JPEG/WebP retain orientation but never original EXIF; provider failures remain allowlisted',async()=>{
  const h=await libraryHarness(), originalFetch=globalThis.fetch;
  const originalError=console.error,logs=[];
  console.error=(...values)=>logs.push(JSON.stringify(values));
  try {
    h.env.OPENAI_API_KEY='synthetic-test-only';
    for(const format of ['jpeg','webp']) {
      const bytes=await sharp({create:{width:32,height:40,channels:3,background:'#7aaf9c'}}).withMetadata({orientation:6,exif:{IFD0:{Artist:'SECRET-SYNTHETIC-ARTIST'},IFD3:{GPSLatitudeRef:'N'}}})[format]().toBuffer();
      const file=await fixture(h,users.staff,'image/'+format,bytes);
      globalThis.fetch=async(url,options)=>{
        if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
        const body=JSON.parse(options.body), image=Buffer.from(body.input[0].content[1].image_url.split(',')[1],'base64');
        assert.ok(!image.includes(Buffer.from('SECRET-SYNTHETIC-ARTIST')));
        const meta=await sharp(image).metadata();assert.equal(meta.orientation,6);assert.equal(meta.width,32);assert.equal(meta.height,40);
        return textResponse(generated);
      };
      const result=await h.request('POST','/api/data-core/content/generate',users.staff,input(file.id));
      assert.equal(result.status,200,JSON.stringify(result.body));
    }
    const file=await fixture(h);
    for(const [upstream,expected] of [[401,503],[403,503],[429,429],[500,502]]) {
      globalThis.fetch=async(url,options)=>String(url).startsWith('https://api.openai.com/')?Response.json({error:'SECRET-SYNTHETIC-RAW-ERROR'},{status:upstream}):originalFetch(url,options);
      const result=await h.request('POST','/api/data-core/content/generate',users.staff,input(file.id));
      assert.equal(result.status,expected);assert.ok(!JSON.stringify(result.body).includes('SECRET-SYNTHETIC'));
    }
    globalThis.fetch=async(url,options)=>String(url).startsWith('https://api.openai.com/')?textResponse({title:'invalid'}):originalFetch(url,options);
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,input(file.id))).status,502);
    delete h.env.OPENAI_API_KEY;
    const absent=await h.request('POST','/api/data-core/content/generate',users.staff,input(file.id));assert.equal(absent.status,503);assert.equal(absent.body.available,false);
    assert.ok(!logs.join('\n').includes('SECRET-SYNTHETIC'));
    assert.ok(!logs.join('\n').includes('synthetic-test-only'));
    assert.equal((await h.env.DB.prepare('SELECT COUNT(*) count FROM file_objects WHERE category=? AND organization_id=?').bind('instagram-derived',ORG).first()).count,0);
  }finally{console.error=originalError;globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('blog multipart path: 10 browser-optimized photos bypass R2 entirely, still enforce per-file/total hard caps and reject non-blog use',async()=>{
  const h=await libraryHarness(),originalFetch=globalThis.fetch;
  try {
    const files=[];for(let i=0;i<10;i++)files.push(await fixture(h));
    const originalRows=await Promise.all(files.map(f=>h.file(f.id)));
    h.env.OPENAI_API_KEY='synthetic-test-only';
    const optimized=await sharp({create:{width:40,height:30,channels:3,background:'#335577'}}).jpeg({quality:80}).toBuffer();
    const multipart=(selected,bytesById)=>{
      const form=new FormData();
      form.set('input',JSON.stringify({sourceApp:'blog',campusId:A,selectedFileIds:selected.map(f=>f.id),notes:'합성 다중 사진',requestId:crypto.randomUUID()}));
      for(const file of selected)form.set(`photo:${file.id}`,new Blob([bytesById.get(file.id)||optimized],{type:'image/jpeg'}),`${file.id}.jpg`);
      return form;
    };
    let calls=0,sentImages=0;
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
      calls++;const body=JSON.parse(options.body),images=body.input[0].content.filter(item=>item.type==='input_image');
      sentImages=images.length;
      // Every image sent to the provider must be the browser-optimized 40x30 JPEG, never the R2
      // 64x80 PNG original (sanitizeAiImage rewrites JPEG markers, so compare decoded metadata).
      for(const image of images){
        const meta=await sharp(Buffer.from(image.image_url.split(',')[1],'base64')).metadata();
        assert.equal(meta.format,'jpeg');assert.equal(meta.width,40);assert.equal(meta.height,30);
      }
      return textResponse(generated);
    };
    const result=await h.request('POST','/api/data-core/content/generate',users.staff,multipart(files,new Map()));
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(calls,1);assert.equal(sentImages,10);

    // An 11th photo is rejected before any provider traffic (JSON-only requests keep the old 6-photo cap).
    const eleventh=await fixture(h);
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,multipart([...files,eleventh],new Map()))).status,400);
    assert.equal(calls,1);

    // A single optimized photo over the 2MiB hard cap is rejected before provider traffic.
    const bigBytes=new Map([[files[0].id,new Uint8Array(3*1024*1024)]]);
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,multipart([files[0]],bigBytes))).status,413);
    assert.equal(calls,1);

    // Several individually-under-cap photos can still add up past the 16MiB total safety cap.
    const nine=files.slice(0,9), overTotal=new Map(nine.map(f=>[f.id,new Uint8Array(1.9*1024*1024)]));
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,multipart(nine,overTotal))).status,413);
    assert.equal(calls,1);

    // Instagram captions may use this multipart shape too (see instagram-ai-edge), but only with the
    // AI-use consent; without it the request is refused before any provider traffic, and a text-only
    // caption may never carry image bytes at all.
    const instagramForm=new FormData();
    instagramForm.set('input',JSON.stringify({sourceApp:'instagram',campusId:A,selectedFileIds:[files[0].id],notes:'x',requestId:crypto.randomUUID()}));
    instagramForm.set(`photo:${files[0].id}`,new Blob([optimized],{type:'image/jpeg'}),'x.jpg');
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,instagramForm)).status,403);
    const textOnlyForm=new FormData();
    textOnlyForm.set('input',JSON.stringify({sourceApp:'instagram',campusId:A,selectedFileIds:[files[0].id],notes:'x',textOnly:true,requestId:crypto.randomUUID()}));
    textOnlyForm.set(`photo:${files[0].id}`,new Blob([optimized],{type:'image/jpeg'}),'x.jpg');
    assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,textOnlyForm)).status,400);
    assert.equal(calls,1);
    // None of this ever wrote to the R2 originals or their file_objects rows.
    assert.deepEqual(await Promise.all(files.map(f=>h.file(f.id))),originalRows);
  }finally{globalThis.fetch=originalFetch;await h.mf.dispose();}
});

test('six-photo budget and concurrent request lease prevent extra paid calls; byte limits fail before provider traffic',async()=>{
  const h=await libraryHarness(),originalFetch=globalThis.fetch,originalBucket=h.env.FILES;
  let release;
  try {
    const ids=[];for(let i=0;i<6;i++)ids.push((await fixture(h)).id);
    h.env.OPENAI_API_KEY='synthetic-test-only';
    let calls=0,entered;
    const started=new Promise(resolve=>{entered=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://api.openai.com/'))return originalFetch(url,options);
      calls++;assert.equal(JSON.parse(options.body).input[0].content.filter(c=>c.type==='input_image').length,6);
      entered();await gate;return textResponse(generated);
    };
    const first=h.request('POST','/api/data-core/content/generate',users.staff,input(ids[0],{selectedFileIds:ids}));
    await started;
    const concurrent=await h.request('POST','/api/data-core/content/generate',users.staff,input(ids[0]));
    assert.equal(concurrent.status,409);release();assert.equal((await first).status,200);assert.equal(calls,1);
    for(const [size,selectedFileIds] of [[9*1024*1024,[ids[0]]],[6*1024*1024,ids.slice(0,3)]]) {
      h.env.FILES={get:async key=>{const object=await originalBucket.get(key);return {size,body:new ReadableStream({start(controller){controller.close();}}),arrayBuffer:()=>object.arrayBuffer()};}};
      assert.equal((await h.request('POST','/api/data-core/content/generate',users.staff,input(ids[0],{selectedFileIds}))).status,413,'size budget '+size);
    }
    assert.equal(calls,1);
    const jobs=await h.env.DB.prepare("SELECT status,deleted_at,metadata_json FROM data_records WHERE record_type='content-ai-request'").all();
    assert.ok(jobs.results.every(row=>row.deleted_at&&row.metadata_json==='{}'));
  }finally{release?.();h.env.FILES=originalBucket;globalThis.fetch=originalFetch;await h.mf.dispose();}
});

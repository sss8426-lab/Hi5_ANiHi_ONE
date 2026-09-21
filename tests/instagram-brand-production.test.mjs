import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from 'fast-png';
import { libraryHarness,users,A,B,ORG } from './support/library-harness.mjs';
import { getInstagramCampusLogoLabel,normalizeDesign,designChecks,TEMPLATES } from '../public/data-core/instagram-brand-policy.js';

test('campus logo projection is exact, source names unchanged, all template recommendations are deterministic',()=>{
  const cases=[['부천 디자인 입시본원','부천 입시본원'],['부천 애니 입시본원','부천 입시본원'],['부천 범박 캠퍼스','범박 캠퍼스'],['부천 원종 캠퍼스','원종 캠퍼스'],['부천 중동 캠퍼스','중동 캠퍼스'],['부천 옥길 캠퍼스','옥길 캠퍼스'],['서울 광진 입시본원','광진 입시본원'],['울산 송정 입시본원','송정 입시본원'],['안산 입시본원','안산 입시본원'],['파주 입시본원','파주 입시본원']];
  const original=structuredClone(cases);for(const [name,label]of cases)assert.equal(getInstagramCampusLogoLabel(name),label);assert.deepEqual(cases,original);
  assert.equal(getInstagramCampusLogoLabel('부천 다른 장소'),'부천 다른 장소');
  assert.equal(normalizeDesign(null).usePermission,'review');
  for(const [templateId,template]of Object.entries(TEMPLATES))assert.equal(normalizeDesign({templateId}).logoType,template.logo);
  assert.ok(designChecks(normalizeDesign({templateId:'design',logoType:'anihi'}),'범박 캠퍼스').some(c=>c.code==='logo-topic'&&c.status==='human_required'));
});

const png=(w,h)=>encode({width:w,height:h,channels:4,depth:8,data:new Uint8Array(w*h*4).fill(190)});
const design={templateId:'artwork',logoType:'anihi',materialKind:'student-artwork',usePermission:'allowed',headline:'SYNTHETIC 작품 소개',contact:'DM 문의',factsVerified:true};
const checks=Object.fromEntries(['artwork','logo','design','ai','privacy','readability','facts'].map(k=>[k,true]));

test('Instagram production uses existing files, version-bound approval, scoped permissions and non-destructive export',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC Instagram',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC.png',mime:'image/png',bytes:png(120,80)})).body.file;
    const original=await h.file(file.id),bytes=new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer());
    const created=await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC 게시물',content:'실제 실적을 주장하지 않는 검증 문구',relatedFileIds:[file.id],metadata:{instagramDesign:design}});
    assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.draft.id,base='/api/data-core/content/instagram/'+id;
    let review=await h.request('GET',base+'/review',users.staff);assert.equal(review.status,200,JSON.stringify(review.body));assert.equal(review.body.campusLogoLabel,'부천 입시본원');assert.equal(review.body.canApprove,false);
    assert.equal((await h.request('GET',base+'/review',users.foreign)).status,403);
    assert.equal((await h.request('GET',base+'/review',null)).status,401);
    const makeForm=fingerprint=>{const form=new FormData();form.set('file',new Blob([png(2160,2700)],{type:'image/png'}),'SYNTHETIC-render.png');form.set('fingerprint',fingerprint);return form;};
    assert.equal((await h.request('POST',base+'/render',users.staff,makeForm('stale'))).status,409);
    const rendered=await h.request('POST',base+'/render',users.staff,makeForm(review.body.fingerprint));assert.equal(rendered.status,201,JSON.stringify(rendered.body));
    const {renderId}=rendered.body,payload={renderId,fingerprint:review.body.fingerprint};
    assert.equal(rendered.body.file.metadata.derivedFromFileId,file.id);assert.equal(rendered.body.file.metadata.campusLogoLabel,'부천 입시본원');
    assert.equal((await h.request('POST',base+'/export',users.staff,payload)).status,409);
    assert.equal((await h.request('POST',base+'/approve',users.staff,payload)).status,400);
    const approved=await h.request('POST',base+'/approve',users.staff,{...payload,checks});assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.approved,true);
    assert.equal((await h.request('POST',base+'/approve',users.foreign,{...payload,checks})).status,403);
    assert.equal((await h.request('POST',base+'/approve',users.staff,{...payload,checks},'https://attacker.test')).status,403);
    const exported=await h.raw('POST',base+'/export',users.staff,payload);assert.equal(exported.status,200);const output=decode(new Uint8Array(await exported.arrayBuffer()));assert.equal(output.width,1080);assert.equal(output.height,1350);
    const savedRender=JSON.parse((await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(renderId).first()).metadata_json);
    const published=await h.file(savedRender.exportFileId);assert.ok(published);
    const provenance=JSON.parse((await h.env.DB.prepare('SELECT metadata_json FROM data_records WHERE id=?').bind(published.data_record_id).first()).metadata_json);
    assert.equal(provenance.derivativeType,'instagram-publish');assert.equal(provenance.derivedFromFileId,file.id);
    assert.equal((await h.raw('GET','/api/data-core/files/'+published.id,users.staff)).status,200);
    assert.equal((await h.raw('GET','/api/data-core/files/'+published.id,users.foreign)).status,403);
    for(const change of [{content:'수정된 캡션'},{metadata:{instagramDesign:{...design,logoType:'hi5'}}},{metadata:{instagramDesign:{...design,contact:'변경 DM'}}}]){
      assert.equal((await h.request('PATCH','/api/data-core/content/'+id,users.staff,change)).status,200);
      assert.equal((await h.request('POST',base+'/export',users.staff,payload)).status,409);
    }
    assert.equal((await h.request('PATCH','/api/data-core/records/'+renderId,users.admin,{metadata:{approval:{fingerprint:payload.fingerprint}}})).status,403);
    assert.equal((await h.request('POST','/api/data-core/records',users.admin,{recordType:'instagram-reviewed-render',sourceApp:'instagram',title:'forged',metadata:{approval:true}})).status,403);
    const reopened=await h.request('GET',base+'/review',users.staff);assert.equal(reopened.body.renderId,renderId);assert.equal(reopened.body.approved,false);
    assert.deepEqual(await h.file(file.id),original);assert.deepEqual(new Uint8Array(await(await h.env.FILES.get(original.r2_key)).arrayBuffer()),bytes);
    assert.equal((await h.env.FAMILY_DB.prepare('SELECT value FROM library_sentinel').first()).value,'preserved');
    const log=await h.env.DB.prepare("SELECT action FROM audit_logs WHERE resource_type='instagram-production' ORDER BY created_at").all();assert.deepEqual(log.results.map(r=>r.action),['instagram.render','instagram.approve','instagram.export']);
    assert.equal((await h.request('GET','/api/data-core/content/instagram-policy?campusId='+B,users.staff)).status,403);
    assert.equal((await h.request('GET','/api/data-core/content/instagram-policy?campusId='+B,users.admin)).status,200);
    const untouched=await h.env.DB.prepare('SELECT name FROM campuses WHERE id=? AND organization_id=?').bind(A,ORG).first();assert.notEqual(untouched.name,'부천 입시본원');
  }finally{await h.mf.dispose();}
});

test('Instagram blocks student artwork, missing consent and document sources before any external AI request',async()=>{
  const h=await libraryHarness();let calls=0;const previous=globalThis.fetch;
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC consent',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff,{mime:'image/png',bytes:png(32,32)})).body.file;
    h.env.OPENAI_API_KEY='synthetic-only';globalThis.fetch=async()=>{calls++;throw Error('Provider must not run');};
    for(const material of [undefined,{materialKind:'student-artwork',usePermission:'allowed',externalAiConsent:true},{materialKind:'ai-support',usePermission:'review',externalAiConsent:true},{materialKind:'real-photo',usePermission:'allowed',externalAiConsent:true}]){
      const r=await h.request('POST','/api/data-core/content/image-edit',users.staff,{sourceApp:'instagram',campusId:A,sourceFileId:file.id,direction:'synthetic',requestId:crypto.randomUUID(),material});assert.equal(r.status,403,JSON.stringify(r.body));
    }
    const r=await h.request('POST','/api/data-core/content/generate',users.staff,{sourceApp:'instagram',campusId:A,selectedFileIds:[file.id],notes:'synthetic',requestId:crypto.randomUUID(),material:{materialKind:'student-artwork',usePermission:'allowed',externalAiConsent:true}});assert.equal(r.status,403);assert.equal(calls,0);
  }finally{globalThis.fetch=previous;await h.mf.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare} from 'miniflare';
import {detailUpdateStatement} from '../scripts/guideline-enrichment-sql.mjs';
import {paginate} from '../public/data-core/pagination.js';
import {detailColumns,enrichPublicDetails,projectPublicDetails} from '../public/data-core/guideline-details.js';
import {decodePublicGuidelines,guidelineIdentity,projectGuideline} from '../public/data-core/admissions-model.js';

test('university pagination clamps pages, returns at most four, preserves exact source correspondence',()=>{
  const rows=Array.from({length:55},(_,id)=>({id,sourceUniversityId:`source-${id}`}));
  assert.deepEqual(paginate(rows).rows,rows.slice(0,4));
  const second=paginate(rows,2);assert.deepEqual(second.rows.map(r=>r.sourceUniversityId),['source-4','source-5','source-6','source-7']);
  assert.equal(paginate(rows,999).page,14);assert.equal(paginate(rows,-3).page,1);
  assert.equal(paginate(rows,14).rows.length,3);assert.equal(paginate([]).rows.length,0);
  assert.ok(paginate(rows,7).buttons.includes(null));assert.equal(paginate(rows,7).buttons[0],1);
  assert.equal(paginate(rows,7).buttons.at(-1),14);
});
test('source details are additive, source identity fingerprint mapping and known values remain intact',()=>{
  const previous={academicYear:'2027',universityName:'합성대',department:'웹툰',admissionType:'실기',admissionCategory:'실기',admissionSeason:'susi',quota:10,sourcePriority:50,mappingStatus:'review',universityId:null,sourceFingerprint:'unchanged',sourceUpdatedAt:'2026-01-01',publicDetails:{previousQuota:'12'}};
  const before=structuredClone(previous);const next=enrichPublicDetails(previous,{previousQuota:'99',previousApplicants:'0',studentName:'PRIVATE',practicalVenue:null});
  assert.deepEqual(previous,before);assert.equal(next.publicDetails.previousQuota,'12');assert.equal(next.publicDetails.previousApplicants,'0');
  assert.equal(next.sourceFingerprint,previous.sourceFingerprint);assert.equal(next.mappingStatus,'review');assert.equal(next.universityId,null);
  assert.equal(guidelineIdentity(next),guidelineIdentity(previous));assert.equal(next.quota,10);
  assert.doesNotMatch(JSON.stringify(next),/PRIVATE|studentName/);
  for(const protectedRow of [{...previous,sourcePriority:80},{...previous,sourcePriority:100},{...previous,verificationStatus:'verified'}])assert.equal(enrichPublicDetails(protectedRow,{previousApplicants:'1'}),protectedRow);
});
test('public table details exclude member-only hidden JSON columns and malformed pool indexes',()=>{
  const facts={'학년도':'2027','대학':'합성대','모집단위':'웹툰','전형명':'일반','전형구분':'정원내','전형유형세부':'실기','전년도 모집인원':'0','전년도 지원인원':'15','학생부 1학년':'MEMBER_ONLY','전년도 합격자 통계':'PRIVATE_STATS'};
  const c=Object.keys(facts),p=Object.values(facts),raw={c,p,r:[c.map((_,i)=>i)]};
  const [row]=decodePublicGuidelines(raw,'susi',{});assert.equal(row.publicDetails.previousQuota,'0');assert.equal(row.publicDetails.previousApplicants,'15');
  assert.doesNotMatch(JSON.stringify(row),/MEMBER_ONLY|PRIVATE_STATS/);
  assert.deepEqual(projectGuideline({...row,publicDetails:{...row.publicDetails,password:'SECRET'}}).publicDetails,row.publicDetails);
  raw.r[0][c.indexOf('전년도 모집인원')]=999;assert.throws(()=>decodePublicGuidelines(raw,'susi',{}));
  assert.equal(Object.keys(detailColumns).length,11);assert.deepEqual(projectPublicDetails({foo:'secret'}),{});
});
test('counseling UI removes only manual competition surfaces and keeps safe gallery controls',()=>{
  const html=fs.readFileSync('public/data-core/index.html','utf8');
  assert.doesNotMatch(html,/id="openCompetitionBtn"|id="competitionList"|id="competitionDetail"|DATA CORE 대회 목록/);
  for(const id of ['openAwardFolderBtn','openAwardUploadBtn','deleteSelectedAwardsBtn','awardDeleteDialog','refreshCompetitionSourcesBtn'])assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('/data-core/image-gallery.js'));
  assert.match(html,/counseling-image-cards/);assert.match(html,/competition-hero/);
  for(const file of ['competition-challenge','admission-roadmap'])assert.ok(fs.statSync(`public/data-core/assets/counseling/${file}.webp`).size<300000);
});

test('additive enrichment SQL preserves identity, originals, tombstones, foreign rows and concurrent changes',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
  try{
    const db=await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE data_records(id TEXT PRIMARY KEY,organization_id TEXT,campus_id TEXT,source_app TEXT,record_type TEXT,metadata_json TEXT,deleted_at TEXT)').run();
    const previous={sourcePriority:50,sourceFingerprint:'fixed',mappingStatus:'review',universityId:null,quota:12};
    for(const id of ['one','foreign','deleted','concurrent'])await db.prepare('INSERT INTO data_records VALUES (?,?,?,?,?,?,?)').bind(id,'org-hi5-anihi',id==='foreign'?'other':null,'admissions','university-admission-susi',JSON.stringify(id==='concurrent'?{...previous,quota:13}:previous),id==='deleted'?'2026-01-01':null).run();
    const row={id:'one',metadata_json:JSON.stringify(previous)};
    const next=enrichPublicDetails(previous,{previousApplicants:"120's",previousQuota:'0'});
    for(const id of ['one','foreign','deleted','concurrent'])await db.prepare(detailUpdateStatement({...row,id},next,'2026-09-09')).run();
    const results=(await db.prepare('SELECT * FROM data_records ORDER BY id').all()).results;
    for(const result of results){const m=JSON.parse(result.metadata_json);assert.equal(m.sourceFingerprint,'fixed');assert.equal(m.mappingStatus,'review');assert.equal(m.universityId,null);if(result.id==='one'){assert.deepEqual(m.publicDetails,next.publicDetails);assert.equal(m.quota,12);}else{assert.equal(m.publicDetails,undefined);assert.equal(m.quota,result.id==='concurrent'?13:12);}}
    const retry=await db.prepare(detailUpdateStatement(row,next,'2026-09-10')).run();assert.equal(retry.meta.changes,0);
  }finally{await mf.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare} from 'miniflare';
import {programView,filterPrograms,ratioFilterOptions,percent} from '../public/data-core/roadmap-model.js';
import {paginate} from '../public/data-core/pagination.js';
import {ratioPrograms} from './fixtures/roadmap-ratio-programs.mjs';

const views=ratioPrograms.map(programView);
const ids=rows=>rows.map(p=>p.id.replace('synthetic-ratio-',''));

test('A-H ratio combinations use exact numbers, preserve zero and exclude staged/unknown records',()=>{
  for(const [filters,expected] of [
    [{academicRatio:'20',practicalRatio:'80'},['A']],
    [{academicRatio:'30',practicalRatio:''},['B']],
    [{academicRatio:'',practicalRatio:'100%'},['D']],
    [{academicRatio:20,practicalRatio:60},['F']],
    [{academicRatio:100,practicalRatio:0},['E']],
    [{academicRatio:'',practicalRatio:''},['A','B','C','D','E','F','G','H']],
    [{academicRatio:'40'},['C']],
    [{practicalRatio:'60'},['C','F']],
  ])assert.deepEqual(ids(filterPrograms(views.slice(0,8),filters)),expected);
  for(const value of ['79','81','70~80','80 or 100',true,[],{},'1e2','0x50','-1','101']){
    assert.deepEqual(filterPrograms(views,{practicalRatio:value}),[]);
  }
  assert.equal(percent(' 80% '),80);assert.equal(percent('0'),0);
  assert.equal(views[5].other,20);
  assert.equal(views[1].grade,30,'school record and CSAT share the safe formula helper');
  const stringView={...views[0],grade:'20%',skill:'80%'};
  assert.equal(filterPrograms([stringView],{academicRatio:20,practicalRatio:80}).length,1);
});

test('ratio facets are distinct sorted real values for the structural subset, not the current page or ratio pair',()=>{
  assert.deepEqual(ratioFilterOptions(views),{academicRatio:[0,20,25,30,35,40,100],practicalRatio:[0,60,65,70,75,80,100]});
  assert.deepEqual(ratioFilterOptions(views,{region:'경기',schoolType:'4년제',admission:'수시',academicRatio:20,practicalRatio:80}),{academicRatio:[0,20],practicalRatio:[80,100]});
  assert.deepEqual(ids(filterPrograms(views,{region:'경기',schoolType:'4년제',admission:'수시',academicRatio:20,practicalRatio:80})),['A']);
  assert.deepEqual(ratioFilterOptions(views,{region:'없는 지역'}),{academicRatio:[],practicalRatio:[]});
  assert.equal(paginate(views,1).rows.length,4);assert.equal(paginate(views,2).rows.length,4);assert.equal(paginate(views,3).rows.length,2);
  assert.equal(paginate(filterPrograms(views,{academicRatio:20,practicalRatio:80}),3).page,1);
});

test('explicit staged or incomplete formulas override old numeric fields, including reviewed legacy rows',()=>{
  const metadata={year:2028,officialSourceUrl:'https://example.edu/guide.pdf',verificationStatus:'approved',verifiedAt:'2026-09-11',gradeRatio:'40%',skillRatio:'60%'};
  for(const formula of ['1단계 학생부100 / 2단계 1단계40+실기60','학생부40+실기','실기60','학생부40 또는 수능40+실기60','학생부40점+실기60점']){
    const row=programView({metadata:{...metadata,selectionFormula:formula}});
    assert.equal(row.grade,null);assert.equal(row.skill,null);
    assert.equal(filterPrograms([row],{practicalRatio:60}).length,0);
  }
  assert.equal(programView({metadata:{...metadata,ratioStatus:'staged'}}).grade,null);
  assert.equal(programView({metadata}).grade,40,'existing fully reviewed numeric-only legacy pair still works');
  assert.equal(programView({metadata:{...metadata,selectionMethodText:'학생부10+수능20+실기70'}}).grade,30);
});

test('roadmap HTML exposes five real labels and removes the old emphasis filter without changing other views',()=>{
  const html=fs.readFileSync('public/data-core/roadmap.html','utf8');
  for(const [id,label] of [['regionFilter','지역'],['schoolFilter','학교 유형'],['admissionFilter','모집 시기'],['academicRatioFilter','성적 %'],['practicalRatioFilter','실기 %']]){
    assert.ok(html.includes(`<label for="${id}">${label}</label><select id="${id}">`));
  }
  assert.doesNotMatch(html,/focusFilter|전형 특징/);
});

test('Worker paginated ratios/facets preserve source bytes, authorization and guideline detail',async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:['DB'],r2Buckets:['FILES'],d1Persist:false,r2Persist:false});
  try{
    const {default:worker}=await import('../dist/server/index.js');
    const DB=await mf.getD1Database('DB'),FILES=await mf.getR2Bucket('FILES');
    const original=JSON.stringify({students:[{name:'SYNTHETIC_PRIVATE'}],universities:[],cases:[],awardFolders:[],settings:{preserve:true}});
    await FILES.put('state/admissions-data.json',original);
    const env={DB,FILES,DATA_CORE_SUPER_ADMIN_EMAILS:'ratio-admin@example.test'};
    const headers={'oai-authenticated-user-id':'synthetic-ratio-admin','oai-authenticated-user-email':'ratio-admin@example.test'};
    const url='/api/data-core/roadmap/programs?careerId=D001&page=1';
    const call=(path,auth=true)=>worker.fetch(new Request('http://localhost'+path,{headers:auth?headers:{}}),env,{waitUntil(){},passThroughOnException(){}});
    assert.equal((await call(url,false)).status,401);
    assert.equal((await call(url)).status,200);
    const user=await DB.prepare('SELECT id FROM users WHERE email=?').bind('ratio-admin@example.test').first('id');
    for(const p of ratioPrograms){const m=p.metadata;
      await DB.prepare("INSERT INTO data_records (id,organization_id,created_by_user_id,record_type,source_app,title,visibility,status,metadata_json,created_at,updated_at) VALUES (?,'org-hi5-anihi',?,'university-admission-susi','admissions','Synthetic ratio','organization','active',?,'2026-09-11','2026-09-11')")
        .bind(p.id,user,JSON.stringify({...m,academicYear:m.year,department:m.major,admissionType:'합성 전형',gradeRatio:99,practicalRatio:99})).run();
    }
    const snapshot=async()=>JSON.stringify((await DB.prepare("SELECT id,metadata_json FROM data_records WHERE source_app='admissions' ORDER BY id").all()).results);
    const before=await snapshot();
    for(const [query,expected] of [['&academicRatio=20&practicalRatio=80',['A']],['&academicRatio=30',['B']],['&practicalRatio=100',['D']],['&academicRatio=20&practicalRatio=60',['F']],['&practicalRatio=0',['E']],['&practicalRatio=81',[]]]){
      const response=await call(url+query),body=await response.json();
      assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
      assert.deepEqual(ids(body.programs),expected);assert.equal(body.pagination.page,1);
      assert.equal(body.pagination.total,expected.length);assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_PRIVATE/);
      assert.deepEqual(body.facets.academicRatio,[0,20,25,30,35,40,100]);
    }
    const regional=await(await call(url+'&region='+encodeURIComponent('경기')+'&admission='+encodeURIComponent('수시'))).json();
    assert.deepEqual(regional.facets.academicRatio,[0,20]);assert.deepEqual(regional.facets.practicalRatio,[80,100]);
    const page2=await(await call(url.replace('page=1','page=2'))).json();assert.equal(page2.programs.length,4);assert.equal(page2.pagination.totalPages,3);
    const detail=await(await call('/api/data-core/admissions/guidelines?id=synthetic-ratio-A')).json();
    assert.equal(detail.rows[0].academicRatio,20);assert.equal(detail.rows[0].practicalRatio,80);
    assert.equal(await snapshot(),before);assert.equal(await(await FILES.get('state/admissions-data.json')).text(),original);
  }finally{await mf.dispose();}
});

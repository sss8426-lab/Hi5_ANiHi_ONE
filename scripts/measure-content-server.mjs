import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {encode} from 'fast-png';
import {libraryHarness,users,A} from '../tests/support/library-harness.mjs';
const label=process.argv[2]||'after',h=await libraryHarness(),results=[];
let counts={},queries=new Map(),bindings=new Map();
const add=key=>{counts[key]=(counts[key]||0)+1;};
const db=h.env.DB;
h.env.DB=new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{const wrap=stmt=>new Proxy(stmt,{get(s,k){
    if(k==='bind')return(...args)=>{bindings.set(sql,args);return wrap(s.bind(...args));};
    if(['first','all','run','raw'].includes(k))return(...args)=>{add('db');queries.set(sql,(queries.get(sql)||0)+1);return s[k](...args);};
    const v=s[k];return typeof v==='function'?v.bind(s):v;
  }});return wrap(target.prepare(sql));};
  if(key==='batch')return stmts=>{add('batch');return target.batch(stmts);};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
}});
const bucket=h.env.FILES;
h.env.FILES=new Proxy(bucket,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return(...args)=>{add('r2.'+String(key));return value.apply(target,args);};}});
async function measure(name,count,fn){counts={};const start=performance.now();await fn();results.push({name,count,ms:performance.now()-start,...counts});}
const png=(w,height)=>encode({width:w,height,channels:4,depth:8,data:new Uint8Array(w*height*4).fill(185)});
try{
 const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC measurement',users.staff)).body.folder;
 const items=[],master=png(2160,2700);
 for(let i=0;i<10;i++){
  const source=(await h.upload(folder.id,users.staff,{name:'SYNTHETIC.png',mime:'image/png',bytes:png(40,50)})).body.file;
  const draft=(await h.request('POST','/api/data-core/content',users.staff,{sourceApp:'instagram',campusId:A,title:'SYNTHETIC',relatedFileIds:[source.id],metadata:{instagramDesign:{workflow:'carousel-v2',logoType:'none',materialKind:'student-artwork',usePermission:'allowed'}}})).body.draft;
  const base='/api/data-core/content/instagram/'+draft.id,review=await h.request('GET',base+'/review',users.staff);
  const form=new FormData();form.set('file',new Blob([master],{type:'image/png'}),'master.png');form.set('fingerprint',review.body.fingerprint);
  let rendered;await measure('master-upload',1,async()=>{rendered=await h.request('POST',base+'/render',users.staff,form);assert.equal(rendered.status,201,JSON.stringify(rendered.body));});
  items.push({draftId:draft.id,renderId:rendered.body.renderId,fingerprint:rendered.body.fingerprint});
 }
 for(const count of [1,5,10])for(let repeat=0;repeat<3;repeat++)await measure('complete',count,async()=>{const r=await h.request('POST','/api/data-core/content/instagram-sets',users.staff,{requestId:crypto.randomUUID(),items:items.slice(0,count)});assert.equal(r.status,201,JSON.stringify(r.body));});
 for(const item of items.slice(0,3))for(const repeat of [false,true])await measure(repeat?'download-repeat':'download-first',1,async()=>{const r=await h.raw('POST',`/api/data-core/content/instagram/${item.draftId}/export`,users.staff,item);assert.equal(r.status,200);const first=performance.now();await r.arrayBuffer();counts.receiveMs=performance.now()-first;counts.timing=r.headers.get('server-timing');});
 for(let i=0;i<3;i++)await measure('file-list',10,async()=>assert.equal((await h.list(folder.id,users.staff)).status,200));
 const listingSql=[...queries.keys()].find(sql=>sql.includes('FROM file_objects fo LEFT JOIN users'));
 assert.ok(listingSql);const plan=await db.prepare('EXPLAIN QUERY PLAN '+listingSql).bind(...bindings.get(listingSql)).all();
 await fs.mkdir('outputs/content-performance',{recursive:true});await fs.writeFile(`outputs/content-performance/server-${label}.json`,JSON.stringify({environment:'isolated Node Worker + Miniflare; synthetic pixels, no provider/network delay',results,queryPlan:plan.results,queries:[...queries]},null,2));
 console.log(JSON.stringify(results));
}finally{await h.mf.dispose();}

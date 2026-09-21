import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {libraryHarness,users,A} from './support/library-harness.mjs';

test('shared navigation executes the same role-filtered menu for work, blog and Instagram',async()=>{
  const source=await fs.readFile('public/data-core/work-navigation.js','utf8');
  const expected=['work-home','library','blog','instagram','kkumeum','attendance','mode-home'];
  for(const role of ['STAFF','TEACHER','CAMPUS_ADMIN','MASTER','SUPER_ADMIN']){
    let previous;
    for(const path of ['/data-core/work','/data-core/content/blog','/data-core/content/instagram']){
      const element=()=>({dataset:{},children:[],attrs:{},classList:{toggle(key,value){this[key]=value;}},append(child){this.children.push(child);},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];}});
      const mounts=['work','admin'].map(type=>Object.assign(element(),{dataset:{workNavigation:type}}));
      const nodes=()=>mounts.flatMap(m=>m.children),window={};
      const document={getElementById:()=>path==='/data-core/work'?{}:null,createElement:element,querySelectorAll:selector=>selector==='[data-work-navigation]'?mounts:selector==='[data-work-menu]'?nodes():[mounts[1]]};
      vm.runInNewContext(source,{document,window,location:{pathname:path}});
      window.DataCoreWorkNavigation.setContext({authenticated:true,isSuperAdmin:['MASTER','SUPER_ADMIN'].includes(role)});
      const visible=mounts.filter(m=>!m.classList.hidden).flatMap(m=>m.children.map(n=>n.dataset.workMenu));
      assert.deepEqual(visible.slice(0,7),expected);assert.equal(visible.length,['MASTER','SUPER_ADMIN'].includes(role)?11:7);
      if(previous)assert.deepEqual(visible,previous);previous=visible;
      assert.equal(nodes().filter(n=>n.attrs['aria-current']==='page').length,1);
      assert.equal(nodes().filter(n=>n.dataset.kkumeumNav).length,1);
      window.DataCoreWorkNavigation.setContext({authenticated:false});assert.equal(mounts[1].classList.hidden,true);
    }
  }
});

test('file response is usable before folders; confirmed virtual roots omit empty file queries',async()=>{
  const window={};vm.runInNewContext(await fs.readFile('public/data-core/library-client.js','utf8'),{window,AbortController,DOMException});
  let release,seen=false;const calls=[];
  const api=url=>{calls.push(url);return url.includes('/folders?')?new Promise(resolve=>release=resolve):Promise.resolve({files:[{id:'synthetic'}]});};
  const pending=window.DataCoreLibraryClient.browse(api,{id:'custom'},{onListing:()=>seen=true});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(seen,true);release({});await pending;
  calls.length=0;
  const root=window.DataCoreLibraryClient.browse(api,{id:'campus:A'},{skipEmptyRoot:true});
  await new Promise(resolve=>setTimeout(resolve,0));release({});await root;
  assert.equal(calls.length,1);assert.match(calls[0],/folders/);
});

test('private rows do not consume a library page or hide later authorized files',async()=>{
  const h=await libraryHarness();
  try{
    const folder=(await h.folder('category:'+A+':class-photo','SYNTHETIC pagination',users.staff)).body.folder;
    const file=(await h.upload(folder.id,users.staff)).body.file;
    await h.env.DB.prepare("UPDATE file_objects SET visibility='private',created_at='2030-01-01' WHERE id=?").bind(file.id).run();
    for(const [prefix,visibility,count,created]of [['hidden','private',60,'2029-01-01'],['visible','campus',51,'2028-01-01']]){
      await h.env.DB.batch(Array.from({length:count},(_,i)=>h.env.DB.prepare(`INSERT INTO file_objects
        (id,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at)
        SELECT ?,organization_id,campus_id,data_record_id,owner_user_id,area,category,source_app,?,original_file_name,mime_type,size_bytes,?,? FROM file_objects WHERE id=?`)
        .bind(`${prefix}-${i}`,`synthetic-pagination/${prefix}-${i}`,visibility,created,file.id)));
    }
    const first=await h.request('GET',`/api/data-core/library/files?folderId=${folder.id}&page=1`,users.foreign);
    assert.equal(first.status,200);assert.equal(first.body.files.length,50);assert.equal(first.body.hasMore,true);
    const second=await h.request('GET',`/api/data-core/library/files?folderId=${folder.id}&page=2`,users.foreign);
    assert.equal(second.body.files.length,1);assert.equal(second.body.hasMore,false);
    assert.equal(new Set([...first.body.files,...second.body.files].map(f=>f.id)).size,51);
    assert.ok([...first.body.files,...second.body.files].every(f=>f.id.startsWith('visible')));
  }finally{await h.mf.dispose();}
});

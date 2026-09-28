import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryHarness, users, A, B, ORG} from './support/library-harness.mjs';

test('campus totals include all authorized descendants and refresh after file mutations', async()=>{
  const h=await libraryHarness();
  try {
    await h.request('GET','/api/data-core/content?sourceApp=blog',users.master);
    const category=`category:${A}:academy-photo`;
    const make=async(parent,title,user=users.staff)=>{const r=await h.folder(parent,title,user);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.folder;};
    const top=await make(category,'__synthetic_count_top'),child=await make(top.id,'__synthetic_count_child');
    const destination=await make(category,'__synthetic_count_destination');
    const put=async(folder,name,user=users.staff)=>{const r=await h.upload(folder,user,{name});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.file.id;};
    const total=async(campus=A,user=users.staff)=>{const r=await h.browse('root',user);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);return r.body.folders.find(f=>f.id===`campus:${campus}`);};
    assert.equal((await total()).fileCount,0);
    const foldersBefore=(await total()).folderCount;
    await put(category,'root-1.txt');await put(category,'root-2.txt');
    for(let i=0;i<10;i++)await put(top.id,`top-${i}.txt`);
    let moving;for(let i=0;i<10;i++)moving=await put(child.id,`child-${i}.txt`);
    assert.equal((await total()).fileCount,22);
    assert.equal((await total()).folderCount,foldersBefore,'direct folder count is unchanged');
    assert.equal((await h.browse(category,users.staff)).body.folders.find(f=>f.id===top.id).fileCount,10,'non-campus cards retain direct counts');
    let deep=child;for(let i=0;i<8;i++)deep=await make(deep.id,`__synthetic_depth_${i}`);
    await put(deep.id,'deep.txt');assert.equal((await total()).fileCount,23);
    const movedFolder=await h.request('POST','/api/data-core/library/move',users.staff,{requestId:crypto.randomUUID(),targetId:destination.id,items:[{kind:'folder',id:top.id,revision:top.revision}]});
    assert.equal(movedFolder.status,200,JSON.stringify(movedFolder.body));assert.equal((await total()).fileCount,23,'moving a whole subtree preserves the total');
    const moved=await h.request('POST','/api/data-core/library/move',users.staff,{requestId:crypto.randomUUID(),targetId:destination.id,items:[{kind:'file',id:moving,revision:child.id}]});
    assert.equal(moved.status,200,JSON.stringify(moved.body));assert.equal((await total()).fileCount,23);
    assert.equal((await h.request('DELETE',`/api/data-core/library/files/${moving}`,users.staff)).status,200);
    assert.equal((await total()).fileCount,22);
    assert.equal((await h.request('POST',`/api/data-core/trash/files/${moving}/restore`,users.master)).status,200);
    assert.equal((await total()).fileCount,23);
    assert.equal((await h.request('DELETE',`/api/data-core/library/files/${moving}`,users.staff)).status,200);
    const purge=await h.request('DELETE',`/api/data-core/trash/files/${moving}`,users.master);
    assert.equal(purge.status,200,JSON.stringify(purge.body));assert.equal((await total()).fileCount,22);
    assert.equal((await total(B)).fileCount,0,'no cross-campus contamination');

    const protectedFolder=await make(`category:${B}:student-artwork`,'__synthetic_private',users.foreign);
    await put(protectedFolder.id,'private.txt',users.foreign);
    assert.equal((await total(B)).fileCount,0,'foreign student files do not leak through counts');
    assert.equal((await total(B,users.foreign)).fileCount,1);
    const shared=await make(`category:${B}:academy-photo`,'__synthetic_shared',users.foreign);
    await put(shared.id,'shared.txt',users.foreign);
    assert.equal((await total(B)).fileCount,1,'existing authorized shared files remain countable');
    assert.equal((await total(B,users.master)).fileCount,2);

    const template=await h.file((await h.list(top.id,users.staff)).body.files[0].id);
    for(const [id,source,key,area] of [['family','kkumeum','family/test','family-private'],['thumb','data-core','thumb/test','documents-private']]) {
      await h.env.DB.prepare(`INSERT INTO file_objects(id,organization_id,campus_id,data_record_id,owner_user_id,source_app,area,category,r2_key,original_file_name,mime_type,size_bytes,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,ORG,A,top.id,template.owner_user_id,source,area,id==='thumb'?'image-thumbnail':'academy-photo',key,'synthetic.txt','text/plain',1,'campus',new Date().toISOString()).run();
    }
    assert.equal((await total()).fileCount,22,'FAMILY and derivatives excluded');
    await h.env.DB.prepare('UPDATE data_records SET deleted_at=? WHERE id=?').bind(new Date().toISOString(),top.id).run();
    assert.equal((await total()).fileCount,2,'deleted ancestors exclude all descendants');
    await h.env.DB.prepare('UPDATE data_records SET deleted_at=NULL WHERE id=?').bind(top.id).run();
    assert.equal((await total()).fileCount,22);
    const db=h.env.DB,queries=[];h.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{queries.push(sql);return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    await total();assert.equal(queries.filter(sql=>sql.includes('COUNT(*) AS n')&&sql.includes('FROM file_objects')).length,1,'single grouped file query for all campus cards');
    h.env.DB=db;
    h.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(sql.includes('COUNT(*) AS n')&&sql.includes('FROM file_objects'))throw Error('synthetic count failure');return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    assert.equal((await total()).fileCount,null,'failed aggregation is not reported as zero');h.env.DB=db;
    const noCounts=await h.request('GET','/api/data-core/library/folders?parentId=root&counts=0',users.staff);
    assert.ok(noCounts.body.folders.every(f=>f.fileCount===null));
  }finally{await h.mf.dispose();}
});

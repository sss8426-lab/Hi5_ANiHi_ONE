import assert from 'node:assert/strict';
import test from 'node:test';
import {libraryHarness,users} from './support/library-harness.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=','base64');
const base='/api/data-core/awards',category='category:organization:competition-material';

// Reported: photos of a deleted 공모전 folder still showed in 자료보관함 → 공모전·실기대회 (and so in the
// blog/Instagram photo pickers), but every generation refused them ("볼 수 있는 DATA CORE 파일만 …").
test('files of a deleted folder (or of a deleted parent award folder) are not listed, counted or opened, and return on restore',async()=>{
  const h=await libraryHarness();
  try{
    const make=async(title,extra={})=>{const r=await h.request('POST',base+'/folders',users.admin,{title,collectionType:'enrolled',...extra});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.record;};
    const upload=async(parent,name)=>{const form=new FormData();form.set('file',new File([png],name,{type:'image/png'}));form.set('recordId',parent.id);form.set('category','competition-material');
      const r=await h.request('POST','/api/data-core/files',users.admin,form);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.file;};
    const root=await make('SYNTHETIC 본상'),child=await make('SYNTHETIC 본상 하위',{parentFolderId:root.id}),other=await make('SYNTHETIC 유지');
    const direct=await upload(root,'SYNTHETIC-direct.png'),nested=await upload(child,'SYNTHETIC-nested.png'),kept=await upload(other,'SYNTHETIC-kept.png');

    const listed=async()=>(await h.list(category)).body.files.map(f=>f.id).sort();
    const counted=async()=>{
      const crumbs=(await h.request('GET',`/api/data-core/library/folders?parentId=${encodeURIComponent(category)}`,users.admin)).body.breadcrumbs;
      const parent=crumbs.at(-2).id;
      return (await h.browse(parent)).body.folders.find(f=>f.id===category).fileCount;
    };
    const open=id=>h.request('GET','/api/data-core/library/files/'+id,users.admin);
    assert.deepEqual(await listed(),[direct.id,nested.id,kept.id].sort());
    assert.equal(await counted(),3);

    assert.equal((await h.request('DELETE',`${base}/folders/${root.id}`,users.admin)).status,200);
    assert.deepEqual(await listed(),[kept.id],'the deleted folder and its sub-folder keep their files out of the category folder');
    assert.equal(await counted(),1,'and out of the folder count');
    assert.equal((await open(direct.id)).status,403);assert.equal((await open(nested.id)).status,403,'a live sub-folder under a deleted parent is hidden too');
    assert.equal((await open(kept.id)).status,200,'files of other folders are untouched');
    // The pickers' own permission check agrees with the listing now.
    const blog=await h.request('POST','/api/data-core/content/blog/files',users.admin,{fileIds:[direct.id,kept.id],originals:false});
    assert.equal(blog.body.items[0].status!==undefined&&blog.body.items[0].status>=400,true);assert.equal(blog.body.items[1].error,undefined);
    // Nothing was deleted: the rows and bytes are intact.
    assert.ok(await h.file(direct.id));assert.ok(await h.env.FILES.get((await h.file(nested.id)).r2_key));

    assert.equal((await h.request('POST',`${base}/folders/${root.id}/restore`,users.admin)).status,200);
    assert.deepEqual(await listed(),[direct.id,nested.id,kept.id].sort(),'restoring the folder brings its files back');
    assert.equal(await counted(),3);
    assert.equal((await open(nested.id)).status,200);
  }finally{await h.mf.dispose();}
});

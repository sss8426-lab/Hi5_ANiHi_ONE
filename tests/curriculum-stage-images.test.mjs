import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {imageSize} from 'image-size';
import test from 'node:test';

test('six new curriculum artworks are distinct, optimized and mapped to unchanged stage routes', async()=>{
  const source=await readFile('public/data-core/curriculum.js','utf8');
  const prompts=JSON.parse(await readFile('public/data-core/assets/curriculum/prompts.json','utf8'));
  const hashes=new Set();
  for(const family of ['content','design'])for(const stage of ['basic','advanced','admission']){
    const name=`${family}-${stage}-v1.webp`,bytes=await readFile('public/data-core/assets/curriculum/'+name);
    assert.ok(source.includes(name));assert.ok(bytes.length<350000);
    const dimensions=imageSize(bytes);assert.equal(dimensions.width,1200);assert.equal(dimensions.height,800);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
    assert.ok(prompts.assets.find(asset=>asset.file===name)?.prompt);
  }
  assert.equal(hashes.size,6);
  assert.match(source,/content: \{ basic: \[\], advanced: \[\], admission: \[\] \}/);
  assert.match(source,/design: \{ basic: \[\], advanced: \[\], admission: \[\] \}/);
});

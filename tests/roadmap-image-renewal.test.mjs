import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';
import {careerImageScenes} from '../public/data-core/occupation-image-renewal.js';
import {libraryHarness, users} from './support/library-harness.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approved = {
  D002: 'd7f0e052bc114beb3819249baa42f7807070374665852fa5d3d7977ba139a88a',
  D012: '714dc7cea8de201c7f1a081119fc8ccbf5d7238d8f9b138bc242e42b365cb3ef',
  D020: '5613564f44babeb58c041d044c74114ed001347d2bd673669da835e113294db1',
};
test('32 unique v2 scenes, approved sample bytes, old rollback assets and bounded display derivatives', async () => {
  assert.equal(Object.keys(careerImageScenes).length,32);
  const provenance = JSON.parse(await fs.readFile('docs/roadmap-image-v2-provenance.json','utf8'));
  assert.equal(provenance.images.length,32);
  const hashes = new Set();
  for (const c of occupationImageConcepts) {
    const bytes = await fs.readFile('public'+c.asset), meta = await sharp(bytes).metadata();
    assert.deepEqual([meta.width,meta.height],[640,480]);
    assert.equal(meta.format,'webp'); assert.equal(meta.exif,undefined);
    assert.ok(bytes.length<80000,c.occupationId); hashes.add(hash(bytes));
    await fs.access(`public/data-core/assets/roadmap/covers/${c.slug}.webp`);
    await fs.access(c.legacyAsset.replace(/^\//,'public/'));
    const detail = await fs.readFile('public'+c.detailAsset), dm = await sharp(detail).metadata();
    assert.deepEqual([dm.width,dm.height],[c.detailWidth,c.detailHeight]);
    if (approved[c.occupationId]) {
      assert.equal(hash(bytes),approved[c.occupationId]);
      assert.equal(c.version,'20260913-work-v1');
    } else {
      assert.match(c.asset,new RegExp(`/v2/${c.occupationId}-${c.slug}-v2\\.webp$`));
      assert.ok(detail.length<350000);
      assert.equal(c.alt,careerImageScenes[c.occupationId]);
      const p=provenance.images.find(x=>x.id===c.occupationId);
      assert.equal(p.derived[0].sha256,hash(bytes));
      assert.equal(p.derived[1].sha256,hash(detail));
      assert.equal(p.syntheticScene,true);
    }
  }
  assert.equal(hashes.size,35);
  assert.equal(new Set(provenance.images.map(x=>x.sourceSha256)).size,32);
});

test('internal review is MASTER/SUPER_ADMIN only, including direct files and HEAD', async () => {
  const h=await libraryHarness();
  h.env.ASSETS={fetch:async()=>new Response('<html>synthetic review</html>',{headers:{'content-type':'text/html'}})};
  try {
    const config=JSON.parse(await fs.readFile('wrangler.jsonc','utf8'));
    assert.ok(config.assets.run_worker_first.includes('/data-core/roadmap/*'));
    for (const suffix of ['', '/', '.html', '.js', '.css']) {
      const path='/data-core/roadmap/image-review'+suffix;
      for(const method of ['GET','HEAD']) {
        assert.equal((await h.raw(method,path,null)).status,401,path);
        for(const user of [users.campusAdmin,users.director,users.teacher,users.staff]) assert.equal((await h.raw(method,path,user)).status,403,path);
        for(const user of [users.admin,users.master]) {
          const response=await h.raw(method,path,user);
          assert.equal(response.status,200,path);
          assert.equal(response.headers.get('cache-control'),'private, no-store');
        }
      }
    }
    assert.equal((await h.raw('POST','/data-core/roadmap/image-review',users.master)).status,405);
    for (const path of ['/data-core/roadmap/%69mage-review.html','/data-core/roadmap/image-review%2Ehtml']) {
      assert.equal((await h.raw('GET',path,null)).status,401);
      assert.equal((await h.raw('GET',path,users.campusAdmin)).status,403);
      assert.equal((await h.raw('GET',path,users.master)).status,200);
    }
    const worker=(await import('../dist/server/index.js')).default;
    assert.equal((await worker.fetch(new Request('http://localhost/data-core/roadmap/image-review'),{},{waitUntil(){}})).status,503);
  } finally { await h.mf.dispose(); }
});

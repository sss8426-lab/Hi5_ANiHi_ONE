import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';

test('shared design is versioned and scoped to CORE staff and counseling, not FAMILY',()=>{
  for(const name of ['index','content','accounts','operations','readiness','roadmap','work/kkumeum']){
    const html=fs.readFileSync(`public/data-core/${name}.html`,'utf8');
    assert.match(html,/design-tokens\.css\?v=20260910-1/);
    assert.match(html,/design-system\.css\?v=20260910-1/);
    assert.match(html,/design-shell\.js\?v=20260910-1/);
  }
  const css=fs.readFileSync('public/data-core/design-system.css','utf8');
  assert.doesNotMatch(css,/body\.family|\/family\//);
  assert.doesNotMatch(fs.readFileSync('public/family/index.html','utf8'),/design-system\.css/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/focus-visible/);
  assert.match(css,/background-image: none/);
  const shell=fs.readFileSync('public/data-core/design-shell.js','utf8');
  assert.doesNotMatch(shell,/fetch\(|localStorage|sessionStorage|\/api\/|innerHTML/);
  assert.match(shell,/anchor\.after\(sidebar\)/);
  assert.match(shell,/dialog\.append\(sidebar\)/);
});

test('approved bright photographs have a unique versioned mapping and bounded size',()=>{
  const {assets}=JSON.parse(fs.readFileSync('public/data-core/visual-assets.json','utf8'));
  assert.equal(assets.length,41);
  assert.equal(assets.filter(a=>/^D\d/.test(a.key)).length,35);
  assert.equal(new Set(assets.map(a=>a.asset)).size,41);
  const hashes=new Set();
  for(const a of assets){
    const bytes=fs.readFileSync('public'+a.asset);
    assert.ok(bytes.length<300000,a.key);
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.equal(a.style,'bright-photorealistic');
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
    if(/^D\d/.test(a.key)){
      const concept=occupationImageConcepts.find(c=>c.occupationId===a.key);
      assert.equal(concept.asset,a.asset);
      assert.equal(concept.version,a.version);
      assert.equal(a.width/a.height,3/4);
    }
  }
  assert.equal(hashes.size,41);
  assert.match(fs.readFileSync('public/data-core/roadmap.js','utf8'),/occupation-image-concepts\.js\?v=20260910-photo-v2/);
});

test('licensed local icons do not require remote scripts or fonts',()=>{
  const svg=fs.readFileSync('public/data-core/assets/core-icons.svg','utf8');
  for(const id of ['House','Menu','X','Trophy','Compass','Folder','ShieldCheck'])assert.ok(svg.includes(`id="${id}"`));
  assert.doesNotMatch(svg,/<script|onload=|<image|https:/);
  assert.match(fs.readFileSync('public/data-core/assets/core-icons-LICENSE.txt','utf8'),/Permission/);
});

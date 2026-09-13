import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';

test('shared design is versioned and scoped to CORE staff and counseling, not FAMILY',()=>{
  for(const name of ['index','content','accounts','operations','readiness','roadmap','work/kkumeum']){
    const html=fs.readFileSync(`public/data-core/${name}.html`,'utf8');
    const version = '20260913-soft-premium';
    assert.ok(html.includes(`design-tokens.css?v=${version}`));
    assert.ok(html.includes(`design-system.css?v=${version}`));
    assert.match(html,/design-shell\.js\?v=20260912-campus/);
  }
  const css=fs.readFileSync('public/data-core/design-system.css','utf8');
  assert.doesNotMatch(css,/body\.family|\/family\//);
  assert.doesNotMatch(fs.readFileSync('public/family/index.html','utf8'),/design-system\.css/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/focus-visible/);
  assert.match(css,/background-image: none/);
  assert.match(css,/\.summary-metrics \{ grid-template-columns:repeat\(auto-fit, minmax\(min\(100%, 200px\), 1fr\)\)/);
  const familyTheme=fs.readFileSync('public/family/family-theme.css','utf8');
  assert.match(familyTheme,/word-break:keep-all/);
  assert.match(familyTheme,/\.artwork-grid > \.empty-inline \{ grid-column:1 \/ -1/);
  const shell=fs.readFileSync('public/data-core/design-shell.js','utf8');
  assert.doesNotMatch(shell,/fetch\(|localStorage|sessionStorage|\/api\/|innerHTML/);
  assert.match(shell,/anchor\.after\(sidebar\)/);
  assert.match(shell,/dialog\.append\(sidebar\)/);
});

test('approved bright photographs have a unique versioned mapping and bounded size',()=>{
  const {assets}=JSON.parse(fs.readFileSync('public/data-core/visual-assets.json','utf8'));
  assert.equal(assets.length,48);
  assert.equal(assets.filter(a=>/^D\d/.test(a.key)).length,35);
  assert.equal(new Set(assets.map(a=>a.asset)).size,48);
  const hashes=new Set();
  for(const a of assets){
    const bytes=fs.readFileSync('public'+a.asset);
    assert.ok(bytes.length<(a.role==='work-focused-page'?350000:300000),a.key);
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.equal(a.style,'bright-photorealistic');
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
    if(/^D\d/.test(a.key)){
      const concept=occupationImageConcepts.find(c=>c.occupationId===a.key);
      assert.equal(concept.asset,a.asset);
      assert.equal(concept.version,a.version);
      assert.equal(a.width/a.height,4/3);
      assert.ok(bytes.length < 80000, 'Lightweight occupation cover');
      assert.equal(createHash('sha256').update(fs.readFileSync('public'+concept.sourceAsset)).digest('hex'),a.sourceSha256);
      assert.ok(fs.existsSync('public'+concept.legacyAsset));
    }
  }
  assert.equal(hashes.size,48);
  assert.match(fs.readFileSync('public/data-core/roadmap.js','utf8'),/occupation-image-concepts\.js\?v=20260913-work-v1/);
});

test('approved home photographs match accessible slots without replacing existing page assets',()=>{
  const {assets}=JSON.parse(fs.readFileSync('public/data-core/visual-assets.json','utf8'));
  const html=fs.readFileSync('public/data-core/index.html','utf8');
  for(const slot of ['dream','admissions']){
    const asset=assets.find(a=>a.key===`counseling-home-${slot}`);
    assert.equal(asset.role,'home-card');
    assert.equal(asset.width/asset.height,3/2);
    assert.equal(asset.fictionalPeople,true);
    assert.ok(html.includes(`data-brand-image="${slot}" src="${asset.asset}" alt="${asset.alt}"`));
  }
  for(const [key,path] of [['roadmap-hero','dream-roadmap-photo-v1.webp'],['admissions','admission-roadmap.webp'],['competition','competition-challenge.webp']]){
    assert.equal(assets.find(a=>a.key===key).asset,`/data-core/assets/counseling/${path}`);
    assert.ok(fs.existsSync(`public/data-core/assets/counseling/${path}`));
  }
});

test('licensed local icons do not require remote scripts or fonts',()=>{
  const svg=fs.readFileSync('public/data-core/assets/core-icons.svg','utf8');
  for(const id of ['House','Menu','X','Trophy','Compass','Folder','ShieldCheck'])assert.ok(svg.includes(`id="${id}"`));
  assert.doesNotMatch(svg,/<script|onload=|<image|https:/);
  assert.match(fs.readFileSync('public/data-core/assets/core-icons-LICENSE.txt','utf8'),/Permission/);
});

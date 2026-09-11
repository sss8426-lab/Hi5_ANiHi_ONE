import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {imageSize} from 'image-size';
import {parseDocument} from 'htmlparser2';
import {buildVisuals} from '../scripts/prepare-career-visuals.mjs';
import {visualSections} from '../public/data-core/career-visuals.js';

const context = {window:{}};
vm.runInNewContext(await fs.readFile('public/data-core/roadmap-content.js','utf8'), context);
const before = JSON.parse(JSON.stringify(context.window.HI5_ROADMAP_CONTENT));
vm.runInNewContext(await fs.readFile('public/data-core/career-visual-content.js','utf8'), context);
const careers = JSON.parse(JSON.stringify(context.window.HI5_ROADMAP_CONTENT.careers));
const all = node => [node, ...(node.children || []).flatMap(all)];

test('35 stable occupations gain visualContent without changing any source career fields', () => {
  assert.equal(careers.length,35);
  assert.equal(new Set(careers.map(c => c.id)).size,35);
  assert.deepEqual(Object.keys(context.window.HI5_CAREER_VISUAL_CONTENT), before.careers.map(c => c.id));
  for (const [i,c] of careers.entries()) {
    const {visualContent,...original} = c;
    assert.deepEqual(original,before.careers[i]);
    assert.deepEqual(Object.keys(visualContent),['learning','competencies','portfolio']);
    for (const [key,section] of Object.entries(visualContent)) {
      assert.ok(section.title && section.intro && section.imageAlt.length > 20,`${c.id}/${key} copy`);
      assert.ok(section.items.length >= (key === 'portfolio' ? 2 : 4));
      assert.ok(section.items.every(item => item.title && item.description));
      assert.equal(section.available,true,`${c.id}/${key} is not complete`);
      assert.match(section.image,/^\/data-core\/assets\/roadmap\/detail\/[a-z0-9-]+\/(learning|competency|portfolio)\.webp$/);
      assert.match(section.version,/^[a-f0-9]{12}$/);
    }
  }
});

test('all 105 WebPs exist, decode, match dimensions and hashes, and are unique', async () => {
  const paths = new Set(), hashes = new Set();
  let total = 0;
  for (const c of careers) for (const section of Object.values(c.visualContent)) {
    assert.ok(!paths.has(section.image)); paths.add(section.image);
    const bytes = await fs.readFile(path.join('public',section.image));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.ok(!hashes.has(hash),`Repeated visual ${section.image}`); hashes.add(hash);
    assert.equal(hash.slice(0,12),section.version);
    const size = imageSize(bytes);
    assert.equal(size.type,'webp');
    assert.equal(size.width,section.width); assert.equal(size.height,section.height);
    assert.ok(bytes.length > 10000 && bytes.length < 600*1024,section.image);
    total += bytes.length;
  }
  assert.equal(paths.size,105);
  assert.ok(total/105 < 350*1024);
  const disk = await fs.readdir('public/data-core/assets/roadmap/detail',{recursive:true});
  for (const file of disk.filter(file => file.endsWith('.webp'))) {
    const relative = '/data-core/assets/roadmap/detail/'+file.replaceAll('\\','/');
    if (!paths.has(relative)) process.emitWarning(`Unreferenced career visual: ${relative}`);
  }
});

test('the prompt manifest and browser content reproduce from the editorial source', async () => {
  const built = await buildVisuals();
  assert.deepEqual(built.missing,[]);
  assert.equal((await fs.readFile('public/data-core/career-visual-content.js','utf8')).replaceAll('\r\n','\n'),built.source);
  const manifest = JSON.parse(await fs.readFile('public/data-core/career-visual-prompts.json','utf8'));
  assert.deepEqual(manifest,built.prompts);
  for (const career of Object.values(manifest.careers)) {
    assert.equal(new Set(Object.values(career.sections).map(s => s.scene)).size,3);
    for (const section of Object.values(career.sections)) {
      assert.ok(section.subjects.length && section.props.length && section.avoid.length);
      assert.match(section.prompt,/no embedded text/i);
      assert.match(section.provenance,/fictional/);
    }
  }
});

test('each detail renders only its own three lazy images with semantic text and related majors', () => {
  for (const career of careers) {
    const nodes = all(parseDocument(visualSections(career)));
    const images = nodes.filter(node => node.name === 'img');
    assert.equal(images.length,3);
    for (const image of images) {
      assert.equal(image.attribs.loading,'lazy');
      assert.equal(image.attribs.decoding,'async');
      assert.ok(image.attribs.alt.length > 20);
      assert.ok(Object.values(career.visualContent).some(s => `${s.image}?v=${s.version}` === image.attribs.src));
      assert.ok(image.attribs.width && image.attribs.height);
    }
    assert.equal(nodes.filter(n => n.name === 'h2').length,3);
    assert.equal(nodes.filter(n => n.attribs?.class === 'major-item').length,career.majors.length);
    assert.ok(nodes.some(n => n.attribs?.id === 'careerOutcome'));
    assert.equal(nodes.filter(n => n.name === 'script' || n.name === 'iframe').length,0);
  }
});

test('missing assets show an honest text state and text is escaped', () => {
  const career = structuredClone(careers[0]);
  career.visualContent.learning.available = false;
  career.visualContent.learning.title = '<img src=x onerror=alert(1)>';
  career.visualContent.learning.items[0].description = '<script>bad()</script>';
  const html = visualSections(career);
  assert.match(html,/시각 자료 준비 중/);
  assert.doesNotMatch(html,/<script>|onerror=alert\(1\)>/);
  assert.match(html,/&lt;script&gt;/);
  assert.equal(all(parseDocument(html)).filter(n => n.name === 'img').length,2);
});

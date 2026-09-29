import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {careerWorks, artists} from '../public/data-core/career-works.js';
import {careerWorkVisuals} from '../public/data-core/career-work-visuals.js';
import {workSlides, slideHtml} from '../public/data-core/career-visuals.js';

const context = {window:{}};
for (const name of ['roadmap-content', 'career-visual-content']) {
  vm.runInNewContext(await fs.readFile(`public/data-core/${name}.js`, 'utf8'), context);
}
const careers = context.window.HI5_ROADMAP_CONTENT.careers;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('35 careers have exactly three individually matched educational artworks', async () => {
  assert.equal(careers.length, 35);
  assert.equal(Object.keys(careerWorkVisuals).length, 35);
  const provenance = JSON.parse(await fs.readFile('docs/career-work-visual-provenance.json', 'utf8'));
  assert.equal(Object.keys(provenance.assets).length, 105);
  const hashes = new Set();
  for (const career of careers) {
    const slides = workSlides(career);
    assert.equal(slides.length, 3, career.id);
    for (const [i, slide] of slides.entries()) {
      const visual = slide.image;
      assert.ok(visual?.available, `${career.id}:${i} image missing`);
      assert.equal(visual.title, career.visualContent.portfolio.items[i].title);
      assert.equal(visual.provenance, 'ai-generated-educational-example');
      assert.match(visual.image, new RegExp(`/works/${career.id.toLowerCase()}-0${i+1}\\.webp$`));
      const bytes = await fs.readFile(`public${visual.image}`);
      const metadata = await sharp(bytes).metadata();
      const hash = createHash('sha256').update(bytes).digest('hex');
      const record = provenance.assets[`${career.id.toLowerCase()}-0${i+1}`];
      assert.deepEqual([metadata.width,metadata.height], [visual.width,visual.height]);
      assert.ok(visual.width >= 1600 && visual.width / visual.height >= 2 && visual.width / visual.height <= 4);
      assert.equal(record.sha256, hash);
      assert.equal(visual.version, hash.slice(0,12));
      assert.ok(record.prompt.includes(visual.title));
      assert.ok(!hashes.has(hash), `${career.id}:${i} reused artwork`);
      hashes.add(hash);
    }
  }
});

test('every work preserves all corresponding artist references and portfolio text below its image', () => {
  for (const career of careers) {
    for (const [i, slide] of workSlides(career).entries()) {
      const html = slideHtml(career, slide, i, 3);
      const bottom = html.slice(html.indexOf('<section class="work-viewer-bottom"'));
      const work = careerWorks[career.id][i];
      assert.ok(html.includes(escape(work.about)));
      assert.ok(html.indexOf('work-viewer-top') < html.indexOf('work-viewer-stage'));
      assert.ok(html.indexOf('work-viewer-stage') < html.indexOf('work-viewer-bottom'));
      assert.equal(slide.people.length, work.artists.length);
      for (const id of work.artists) {
        const artist = artists[id];
        for (const value of [artist.name,artist.nameEn,artist.meta,artist.bio,...artist.works]) assert.ok(bottom.includes(escape(value)), `${career.id}:${i} ${id}`);
        for (const link of artist.links) assert.ok(bottom.includes(`href="${escape(link.url)}" target="_blank" rel="noopener noreferrer"`));
      }
      for (const value of [...work.uses,...work.portfolio]) assert.ok(bottom.includes(escape(value)));
      assert.ok(!/<img[^>]+src="https?:/.test(html), 'Never use an artist photo as the educational work');
      if (slide.image) assert.ok(html.includes('아래 대표 작가의 실제 작품과는 별개의 예시입니다.'));
    }
  }
});

test('work viewer escapes content and rejects unsafe artist URLs', () => {
  const career = careers[0];
  const slide = workSlides(career)[0];
  const unsafe = '<img src=x onerror=alert(1)>';
  const html = slideHtml({...career,name:unsafe}, {...slide,item:{title:unsafe},work:{...slide.work,about:unsafe},people:[{...slide.people[0],bio:unsafe,links:[{label:'unsafe',url:'javascript:alert(1)'},{label:'reference',url:'https://example.com/?q=a&b=c'}]}]}, 0, 3);
  assert.ok(!html.includes(unsafe));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes(escape(unsafe)));
  assert.ok(html.includes('https://example.com/?q=a&amp;b=c'));
});

test('unavailable artwork never falls back to unrelated artist photographs', () => {
  const career = careers[0];
  const html = slideHtml(career, {...workSlides(career)[0],image:null}, 0, 3);
  assert.ok(html.includes('교육용 이미지를 준비하고 있습니다.'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('work-viewer-bottom'));
});

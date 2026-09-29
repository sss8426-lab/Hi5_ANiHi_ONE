import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {careerWorks, artists} from '../public/data-core/career-works.js';
import {artistImages} from '../public/data-core/career-work-images.js';
import {visualSections} from '../public/data-core/career-visuals.js';

const context = {window: {}};
vm.runInNewContext(fs.readFileSync('public/data-core/roadmap-content.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('public/data-core/career-visual-content.js', 'utf8'), context);
const careers = context.window.HI5_ROADMAP_CONTENT.careers;

test('every career has a detail for each 대표 작품, each naming known representative artists', () => {
  assert.equal(Object.keys(careerWorks).length, careers.length);
  for (const career of careers) {
    const works = careerWorks[career.id];
    assert.equal(works?.length, career.visualContent.portfolio.items.length, career.id);
    for (const [i, work] of works.entries()) {
      assert.ok(work.about.length >= 50, `${career.id}:${i} about`);
      assert.ok(work.uses.length >= 3 && work.portfolio.length >= 3, `${career.id}:${i} lists`);
      assert.ok(work.artists.length >= 1 && work.artists.length <= 2, `${career.id}:${i} artists`);
      for (const id of work.artists) assert.ok(artists[id], `${career.id}:${i} unknown artist ${id}`);
    }
  }
});

test('artists carry a short biography, notable works, safe links and only https pictures with a source', () => {
  for (const [id, artist] of Object.entries(artists)) {
    assert.ok(artist.name && artist.meta && artist.bio.length > 30 && artist.works.length, id);
    for (const link of artist.links) assert.match(link.url, /^https?:\/\/[^\s"<>]+$/, `${id} link`);
    const pictures = artist.images?.length ? artist.images : artistImages[id] || [];
    for (const picture of pictures) {
      assert.match(picture.src, /^https:\/\//, `${id} picture must load over https`);
      assert.ok(picture.caption && picture.source && /^https:\/\//.test(picture.href), `${id} picture credit`);
    }
  }
  for (const id of Object.keys(artistImages)) assert.ok(artists[id], `pictures for unknown artist ${id}`);
});

test('work cards open their detail; academy stage images exist', () => {
  for (const career of careers) {
    const html = visualSections(career);
    assert.equal((html.match(/class="career-work-open"/g) || []).length, career.visualContent.portfolio.items.length, career.id);
  }
  const js = fs.readFileSync('public/data-core/roadmap.js', 'utf8');
  for (const key of js.match(/'(?:story|design)-[a-z]+'(?=: \[)/g).map((k) => k.slice(1, -1))) {
    assert.ok(fs.existsSync(`public/data-core/assets/roadmap/academy/${key}.webp`), key);
  }
});

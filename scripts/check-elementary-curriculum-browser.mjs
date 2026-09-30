import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.CURRICULUM_TEST_ORIGIN || 'http://localhost:3142';
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Local isolated browser check only');
const out = 'outputs/elementary-curriculum/browser';
await mkdir(out, {recursive: true});
const folders = [
  {title: '꿈 그림 기초', slug: 'drawing', image: 'start-drawing-v1.webp'},
  {title: '만화그리기 기초', slug: 'comics', image: 'start-comics-v1.webp'},
  {title: '디자인하기 기초', slug: 'design', image: 'start-design-v1.webp'},
];
const browser = await chromium.launch({headless: true, channel: 'chrome'});
const errors = [], reports = [];
let mutations = 0, role = 'MASTER';
try {
  const context = await browser.newContext({serviceWorkers: 'block'});
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/auth/activity') return route.fulfill({json: {ok: true}});
    if (request.method() !== 'GET') { mutations++; return route.fulfill({status: 405}); }
    if (url.pathname.endsWith('/context')) return route.fulfill({json: {
      authenticated: true, canWrite: role === 'MASTER', isSuperAdmin: role === 'MASTER',
      user: {id: 'synthetic-elementary', name: 'Synthetic QA', role},
      memberships: [{role, campusId: role === 'MASTER' ? null : 'synthetic-campus'}],
    }});
    if (url.pathname.endsWith('/health')) return route.fulfill({json: {ok: true, bindings: {database: true, files: true}}});
    if (url.pathname === '/api/data-core/curriculum/folders/legacy-elementary') return route.fulfill({json: {family: 'start', stage: 'main', canManage: role === 'MASTER', folder: {id: 'legacy-elementary', title: '기존 초등 수업', webManaged: true}, folders: [], pages: [], breadcrumbs: [{id: 'legacy-elementary', title: '기존 초등 수업'}], totalFolders: 0, totalPages: 0}});
    if (url.pathname === '/api/data-core/curriculum') return route.fulfill({json: {family: url.searchParams.get('family'), stage: url.searchParams.get('stage'), canManage: role === 'MASTER', folders: [], pages: [], breadcrumbs: [], totalFolders: 0, totalPages: 0}});
    return route.fulfill({json: {records: [], files: [], events: [], campuses: [], items: [], folders: [], pages: [], totalFolders: 0}});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({width, height: 1000});
    await page.goto(`${base}/data-core/curriculum/start`);
    const cards = page.locator('#view-curriculum .curriculum-stage-card');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    assert.deepEqual(await cards.locator('h3').allTextContents(), folders.map(folder => folder.title));
    for (let index = 0; index < folders.length; index++) {
      const image = cards.nth(index).locator('img');
      await image.evaluate(element => element.decode());
      const details = await image.evaluate(element => ({src: element.getAttribute('src'), width: element.naturalWidth, height: element.naturalHeight}));
      assert.equal(details.src, `/data-core/assets/curriculum/${folders[index].image}`);
      assert.equal(details.width, 1200);
      assert.equal(details.height, 800);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const clipped = await cards.evaluateAll(elements => elements.flatMap(element => [...element.querySelectorAll('h3,p')].filter(text => text.scrollWidth > text.clientWidth + 1).map(text => text.textContent)));
    assert.deepEqual(clipped, []);
    await page.screenshot({path: `${out}/start-${width}.png`, fullPage: true});
    reports.push({width, cards: 3, overflow: false});
  }
  await page.setViewportSize({width: 1440, height: 1000});
  for (const actor of ['MASTER', 'CAMPUS_ADMIN', 'TEACHER']) {
    role = actor;
    for (const folder of folders) {
      const url = `${base}/data-core/curriculum/start/${folder.slug}`;
      await page.goto(`${base}/data-core/curriculum/start`);
      await page.locator(`.curriculum-stage-card[href$="/${folder.slug}"]`).click();
      await page.locator('#view-curriculum h2').getByText(folder.title, {exact: true}).waitFor();
      assert.equal(page.url(), url);
      await page.locator('.lesson-empty').waitFor();
      assert.equal(await page.locator('[data-new-folder]').count(), actor === 'MASTER' ? 1 : 0);
      await page.reload();
      await page.locator('#view-curriculum h2').getByText(folder.title, {exact: true}).waitFor();
      await page.locator('.lesson-breadcrumb a[href="/data-core/curriculum/start"]').click();
      await page.locator('.curriculum-stage-card').first().waitFor();
      assert.equal(page.url(), `${base}/data-core/curriculum/start`);
      await page.goBack();
      await page.locator('#view-curriculum h2').getByText(folder.title, {exact: true}).waitFor();
      await page.goto(url + '/');
      await page.locator('#view-curriculum h2').getByText(folder.title, {exact: true}).waitFor();
    }
  }
  await page.goto(`${base}/data-core/curriculum/start?lesson=legacy-elementary`);
  await page.getByRole('heading', {name: '기존 초등 수업', exact: true}).waitFor();
  await page.locator('.lesson-breadcrumb a[href="/data-core/curriculum/start/drawing"]').click();
  await page.getByRole('heading', {name: '꿈 그림 기초', exact: true}).waitFor();
  assert.equal(page.url(), `${base}/data-core/curriculum/start/drawing`);
  for (const family of ['content', 'design']) {
    await page.goto(`${base}/data-core/curriculum/${family}`);
    await page.locator('.curriculum-stage-card').first().waitFor();
    assert.deepEqual(await page.locator('.curriculum-stage-card h3').allTextContents(), ['기초과정', '심화과정', '입시과정']);
  }
  await page.goto(`${base}/data-core/curriculum`);
  await page.locator('.curriculum-start-card').click();
  await page.locator('.curriculum-stage-card').first().waitFor();
  assert.equal(page.url(), `${base}/data-core/curriculum/start`);
  assert.deepEqual(errors, []);
  assert.equal(mutations, 0);
  const report = {api: 'isolated synthetic fixtures, no production data', reports, roles: ['MASTER', 'CAMPUS_ADMIN', 'TEACHER'], folderNavigation: 'click, reload, back, history, trailing slash, legacy lesson link', errors, mutations};
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

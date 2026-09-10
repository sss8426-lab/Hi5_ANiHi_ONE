import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.MODE_PHOTO_BASE || 'http://localhost:3113';
const browser = await chromium.launch({headless:true, channel:'chrome'});
let checks = 0, authenticated = false;
const check = (value, message) => { assert.ok(value, message); checks++; };
const errors = [], badAssets = [], mutations = [];
try {
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== new URL(base).origin) return route.abort();
    if (req.isNavigationRequest() && u.pathname === '/data-core/work') {
      return route.fulfill({contentType:'text/html',body:'<h1>Synthetic work destination</h1>'});
    }
    if (!u.pathname.startsWith('/api/')) {
      if (req.method() !== 'GET') return route.abort();
      return route.continue();
    }
    if (req.method() === 'POST' && /^\/api\/data-core\/competition-sources\/(mgood|artmd)\/preview$/.test(u.pathname)) {
      return route.fulfill({json:{pages:[],items:[]}});
    }
    if (req.method() !== 'GET') {
      mutations.push(u.pathname);
      return route.fulfill({status:403,json:{error:'Synthetic read-only fixture'}});
    }
    if (u.pathname.endsWith('/context') || u.pathname === '/api/auth/session') {
      return route.fulfill({json:{authenticated,isSuperAdmin:authenticated,canWrite:authenticated,user:authenticated?{name:'Synthetic teacher'}:null,memberships:[]}});
    }
    if (u.pathname.endsWith('/health')) return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    // Model existing system folders so the legacy admin initializer has nothing to create.
    if (u.pathname === '/api/data-core/records' && u.searchParams.get('recordType') === 'hq-library-folder') {
      return route.fulfill({json:{records:['class-artwork','director-only','resources','production'].map((key, i) => ({
        id:`synthetic-folder-${i}`,campusId:null,recordType:'hq-library-folder',sourceApp:'data-core-library',
        title:`Synthetic folder ${i}`,metadata:{folderKey:key,sortOrder:(i+1)*10},
      }))}});
    }
    return route.fulfill({json:{campuses:[],records:[],files:[],events:[],competitions:[]}});
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() === 404 && !r.url().includes('/api/')) badAssets.push(new URL(r.url()).pathname); });
  await mkdir('outputs/mode-photos', {recursive:true});
  for (const state of [false,true]) {
    authenticated = state;
    for (const width of [1920,1440,1024,820,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.goto(base + '/data-core');
      await page.locator('body.mode-home-artwork-active').waitFor();
      const cards = page.locator('[data-mode-card]');
      check(await cards.count() === 2, 'two mode cards');
      for (const mode of ['counseling','work']) {
        const card = page.locator(`[data-mode-card="${mode}"]`), img = card.locator('img');
        await img.evaluate(i => i.decode());
        check((await img.getAttribute('src')).endsWith(`mode-${mode}-photo-v1.webp`), 'approved versioned photo');
        check(await img.evaluate(i => i.naturalWidth === 1440 && i.naturalHeight === 1080), 'photo dimensions');
        check(await img.evaluate(i => {const r=i.getBoundingClientRect();return Math.abs(r.width/r.height-4/3)<.01;}), 'whole approved photo without portrait crop');
        check(await card.getAttribute('href') === `/data-core/${mode}`, 'mode route retained');
        check(await card.locator('.mode-overlay').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'copy fits');
      }
      const boxes = await cards.evaluateAll(nodes => nodes.map(e => {const r=e.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};}));
      check(Math.abs(boxes[0].height-boxes[1].height) < 1, 'equal card heights');
      check(width > 980 ? Math.abs(boxes[0].y-boxes[1].y)<1 : boxes[1].y>boxes[0].y, 'responsive card arrangement');
      check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'no page overflow');
      await page.screenshot({path:`outputs/mode-photos/home-${width}-${state}.png`,fullPage:true});
      await cards.first().click();
      await page.waitForURL('**/data-core/counseling');
      await page.locator('#view-counseling-home.active').waitFor();
      const linkedPhoto = page.locator('.counseling-image-cards a[href="/data-core/roadmap"] img');
      await linkedPhoto.evaluate(i => i.decode());
      check((await linkedPhoto.getAttribute('src')).endsWith('mode-counseling-photo-v1.webp'), 'counseling card uses same approved photo');
      await page.screenshot({path:`outputs/mode-photos/counseling-${width}-${state}.png`,fullPage:true});
      await page.goBack();
      await page.locator('[data-mode-card="work"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/data-core/work');
      await page.getByRole('heading',{name:'Synthetic work destination'}).waitFor();
      check(true, 'work card supports keyboard navigation');
      await page.goBack();
      await page.reload();
      await page.locator('body.mode-home-artwork-active').waitFor();
      check(true, 'back and refresh preserve home');
    }
  }
  check(errors.length === 0, 'no browser errors');
  check(badAssets.length === 0, 'no broken assets');
  check(mutations.length === 0, `no mutations attempted: ${JSON.stringify([...new Set(mutations)])}`);
  console.log(JSON.stringify({checks,errors,badAssets,mutations,syntheticOnly:true}));
} finally { await browser.close(); }

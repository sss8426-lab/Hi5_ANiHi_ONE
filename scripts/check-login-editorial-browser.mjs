import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = resolve('public');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp'};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const file = resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(root + sep) || req.method !== 'GET') throw Error('Unsupported request');
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.LOGIN_BASE || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, channel: 'chrome'});
const errors = [], failedAssets = [];
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
try {
  const context = await browser.newContext();
  let session = {authenticated: false}, loginStatus = 401, changeRequired = false, mutationCount = 0;
  // All API calls are fulfilled synthetically, including when inspecting Preview.
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== new URL(base).origin) return route.abort();
    if (u.pathname === '/api/auth/session') return route.fulfill({json: session});
    if (u.pathname === '/api/auth/login') {
      mutationCount++;
      return route.fulfill({status: loginStatus, json: loginStatus === 200 ? {mustChangePassword: changeRequired} : {error: 'Synthetic login denied'}});
    }
    if (u.pathname === '/api/auth/password') {
      mutationCount++;
      return route.fulfill({json: {ok: true}});
    }
    if (u.pathname.startsWith('/api/') || req.method() !== 'GET') return route.abort();
    if (['/data-core/work', '/data-core/work/library', '/data-core/counseling', '/data-core'].includes(u.pathname)) {
      return route.fulfill({contentType: 'text/html', body: '<h1>Synthetic destination</h1>'});
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) failedAssets.push(new URL(r.url()).pathname); });
  await mkdir('outputs/login-editorial', {recursive: true});
  const visit = async (query = '') => {
    await page.goto(base + '/data-core/login.html' + query);
    await page.locator('.login-hero').evaluate(img => img.decode());
  };
  const dimensions = [[1920,1080],[1440,900],[1366,768],[1280,720],[1101,740],[1024,768],[820,1180],[768,1024],[390,844],[320,568],[844,390]];
  for (const [width, height] of dimensions) {
    await page.setViewportSize({width, height});
    await visit();
    const layout = await page.evaluate(() => {
      const img = document.querySelector('.login-hero'), panel = document.querySelector('.login-panel');
      const rect = e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
      return {image:rect(img), panel:rect(panel), stacked:getComputedStyle(img).position === 'relative',
        overflow:document.documentElement.scrollWidth > innerWidth + 1, natural:[img.naturalWidth,img.naturalHeight],
        controls:[...document.querySelectorAll('#loginForm input, #loginForm button')].map(rect)};
    });
    check(!layout.overflow, `no overflow ${width}x${height}`);
    check(layout.natural[0] === 1536 && layout.natural[1] === 1024, `approved image loaded ${width}`);
    check(layout.controls.every(r => r.x >= 0 && r.right <= width && r.height >= 40), `usable controls ${width}`);
    if (layout.stacked) {
      check(layout.panel.y >= layout.image.bottom, `panel below whole image ${width}`);
      check(Math.abs(layout.image.width / layout.image.height - 1.5) < .01, `uncropped image ${width}`);
    } else {
      check(layout.panel.x >= width * .65 && layout.panel.bottom <= height, `bottom-right panel ${width}`);
      // Approved headline occupies x=800..1510, y=80..455 in the 1536x1024 image.
      const scale = Math.max(width / 1536, height / 1024);
      check(layout.panel.y > 455 * scale, `panel does not cover headline ${width}`);
    }
    await page.screenshot({path: `outputs/login-editorial/login-${width}x${height}.png`, fullPage: true});
  }
  await page.setViewportSize({width: 1440, height: 900});
  await visit('?next=/data-core/work/library');
  await page.getByLabel('로그인 ID', {exact:true}).fill('synthetic-ui');
  await page.getByLabel('비밀번호', {exact:true}).fill('synthetic-only-not-real');
  await page.getByRole('button', {name:'로그인',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Synthetic login denied'}).waitFor();
  check(await page.getByRole('button',{name:'로그인',exact:true}).isEnabled(), 'failed login can retry');
  loginStatus = 200;
  await page.getByRole('button', {name:'로그인',exact:true}).click();
  await page.waitForURL('**/data-core/work/library');
  await page.getByRole('heading', {name:'Synthetic destination'}).waitFor();
  check(true, 'successful login keeps next destination');

  session = {authenticated: true, mustChangePassword: true};
  for (const [width,height] of [[1440,900],[1280,720],[390,844],[320,568]]) {
    await page.setViewportSize({width,height});
    await visit();
    await page.getByRole('heading',{name:'비밀번호 변경'}).waitFor();
    check(await page.locator('#currentPassword').evaluate(el => el === document.activeElement), `password focus ${width}`);
    check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `password form no overflow ${width}`);
    await page.screenshot({path:`outputs/login-editorial/password-${width}.png`,fullPage:true});
  }
  await page.locator('#currentPassword').fill('synthetic-only-old');
  await page.locator('#nextPassword').fill('synthetic-only-next');
  await page.locator('#confirmPassword').fill('synthetic-mismatch');
  const before = mutationCount;
  await page.getByRole('button',{name:'변경 후 시작하기'}).click();
  await page.locator('#passwordMessage').filter({hasText:'새 비밀번호가 일치하지 않습니다.'}).waitFor();
  check(mutationCount === before, 'mismatch sends no API call');
  await page.locator('#confirmPassword').fill('synthetic-only-next');
  await page.getByRole('button',{name:'변경 후 시작하기'}).click();
  await page.waitForURL('**/data-core/work');
  await page.getByRole('heading', {name:'Synthetic destination'}).waitFor();
  check(true, 'password change redirects after success');

  session = {authenticated:false};
  await visit();
  await page.getByRole('link',{name:'공개 상담 화면으로 돌아가기'}).click();
  await page.waitForURL('**/data-core/counseling');
  check(true, 'public counseling return works');
  await page.goBack();
  await page.locator('#loginForm').waitFor();
  await page.reload();
  await page.locator('#loginForm').waitFor();
  check(true, 'back and refresh keep login usable');
  check(errors.length === 0, 'no browser JS errors');
  check(failedAssets.length === 0, 'no failed static assets');
  console.log(JSON.stringify({checks, errors, failedAssets, network:'all auth APIs mocked; no real credentials or mutations'}));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

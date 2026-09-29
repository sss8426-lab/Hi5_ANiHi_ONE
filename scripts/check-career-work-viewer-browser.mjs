import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {careerWorks, artists} from '../public/data-core/career-works.js';
import {careerWorkVisuals} from '../public/data-core/career-work-visuals.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const publicRoot = path.resolve('public');
const output = 'outputs/career-work-viewer';
await fs.mkdir(output, {recursive:true});
const context = {window:{}};
for (const name of ['roadmap-content', 'career-visual-content']) vm.runInNewContext(await fs.readFile(`public/data-core/${name}.js`, 'utf8'), context);
const careers = JSON.parse(JSON.stringify(context.window.HI5_ROADMAP_CONTENT.careers));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
// Serve only repository static assets. Every API request is intercepted with synthetic responses below.
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(publicRoot, '.'+pathname);
    if (!file.startsWith(publicRoot+path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await fs.readFile(file);
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'}).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = [], sectionChecks = [], errors = [], mutations = [], externalImages = [];
try {
  browser = await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL || 'chrome'});
  const ctx = await browser.newContext({serviceWorkers:'block',hasTouch:true});
  await ctx.route('**/api/**', route => {
    if (route.request().method() !== 'GET') mutations.push(route.request().url());
    return route.fulfill({status:401,json:{error:'Synthetic unauthenticated viewer test'}});
  });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.resourceType() === 'image' && !request.url().startsWith(base)) externalImages.push(request.url()); });
  const dialog = page.locator('#workDetail');
  const open = async (career,index=0) => {
    await page.goto(`${base}/data-core/roadmap.html#family=${career.family}&career=${career.id}`);
    await page.locator('#careerVisualSections > section').first().waitFor();
    const layout = await page.locator('#careerVisualSections > section').evaluateAll(sections => ({
      keys:sections.map(section => section.dataset.section),
      numbers:sections.map(section => section.querySelector('.career-visual-number b').textContent),
      bounds:sections.map(section => { const box=section.getBoundingClientRect(); return {top:box.top,bottom:box.bottom}; }),
      introBottom:document.querySelector('#resultVisual').getBoundingClientRect().bottom,
      width:window.innerWidth,
      overflow:document.documentElement.scrollWidth>window.innerWidth
    }));
    assert.deepEqual(layout.keys,['portfolio','learning','competencies'],`${career.id} section order`);
    assert.deepEqual(layout.numbers,['01','02','03']);
    assert.ok(layout.bounds[0].top >= layout.introBottom-1,'Portfolio follows the career introduction');
    assert.ok(layout.bounds[1].top >= layout.bounds[0].bottom-1,'Learning follows portfolio');
    assert.ok(layout.bounds[2].top >= layout.bounds[1].bottom-1,'Competencies follow learning');
    assert.equal(layout.overflow,false,`${career.id}:${layout.width} page overflow`);
    sectionChecks.push({career:career.id,width:layout.width,order:layout.keys});
    await page.locator(`.career-work-open[data-work="${index}"]`).click();
    await dialog.locator('.work-viewer-picture img').evaluate(img=>img.decode());
  };
  const check = async (career,index,width) => {
    const image = careerWorkVisuals[career.id][index];
    assert.ok(image.available, `${career.id}:${index} missing artwork`);
    await dialog.locator('.work-viewer-picture img').evaluate(img=>img.decode());
    assert.equal(await dialog.locator('#workDetailTitle').textContent(),image.title);
    assert.equal(await dialog.locator('.work-viewer-picture img').getAttribute('src'),`${image.image}?v=${image.version}`);
    const geometry = await dialog.evaluate(d => {
      const img=d.querySelector('.work-viewer-picture img');
      return {width:d.clientWidth,scrollWidth:d.scrollWidth,img:img.getBoundingClientRect().toJSON(),top:d.querySelector('.work-viewer-top').getBoundingClientRect().toJSON(),bottom:d.querySelector('.work-viewer-bottom').getBoundingClientRect().toJSON(),fit:getComputedStyle(img).objectFit,natural:[img.naturalWidth,img.naturalHeight]};
    });
    assert.ok(geometry.scrollWidth <= geometry.width+1, `${career.id}:${index}:${width} overflow`);
    assert.ok(geometry.img.width >= geometry.width-26, 'Artwork fills viewer width');
    assert.deepEqual(geometry.natural,[image.width,image.height]);
    assert.ok(Math.abs(geometry.img.width/geometry.img.height-image.width/image.height)<0.01, 'No stretching or cropping');
    assert.equal(geometry.fit,'contain');
    assert.ok(geometry.img.top >= geometry.top.bottom-1);
    assert.ok(geometry.bottom.top >= geometry.img.bottom-1);
    const footer = await dialog.locator('.work-viewer-bottom').innerText();
    const work = careerWorks[career.id][index];
    assert.equal(await dialog.locator('.work-viewer-artist').count(),work.artists.length);
    for (const id of work.artists) for (const value of [artists[id].name,artists[id].bio,...artists[id].works]) assert.ok(footer.includes(value), `${career.id} lost artist content`);
    for (const value of [...work.uses,...work.portfolio]) assert.ok(footer.includes(value));
    assert.ok((await dialog.innerText()).includes('아래 대표 작가의 실제 작품과는 별개의 예시입니다.'));
    report.push({career:career.id,work:index+1,width});
  };
  for (const [width,height] of [[1440,1000],[390,844],[2560,1164],[1920,1080],[1024,768],[768,1024],[320,740]]) {
    await page.setViewportSize({width,height});
    const subset = [1440,390].includes(width) ? careers : careers.filter(c=>['D006','D010','D018'].includes(c.id));
    for (const career of subset) {
      await open(career);
      for (let i=0;i<3;i++) {
        await check(career,i,width);
        if (['D006','D010','D018'].includes(career.id) && i===0) await page.screenshot({path:`${output}/${width}-${career.id}.png`});
        if(i<2) await page.keyboard.press('ArrowRight');
      }
      assert.equal(await dialog.locator('.work-viewer-next').isDisabled(),true);
      await page.keyboard.press('Escape');
      assert.equal(await dialog.evaluate(d=>d.open),false);
      assert.equal(await page.locator('.career-work-open[data-work="0"]').evaluate(b=>document.activeElement===b),true);
    }
    console.log(JSON.stringify({width,checked:report.length}));
  }
  const career = careers.find(c=>c.id==='D006');
  await open(career,1);
  await check(career,1,320);
  await dialog.locator('.work-viewer-prev').click();
  assert.equal(await dialog.locator('.work-viewer-prev').isDisabled(),true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await dialog.locator('#workDetailTitle').textContent(),careerWorkVisuals.D006[0].title);
  const surface=dialog.locator('.work-viewer-picture');
  await surface.dispatchEvent('touchstart',{touches:[{identifier:0,clientX:240,clientY:200}]});
  await surface.dispatchEvent('touchend',{changedTouches:[{identifier:0,clientX:80,clientY:205}]});
  await check(career,1,320);
  await surface.dispatchEvent('touchstart',{touches:[{identifier:0,clientX:240,clientY:200}]});
  await surface.dispatchEvent('touchend',{changedTouches:[{identifier:0,clientX:180,clientY:500}]});
  assert.equal(await dialog.locator('#workDetailTitle').textContent(),careerWorkVisuals.D006[1].title,'Vertical scrolling must not change work');
  await dialog.locator('.work-viewer-close').click();
  assert.equal(await page.locator('.career-work-open[data-work="1"]').evaluate(b=>document.activeElement===b),true);
  await page.route('**/works/d006-01.webp?*', route=>route.fulfill({status:404,body:'Synthetic missing image'}));
  await page.reload();
  await page.locator('.career-work-open[data-work="0"]').click();
  await dialog.locator('.work-viewer-error:visible').waitFor();
  assert.equal(await dialog.locator('.work-viewer-picture img:visible').count(),0);
  assert.ok((await dialog.locator('.work-viewer-bottom').innerText()).includes(artists[careerWorks.D006[0].artists[0]].name));
  await dialog.locator('.work-viewer-next').click();
  await check(career,1,320);
  assert.deepEqual(errors,[]);
  assert.deepEqual(mutations,[]);
  assert.deepEqual(externalImages,[]);
  await fs.writeFile(`${output}/report.json`,JSON.stringify({kind:'local static app with synthetic API responses',checks:report.length,sectionChecks,report,errors,mutations,externalImages},null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks:report.length,sectionChecks:sectionChecks.length,output}));
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3107';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) && !/^https:\/\/[a-f0-9]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(base)) throw Error('Synthetic local/immutable Preview only');
const output = `outputs/roadmap-request-${base.startsWith('http:') ? 'local' : 'preview'}`;
await fs.mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true, channel:'chrome'});
const errors = [], mutations = [], missing = [], results = [];
let mode = 'success', holdId, announce, release;
try {
  const context = await browser.newContext({serviceWorkers:'block'});
  context.setDefaultTimeout(15000);
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') { mutations.push(url.pathname); return route.fulfill({status:405, json:{error:'Synthetic read only'}}); }
    if (url.pathname === '/api/data-core/roadmap/programs') {
      const career = url.searchParams.get('careerId'), page = Number(url.searchParams.get('page') || 1);
      return route.fulfill({json:{programs:Array.from({length:4},(_,n)=>({id:`synthetic-${career}-${page}-${n}`,metadata:{universityName:`합성 대학 ${n}`,major:career==='D017'?'시각디자인':'웹툰',year:2027,admission:'수시',guidelineId:`synthetic-${career}-${page}-${n}`,selectionFormula:'실기100',sourceUrl:'https://grinalda.net/univ-info-susi/'}})),pagination:{page,totalPages:2,buttons:[1,2],total:8},total:8,facets:{region:[],schoolType:[]},trend:null}});
    }
    if (url.pathname === '/api/data-core/admissions/guidelines') {
      const id = url.searchParams.get('id'), requestMode = mode;
      if (id === holdId) { announce(); await new Promise(resolve => { release = resolve; }); }
      return route.fulfill(requestMode === 'failure' ? {status:500,json:{error:'Synthetic failure'}} : {json:{rows:[{id:requestMode==='wrong'?'synthetic-wrong':id,universityName:id,department:'합성 전공',academicYear:2027,admissionSeason:'susi',selectionFormula:'실기100',sourceUrl:'https://grinalda.net/univ-info-susi/'}]}}).catch(()=>{});
    }
    return route.fulfill({status:401,json:{error:'Synthetic context only'}});
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status()>=400 && !r.url().includes('/api/')) missing.push(new URL(r.url()).pathname); });
  const navigate = async id => {
    const family=id==='D017'?'design':'story';
    await page.goto(`${base}/data-core/roadmap#family=${family}`);
    await page.locator(`.dream-card[href="#family=${family}&career=${id}"]`).click();
    await page.locator('.university-item').first().waitFor({state:'visible'});
    await page.locator('#notice[hidden]').waitFor({state:'attached'});
    assert.equal(await page.locator('.university-item').count(),4);
  };
  const hold = id => { holdId=id;return new Promise(resolve=>{announce=resolve;}); };
  const finishHeld = async () => { release();holdId=null;await page.waitForTimeout(100); };
  const open = n => page.getByRole('button',{name:'입시요강 보기',exact:true}).nth(n).click();
  for (const [width,height] of [[1920,1080],[1440,1000],[820,1180],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});
    await navigate('D001');
    let started = hold('synthetic-D001-1-0');
    await open(0); await started; await open(1);
    await page.locator('dialog[open] h2').filter({hasText:'synthetic-D001-1-1'}).waitFor();
    await finishHeld();
    assert.equal(await page.locator('dialog[open] h2').innerText(),'synthetic-D001-1-1');
    results.push({width,case:'latest-click',passed:true});
    await page.keyboard.press('Escape');
    started=hold('synthetic-D001-1-0');await open(0);await started;
    await navigate('D017');await finishHeld();
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#notice').isVisible(),false);
    results.push({width,case:'navigation-cancels',passed:true});
    await open(0);await page.locator('dialog[open]').waitFor();
    await navigate('D001');assert.equal(await page.locator('dialog[open]').count(),0);
    results.push({width,case:'navigation-closes-modal',passed:true});
    started=hold('synthetic-D001-1-0');await open(0);await started;
    await page.getByRole('button',{name:'2 페이지',exact:true}).click();
    await page.locator('#universityPagination [aria-current]').filter({hasText:'2'}).waitFor();await finishHeld();
    assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('.university-item').count(),4);
    results.push({width,case:'pagination-cancels',passed:true});
    mode='wrong';await open(0);await page.getByText('저장된 입시요강을 찾을 수 없습니다.',{exact:true}).waitFor();
    assert.equal(await page.locator('dialog[open]').count(),0);results.push({width,case:'mismatched-id',passed:true});
    mode='failure';await open(0);await page.getByText('입시요강을 불러오지 못했습니다. 다시 시도해주세요.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'입시요강 보기',exact:true}).first().isEnabled(),true);
    mode='success';await open(0);await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('#notice').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await page.locator('dialog[open]').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.screenshot({path:`${output}/${width}-guideline.png`});await page.keyboard.press('Escape');
    results.push({width,case:'retry-and-responsive-dialog',passed:true});
    console.log(JSON.stringify({width,passed:results.length}));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);assert.deepEqual(missing,[]);
  const report={checks:results.length,results,pageErrors:0,mutationRequests:0,missingAssets:0};
  await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,results:undefined}));
} finally { release?.();await browser.close(); }

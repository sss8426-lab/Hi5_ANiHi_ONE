import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = resolve('public');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.svg':'image/svg+xml'};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) throw Error('Outside public');
    res.setHeader('content-type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true, channel:'chrome'});
const failures = [], errors = [];
let checks = 0;
const check = async (name, fn) => { try { await fn(); checks++; } catch (e) { failures.push(`${name}: ${e.message}`); console.log(JSON.stringify({failed:name,error:e.message})); } };
try {
  const ctx = await browser.newContext();
  let programStatus = 503, requests = [], slowResolve, slowRequest = false;
  const fixture = season => ({id:'synthetic-guide', academicYear:'2027', admissionSeason:season, universityName:'Synthetic University', department:'Synthetic Art', admissionType:'Synthetic admission', sourceUrl:`https://grinalda.net/univ-info-${season}/`});
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (req.method() !== 'GET') throw Error('No mutation is permitted');
    if (u.pathname === '/synthetic-host') return route.fulfill({contentType:'text/html', body:'<style>.hidden{display:none}</style><section id="susi"></section><section id="jungsi" class="hidden"></section>'});
    if (u.pathname === '/synthetic-parent') return route.fulfill({contentType:'text/html', body:'<iframe src="/synthetic-host"></iframe>'});
    if (u.pathname.endsWith('/programs')) return route.fulfill({status:programStatus, json:programStatus===200?{programs:[]}:{error:'Synthetic unavailable'}});
    if (u.pathname.endsWith('/guidelines')) {
      requests.push(Object.fromEntries(u.searchParams));
      if (slowRequest) { slowRequest = false; await new Promise(r => {slowResolve=r;}); }
      const season=u.searchParams.get('season');
      const rows=u.searchParams.get('id')==='missing'?[]:[fixture(season)];
      return route.fulfill({json:{rows, total:rows.length, page:1, facets:{}, canSync:false}});
    }
    if (u.pathname.startsWith('/api/')) throw Error('Unexpected API');
    return route.continue();
  });
  const p = await ctx.newPage(); p.on('pageerror', e=>errors.push(e.message));
  let hostId=0;
  const host = async (hash, framed=false) => {
    await p.goto(base+(framed?'/synthetic-parent':'/synthetic-host')+`?run=${++hostId}`+hash);
    const frame=framed?p.frames().find(f=>f!==p.mainFrame()):p.mainFrame();
    await frame.waitForSelector('#susi',{state:'attached'});
    const season=new URLSearchParams(hash.slice(1)).get('page');
    await frame.evaluate(async season=>{for(const id of ['susi','jungsi'])document.getElementById(id).classList.toggle('hidden',id!==season);const m=await import('/admissions-web/renderer/guidelines.js'); await m.renderGuidelines(season);},season);
    return frame;
  };
  for (const season of ['susi','jungsi']) for (const framed of [false, true]) {
    const f=await host(`#page=${season}&guideline=synthetic-guide&keep=synthetic`,framed);
    await f.locator('.guideline-dialog[open]').waitFor();
    await f.getByRole('button',{name:'상세 닫기'}).click();
    const historyLength=await p.evaluate(()=>{history.replaceState({synthetic:true},'',location.href);return history.length;});
    await f.getByRole('button',{name:'초기화',exact:true}).click();
    await f.locator('[data-status]').filter({hasText:'검색 결과'}).waitFor();
    await check(`reset clears deep link ${season} framed=${framed}`,async()=>{
      assert.equal(await f.locator('.guideline-dialog').count(),0);
      assert.equal(new URL(p.url()).hash,`#page=${season}&keep=synthetic`);
      assert.equal(requests.at(-1).id,undefined);
      assert.deepEqual(await p.evaluate(()=>({state:history.state,length:history.length})),{state:{synthetic:true},length:historyLength});
    });
  }
  const f=await host('#page=susi&guideline=missing');
  await f.locator('[data-status]').filter({hasText:'검색 결과 0개'}).waitFor();
  await f.locator('[name="query"]').fill('Synthetic');
  await f.getByRole('button',{name:'검색',exact:true}).click();
  await f.locator('[data-status]').filter({hasText:'검색 결과'}).waitFor();
  await check('missing deep link does not trap search',async()=>{
    assert.equal(requests.at(-1).id,undefined);
    assert.equal(await f.locator('[data-row-detail]').count(),1);
  });
  await host('#page=susi');
  slowRequest=true;
  await p.getByRole('button',{name:'검색',exact:true}).click();
  await p.locator('[data-status]').filter({hasText:'확인하고 있습니다'}).waitFor();
  await check('old results cannot be opened during a new search',async()=>assert.equal(await p.locator('[data-row-detail]').count(),0));
  while (!slowResolve) await new Promise(r=>setTimeout(r,10));
  slowResolve();
  await p.locator('[data-row-detail]').waitFor();
  await p.goto(base+'/data-core/roadmap.html#family=story&career=D001');
  await p.locator('#notice').filter({hasText:'불러오지 못했습니다'}).waitFor();
  await mkdir('outputs/counseling-recovery',{recursive:true});
  for (const width of [1440,390]) {
    await p.setViewportSize({width,height:900});
    await p.locator('#notice').scrollIntoViewIfNeeded();
    await check(`retry fits viewport ${width}`,async()=>{
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const box=await p.getByRole('button',{name:'다시 불러오기'}).boundingBox();
      assert.ok(box && box.x>=0 && box.x+box.width<=width);
    });
    await p.screenshot({path:`outputs/counseling-recovery/retry-${width}.png`});
  }
  await check('transient failure offers in-place retry',async()=>{
    assert.equal(await p.getByRole('button',{name:'다시 불러오기'}).count(),1);
    programStatus=200;
    await p.getByRole('button',{name:'다시 불러오기'}).click();
    await p.locator('#notice').waitFor({state:'hidden'});
    assert.equal(await p.getByRole('button',{name:'다시 불러오기'}).count(),0);
  });
  for (const status of [401,403]) {
    programStatus=status;
    await p.reload();
    await p.locator('#notice').filter({hasText:/잠시 후|로그인|권한/}).waitFor();
    await check(`no retry for authorization ${status}`,async()=>{
      assert.equal(await p.getByRole('button',{name:'다시 불러오기'}).count(),0);
      assert.match(await p.locator('#notice').textContent(),status===401?/로그인/:/권한/);
    });
  }
  await check('no browser exceptions',async()=>assert.deepEqual(errors,[]));
  await p.screenshot({path:'outputs/counseling-recovery/permission.png'});
  console.log(JSON.stringify({checks,failures,browserErrors:errors.length}));
  if(failures.length)process.exitCode=1;
} finally { await browser.close(); await new Promise(r=>server.close(r)); }

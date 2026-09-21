import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { libraryHarness, users, A, B } from '../tests/support/library-harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv.includes('--preview') ? new URL(process.argv[process.argv.indexOf('--preview') + 1]).origin : null;
const root = path.resolve('public'), out = path.resolve('outputs/calendar-browser');
await fs.mkdir(out, { recursive: true });
const h = await libraryHarness(), checked = new Set(), errors = [], writes = [], timings = [];
let role = users.campusAdmin, failWrite = false, failRead = false, releaseWrite, holdWrite = false, releaseRead, holdRead = false, acceptClose = true;
let reads = 0;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.includes('/competition-sources/')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [], pages: [] })); return;
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes.toString()) : undefined;
      const calendar = url.pathname.startsWith('/api/data-core/calendar');
      if(calendar && req.method==='GET' && failRead){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'SYNTHETIC_READ_RETRY'}));return;}
      if (calendar && req.method !== 'GET') {
        writes.push({ method: req.method, body });
        if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; });
        if (failWrite) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'SYNTHETIC_RETRY' })); return; }
      }
      const result = await h.raw(req.method, url.pathname + url.search, role, body);
      const responseBytes = Buffer.from(await result.arrayBuffer());
      if (calendar && req.method === 'GET') {
        reads++;
        if (holdRead) { holdRead = false; await new Promise(resolve => { releaseRead = resolve; }); }
      }
      res.writeHead(result.status, Object.fromEntries(result.headers)).end(responseBytes); return;
    }
    const pathname = ['/data-core/work', '/data-core/counseling'].includes(url.pathname) ? '/data-core/index.html' : url.pathname;
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await fs.readFile(file);
    if (preview && !checked.has(pathname)) {
      const remote = await fetch(preview + pathname);
      const hash = value => createHash('sha256').update(/\.(html|js|css|svg|json)$/.test(pathname) ? value.toString('utf8').replace(/\r\n/g, '\n') : value).digest('hex');
      assert.equal(remote.status, 200, pathname);
      assert.equal(hash(Buffer.from(await remote.arrayBuffer())), hash(bytes), pathname);
      checked.add(pathname);
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(error.message);
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', timezoneId:'America/Los_Angeles' });
  await context.addInitScript(() => {
    const NativeObserver = window.MutationObserver;
    window.calendarMetrics = { observers: 0, callbacks: 0, listeners:0 };
    const addListener=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(...args){if(this instanceof Element&&this.matches('[data-calendar-home],#calendarDetail,#calendarModal'))window.calendarMetrics.listeners++;return addListener.apply(this,args);};
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        let calendar = false;
        super((records, observer) => { if (calendar) window.calendarMetrics.callbacks++; callback(records, observer); });
        const observe = this.observe.bind(this);
        this.observe = (target, options) => {
          if (target.hasAttribute?.('data-calendar-home') && !calendar) { calendar = true; window.calendarMetrics.observers++; }
          observe(target, options);
        };
      }
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('dialog',dialog=>acceptClose?dialog.accept():dialog.dismiss());
  const home = page.locator('#view-work-home');
  await page.goto(origin + '/data-core/work');
  assert.equal(await page.evaluate(()=>window.AcademyCalendar.dateKey(new Date('2026-09-30T15:30:00Z'))),'2026-10-01');
  await home.locator('[data-calendar-add]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#calendarCampus').options.length > 0);
  // Calendar redraws used to leave orphan observers and multiply callback work.
  for (let i = 0; i < 40; i++) await home.locator('[data-calendar-date]:not(.outside)').nth(i % 20).click();
  const metrics = await page.evaluate(() => window.calendarMetrics);
  assert.equal(metrics.observers, 2); assert.ok(metrics.callbacks < 100, JSON.stringify(metrics));
  const widths = [1920, 1440, 1280, 1024, 820, 768, 430, 390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await home.locator('[data-calendar-add]').click();
    assert.equal(await page.locator('#calendarCampus').inputValue(), A);
    assert.equal(await page.locator('#calendarCampus option').count(), 1);
    const start = performance.now();
    await page.locator('#calendarTitle').fill('SYNTHETIC_원종캠퍼스 전시회');
    await page.locator('#calendarSummary').fill('한글 입력과 수정 검증');
    timings.push({ width, inputMs: Math.round(performance.now() - start) });
    assert.equal(await page.locator('#calendarTitle').inputValue(), 'SYNTHETIC_원종캠퍼스 전시회');
    await page.locator('#calendarStartDate').fill('2026-10-24');
    await page.locator('#calendarEndDate').fill('2026-10-25');
    assert.ok(await page.locator('#calendarSubmitBtn').isEnabled());
    assert.equal(await page.evaluate(() => {
      const el = document.querySelector('#calendarModal .modal'), r = el.getBoundingClientRect();
      return r.left < 0 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1;
    }), false, `modal overflow ${width}`);
    await page.screenshot({ path: `${out}/calendar-${width}.png` });
    await page.locator('[data-close-modal="calendarModal"]').click();
  }
  await home.locator('[data-calendar-add]').click();
  await page.locator('#calendarTitle').fill('SYNTHETIC_원종캠퍼스 전시회');
  await page.locator('#calendarStartDate').fill('2026-10-24');
  await page.locator('#calendarEndDate').fill('2026-10-23');
  await page.locator('#calendarSubmitBtn').click();
  assert.equal(writes.length, 0);
  await page.locator('#calendarFormError').getByText('종료일은 시작일과 같거나 이후여야 합니다.').waitFor();
  await page.locator('#calendarEndDate').fill('2026-10-25');
  failWrite = true;
  await page.locator('#calendarSubmitBtn').click();
  await page.locator('#calendarFormError').getByText('SYNTHETIC_RETRY').waitFor();
  assert.equal(await page.locator('#calendarTitle').inputValue(), 'SYNTHETIC_원종캠퍼스 전시회');
  failWrite = false; holdWrite = true;
  const count = writes.length;
  await page.locator('#calendarSubmitBtn').click();
  await page.waitForFunction(() => document.querySelector('#calendarForm').getAttribute('aria-busy') === 'true');
  await page.locator('#calendarForm').dispatchEvent('submit');
  assert.ok(await page.locator('#calendarSubmitBtn').isDisabled());
  await page.locator('[data-close-modal="calendarModal"]').click();
  assert.ok(await page.locator('#calendarModal').isVisible());
  await new Promise(resolve => { const check = () => releaseWrite ? resolve() : setTimeout(check, 10); check(); });
  assert.equal(writes.length, count + 1);
  const changesMonth = !(await home.locator('[data-calendar-month]').textContent()).includes('2026년 10월');
  const refreshed = changesMonth ? page.waitForResponse(response => response.url().includes('/calendar?') && new URL(response.url()).searchParams.get('to')==='2026-10-31' && response.ok()) : Promise.resolve();
  holdWrite = false; releaseWrite();
  await page.locator('#calendarModal').waitFor({ state:'hidden' });
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_원종캠퍼스 전시회', { exact: true }).waitFor();
  await refreshed;
  const visit=async path=>page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},path);
  await visit('/data-core/counseling');
  const counterpart=page.locator('#view-counseling-home');
  await counterpart.locator('[data-calendar-status]').getByText(/전체 조회 완료/).waitFor();
  await counterpart.locator('[data-calendar-list] [data-calendar-event]').click();
  await page.locator('[data-detail-edit]').waitFor();
  const readsBeforeEdit = reads;
  await page.locator('[data-detail-edit]').click();
  await page.locator('#calendarTitle').fill('SYNTHETIC_수정 완료');
  await page.locator('#calendarEndDate').fill('');
  await page.locator('#calendarSubmitBtn').click();
  await page.locator('#calendarModal').waitFor({ state:'hidden' });
  await page.locator('#calendarDetailTitle').getByText('SYNTHETIC_수정 완료',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(reads, readsBeforeEdit, 'same-month save does not wait for a redundant GET');
  await visit('/data-core/work');
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_수정 완료', { exact: true }).waitFor();
  const listed = await h.request('GET', '/api/data-core/calendar?from=2026-10-01&to=2026-10-31', role);
  assert.equal(listed.body.events.length, 1);
  assert.equal(listed.body.events[0].metadata.endDate, undefined);
  // An older month request must never replace the newest navigation result.
  holdRead = true;
  await home.locator('[data-calendar-next]').click();
  await new Promise(resolve => { const check = () => releaseRead ? resolve() : setTimeout(check, 10); check(); });
  await home.locator('[data-calendar-prev]').click();
  releaseRead();
  await home.locator('[data-calendar-date="2026-10-24"]').click();
  await home.locator('[data-calendar-list]').getByText('SYNTHETIC_수정 완료', { exact: true }).waitFor();
  await page.reload();
  await home.locator('[data-calendar-add]').waitFor({ state: 'visible' });
  role = users.master;
  await page.goto(origin + '/data-core/counseling');
  const counseling = page.locator('#view-counseling-home');
  await counseling.locator('[data-calendar-add]').click();
  await page.waitForFunction(() => document.querySelector('#calendarCampus').options.length > 1);
  await page.locator('#calendarCampus').selectOption('');
  assert.equal(await page.locator('#calendarCampus option:checked').textContent(), '조직 공통');
  await page.keyboard.press('Escape');
  // Seed only isolated D1. More than a page of matching dates must be loaded before claiming completion.
  const longTitle=('SYNTHETIC_DUPLICATE '+ '긴 한글 제목 '.repeat(18)).trim();
  const memo='SYNTHETIC_MATCH\n준비사항 <img src=x onerror="window.calendarXss=true">\n'+'상세 메모를 끝까지 확인합니다.\n'.repeat(60);
  const make=async(title,summary,date='2026-10-24',extra={})=>{
    const result=await h.request('POST','/api/data-core/calendar',users.admin,{title,summary,campusId:A,visibility:'campus',metadata:{startDate:date,eventType:'meeting',...extra}});
    assert.equal(result.status,201,JSON.stringify(result.body));return result.body.event;
  };
  const first=await make(longTitle,'다른 기록'),target=await make(longTitle,memo,'2026-10-24',{endDate:'2026-11-03',allDay:false,startTime:'09:30',endTime:'11:00',location:'SYNTHETIC_ROOM'});
  const template=await h.env.DB.prepare('SELECT * FROM data_records WHERE id=?').bind(first.id).first();
  for(let offset=0;offset<120;offset+=20)await h.env.DB.batch(Array.from({length:20},(_,i)=>h.env.DB.prepare(`INSERT INTO data_records (id,organization_id,campus_id,record_type,source_app,title,summary,visibility,status,metadata_json,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    `calendar-browser-${offset+i}`,template.organization_id,A,template.record_type,template.source_app,'SYNTHETIC_BULK '+(offset+i),'합성 페이지 검증','campus','active',template.metadata_json,template.created_by_user_id,template.created_at,template.updated_at)));
  const currentDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  await make('SYNTHETIC_TODAY','한국 오늘 기준',currentDay);
  role=users.campusAdmin;
  await page.goto(origin+'/data-core/work');await home.locator('[data-calendar-add]').waitFor();
  await home.locator('[data-calendar-status]').getByText(/^선택한 월 .*전체 조회 완료$/).waitFor();
  const jump=home.locator('[data-calendar-jump]');await jump.fill('2026-10');await jump.dispatchEvent('change');
  await home.locator('[data-calendar-status]').getByText(/^선택한 월 .*전체 조회 완료$/).waitFor();
  assert.ok((await home.locator('[data-calendar-status]').textContent()).includes('123건'),await home.locator('[data-calendar-status]').textContent());
  assert.equal(await home.locator('button button').count(),0);
  await home.locator('[data-calendar-date="2026-10-24"]').click();
  await home.locator('[data-calendar-more="2026-10-24"]').click();
  assert.equal(await page.locator('#calendarDetailBody [data-calendar-event]').count(),123);
  await page.locator('#calendarDetailBody [data-calendar-event]').filter({hasText:longTitle}).last().click();
  await page.locator('[data-detail-edit]').waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#calendarDetail').isVisible(),false);
  const search=home.locator('[data-calendar-search]');await search.focus();
  await search.dispatchEvent('compositionstart');const beforeComposition=reads;await search.fill('SYNTHETIC_MATCH');await page.waitForTimeout(250);assert.equal(reads,beforeComposition);
  await search.dispatchEvent('compositionend');await home.locator('[data-calendar-status]').getByText(/1건 · 전체 조회 완료/).waitFor();
  assert.ok(await search.evaluate(el=>el===document.activeElement));
  await home.locator('[data-calendar-mode="list"]').click();
  assert.equal(await home.locator('[data-calendar-agenda] [data-calendar-event]').count(),1);
  const targetButton=home.locator('[data-calendar-agenda] [data-calendar-event]');
  assert.equal(await targetButton.getAttribute('data-calendar-event'),'academy:'+target.id);
  await targetButton.focus();await page.keyboard.press('Enter');await page.locator('[data-detail-edit]').waitFor();
  assert.equal(await page.locator('#calendarDetailTitle').textContent(),longTitle);
  assert.ok((await page.locator('#calendarDetailBody').textContent()).includes('SYNTHETIC_ROOM'));
  assert.equal(await page.evaluate(()=>Boolean(window.calendarXss)),false);
  assert.equal(await page.locator('#calendarDetailBody img').count(),0);
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('#calendarDetail').contains(document.activeElement)));}
  await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>document.querySelector('#calendarDetail').contains(document.activeElement)));
  await page.keyboard.press('Escape');assert.ok(await targetButton.evaluate(el=>el===document.activeElement));
  for(const width of [1920,1440,1024,768,430,390,320]){
    await page.setViewportSize({width,height:900});await targetButton.click();await page.locator('[data-detail-edit]').waitFor();
    assert.equal(await page.evaluate(()=>{const el=document.querySelector('#calendarDetail'),r=el.getBoundingClientRect(),footer=el.querySelector('footer').getBoundingClientRect();return r.left<0||r.right>innerWidth+1||el.scrollWidth>el.clientWidth+1||footer.bottom>innerHeight+1;}),false,'detail layout '+width);
    await page.locator('#calendarDetailBody').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await page.screenshot({path:`${out}/detail-${width}.png`});await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page layout '+width);
  }
  const listenersBefore=await page.evaluate(()=>window.calendarMetrics.listeners);
  for(let i=0;i<50;i++){await targetButton.click();await page.locator('[data-detail-edit]').waitFor();await page.keyboard.press('Escape');}
  const repeated=await page.evaluate(()=>window.calendarMetrics);assert.equal(repeated.observers,2);assert.ok(repeated.callbacks<180,JSON.stringify(repeated));
  assert.equal(repeated.listeners,listenersBefore);
  await targetButton.click();await page.locator('[data-detail-copy]').waitFor();const beforeCopy=writes.length;
  await page.locator('[data-detail-copy]').click();assert.equal(writes.length,beforeCopy);assert.equal(await page.locator('#calendarEventId').inputValue(),'');assert.equal(await page.locator('#calendarStartDate').inputValue(),'');
  assert.equal(await page.locator('#calendarCampus').inputValue(),A);
  await page.locator('#calendarStartDate').fill('2026-10-27');await page.locator('#calendarTitle').fill('SYNTHETIC_COPY');
  acceptClose=false;await page.keyboard.press('Escape');assert.equal(await page.locator('#calendarModal').isVisible(),true);assert.equal(await page.locator('#calendarTitle').inputValue(),'SYNTHETIC_COPY');acceptClose=true;
  await page.locator('#calendarTimeMode').selectOption('time');await page.locator('#calendarStartTime').fill('14:00');await page.locator('#calendarEndTime').fill('13:00');
  await page.locator('#calendarSubmitBtn').click();assert.equal(writes.length,beforeCopy);await page.locator('#calendarFormError').getByText(/종료 시간/).waitFor();
  await page.locator('#calendarEndTime').fill('15:00');await page.locator('#calendarSubmitBtn').click();await page.locator('#calendarModal').waitFor({state:'hidden'});
  const copy=(await h.request('GET','/api/data-core/calendar?from=2026-10-01&to=2026-10-31&q=SYNTHETIC_COPY',role)).body.events[0];
  assert.notEqual(copy.id,target.id);assert.equal(copy.metadata.startTime,'14:00');assert.equal(copy.metadata.location,'SYNTHETIC_ROOM');
  assert.equal((await h.request('GET','/api/data-core/calendar/'+target.id,role)).body.event.title,longTitle);
  await search.fill('');await home.locator('[data-calendar-status]').getByText(/124건 · 전체 조회 완료/).waitFor();
  await home.locator('[data-calendar-type]').selectOption('holiday');await home.locator('[data-calendar-status]').getByText(/0건 · 전체 조회 완료/).waitFor();
  await home.locator('[data-calendar-type]').selectOption('meeting');await home.locator('[data-calendar-scope]').selectOption(A);
  await home.locator('[data-calendar-status]').getByText(/123건 · 전체 조회 완료/).waitFor();
  assert.equal(await home.locator(`[data-calendar-scope] option[value="${B}"]`).count(),0);
  await home.locator('[data-calendar-upcoming]').getByText('SYNTHETIC_TODAY',{exact:true}).click();await page.locator('[data-detail-edit]').waitFor();await page.keyboard.press('Escape');
  // Retry must be distinct from an empty result and must recover the full paginated list.
  failRead=true;await page.evaluate(()=>window.AcademyCalendar.load());await home.locator('[data-calendar-status]').getByText(/일정을 불러오지 못했습니다/).waitFor();
  assert.ok(!(await home.locator('[data-calendar-status]').textContent()).includes('0건'));
  failRead=false;await home.locator('[data-calendar-status] [data-calendar-retry]').click();await home.locator('[data-calendar-status]').getByText(/123건 · 전체 조회 완료/).waitFor();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await home.locator('[data-calendar-mode="month"]').click();await home.locator('[data-calendar-month]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/month-${width}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  // Slow detail response after Escape cannot overwrite a newer event detail.
  holdRead=true;releaseRead=null;await home.locator('[data-calendar-list] [data-calendar-event]').first().click();
  await new Promise(resolve=>{const check=()=>releaseRead?resolve():setTimeout(check,10);check();});
  await page.keyboard.press('Escape');await home.locator('[data-calendar-upcoming]').getByText('SYNTHETIC_TODAY',{exact:true}).click();await page.locator('[data-detail-edit]').waitFor();
  releaseRead();await page.waitForTimeout(100);assert.equal(await page.locator('#calendarDetailTitle').textContent(),'SYNTHETIC_TODAY');await page.keyboard.press('Escape');
  // A colleague may read but not edit somebody else's record. No synthetic role bypass in the API.
  const listenersBeforeTrips=await page.evaluate(()=>window.calendarMetrics.listeners),readsBeforeTrips=reads;
  for(let i=0;i<30;i++)for(const mode of ['counseling','work']){
    await visit('/data-core/'+mode);await page.evaluate(()=>window.AcademyCalendar.load());
    await page.locator(`#view-${mode}-home [data-calendar-status]`).getByText(/전체 조회 완료/).waitFor();
  }
  assert.equal(await page.locator('#calendarDetail').count(),1);
  assert.equal(await page.locator('[data-calendar-home] .calendar-tools').count(),2);
  assert.equal(await page.evaluate(()=>window.calendarMetrics.listeners),listenersBeforeTrips);
  assert.equal(reads-readsBeforeTrips,180,'one paginated month plus one summary query per visit, not per hidden root');
  await page.evaluate(()=>{
    const root=document.querySelector('[data-calendar-home]').cloneNode(true);root.id='synthetic-late-calendar';
    root.querySelectorAll('.calendar-tools,[data-calendar-status],[data-calendar-agenda],.calendar-summary').forEach(node=>node.remove());
    document.querySelector('main').append(root);
  });
  await page.locator('#synthetic-late-calendar .calendar-tools').waitFor();
  assert.equal(await page.locator('#synthetic-late-calendar .calendar-tools').count(),1);
  await page.evaluate(()=>document.querySelector('#synthetic-late-calendar').remove());
  role=users.teacher;await page.goto(origin+'/data-core/work');await home.locator('[data-calendar-upcoming]').getByText('SYNTHETIC_TODAY',{exact:true}).click();
  await page.locator('[data-detail-copy]').waitFor();assert.equal(await page.locator('[data-detail-edit]').count(),0);assert.equal(await page.locator('[data-detail-delete]').count(),0);
  await page.evaluate(()=>window.AcademyCalendar.reset());assert.equal(await page.locator('#calendarDetail').isVisible(),false);assert.equal(await page.locator('#calendarDetailBody').textContent(),'');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${out}/result.json`, JSON.stringify({ scope: 'real Worker + isolated synthetic D1/R2; no production writes', preview, checkedAssets: checked.size, widths, metrics, timings, writes: writes.length, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, metrics, timings, checkedAssets: checked.size }));
} finally {
  releaseRead?.(); releaseWrite?.();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await h.mf.dispose();
}

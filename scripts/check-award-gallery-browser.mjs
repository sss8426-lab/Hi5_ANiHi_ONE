import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.ROADMAP_TEST_ORIGIN || 'http://localhost:3107';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Synthetic fixtures require localhost');
const output = path.resolve('outputs/award-gallery-browser');
await fs.mkdir(output, {recursive:true});
const image = await fs.readFile('public/data-core/assets/mode-counseling.webp');
const browser = await chromium.launch({headless:true,channel:process.env.ROADMAP_BROWSER_CHANNEL || 'chrome'});
let checks=0;
try {
  const ctx = await browser.newContext();
  const errors=[], writes=[];
  let authenticated=true, slowA=false, role='SUPER_ADMIN';
  const trashed=new Set(), imageRequests=new Map();
  let folders=[
    {id:'b',title:'합성 두 번째 폴더',campusId:null,createdAt:'2026-09-02'},
    {id:'a',title:'합성 첫 번째 폴더',campusId:'synthetic-campus',createdAt:'2026-09-01'},
  ];
  const hqFolders=['class-artwork','director-only','resources','production'].map((key,i)=>({
    id:`hq-${i}`,title:`Synthetic HQ ${i}`,recordType:'hq-library-folder',sourceApp:'data-core-library',
    campusId:null,metadata:{folderKey:key,sortOrder:i+1},
  }));
  const files = (id) => Array.from({length:8},(_,i)=>({id:`${id}-${i}`,recordId:id,mimeType:'image/webp',fileName:`합성 수상작 ${id}-${i}`,category:'competition-material',ownerUserId:'local:synthetic-admin'})).filter(f=>!trashed.has(f.id));
  await ctx.route('**/*', async route => {
    const req=route.request(), url=new URL(req.url());
    if (url.origin!==base) return route.abort();
    const p=url.pathname;
    if (!p.startsWith('/api/')) return route.continue();
    if (req.method()!=='GET') writes.push({path:p,method:req.method(),body:req.postData()});
    if (p==='/api/data-core/context') return route.fulfill({json:{authenticated,canWrite:authenticated,isSuperAdmin:role==='SUPER_ADMIN',user:{name:'Synthetic user',internalUserId:'local:synthetic-admin'},memberships:[{role,campusId:'synthetic-campus'}]}});
    if (p==='/api/data-core/health') return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if (p==='/api/data-core/campuses') return route.fulfill({json:{campuses:[{id:'synthetic-campus',name:'합성 캠퍼스'}]}});
    if (p==='/api/data-core/records' && req.method()==='POST') {
      const body=req.postDataJSON();
      assert.equal(body.recordType,'competition-award-folder','Only the requested synthetic award folder may be created');
      const record={...body,id:'c',createdAt:'2026-09-03'};
      folders.push(record);return route.fulfill({status:201,json:{record}});
    }
    if (p==='/api/data-core/records/c' && req.method()==='DELETE') {
      folders=folders.filter(f=>f.id!=='c');return route.fulfill({json:{ok:true}});
    }
    if (p==='/api/data-core/records') return route.fulfill({json:{records:url.searchParams.get('recordType')==='competition-award-folder'?folders:hqFolders}});
    if (p==='/api/data-core/files' && req.method()==='POST') return route.fulfill({status:201,json:{file:{id:'synthetic-upload'}}});
    if (p==='/api/data-core/files') {
      const id=url.searchParams.get('recordId');
      if (id==='a' && slowA) await new Promise(r=>setTimeout(r,450));
      return route.fulfill({json:{files:id ? [...files(id),...files('foreign')] : []}});
    }
    if (p.startsWith('/api/data-core/files/')) {
      if(req.method()==='DELETE') { assert.equal(url.searchParams.get('awardFolderId'),p.split('/').pop().split('-')[0]); trashed.add(p.split('/').pop()); return route.fulfill({json:{ok:true,recoverable:true}}); }
      imageRequests.set(p,(imageRequests.get(p)||0)+1);
      return route.fulfill({contentType:'image/webp',body:image});
    }
    if (p.includes('/competition-sources/')) {
      const source=p.includes('/mgood/')?'mgood':'artmd', sourcePage=source==='mgood'?'https://www.mgood.co.kr/contest/21001_contest_list.php?state=main':'https://artndesign.com/shop/list.php?ca_id=20';
      return route.fulfill({json:{pages:[{url:sourcePage,ok:true}],items:[
        {title:'합성 접수중 대회',source,sourcePage,sourceStatus:'open',sourceUrl:`https://www.mgood.co.kr/synthetic?c_seq=${source}`,applicationEnd:'2099-09-20'},
        {title:'합성 종료 대회',source,sourcePage,sourceStatus:'unknown',sourceUrl:'https://www.mgood.co.kr/closed'},
      ]}});
    }
    return route.fulfill({json:{competitions:[],events:[],files:[],records:[]}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for (const [name,width,height,columns] of [['desktop',1440,1000,4],['wide',1920,1080,6],['tablet',820,1180,3],['mobile',390,844,2],['small-mobile',320,740,2]]) {
    await page.setViewportSize({width,height});
    await page.goto(`${base}/data-core/counseling/competitions`);
    await page.locator('[data-award-image="a-0"]').waitFor();
    assert.deepEqual(await page.locator('[data-award-folder-id]').evaluateAll(els=>els.map(e=>e.dataset.awardFolderId)),['a','b']);
    assert.equal(await page.locator('.award-folder-list > button:first-child').getAttribute('id'),'openAwardFolderBtn');
    assert.equal(await page.locator('[data-award-folder-id="a"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#awardLibraryFiles a').count(),8);
    assert.equal(await page.locator('#awardLibraryFiles').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),columns);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} overflow`);
    for (const img of await page.locator('[data-award-thumbnail]').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(img=>new Promise((resolve,reject)=>{
        if(img.complete && img.naturalWidth) return resolve();
        img.onload=resolve;img.onerror=reject;
      }));
    }
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});checks+=6;
    for (const close of ['button','escape','overlay']) {
      const before=imageRequests.get('/api/data-core/files/a-0');
      const started=Date.now();
      await page.locator('[data-award-image="a-0"]').click();
      await page.locator('#awardLightbox[open]').waitFor();
      assert.match(await page.locator('#awardLightboxImage').getAttribute('src'),/^blob:/);
      await page.locator('#awardLightboxImage').evaluate(img=>img.decode());
      assert.equal(imageRequests.get('/api/data-core/files/a-0'),before);
      console.log(JSON.stringify({viewport:name,close,warmOpenMs:Date.now()-started}));
      if(close==='button') await page.locator('#closeAwardLightboxBtn').click();
      if(close==='escape') await page.keyboard.press('Escape');
      if(close==='overlay') await page.mouse.click(2,2);
      await page.locator('#awardLightbox[open]').waitFor({state:'hidden'});checks++;
    }
    await page.locator('[data-award-folder-id="b"]').click();
    await page.locator('[data-award-image="b-0"]').waitFor();
    assert.equal(await page.locator('[data-award-image^="a-"]').count(),0);checks++;
  }
  slowA=true;
  await page.locator('[data-award-folder-id="a"]').click();
  assert.equal(await page.locator('#awardLibraryFiles a').count(),0);
  await page.locator('[data-award-folder-id="b"]').click();
  await page.locator('[data-award-image="b-0"]').waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-award-image^="a-"]').count(),0);checks+=2;
  await page.locator('#openAwardFolderBtn').click();
  await page.locator('#awardFolderTitle').fill('자유 이름 <합성> & 2027');
  await page.locator('#awardFolderForm button[type=submit]').click();
  await page.locator('[data-award-folder-id="c"]').waitFor();
  assert.equal(await page.locator('#selectedAwardFolderTitle').textContent(),'자유 이름 <합성> & 2027');
  assert.equal(await page.locator('[data-award-folder-id="c"]').getAttribute('aria-pressed'),'true');checks+=2;
  await page.locator('#openAwardUploadBtn').click();
  assert.equal(await page.locator('#uploadRecordId').inputValue(),'c');
  assert.equal(await page.locator('#uploadCampus').inputValue(),'');
  assert.equal(await page.locator('#uploadCampus').isDisabled(),true);
  assert.equal(await page.locator('#uploadCategory').isDisabled(),true);checks+=4;
  await page.locator('#uploadFile').setInputFiles({name:'synthetic.webp',mimeType:'image/webp',buffer:image});
  await page.locator('#uploadSubmitBtn').click();
  await page.locator('#uploadModal').waitFor({state:'hidden'});
  const upload=writes.find(w=>w.path==='/api/data-core/files');
  assert.match(upload.body,/name="recordId"\r\n\r\nc\r\n/);
  assert.match(upload.body,/competition-material/);checks+=2;
  page.once('dialog',d=>d.accept());
  await page.locator('#deleteAwardFolderBtn').click();
  await page.locator('[data-award-folder-id="c"]').waitFor({state:'detached'});
  assert.deepEqual(writes.filter(w=>w.method==='DELETE').map(w=>w.path),['/api/data-core/records/c']);checks++;
  await page.locator('[data-award-select="a-0"]').check();
  await page.getByRole('button',{name:'선택 삭제',exact:true}).click();
  await page.locator('#cancelAwardDeleteBtn').click();
  assert.equal(await page.locator('#awardLibraryFiles a').count(),8);
  await page.getByRole('button',{name:'선택 삭제',exact:true}).click();
  await page.locator('#confirmAwardDeleteBtn').click();
  await page.locator('[data-award-image="a-0"]').waitFor({state:'detached'});
  await page.locator('[data-award-image="a-1"]').waitFor();
  assert.equal(await page.locator('#awardLibraryFiles a').count(),7);
  trashed.clear();
  assert.equal(await page.getByRole('button',{name:'소식 가리기',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'소식 보이기',exact:true}).count(),0);
  await page.getByRole('button',{name:'새로고침',exact:true}).click();
  assert.equal(await page.getByText('합성 종료 대회',{exact:true}).count(),0);checks++;
  await page.goto(`${base}/data-core/counseling`);
  await page.goBack();await page.locator('[data-award-image="a-0"]').waitFor();
  await page.reload();await page.locator('[data-award-image="a-0"]').waitFor();checks+=2;
  for (const nextRole of ['SUPER_ADMIN','CAMPUS_DIRECTOR','TEACHER','STAFF']) {
    role=nextRole;
    await page.goto(`${base}/data-core/counseling`);
    await page.locator('#logoutBtn:not(.hidden)').waitFor();
    const positions=await page.evaluate(()=>{const user=document.getElementById('userChip').getBoundingClientRect(),logout=document.getElementById('logoutBtn').getBoundingClientRect();return {userRight:user.right,logoutLeft:logout.left,userY:user.y,logoutY:logout.y,nameVisible:getComputedStyle(document.querySelector('#userChip > div:last-child')).display};});
    assert.ok(positions.userRight<=positions.logoutLeft);
    assert.ok(positions.logoutLeft-positions.userRight<30);
    assert.notEqual(positions.nameVisible,'none'); checks+=3;
  }
  authenticated=false;await page.reload();
  await page.getByText('로그인이 필요합니다',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.getByRole('link',{name:'DATA CORE 로그인 화면 열기'}).isVisible(),true);
  assert.equal(await page.locator('#openAwardFolderBtn').isDisabled(),true);checks++;
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:checks,pageErrors:0,syntheticOnly:true,screenshots:output}));
} finally { await browser.close(); }

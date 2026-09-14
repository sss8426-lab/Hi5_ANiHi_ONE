import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ROADMAP_TEST_ORIGIN||'http://localhost:3138';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)&&!/^https:\/\/[a-f0-9]+-hi5-anihi-one\.sss8426\.workers\.dev$/.test(base))throw Error('Local/immutable Preview only');
const directory='outputs/curriculum-covers',assets=JSON.parse(await readFile(`${directory}/assets.json`,'utf8'));
const out=`${directory}/${base.startsWith('https')?'preview':'browser'}`;await mkdir(out,{recursive:true});
const images=new Map();for(const a of assets)images.set(a.id,await readFile(a.path));
assert.equal(new Set(assets.map(a=>a.sha256)).size,assets.length);
const sample=await sharp({create:{width:640,height:900,channels:3,background:'#edf0ee'}}).webp().toBuffer();
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[],reports=[];let mutations=0;
try {
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(req.method()==='POST'&&(u.pathname==='/api/auth/activity'||/competition-sources\/(mgood|artmd)\/preview$/.test(u.pathname)))return route.fulfill({json:{ok:true,items:[]}});
    if(req.method()!=='GET'){mutations++;return route.fulfill({status:405,body:''});}
    if(u.pathname.endsWith('/context'))return route.fulfill({json:{authenticated:true,canWrite:true,isSuperAdmin:true,user:{name:'Synthetic QA'},memberships:[]}});
    if(u.pathname.endsWith('/health'))return route.fulfill({json:{ok:true,bindings:{database:true,files:true}}});
    if(u.pathname.startsWith('/api/data-core/curriculum')) {
      const id=u.pathname.split('/folders/')[1],a=assets.find(a=>a.folderId===id),stage=a?.stage||u.searchParams.get('stage');
      const list=assets.filter(a=>a.stage===stage).map(a=>({id:a.folderId,title:a.title,order:a.order,parentFolderId:null,representativeUrl:`/api/data-core/files/${a.id}`,coverAlt:a.alt,pageCount:3}));
      const folder=list.find(f=>f.id===id)||null;
      const pages=folder?Array.from({length:3},(_,i)=>({id:`synthetic-${i}`,order:i+1,previewUrl:`/api/data-core/files/synthetic-preview-${i}`,thumbnailUrl:`/api/data-core/files/synthetic-thumb-${i}`,originalUrl:`/api/data-core/files/synthetic-original-${i}`,printUrl:`/api/data-core/files/synthetic-print-${i}`})):[];
      return route.fulfill({json:{family:'content',stage,folder,breadcrumbs:folder?[folder]:[],folders:folder?[]:list,pages,totalFolders:list.length,totalPages:list.length*3}});
    }
    if(u.pathname.startsWith('/api/data-core/files/'))return route.fulfill({body:images.get(u.pathname.split('/').at(-1))||sample,contentType:'image/webp'});
    return route.fulfill({json:{records:[],files:[],events:[],campuses:[],competitions:[],items:[]}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1920,1440,1280,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    for(const stage of ['basic','advanced','admission']) {
      await page.goto(`${base}/data-core/curriculum/content/${stage}`);await page.locator('.lesson-card').first().waitFor();
      const expected=assets.filter(a=>a.stage===stage);assert.equal(await page.locator('.lesson-card').count(),expected.length);
      for(const img of await page.locator('.lesson-card img').all()) {await img.scrollIntoViewIfNeeded();await img.evaluate(i=>i.decode());}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      const visible=await page.locator('.lesson-card img').evaluateAll(es=>es.map(e=>({src:e.getAttribute('src'),alt:e.alt,width:e.naturalWidth,height:e.naturalHeight})));
      for(let i=0;i<expected.length;i++){assert.equal(visible[i].src,`/api/data-core/files/${expected[i].id}`);assert.equal(visible[i].alt,expected[i].alt);assert.equal(visible[i].width,640);assert.equal(visible[i].height,480);}
      await page.screenshot({path:`${out}/${stage}-${width}.png`,fullPage:true});
      if(width===1440)for(const a of expected) {
        await page.locator(`.lesson-card[href*="${a.folderId}"]`).click();await page.locator('.lesson-counter').getByText('1 / 3',{exact:true}).waitFor();
        assert.ok(page.url().includes(a.folderId));await page.goBack();await page.locator('.lesson-card').first().waitFor();
      }
      reports.push({width,stage,covers:expected.length,passed:true});
    }
  }
  assert.deepEqual(errors,[]);assert.equal(mutations,0);
  const report={origin:base,realCoverAssets:assets.length,api:'synthetic isolated fixtures',reports,errors,mutations};
  await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}

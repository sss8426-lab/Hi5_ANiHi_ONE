import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import sharp from 'sharp';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),repo=resolve(root,'../..');
const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/sis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const executablePath=join(root,'node_modules/electron/dist/electron.exe'),output=join(repo,'outputs/sync-gui');await mkdir(output,{recursive:true});
const results=[];
for(const scale of [1,1.25,1.5]){
  const temp=await mkdtemp(join(tmpdir(),'hi5-sync-gui-')),sources={};
  for(const stage of ['basic','advanced','admission']){
    const source=join(temp,stage);await mkdir(join(source,'1 합성 수업'),{recursive:true});sources['content-'+stage]=source;
    const b=await sharp({create:{width:96,height:128,channels:3,background:'#7cab98'}}).jpeg().toBuffer();
    for(const name of ['1.jpg','2.jpg'])await writeFile(join(source,'1 합성 수업',name),b);
  }
  await writeFile(join(temp,'config.json'),JSON.stringify({configured:true,watch:false,sources}));
  let app;
  try{
    const env={...process.env,HI5_SYNC_TEST_DIR:temp,HI5_SYNC_TEST_REMOTE:join(here,'gui-remote.mjs')};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath,args:[`--force-device-scale-factor=${scale}`,root],env,timeout:60000});
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
    await page.waitForLoadState('load');
    try{await page.waitForFunction(()=>document.querySelectorAll('.target.new').length===3,{},{timeout:30000});}catch(e){await page.screenshot({path:join(output,'startup-error.png')});console.log(await page.locator('body').innerText());throw e;}
    assert.deepEqual(JSON.parse(await readFile(join(temp,'transport-counts.json'),'utf8')),{writes:0,uploads:0});
    assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
    const cdp=await page.context().newCDPSession(page);
    for(const width of [1920,1440,1280,1024]){
      const logicalWidth=Math.floor(width/scale),logicalHeight=Math.floor(1080/scale);
      await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width:logicalWidth,height:logicalHeight});
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:logicalWidth,height:logicalHeight,deviceScaleFactor:scale,mobile:false});
      await page.waitForFunction(w=>window.innerWidth===w,logicalWidth);
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dpr:devicePixelRatio,clipped:[...document.querySelectorAll('button')].filter(e=>e.offsetParent&&e.getBoundingClientRect().right>innerWidth+1).length}));
      assert.ok(geometry.scroll<=geometry.width+1);assert.equal(geometry.clipped,0);
      await page.screenshot({path:join(output,`sync-${width}-${scale}.png`),fullPage:true});results.push({width,scale,...geometry});
    }
    await page.getByRole('button',{name:'상세 보기'}).first().click();await page.getByRole('heading',{name:'기초과정 변경사항'}).waitFor();assert.match(await page.locator('.diff-list').innerText(),/1 합성 수업/);await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('button',{name:'중앙서버에 동기화',exact:true}).click();await page.getByRole('heading',{name:'중앙서버 반영 예정'}).waitFor();assert.match(await page.locator('#modal-body').innerText(),/중앙 자료 자동 삭제\s+0/);
    await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal(JSON.parse(await readFile(join(temp,'transport-counts.json'),'utf8')).writes,0);
    await page.getByRole('button',{name:'중앙서버에 동기화',exact:true}).click();await page.getByRole('button',{name:'동기화 시작',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.target.done').length===3,{},{timeout:120000});
    assert.equal(JSON.parse(await readFile(join(temp,'transport-counts.json'),'utf8')).uploads,24);
    await page.getByRole('button',{name:'변경사항 다시 확인',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.target.current').length===3);
    assert.equal(errors.length,0,errors.join('\n'));
    await page.getByRole('button',{name:'도움말',exact:true}).click();await page.getByRole('heading',{name:'도움말',exact:true}).waitFor();await page.screenshot({path:join(output,`help-${scale}.png`)});await page.getByRole('button',{name:'닫기',exact:true}).click();
    const config=await readFile(join(temp,'config.json'),'utf8');assert.doesNotMatch(config,/(oauth_token|password|Bearer|r2_key)/);
  }finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close();}await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
}
await writeFile(join(output,'result.json'),JSON.stringify({results,syntheticOnly:true,productionWrites:0},null,2));
console.log(JSON.stringify({viewportScalingChecks:results.length,syntheticSyncs:3,productionWrites:0,errors:0}));

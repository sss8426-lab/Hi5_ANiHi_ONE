import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
const {_electron}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/sis/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const output=resolve('outputs/sync-gui'),executablePath=resolve('dist-sync/1.0.0/win-unpacked/HI5-ANiHi-Sync.exe');await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.HI5_SYNC_TEST_DIR;delete env.HI5_SYNC_TEST_REMOTE;
let app;
try{
  app=await _electron.launch({executablePath,args:['--force-device-scale-factor=1'],env,timeout:60000});
  const page=await app.firstWindow();await page.waitForLoadState('load');
  await page.waitForFunction(()=>document.querySelectorAll('.target').length===3,{},{timeout:60000});
  if(await page.locator('#modal').isVisible())await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.target.current').length===3||[...document.querySelectorAll('.target')].some(t=>t.matches('.error,.offline,.blocked')),{},{timeout:600000});
  if(await page.locator('.target.current').count()!==3){await page.screenshot({path:join(output,'packaged-connection-error.png')});throw Error('Packaged central connection failed (no apply).');}
  const counts=await page.locator('.target .counts').allTextContents();assert.deepEqual(counts,['24개 수업 · 360개 파일','21개 수업 · 465개 파일','3개 수업 · 101개 파일']);
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  const security=await app.evaluate(({app,BrowserWindow})=>({packaged:app.isPackaged,windows:BrowserWindow.getAllWindows().map(w=>{const p=w.webContents.getLastWebPreferences();return {sandbox:p.sandbox,nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,webSecurity:p.webSecurity};})}));
  assert.equal(security.packaged,true);assert.deepEqual(security.windows[0],{sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true});
  await page.screenshot({path:join(output,'packaged-production-readonly.png')});
  // Only the local shortcut setting is invoked. No sync/apply confirmation is opened.
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'바탕화면 바로가기',exact:true}).click();
  await page.getByText('바탕화면 바로가기를 만들었습니다.',{exact:true}).waitFor();await page.getByRole('button',{name:'닫기',exact:true}).click();
  await writeFile(join(output,'packaged-production-readonly.json'),JSON.stringify({counts,security,productionApply:false,shortcutCreated:true,source:'fresh production comparison'},null,2));
  console.log(JSON.stringify({packaged:true,counts,productionApply:false,shortcutCreated:true}));
}finally{if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy();}).catch(()=>{});await app.close();}}

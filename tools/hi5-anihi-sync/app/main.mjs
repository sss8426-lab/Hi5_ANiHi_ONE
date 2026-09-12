import { app, BrowserWindow, ipcMain, dialog, shell, session, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const ORIGIN='hi5-sync://app';
protocol.registerSchemesAsPrivileged([{scheme:'hi5-sync',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setName('HI5·ANiHi Sync');
if(!app.requestSingleInstanceLock())app.exit(0);
let window,worker,state,settings,closing=false,sequence=0;
const pending=new Map();
const call=(command,value)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.send({id,command,value});});
app.on('second-instance',()=>{window?.restore();window?.focus();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{worker?.kill();});
app.whenReady().then(async()=>{
// Keep the branded middle dot out of HTTP headers (Chromium requires ASCII UA).
session.defaultSession.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36 HI5-ANiHi-Sync/1.0.0`);
const userDir=!app.isPackaged&&process.env.HI5_SYNC_TEST_DIR?process.env.HI5_SYNC_TEST_DIR:join(app.getPath('appData'),'HI5-ANiHi-Sync');
const localDir=!app.isPackaged&&process.env.HI5_SYNC_TEST_DIR?join(userDir,'local'):join(process.env.LOCALAPPDATA||app.getPath('userData'),'HI5-ANiHi-Sync');
session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
session.defaultSession.setPermissionCheckHandler(()=>false);
protocol.handle('hi5-sync',async request=>{
  const url=new URL(request.url);
  const assets=new Map([['/','index.html'],['/renderer.js','renderer.js'],['/style.css','style.css'],['/lucide.js','../.runtime/lucide.js'],['/logo.png','../.runtime/logo.png']]);
  if(url.host!=='app'||!assets.has(url.pathname))return new Response('',{status:404});
  const path=assets.get(url.pathname),type=path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':path.endsWith('.png')?'image/png':'text/html';
  return new Response(await readFile(resolve(here,path)),{headers:{'Content-Type':type==='image/png'?type:type+'; charset=utf-8','X-Content-Type-Options':'nosniff'}});
});
window=new BrowserWindow({title:'HI5·ANiHi Sync · DATA CORE',width:1080,height:860,minWidth:640,minHeight:550,backgroundColor:'#f4f7f5',show:false,icon:join(root,'.runtime/logo.png'),webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
window.removeMenu();
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',event=>event.preventDefault());
window.on('close',async event=>{
  if(!closing&&state?.busy){event.preventDefault();const answer=await dialog.showMessageBox(window,{type:'question',message:'작업을 중지하고 닫을까요?',detail:'완료된 자료는 유지됩니다. 다음 실행에서 다시 검사할 수 있습니다.',buttons:['계속 작업','중지 후 닫기'],defaultId:0,cancelId:0});if(answer.response===1){closing=true;await call('cancel');const timer=setInterval(()=>{if(!state?.busy){clearInterval(timer);window.close();}},200);}}
});
worker=fork(join(here,'worker.mjs'),[],{execPath:process.execPath,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HI5_SYNC_ROOT:root,HI5_SYNC_USER_DIR:userDir,HI5_SYNC_LOCAL_DIR:localDir,HI5_SYNC_TEST_REMOTE:!app.isPackaged?(process.env.HI5_SYNC_TEST_REMOTE||''):'',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}});
worker.on('message',message=>{
  if(message.type==='state'){state=message.state;settings=message.settings;window?.webContents.send('sync:state',{...state,settings});}
  if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);p.resolve(message.result);}
});
worker.on('exit',()=>{for(const p of pending.values())p.resolve({error:{message:'동기화 작업이 중단되었습니다. 앱을 다시 실행해 주세요.'}});pending.clear();if(!closing&&!window?.isDestroyed())window.webContents.send('sync:state',{...state,busy:false,error:{message:'작업 프로세스가 종료되었습니다. 앱을 다시 실행해 주세요.'}});});
ipcMain.handle('sync:command',async(event,command,value)=>{
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith(ORIGIN+'/'))throw Error('Blocked IPC');
  const allowed=['state','scan','confirm','apply','cancel','login','folder','settings','web','shortcut'];
  if(!allowed.includes(command))return {error:{message:'허용되지 않은 작업입니다.'}};
  if(command==='folder'){
    if(state?.busy||!state?.targets?.some(t=>t.id===value))return {error:{message:'현재 작업과 과정 선택을 확인해 주세요.'}};
    const selected=await dialog.showOpenDialog(window,{title:'커리큘럼 원본 폴더 선택',properties:['openDirectory','dontAddToRecent']});
    if(selected.canceled)return {cancelled:true};return call('folder',{id:value,path:selected.filePaths[0]});
  }
  if(command==='web'){
    const url=new URL(settings.baseUrl);if(url.protocol!=='https:'||url.username||url.password)return;
    await shell.openExternal(url.origin+'/data-core/curriculum');return {ok:true};
  }
  if(command==='shortcut'){
    if(!app.isPackaged)return {error:{message:'설치 또는 배포용 프로그램에서 만들 수 있습니다.'}};
    return {ok:shell.writeShortcutLink(join(app.getPath('desktop'),'HI5·ANiHi Sync.lnk'),'create',{target:process.execPath,cwd:dirname(process.execPath),description:'HI5·ANiHi DATA CORE 동기화',icon:process.execPath,iconIndex:0})};
  }
  return call(command,value);
});
await window.loadURL(ORIGIN+'/');window.show();
}).catch(()=>{dialog.showErrorBox('HI5·ANiHi Sync','프로그램을 시작하지 못했습니다. 앱을 다시 실행해 주세요.');app.exit(1);});

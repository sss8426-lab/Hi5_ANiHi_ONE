// Sandboxed Electron preload uses its restricted CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(command,value)=>ipcRenderer.invoke('sync:command',command,value);
contextBridge.exposeInMainWorld('hi5Sync',Object.freeze({
  state:()=>invoke('state'),scan:()=>invoke('scan'),confirm:ids=>invoke('confirm',ids),
  apply:value=>invoke('apply',value),cancel:()=>invoke('cancel'),
  login:()=>invoke('login'),chooseFolder:id=>invoke('folder',id),
  settings:value=>invoke('settings',value),openWeb:()=>invoke('web'),
  shortcut:()=>invoke('shortcut'),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('sync:state',listener);return()=>ipcRenderer.removeListener('sync:state',listener);}
}));

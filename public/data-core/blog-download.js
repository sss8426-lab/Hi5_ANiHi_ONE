import {Zip,ZipPassThrough,strToU8} from './vendor/fflate-0.8.3.js';
import {safeName,orderedName,exportHtml} from './blog-post-model.js';

export const DOWNLOAD_LIMIT=96*1024*1024;
export async function resolveFiles(fileIds,campusId,signal,originals=true){
  const response=await fetch('/api/data-core/content/blog/files',{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{'content-type':'application/json'},body:JSON.stringify({fileIds,campusId,originals})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'파일 확인 실패');
  return value.items;
}
export async function fetchOriginal(item,signal){
  const response=await fetch(item.url,{credentials:'same-origin',cache:'no-store',signal});
  if(!response.ok)throw Error(`${item.fileName}: ${response.status===403?'접근 권한이 변경되었습니다.':response.status===404?'파일이 없습니다.':'가져오기 실패 ('+response.status+')'}`);
  if(response.headers.get('etag')!==item.version){await response.body?.cancel();throw Error(`${item.fileName}: 파일 버전이 변경되었습니다. 다시 확인해주세요.`);}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>item.size||size>DOWNLOAD_LIMIT)throw Error(`${item.fileName}: 다운로드 크기 한도를 초과했습니다.`);chunks.push(value);}
    if(size!==item.size)throw Error(`${item.fileName}: 파일을 끝까지 받지 못했습니다.`);
    return new Blob(chunks,{type:item.mimeType});
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();chunks.length=0;}
}
export async function buildDownload({ids,campusId,originals=true,post,expectedVersions=new Map(),signal,onProgress=()=>{}}){
  onProgress('원본 확인 중');
  const items=await resolveFiles(ids,campusId,signal,originals),errors=items.filter(v=>v.error);
  if(errors.length)throw Error(errors.map(v=>`${v.selectedId}: ${v.error}`).join('\n'));
  for(const item of items)if(expectedVersions.get(item.selectedId)&&expectedVersions.get(item.selectedId)!==item.version)throw Error(`${item.fileName}: 저장한 게시물의 원본 버전과 다릅니다. 사진을 다시 확인하세요.`);
  if(!items.length)throw Error('선택한 사진이 없습니다.');
  if(items.reduce((sum,v)=>sum+v.size,0)>DOWNLOAD_LIMIT)throw Error('묶음은 96MB까지 준비할 수 있습니다. 사진을 나누거나 개별 다운로드해주세요.');
  if(items.length===1&&!post){onProgress('사진 가져오는 중 1/1');return {blob:await fetchOriginal(items[0],signal),name:safeName(items[0].fileName),items};}
  const chunks=[],names=new Map();let zipError;
  const zip=new Zip((error,data)=>{if(error)zipError=error;else chunks.push(data);});
  try{
    for(let i=0;i<items.length;i++){
      signal?.throwIfAborted();onProgress(`사진 가져오는 중 ${i+1}/${items.length}`);
      const item=items[i],blob=await fetchOriginal(item,signal),name=orderedName(item.fileName,i);
      if(post)names.set(post.blocks.filter(b=>b.type==='image')[i].id,name);
      const entry=new ZipPassThrough(name);zip.add(entry);entry.push(new Uint8Array(await blob.arrayBuffer()),true);
      if(zipError)throw zipError;
    }
    signal?.throwIfAborted();onProgress('묶음 준비 중');
    if(post){const entry=new ZipPassThrough('게시물.html');zip.add(entry);entry.push(strToU8(exportHtml(post,names)),true);}
    zip.end();if(zipError)throw zipError;
    return {blob:new Blob(chunks,{type:'application/zip'}),items};
  }finally{zip.terminate();chunks.length=0;}
}
export function startDownload(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeName(name,'사진.zip',150);document.body.append(a);a.click();a.remove();
  const timer=setTimeout(clean,30000);
  function clean(){clearTimeout(timer);URL.revokeObjectURL(url);window.removeEventListener('pagehide',clean);}
  window.addEventListener('pagehide',clean,{once:true});
}

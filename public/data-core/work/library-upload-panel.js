const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export async function readDropEntries(items){
  const files=[],directories=new Set();
  async function visit(entry,path=''){
    const name=path+entry.name;
    if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));files.push({file,path:name});}
    else if(entry.isDirectory){directories.add(name);const reader=entry.createReader();while(true){const children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!children.length)break;for(const child of children)await visit(child,name+'/');}}
    if(files.length>5000||directories.size>500)throw Error('한 번에 파일 5,000개·폴더 500개까지 업로드할 수 있습니다.');
  }
  for(const item of items){const entry=item.webkitGetAsEntry?.();if(entry)await visit(entry);else{const file=item.getAsFile?.();if(file)files.push({file,path:file.name});}}
  return {files,directories:[...directories]};
}
export function setupUploads({host,state,api,load}){
  const $=id=>document.getElementById(id),batches=[];let active=false,collapseTimer,pinned=false;
  const panel=el('section');panel.id='libraryUploadPanel';panel.className='lb-upload-panel';panel.hidden=true;panel.setAttribute('aria-label','업로드 진행');
  panel.innerHTML='<header><strong>업로드</strong><button data-toggle aria-label="업로드 진행창 접기">−</button></header><p data-summary role="status"></p><div data-body><div data-batches></div><p data-error role="alert"></p><button data-cancel>진행 중 업로드 취소</button></div>';document.body.append(panel);
  const folderInput=el('input');folderInput.type='file';folderInput.multiple=true;folderInput.setAttribute('webkitdirectory','');folderInput.hidden=true;host.append(folderInput);
  const folderButton=el('button','폴더 업로드');folderButton.className='lb-button';folderButton.id='libraryFolderUpload';$('libraryUpload').after(folderButton);folderButton.onclick=()=>folderInput.click();
  const updateVisibility=()=>{folderButton.hidden=$('libraryUpload').hidden;};new MutationObserver(updateVisibility).observe($('libraryUpload'),{attributes:true,attributeFilter:['hidden']});updateVisibility();
  const error=message=>{panel.hidden=false;panel.querySelector('[data-error]').textContent=message;panel.classList.remove('lb-collapsed');};
  const expand=()=>{clearTimeout(collapseTimer);panel.hidden=false;panel.classList.remove('lb-collapsed');};
  panel.querySelector('[data-toggle]').onclick=()=>{pinned=!panel.classList.contains('lb-collapsed');panel.classList.toggle('lb-collapsed');};
  function scheduleCollapse(){clearTimeout(collapseTimer);if(active||pinned||panel.matches(':hover')||panel.contains(document.activeElement)||batches.some(b=>b.queue.items.some(i=>['failed','cancelled'].includes(i.status)))||panel.querySelector('[data-error]').textContent)return;collapseTimer=setTimeout(()=>{if(!active&&!panel.matches(':hover')&&!panel.contains(document.activeElement))panel.classList.add('lb-collapsed');},2000);}
  panel.addEventListener('pointerenter',()=>clearTimeout(collapseTimer));panel.addEventListener('pointerleave',scheduleCollapse);panel.addEventListener('focusin',()=>clearTimeout(collapseTimer));panel.addEventListener('focusout',()=>setTimeout(scheduleCollapse));
  function render(){
    const items=batches.flatMap(b=>b.queue.items),done=items.filter(i=>i.status==='done').length,failed=items.filter(i=>i.status==='failed').length,total=items.reduce((s,i)=>s+i.total,0),bytes=items.reduce((s,i)=>s+Math.min(i.loaded,i.total),0);
    const pct=items.length&&done===items.length?100:Math.min(99,Math.floor(total?bytes/total*100:0));panel.querySelector('[data-summary]').textContent=`${pct}% · ${done}/${items.length}개 완료${failed?' · '+failed+'개 실패':''}`;
    const container=panel.querySelector('[data-batches]');container.replaceChildren();
    for(const batch of batches){const row=el('div');row.className='lb-upload-batch';const p=batch.queue.snapshot();row.append(el('strong',batch.title),el('p',`${p.success}/${p.count}개 · ${p.percent}%`));const progress=el('progress');progress.max=100;progress.value=p.percent;row.append(progress);
      const current=batch.queue.items.find(i=>i.status==='uploading');if(current)row.append(el('small',current.file.name+' · '+(current.phase==='thumbnail'?'원본 저장 완료 · 미리보기 준비 중':'원본 전송 중')));
      for(const i of batch.queue.items.filter(i=>i.status==='failed'))row.append(el('p',i.file.name+': '+i.error));
      const cancelled=batch.queue.items.filter(i=>i.status==='cancelled').length;if(cancelled)row.append(el('small',`${cancelled}개 취소됨`));
      const warnings=batch.queue.items.filter(i=>i.result?.thumbnailCreated===false).length;if(warnings)row.append(el('small',`원본 ${warnings}개 저장 완료 · 썸네일 생성은 실패했습니다.`));
      if(p.failed&&!p.running&&!active){const retry=el('button','실패 파일 재시도');retry.onclick=()=>{batch.retry=true;void drain();};row.append(retry);}container.append(row);
    }panel.querySelector('[data-cancel]').hidden=!active;
  }
  async function drain(){if(active)return;active=true;expand();
    try{for(const batch of batches){if(batch.started&&!batch.retry)continue;batch.started=true;const retry=batch.retry;batch.retry=false;await batch.queue.run(retry);}}
    finally{active=false;render();scheduleCollapse();if(batches.some(b=>b.target===state.folder?.id))await load();}
  }
  panel.querySelector('[data-cancel]').onclick=()=>{for(const batch of batches){batch.queue.cancel();batch.started=true;}render();};
  const chooser=el('dialog');chooser.className='lb-upload-choice';chooser.innerHTML='<h3>폴더 업로드</h3><p data-destination></p><label>같은 이름의 폴더 <select data-folders><option value="merge">기존 폴더와 합치기</option><option value="rename">새 이름으로 만들기</option></select></label><label>같은 이름의 파일 <select data-files><option value="rename">새 이름으로 저장</option><option value="skip">건너뛰기</option></select></label><div class="lb-toolbar"><button data-cancel>취소</button><button data-start>업로드</button></div>';host.append(chooser);
  function choose(title){return new Promise(resolve=>{chooser.querySelector('[data-destination]').textContent=title;let result=null;chooser.querySelector('[data-start]').onclick=()=>{result={folders:chooser.querySelector('[data-folders]').value,files:chooser.querySelector('[data-files]').value};chooser.close();};chooser.querySelector('[data-cancel]').onclick=()=>chooser.close();chooser.addEventListener('close',()=>resolve(result),{once:true});chooser.showModal();});}
  chooser.querySelector('[data-destination]').after(el('p','폴더 선택창은 빈 폴더를 전달하지 않을 수 있습니다. 빈 폴더는 지원 브라우저에서 폴더째 끌어 넣어 주세요.'));
  let preparing=false;
  async function enqueue(input,target){
    if(!target?.canWrite||!target.category){error('업로드할 수 있는 폴더를 선택하세요.');return;}
    if(preparing){error('이전 폴더 구성을 확인 중입니다. 잠시 후 추가해 주세요.');return;}preparing=true;
    try{
      const directories=new Set(input.directories);for(const item of input.files){const parts=item.path.split('/');parts.pop();while(parts.length){directories.add(parts.join('/'));parts.pop();}}
      if(input.files.length>5000||directories.size>500)throw Error('한 번에 파일 5,000개·폴더 500개까지 업로드할 수 있습니다.');
      for(const path of [...directories,...input.files.map(i=>i.path)])if(path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\\')||[...p].some(c=>c.charCodeAt(0)<32)))throw Error('올바르지 않은 상대 경로입니다.');
      if(new Set([...directories].map(path=>path.normalize('NFC'))).size!==directories.size)throw Error('문자 정규화 후 같은 이름이 되는 폴더가 있습니다. 폴더 이름을 구분해 주세요.');
      let choices=directories.size?await choose(target.title):null;if(directories.size&&!choices)return;
      expand();panel.querySelector('[data-error]').textContent='';panel.querySelector('[data-summary]').textContent='폴더 구성 확인 중…';
      const paths=new Map([['',target.id]]),views=new Map();
      const view=async id=>{if(!views.has(id))views.set(id,await api('/api/data-core/library/folders?counts=0&parentId='+encodeURIComponent(id)));return views.get(id);};
      const ordered=[...directories].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b));
      for(const path of ordered){const parts=path.split('/'),name=parts.pop().normalize('NFC'),parent=paths.get(parts.join('/'));const v=await view(parent);let found=v.folders.find(f=>f.title.normalize('NFC')===name),title=name;
        if(found&&choices.folders==='rename'){let n=2;while(v.folders.some(f=>f.title===title))title=`${name} (${n++})`;found=null;}
        if(!found){try{const response=await api('/api/data-core/library/folders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({parentFolderId:parent,title})});found=response.folder;v.folders.push(found);}catch(e){if(e.status!==409)throw e;views.delete(parent);const fresh=await view(parent);found=fresh.folders.find(f=>f.title===title);if(!found||choices.folders!=='merge')throw e;}}
        if(!found.canWrite)throw Error('하위 폴더에 업로드할 권한이 없습니다.');paths.set(path,found.id);
      }
      const names=new Map(),entries=[];let skipped=0;
      for(const inputFile of input.files){const parts=inputFile.path.split('/');parts.pop();const folderId=paths.get(parts.join('/'));if(!names.has(folderId)){const set=new Set();let page=1;while(true){const listing=await api(`/api/data-core/library/files?folderId=${encodeURIComponent(folderId)}&page=${page++}`);for(const f of listing.files)set.add(f.fileName.normalize('NFC'));if(!listing.hasMore)break;}names.set(folderId,set);}
        const set=names.get(folderId);let file=inputFile.file,name=file.name.normalize('NFC');
        if(set.has(name)){if(!choices){choices=await choose(target.title+' · 같은 이름의 파일이 있습니다.');if(!choices)return;}if(choices.files==='skip'){skipped++;continue;}const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';let n=2;while(set.has(name))name=`${base} (${n++})${ext}`;file=new File([file],name,{type:file.type,lastModified:file.lastModified});}set.add(name);
        entries.push({file,target:{recordId:folderId,libraryScoped:true,uploadRequestId:crypto.randomUUID()}});
      }
      if(!entries.length){panel.querySelector('[data-summary]').textContent=`폴더 준비 완료 · ${skipped}개 건너뜀`;if(state.folder?.id===target.id)await load();scheduleCollapse();return;}
      const batch={title:`${target.title} · ${entries.length}개${skipped?' / '+skipped+'개 건너뜀':''}`,target:target.id,started:false,queue:new window.DataCoreUploadQueue(entries,{recordId:target.id,libraryScoped:true},render,window.DataCoreLibraryThumbnail.send)};batches.push(batch);void drain();
    }catch(e){error(e.message);}finally{preparing=false;}
  }
  $('libraryUpload').onclick=()=>{if(state.folder?.canWrite)$('libraryFileInput').click();};
  $('libraryFileInput').onchange=()=>{const files=[...$('libraryFileInput').files].map(file=>({file,path:file.name}));$('libraryFileInput').value='';void enqueue({files,directories:[]},{...state.folder});};
  folderInput.onchange=()=>{const files=[...folderInput.files].map(file=>({file,path:file.webkitRelativePath||file.name}));folderInput.value='';void enqueue({files,directories:[]},{...state.folder});};
  host.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  host.addEventListener('drop',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();const target={...state.folder};void readDropEntries([...e.dataTransfer.items]).then(input=>enqueue(input,target)).catch(e=>error(e.message));});
  window.addEventListener('beforeunload',e=>{if(active||preparing){e.preventDefault();e.returnValue='';}});
}

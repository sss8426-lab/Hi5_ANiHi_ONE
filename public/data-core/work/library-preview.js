const vendor='/data-core/vendor/library-preview/';
let dialog,controller,worker,pdf,task,renderTask,timer,objectUrl,generation=0,page=1,zoom=1,fitMode=true;
const cache=new Map();let currentEntry=null,opener=null;
function clearCache(){for(const entry of cache.values())entry.task?.destroy();cache.clear();}
function remember(key,entry){cache.delete(key);cache.set(key,entry);while(cache.size>3||[...cache.values()].reduce((n,e)=>n+e.size,0)>48*1024*1024){const [id,old]=cache.entries().next().value;old.task?.destroy();cache.delete(id);}}
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function cleanup(){generation++;controller?.abort();worker?.terminate();if(task&&!pdf)task.destroy();renderTask?.cancel();clearTimeout(timer);if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;worker=null;pdf=null;task=null;currentEntry=null;}
function shell(){
  if(dialog)return;
  dialog=node('dialog');dialog.className='lb-preview';dialog.setAttribute('aria-labelledby','libraryPreviewTitle');
  dialog.innerHTML='<header><h3 id="libraryPreviewTitle"></h3><button type="button" data-close aria-label="미리보기 닫기">×</button></header><p class="lb-preview-path"></p><div class="lb-toolbar"><a data-download download>원본 다운로드</a><button data-locate>폴더에서 보기</button></div><p data-status role="status"></p><div data-controls class="lb-toolbar"></div><div data-body class="lb-preview-body"></div>';
  const nav=node('div');nav.className='lb-toolbar';nav.dataset.files='';dialog.querySelector('[data-controls]').before(nav);
  document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{cleanup();dialog.querySelector('[data-body]').replaceChildren();if(opener?.isConnected)opener.focus({preventScroll:true});});
  addEventListener('pagehide',()=>{dialog.close();clearCache();});document.addEventListener('click',e=>{if(e.target.closest('#logoutBtn')){dialog.close();clearCache();}},true);
}
async function renderPdf(g){
  renderTask?.cancel();const current=await pdf.getPage(page);if(g!==generation)return;
  if(fitMode)zoom=Math.min(1,(dialog.querySelector('[data-body]').clientWidth-16)/current.getViewport({scale:1}).width);
  const viewport=current.getViewport({scale:Math.min(zoom,3)}),canvas=node('canvas');
  if(viewport.width*viewport.height>16000000)throw Error('페이지 크기가 미리보기 제한을 초과합니다.');
  canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.maxWidth='none';canvas.style.width=viewport.width+'px';dialog.querySelector('[data-body]').replaceChildren(canvas);
  renderTask=current.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;
  if(g===generation)dialog.querySelector('[data-status]').textContent=`${page} / ${pdf.numPages} 페이지 · ${Math.round(zoom*100)}%`;
}
function button(text,action,parent){const b=node('button',text);b.type='button';b.onclick=action;parent.append(b);return b;}
function renderSheet(data){
  const controls=dialog.querySelector('[data-controls]');controls.replaceChildren();const select=node('select');select.setAttribute('aria-label','시트');
  data.names.forEach((name,i)=>{const o=node('option',name);o.value=i;select.append(o);});select.value=data.index;select.onchange=()=>{const index=Number(select.value);if(currentEntry.sheets?.[index])renderSheet(currentEntry.sheets[index]);else startParser('excel',currentEntry.buffer.slice(0),generation,index);};controls.append(select);
  const table=node('table'),head=node('thead'),heading=node('tr'),body=node('tbody');heading.append(node('th','행'));
  for(const cell of data.rows[0]||[]){const c=cell.c;heading.append(node('th',c<26?String.fromCharCode(65+c):'A'+String.fromCharCode(65+c-26)));}head.append(heading);table.append(head,body);
  let shown=0;const g=generation;
  const more=()=>{if(g!==generation)return;for(const row of data.rows.slice(shown,shown+50)){const tr=node('tr');tr.append(node('th',row.length?String(row[0].r+1):''));for(const cell of row){const merge=data.merges.find(m=>cell.r>=m.s.r&&cell.r<=m.e.r&&cell.c>=m.s.c&&cell.c<=m.e.c);if(merge&&(cell.r!==merge.s.r||cell.c!==merge.s.c))continue;const td=node('td',cell.text);if(merge){td.rowSpan=Math.min(500,merge.e.r-merge.s.r+1);td.colSpan=Math.min(50,merge.e.c-merge.s.c+1);}tr.append(td);}body.append(tr);}shown+=50;next.hidden=shown>=data.rows.length;};
  const next=button('다음 50행',more,controls);more();
  dialog.querySelector('[data-body]').replaceChildren(table);dialog.querySelector('[data-status]').textContent=data.limited?'처음 500행 · 50열만 표시합니다. 전체 내용은 원본을 다운로드해 주세요.':'저장된 값 기준 · 수식 및 매크로는 실행하지 않습니다.';
}
function raster(blob,label){objectUrl=URL.createObjectURL(blob);const img=node('img'),entry=currentEntry,g=generation;img.alt=label;img.onerror=()=>{delete entry.raster;if(g===generation)dialog.querySelector('[data-status]').textContent='손상되었거나 지원하지 않는 이미지입니다. 원본을 다운로드해 주세요.';};img.src=objectUrl;dialog.querySelector('[data-body]').replaceChildren(img);dialog.querySelector('[data-status]').textContent=label;
  const controls=dialog.querySelector('[data-controls]');controls.replaceChildren();let scale=1;const resize=()=>{img.style.maxWidth='none';img.style.width=Math.round(scale*100)+'%';};button('−',()=>{scale=Math.max(.25,scale-.25);resize();},controls);button('+',()=>{scale=Math.min(3,scale+.25);resize();},controls);button('화면 맞춤',()=>{scale=1;img.style.width='';img.style.maxWidth='100%';},controls);}
function pdfControls(g){const controls=dialog.querySelector('[data-controls]');controls.replaceChildren();for(const [label,change] of [['이전 페이지',()=>page=Math.max(1,page-1)],['다음 페이지',()=>page=Math.min(pdf.numPages,page+1)],['−',()=>{fitMode=false;zoom=Math.max(.25,zoom-.25);}],['+',()=>{fitMode=false;zoom=Math.min(3,zoom+.25);}],['화면 맞춤',()=>fitMode=true]])button(label,()=>{change();void renderPdf(g).catch(e=>{if(g===generation&&e.name!=='RenderingCancelledException')dialog.querySelector('[data-status]').textContent=e.message;});},controls);}
function startParser(kind,buffer,g,index=0){
  worker?.terminate();clearTimeout(timer);worker=new Worker(vendor+'parser.js',{type:'module'});const status=dialog.querySelector('[data-status]'),entry=currentEntry;
  timer=setTimeout(()=>{worker?.terminate();if(g===generation)status.textContent='미리보기 처리 시간 15초를 초과했습니다. 원본을 다운로드해 주세요.';},15000);
  worker.onerror=()=>{clearTimeout(timer);if(g===generation)status.textContent='미리보기 처리에 실패했습니다. 원본을 다운로드해 주세요.';};
  worker.onmessage=async({data})=>{if(g!==generation)return;if(data.error){clearTimeout(timer);status.textContent=data.error;return;}
    if(data.kind==='sheet'){entry.sheets||={};entry.sheets[data.index]=data;if(data.index!==index){worker.postMessage({kind:'sheet',index});return;}clearTimeout(timer);renderSheet(data);return;}
    clearTimeout(timer);let blob,label;
    if(data.kind==='thumbnail'){blob=new Blob([data.data],{type:'image/jpeg'});label='PSD에 저장된 저해상도 썸네일';}
    else{const canvas=node('canvas');canvas.width=data.width;canvas.height=data.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data),data.width,data.height),0,0);blob=await new Promise(r=>canvas.toBlob(r,'image/png'));canvas.width=canvas.height=0;label='PSD에 저장된 합성 이미지';}
    if(g!==generation||!blob)return;entry.raster=blob;entry.label=label;raster(blob,label);worker?.terminate();worker=null;
  };worker.postMessage({kind,buffer},[buffer]);
}
export async function open(file,locate,files=[],cachedOriginal){
  if(!dialog?.open)opener=document.activeElement;
  shell();cleanup();const g=generation;controller=new AbortController();page=1;zoom=1;fitMode=true;
  dialog.querySelector('h3').textContent=file.fileName;dialog.querySelector('.lb-preview-path').textContent=`${file.mimeType} · ${(file.sizeBytes/1024).toFixed(1)} KB\n`+(file.path||[]).map(p=>p.title).join(' > ');
  const navigation=dialog.querySelector('[data-files]');navigation.replaceChildren();const index=files.findIndex(f=>f.id===file.id);button('이전 파일',()=>void open(files[index-1],locate,files,cachedOriginal),navigation).disabled=index<=0;button('다음 파일',()=>void open(files[index+1],locate,files,cachedOriginal),navigation).disabled=index<0||index>=files.length-1;
  dialog.querySelector('[data-download]').href=file.downloadUrl;dialog.querySelector('[data-locate]').onclick=()=>{dialog.close();locate(file);};
  const body=dialog.querySelector('[data-body]'),status=dialog.querySelector('[data-status]'),controls=dialog.querySelector('[data-controls]');body.replaceChildren();controls.replaceChildren();status.textContent='미리보기 준비 중…';if(!dialog.open)dialog.showModal();
  try{
    const ext=file.fileName.split('.').pop().toLowerCase(),excel=['xlsx','xls','xlsm','csv'].includes(ext),psd=['psd','psb'].includes(ext);
    const limit=(excel?16:32)*1024*1024;
    if(file.sizeBytes>limit)throw Error(`미리보기 크기 제한 ${limit/1048576}MB를 초과합니다. 원본을 다운로드해 주세요.`);
    // Reuse only session memory, keyed by original ID, R2 version and renderer version.
    const head=await fetch(file.previewUrl,{method:'HEAD',cache:'no-store',signal:controller.signal});
    if(!head.ok){clearCache();throw Error([401,403].includes(head.status)?'이 파일에 접근할 권한이 없습니다.':'원본 파일을 찾을 수 없습니다.');}
    if(g!==generation)return;
    const key=file.id+':'+head.headers.get('etag')+':preview-v1';currentEntry=cache.get(key)||{size:file.sizeBytes};remember(key,currentEntry);
    if(currentEntry.raster){raster(currentEntry.raster,currentEntry.label);return;}
    if(currentEntry.pdf){pdf=currentEntry.pdf;pdfControls(g);await renderPdf(g);return;}
    if(currentEntry.sheets?.[0]){renderSheet(currentEntry.sheets[0]);return;}
    const cachedUrl=cachedOriginal?.(file);
    const response=await fetch(cachedUrl||file.previewUrl,{cache:'no-store',signal:controller.signal}).catch(error=>{if(!cachedUrl||error.name==='AbortError')throw error;return fetch(file.previewUrl,{cache:'no-store',signal:controller.signal});});
    if(!response.ok)throw Error([401,403].includes(response.status)?'이 파일에 접근할 권한이 없습니다.':response.status===404?'원본 파일을 찾을 수 없습니다.':'원본을 불러오지 못했습니다.');
    if(Number(response.headers.get('content-length'))>limit)throw Error('미리보기 크기 제한을 초과합니다.');
    const reader=response.body.getReader(),chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('미리보기 크기 제한을 초과합니다.');}chunks.push(value);}
    const blob=new Blob(chunks),buffer=await blob.arrayBuffer();if(g!==generation)return;
    const header=new TextDecoder('latin1').decode(buffer.slice(0,1024));
    if(header.includes('%PDF-')){
      const lib=await import(vendor+'build/pdf.mjs');if(g!==generation)return;lib.GlobalWorkerOptions.workerSrc=vendor+'build/pdf.worker.mjs';
      task=lib.getDocument({data:buffer,isEvalSupported:false,enableXfa:false,useWorkerFetch:false,maxImageSize:16000000,canvasMaxAreaInBytes:64000000,cMapUrl:vendor+'cmaps/',cMapPacked:true,standardFontDataUrl:vendor+'standard_fonts/',wasmUrl:vendor+'wasm/'});
      const loadingTask=task;let failure='';
      loadingTask.onPassword=()=>{failure='암호화된 PDF는 다운로드 후 열어주세요.';loadingTask.destroy();};
      const timeout=setTimeout(()=>{failure='PDF 처리 시간 15초를 초과했습니다. 원본을 다운로드해 주세요.';loadingTask.destroy();},15000);
      let loaded;try{loaded=await loadingTask.promise;}catch(e){throw Error(failure||e.message);}finally{clearTimeout(timeout);}
      if(g!==generation){loadingTask.destroy();return;}pdf=loaded;currentEntry.pdf=pdf;currentEntry.task=loadingTask;pdfControls(g);
      await renderPdf(g);return;
    }
    if(excel||psd){
      const bytes=new Uint8Array(buffer),zip=bytes[0]===80&&bytes[1]===75,ole=bytes[0]===208&&bytes[1]===207;
      if(excel&&ext!=='csv'&&!zip&&!ole)throw Error('엑셀 파일 시그니처가 올바르지 않습니다.');
      if(excel&&ext==='csv'&&bytes.slice(0,1024).includes(0))throw Error('텍스트 CSV 파일이 아닙니다.');
      if(excel)currentEntry.buffer=buffer.slice(0);startParser(excel?'excel':'psd',buffer,g);return;
    }
    if(ext==='ai')throw Error('PDF 호환 정보가 없는 AI 파일입니다. PDF 호환 옵션으로 저장하거나 원본을 다운로드해 주세요.');
    if(['jpg','jpeg','png','webp','gif','avif','bmp'].includes(ext)){
      const {imageSize}=await import(vendor+'image-size.mjs');if(g!==generation)return;let dimensions;
      try{dimensions=imageSize(new Uint8Array(buffer));}catch{throw Error('손상되었거나 지원하지 않는 이미지입니다.');}
      if(dimensions.width*dimensions.height>24000000)throw Error('이미지 미리보기는 2,400만 픽셀까지 지원합니다.');
      const label=`${dimensions.width} × ${dimensions.height}`;currentEntry.raster=blob;currentEntry.label=label;raster(blob,label);await body.querySelector('img').decode();return;
    }
    if(['txt','csv'].includes(ext)){body.append(node('pre',new TextDecoder().decode(buffer).slice(0,100000)));status.textContent='텍스트 미리보기';return;}
    throw Error('이 형식은 미리보기를 지원하지 않습니다. 원본을 다운로드해 주세요.');
  }catch(e){if(g===generation&&e.name!=='AbortError')status.textContent=e.message||'미리보기를 만들지 못했습니다.';}
}

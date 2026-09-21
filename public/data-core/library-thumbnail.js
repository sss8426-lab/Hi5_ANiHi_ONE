(() => {
  const supported = /^image\/(jpeg|png|webp|avif|gif)$/;
  const opaqueDesignFile = /\.(ai|psd|psb|clip|eps)$/i;
  let serial=Promise.resolve();
  async function encode(file,signal) {
    signal.throwIfAborted();
    const bitmap=await createImageBitmap(file);
    const canvas=document.createElement('canvas');
    try {
      signal.throwIfAborted();
      const scale=Math.min(1,480/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.76));
      if(!blob||blob.type!=='image/webp'||blob.size>256*1024)throw new Error('Thumbnail unavailable');
      signal.throwIfAborted();
      return blob;
    } finally { bitmap.close();canvas.width=canvas.height=0; }
  }
  function prepare(file,signal) {
    // Only decoding holds the memory gate. A slow server response must not hold it.
    const task=serial.then(()=>encode(file,signal));serial=task.catch(()=>{});
    return task;
  }
  async function persist(blob,id,signal,endpoint) {
    signal.throwIfAborted();
    const controller=new AbortController(),abort=()=>controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,15000);
    try {
      const body=new FormData();body.set('file',blob,'thumbnail.webp');
      const response=await fetch(endpoint || `/api/data-core/library/files/${encodeURIComponent(id)}/thumbnail`,{
        method:'POST',body,signal:controller.signal,credentials:'same-origin',cache:'no-store',
      });
      if(!response.ok)throw Object.assign(new Error('Thumbnail upload failed'),{status:response.status});
      return await response.json();
    } finally {clearTimeout(timeout);signal.removeEventListener('abort',abort);}
  }
  async function create(file,id,signal=new AbortController().signal,endpoint) {
    return persist(await prepare(file,signal),id,signal,endpoint);
  }
  async function send(file,target,signal,onProgress,item) {
    if(opaqueDesignFile.test(file.name)||!supported.test(file.type))return globalThis.DataCoreUploadQueue.send(file,target,signal,onProgress,item);
    const preparation=new AbortController(),abort=()=>preparation.abort();
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    // Overlap local preparation with the unchanged original-byte upload. Observe rejection now,
    // even when the original upload fails first; never send a preview without a saved original.
    const prepared=prepare(file,preparation.signal).catch(()=>null);
    try {
      const result=await globalThis.DataCoreUploadQueue.send(file,target,signal,onProgress,item);
      if(!result.file?.id)return result;
      if(item)item.phase='thumbnail';onProgress(file.size,file.size);
      try {
        const blob=await prepared;if(!blob)throw new Error('Thumbnail unavailable');
        await persist(blob,result.file.id,signal);result.thumbnailCreated=true;
      } catch {result.thumbnailCreated=false;console.warn('Library thumbnail unavailable; original upload preserved.');}
      return result;
    } finally {preparation.abort();signal.removeEventListener('abort',abort);if(item)item.phase='';}
  }
  globalThis.DataCoreLibraryThumbnail={send,create,prepare,persist};
})();

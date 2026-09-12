(() => {
  const supported = /^image\/(jpeg|png|webp|avif|gif)$/;
  let serial=Promise.resolve();
  async function create(file,id,signal=new AbortController().signal,endpoint) {
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
      const body=new FormData();body.set('file',blob,'thumbnail.webp');
      const response=await fetch(endpoint || `/api/data-core/library/files/${encodeURIComponent(id)}/thumbnail`,{
        method:'POST',body,signal,credentials:'same-origin',cache:'no-store',
      });
      if(!response.ok)throw new Error('Thumbnail upload failed');
      return response.json();
    } finally { bitmap.close();canvas.width=canvas.height=0; }
  }
  async function send(file,target,signal,onProgress) {
    const result=await DataCoreUploadQueue.send(file,target,signal,onProgress);
    if(!supported.test(file.type)||!result.file?.id)return result;
    // Decode only one local image at a time; an optional preview failure never retries the original upload.
    const task=serial.then(()=>create(file,result.file.id,signal));serial=task.catch(()=>{});
    try {await task;result.thumbnailCreated=true;}
    catch {result.thumbnailCreated=false;console.warn('Library thumbnail unavailable; original upload preserved.');}
    return result;
  }
  globalThis.DataCoreLibraryThumbnail={send,create};
})();

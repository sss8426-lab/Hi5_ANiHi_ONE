/* DATA CORE staff-only, bounded memory cache. Every new view revalidates over HTTP. */
class DataCorePrivateImageCache {
  constructor({ maxBytes = 32 * 1024 * 1024, maxEntries = 24, ttl = 300000, concurrency = 3, onUnauthorized = () => {}, transform=null } = {}) {
    Object.assign(this,{maxBytes,maxEntries,ttl,concurrency,onUnauthorized,transform});
    this.entries=new Map(); this.pending=new Map(); this.queue=[]; this.controllers=new Set(); this.bytes=0; this.active=0; this.generation=0; this.blocked=false;
  }
  evict(key) {
    const entry=this.entries.get(key); if(!entry)return;
    URL.revokeObjectURL(entry.url); this.bytes-=entry.size; this.entries.delete(key);
  }
  cancelPending() {
    this.generation++;
    for(const controller of this.controllers)controller.abort();
    for(const job of this.queue)job.reject(new DOMException('Cancelled','AbortError'));
    this.queue=[]; this.pending.clear();
  }
  clear() {this.cancelPending();for(const key of this.entries.keys())this.evict(key);}
  peek(path) {
    const entry=this.entries.get(path);
    if(entry&&Date.now()-entry.created<this.ttl)return entry.url;
    this.evict(path);return '';
  }
  get(path, {priority=false} = {}) {
    if(this.blocked)return Promise.reject(Object.assign(new Error('Unauthorized'),{status:403}));
    if(!/^\/api\/data-core\/library\/files\/[^/?#]+$/.test(path))return Promise.reject(new Error('Invalid image path'));
    const now=Date.now();
    for(const [key,entry] of this.entries)if(now-entry.created>=this.ttl)this.evict(key);
    const entry=this.entries.get(path);
    if(entry){this.entries.delete(path);this.entries.set(path,entry);return Promise.resolve(entry.url);}
    if(this.pending.has(path)){if(priority){const job=this.queue.find(job=>job.path===path);if(job)job.priority=true;this.pump();}return this.pending.get(path);}
    const generation=this.generation;
    const promise=new Promise((resolve,reject)=>this.queue.push({path,generation,resolve,reject,priority}));
    this.pending.set(path,promise); this.pump(); return promise;
  }
  pump() {
    this.queue.sort((a,b)=>Number(b.priority)-Number(a.priority));
    while(this.queue.length&&this.active<this.concurrency+(this.queue[0].priority?1:0)){const job=this.queue.shift();this.active++;void this.run(job);}
  }
  async run(job) {
    const controller=new AbortController();this.controllers.add(controller);
    try {
      const response=await fetch(job.path,{credentials:'same-origin',cache:'no-cache',signal:controller.signal});
      if(response.status===401||response.status===403){this.blocked=true;this.clear();this.onUnauthorized();}
      if(!response.ok)throw Object.assign(new Error('Image unavailable'),{status:response.status});
      if(!/^image\/(jpeg|png|webp|avif|gif|bmp|x-ms-bmp)(;|$)/i.test(response.headers.get('content-type')||''))throw Object.assign(new Error('Unsupported preview format'),{code:'unsupported_preview'});
      if(Number(response.headers.get('content-length'))>this.maxBytes)throw new Error('Image exceeds memory budget');
      const reader=response.body.getReader(), chunks=[];let size=0;
      try { while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;
        if(size>this.maxBytes){await reader.cancel();throw new Error('Image exceeds memory budget');}chunks.push(result.value);}
      } finally {reader.releaseLock();}
      if(controller.signal.aborted||job.generation!==this.generation)throw new DOMException('Cancelled','AbortError');
      let blob=new Blob(chunks,{type:response.headers.get('content-type')});
      if(this.transform)blob=await this.transform(blob,job.path,controller.signal);
      if(controller.signal.aborted||job.generation!==this.generation)throw new DOMException('Cancelled','AbortError');
      size=blob.size;
      if(size>this.maxBytes)throw new Error('Transformed image exceeds memory budget');
      while(this.entries.size&&(this.entries.size>=this.maxEntries||this.bytes+size>this.maxBytes))this.evict(this.entries.keys().next().value);
      const url=URL.createObjectURL(blob);
      this.entries.set(job.path,{url,size,created:Date.now()});this.bytes+=size;job.resolve(url);
    } catch(error) { controller.abort();job.reject(error); }
    finally {this.controllers.delete(controller);if(job.generation===this.generation)this.pending.delete(job.path);this.active--;this.pump();}
  }
}
globalThis.DataCorePrivateImageCache=DataCorePrivateImageCache;

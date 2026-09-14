// Page-memory cache; an optional callback can persist an already generated preview.
class AwardImageCache {
  constructor({ maxBytes = 128 * 1024 * 1024, maxEntries = 24, timeoutMs = 60000, onDenied = () => {}, onPreview = null } = {}) {
    Object.assign(this, { maxBytes, maxEntries, timeoutMs, onDenied, onPreview });
    this.entries = new Map();
    this.previews = new Map();
    this.pending = new Map();
    this.previewPending = new Map();
    this.bytes = 0;
    this.previewBytes = 0;
    this.generation = 0;
    this.active = 0;
    this.queue = [];
    this.blocked = false;
    this.previewController = new AbortController();
    this.persistCount = 0;
    this.persistQueue = Promise.resolve();
  }
  peek(id) {
    const entry = this.entries.get(id);
    if (!entry) return '';
    if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
      this.removeOriginal(id);
      return '';
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.url;
  }
  peekPreview(id) { return this.previews.get(id)?.url || ''; }
  removeOriginal(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    this.bytes -= entry.size;
    this.entries.delete(id);
  }
  remove(id) {
    this.removeOriginal(id);
    const preview = this.previews.get(id);
    if (preview) { URL.revokeObjectURL(preview.url); this.previewBytes -= preview.size; this.previews.delete(id); }
  }
  clear() {
    this.generation += 1;
    this.blocked = false;
    this.previewController.abort();
    this.previewController = new AbortController();
    this.persistCount = 0;
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    this.previewPending.clear();
    for (const id of this.entries.keys()) this.removeOriginal(id);
    for (const id of this.previews.keys()) this.remove(id);
    this.drain();
  }
  cancelQueued(id) {
    const pending = this.pending.get(id);
    if (pending && !pending.started && !pending.priority) pending.controller.abort();
    this.drain();
  }
  drain() {
    // Three gallery transfers, with a fourth slot reserved for a clicked original.
    this.queue.sort((a, b) => Number(b.priority) - Number(a.priority));
    for (let i = 0; i < this.queue.length;) {
      const job = this.queue[i];
      if (job.controller.signal.aborted) {
        this.queue.splice(i, 1); job.reject(new DOMException('Cancelled', 'AbortError')); continue;
      }
      if (this.active >= (job.priority ? 4 : 3)) { i += 1; continue; }
      this.queue.splice(i, 1); this.active += 1; job.started = true; job.resolve();
    }
  }
  async get(id, { priority = false } = {}) {
    return (await this.resource(id, priority)).url;
  }
  async resource(id, priority, path=`/api/data-core/files/${encodeURIComponent(id)}`) {
    if (this.blocked) throw new Error('접근 권한을 확인해 주세요.');
    if (this.peek(id)) return this.entries.get(id);
    const pending = this.pending.get(id);
    if (pending && !pending.controller.signal.aborted) {
      if (priority) { pending.priority = true; this.drain(); }
      return pending.promise;
    }
    const generation = this.generation;
    const job = { controller: new AbortController(), priority, started: false };
    const permit = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    this.queue.push(job);
    job.promise = (async () => {
      await permit;
      const timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, this.timeoutMs);
      try {
        if (job.controller.signal.aborted || generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
        const response = await fetch(path, {
          credentials: 'same-origin', cache: 'no-cache', signal: job.controller.signal,
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status)) { this.clear(); this.blocked = true; this.onDenied(); }
          throw new Error('이미지를 열 수 없습니다. 다시 시도해 주세요.');
        }
        const blob = await response.blob();
        if (job.controller.signal.aborted || generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
        if (!blob.type.startsWith('image/') || blob.size > this.maxBytes) throw new Error('이미지 크기 또는 형식을 확인해 주세요.');
        while (this.entries.size && (this.bytes + blob.size > this.maxBytes || this.entries.size >= this.maxEntries)) {
          this.removeOriginal(this.entries.keys().next().value);
        }
        const entry = { url: URL.createObjectURL(blob), blob, size: blob.size, createdAt: Date.now() };
        this.entries.set(id, entry); this.bytes += blob.size;
        return entry;
      } catch (error) {
        if (job.timedOut) throw new Error('이미지 응답이 늦어지고 있습니다. 다시 시도해 주세요.');
        throw error;
      } finally { clearTimeout(timer); this.active -= 1; this.drain(); }
    })();
    this.pending.set(id, job);
    this.drain();
    try { return await job.promise; }
    finally { if (this.pending.get(id) === job) this.pending.delete(id); }
  }
  async getThumbnail(id, thumbnailUrl) {
    if (this.blocked) throw new Error('접근 권한을 확인해 주세요.');
    if (this.peekPreview(id)) return this.peekPreview(id);
    if (this.previewPending.has(id)) return this.previewPending.get(id);
    const generation = this.generation;
    const task = (async () => {
      if(/^\/api\/data-core\/files\/[^/?#]+$/.test(thumbnailUrl||'')) {
        try {
          const key=`thumbnail:${id}`, entry=await this.resource(key,false,thumbnailUrl);
          if(entry.size>256*1024||this.previews.size>=100||this.previewBytes+entry.size>32*1024*1024)throw Error('Invalid thumbnail size');
          if(generation!==this.generation)throw new DOMException('Cancelled','AbortError');
          const url=URL.createObjectURL(entry.blob);
          this.previews.set(id,{url,size:entry.size});this.previewBytes+=entry.size;this.removeOriginal(key);
          return url;
        } catch(error){if(this.blocked||error.name==='AbortError')throw error;}
      }
      const entry = await this.resource(id, false);
      const bitmap = await createImageBitmap(entry.blob, { resizeWidth: 480, resizeQuality: 'medium' });
      const canvas = document.createElement('canvas');
      try {
        const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('미리보기를 만들 수 없습니다.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.78));
        if (generation !== this.generation) throw new DOMException('Cancelled', 'AbortError');
        // One folder has at most 100 rows. Original LRU eviction must never revoke a displayed tile.
        if (!blob || blob.size > 256 * 1024 || this.previews.size >= 100 || this.previewBytes + blob.size > 32 * 1024 * 1024) {
          throw new Error('미리보기를 만들 수 없습니다.');
        }
        const url = URL.createObjectURL(blob);
        this.previews.set(id, { url, size: blob.size }); this.previewBytes += blob.size;
        // Reuse bytes already decoded for the visible tile; never scan/backfill a whole bucket.
        if (this.onPreview && this.persistCount < 5) {
          this.persistCount++;
          const signal = this.previewController.signal;
          this.persistQueue = this.persistQueue.then(() => {
            if (!signal.aborted) return this.onPreview(id, blob, signal);
          }).catch(() => {});
        }
        return url;
      } finally { bitmap.close(); canvas.width = canvas.height = 0; }
    })();
    this.previewPending.set(id, task);
    try { return await task; }
    finally { if (this.previewPending.get(id) === task) this.previewPending.delete(id); }
  }
}

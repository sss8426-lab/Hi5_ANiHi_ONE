// Private image bytes live only in this page, never in persistent browser storage.
class AwardImageCache {
  constructor({ maxBytes = 128 * 1024 * 1024, maxEntries = 24 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.pending = new Map();
    this.bytes = 0;
    this.generation = 0;
    this.active = 0;
    this.queue = [];
  }
  peek(id) {
    const entry = this.entries.get(id);
    if (!entry) return '';
    if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
      this.remove(id);
      return '';
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.url;
  }
  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    this.bytes -= entry.size;
    this.entries.delete(id);
  }
  clear() {
    this.generation += 1;
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    for (const id of this.entries.keys()) this.remove(id);
  }
  async get(id) {
    const existing = this.peek(id);
    if (existing) return existing;
    if (this.pending.has(id)) return this.pending.get(id).promise;
    const controller = new AbortController();
    const generation = this.generation;
    const promise = (async () => {
      if (this.active >= 3) await new Promise((resolve) => this.queue.push(resolve));
      else this.active += 1;
      try {
      if (controller.signal.aborted || generation !== this.generation) throw new Error('이미지 요청이 취소되었습니다.');
      const response = await fetch(`/api/data-core/files/${encodeURIComponent(id)}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) this.clear();
        throw new Error('이미지를 열 수 없습니다. 접근 권한을 확인해 주세요.');
      }
      const blob = await response.blob();
      if (generation !== this.generation) throw new Error('이미지 요청이 취소되었습니다.');
      if (!blob.type.startsWith('image/') || blob.size > this.maxBytes) throw new Error('이미지 크기 또는 형식을 확인해 주세요.');
      while (this.entries.size && (this.bytes + blob.size > this.maxBytes || this.entries.size >= this.maxEntries)) {
        this.remove(this.entries.keys().next().value);
      }
      const url = URL.createObjectURL(blob);
      this.entries.set(id, { url, size: blob.size, createdAt: Date.now() });
      this.bytes += blob.size;
      return url;
      } finally {
        const next = this.queue.shift();
        if (next) next();
        else this.active -= 1;
      }
    })();
    this.pending.set(id, { controller, promise });
    try { return await promise; }
    finally { if (this.pending.get(id)?.promise === promise) this.pending.delete(id); }
  }
}
